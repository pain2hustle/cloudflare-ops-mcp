// zonemender-mcp — a remote MCP server (Cloudflare Worker) that exposes the
// zonemender engine as MCP tools over a URL. Any MCP client (Claude, Cursor,
// an agent) can point at it and scan / plan / fix a Cloudflare zone.
//
// HARDENED vs a naive version, on purpose:
//   • The Cloudflare API token is a WORKER SECRET (env.CLOUDFLARE_API_TOKEN).
//     It is NEVER a tool parameter, so it never travels through an MCP client's
//     logs or an agent's transcript. Set it once:  wrangler secret put CLOUDFLARE_API_TOKEN
//   • Every mutating tool is DRY-RUN by default. It returns the planned diff and
//     writes NOTHING unless the caller passes { apply: true }. See the diff first.
//   • BIMI inherits the engine's hard DMARC precondition (won't write over p=none
//     unless { force: true }). Delete is intentionally NOT exposed here.
//   • No external dependencies, no Durable Object — a plain Worker that speaks
//     JSON-RPC 2.0 (MCP). Deploys clean on the Workers free tier.
//
// Import the engine modules directly (NOT ../src/index.js — that barrel pulls in
// audit.js which uses node:fs, unavailable in a Worker isolate).
import { CloudflareClient, redactToken } from "../src/client.js";
import { scanZone } from "../src/zone.js";
import { applyDnsRecord } from "../src/dns.js";
import { setDmarcPolicy } from "../src/dmarc.js";
import { setupBimi } from "../src/bimi.js";
import { setupEmailRouting } from "../src/email.js";
import { planEmailAuth } from "../src/plan.js";
import { purgeCache } from "../src/cache.js";
import { planPagesCutover } from "../src/pages.js";
import { getOAuthAccessToken, handleOAuthCallback, handleOAuthStart, handleOAuthStatus } from "./oauth.js";

const SERVER = {
  name: "zonemender-mcp",
  title: "Cloudflare DNS, Email-Auth & Cache Ops (zonemender)",
  version: "0.1.0",
};
const PROTOCOL_FALLBACK = "2025-06-18";

// ── Tool catalog (inputSchema = JSON Schema; NOTE: no token field anywhere) ──
const TOOLS = [
  {
    name: "scan_zone",
    description:
      "Read-only snapshot of a domain's Cloudflare zone: all DNS records plus parsed SPF, DMARC, BIMI, and Email Routing status. Never writes.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string", description: "Domain to scan, e.g. example.com" } },
      required: ["domain"],
    },
  },
  {
    name: "plan_email_auth",
    description:
      "Analyze a domain's email authentication (SPF/DKIM/DMARC/BIMI/routing) and report what is missing or misconfigured, with the exact records to add. Never writes.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Domain to analyze" },
        inbox: { type: "string", description: "Where DMARC aggregate reports should go, e.g. you@gmail.com" },
      },
      required: ["domain"],
    },
  },
  {
    name: "verify_domain",
    description:
      "Re-scan a domain and return a pass/fail checklist: SPF, DMARC present + enforced, MX, Email Routing, BIMI, DKIM count. Never writes.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" } },
      required: ["domain"],
    },
  },
  {
    name: "apply_dns_record",
    description:
      "Upsert a single DNS record (create if absent, update if content differs, no-op if identical). DRY-RUN by default — returns the planned diff and writes nothing unless apply=true. Never deletes.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        type: { type: "string", description: "TXT, CNAME, MX, A, AAAA…" },
        name: { type: "string", description: "Record name, e.g. @, _dmarc, default._bimi" },
        content: { type: "string", description: "Record value" },
        priority: { type: "number", description: "MX priority (MX only)" },
        proxied: { type: "boolean" },
        apply: { type: "boolean", description: "Set true to actually write. Default false = dry-run." },
      },
      required: ["domain", "type", "name", "content"],
    },
  },
  {
    name: "set_dmarc_policy",
    description:
      "Change the _dmarc policy (none|quarantine|reject), preserving other tags. DRY-RUN by default — returns the before/after diff and writes nothing unless apply=true.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        policy: { type: "string", enum: ["none", "quarantine", "reject"] },
        rua: { type: "string", description: "Optional aggregate-report mailbox, e.g. mailto:you@gmail.com" },
        pct: { type: "number", description: "Optional rollout percentage 1-100" },
        apply: { type: "boolean", description: "Default false = dry-run." },
      },
      required: ["domain", "policy"],
    },
  },
  {
    name: "setup_bimi",
    description:
      "Create/update the default._bimi TXT record pointing at a logo SVG. REFUSES to write when DMARC is p=none (unless force=true) because BIMI won't be honored without enforced DMARC. DRY-RUN by default.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        logo: { type: "string", description: "HTTPS URL to an SVG Tiny-PS logo" },
        vmc: { type: "string", description: "Optional Verified Mark Certificate PEM URL" },
        apply: { type: "boolean", description: "Default false = dry-run." },
        force: { type: "boolean", description: "Override the DMARC precondition (not recommended)." },
      },
      required: ["domain", "logo"],
    },
  },
  {
    name: "setup_email_routing",
    description:
      "Enable Cloudflare Email Routing and create forward rules (+ optional catch-all). Cloudflare auto-adds the MX/SPF records. DRY-RUN by default. Destination addresses must be verified by their owner via Cloudflare's email.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        forwards: {
          type: "array",
          description: "List of { address, to } forward rules, e.g. { address: 'hello@example.com', to: 'you@gmail.com' }",
          items: {
            type: "object",
            properties: { address: { type: "string" }, to: { type: "string" } },
            required: ["address", "to"],
          },
        },
        catch_all: { type: "string", description: "Optional catch-all destination address" },
        apply: { type: "boolean", description: "Default false = dry-run." },
        force: { type: "boolean", description: "Create rules even to unverified destinations (not recommended — they stay disabled)." },
      },
      required: ["domain"],
    },
  },
  {
    name: "pages_cutover",
    description:
      "Plan or apply a Cloudflare Pages DNS cutover. Deletes only conflicting apex/www A/AAAA/CNAME records and www NS delegations, then creates proxied CNAMEs to the Pages target. DRY-RUN by default; writes only when apply=true.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Root zone, e.g. example.com" },
        target: { type: "string", description: "Pages hostname, normally project.pages.dev" },
        include_www: { type: "boolean", description: "Also cut over www. Default true." },
        include_wildcard: { type: "boolean", description: "Also remove conflicting wildcard records. Default false." },
        apply: { type: "boolean", description: "Default false = dry-run." },
      },
      required: ["domain", "target"],
    },
  },
  {
    name: "purge_cache",
    description:
      "Purge Cloudflare's cache for a zone — the whole zone (default) or specific URLs. DRY-RUN by default: returns the scope and purges NOTHING unless apply=true. Needs a token with Zone > Cache Purge.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Zone, e.g. example.com" },
        everything: { type: "boolean", description: "Purge the whole zone cache (default when no urls given)." },
        urls: { type: "array", items: { type: "string" }, description: "Specific absolute URLs to purge (max 30)." },
        apply: { type: "boolean", description: "Default false = dry-run." },
      },
      required: ["domain"],
    },
  },
];

// ── Tool implementations (each returns a plain object; serialized as text) ──
async function runTool(name, args, env) {
  const tenant = String(args.tenant || "default").trim() || "default";
  const token = (await getOAuthAccessToken(env, tenant)) || env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    return {
      error:
        "No Cloudflare token configured. Connect Cloudflare with /oauth/cloudflare/start or set CLOUDFLARE_API_TOKEN as a Worker secret.",
    };
  }
  const client = new CloudflareClient({ token });
  const domain = String(args.domain || "").trim();
  if (!domain) return { error: "domain is required" };

  switch (name) {
    case "scan_zone":
      return await scanZone(client, domain);

    case "plan_email_auth":
      return await planEmailAuth(client, domain, { inbox: args.inbox });

    case "verify_domain": {
      const s = await scanZone(client, domain);
      const p = s.dmarc && s.dmarc.parsed ? String(s.dmarc.parsed.tags?.p || "").toLowerCase() : "";
      const enforced = p === "quarantine" || p === "reject";
      const dkim = (s.dns || []).filter(
        (r) => r.type === "TXT" && /_domainkey/i.test(r.name)
      ).length;
      const mx = (s.dns || []).some((r) => r.type === "MX");
      const routing = !!(s.email_routing && (s.email_routing.enabled || s.email_routing.status === "ready"));
      const checks = {
        spf: !!s.spf,
        dmarc: !!s.dmarc,
        dmarc_enforced: enforced,
        mx,
        email_routing: routing,
        bimi: !!s.bimi,
        dkim_records: dkim,
      };
      const all_pass = checks.spf && checks.dmarc && enforced && mx && checks.bimi;
      return { domain, checks, all_pass };
    }

    case "apply_dns_record":
      return await applyDnsRecord(
        client,
        domain,
        { type: args.type, name: args.name, content: args.content, priority: args.priority, proxied: args.proxied },
        { apply: args.apply === true }
      );

    case "set_dmarc_policy":
      return await setDmarcPolicy(
        client,
        domain,
        String(args.policy),
        { rua: args.rua, pct: args.pct },
        { apply: args.apply === true }
      );

    case "setup_bimi":
      return await setupBimi(
        client,
        domain,
        { logo: args.logo, vmc: args.vmc },
        { apply: args.apply === true, force: args.force === true }
      );

    case "setup_email_routing":
      return await setupEmailRouting(
        client,
        domain,
        { forwards: args.forwards || [], catchAll: args.catch_all },
        { apply: args.apply === true, force: args.force === true }
      );

    case "pages_cutover":
      return await planPagesCutover(client, domain, {
        target: args.target,
        includeWww: args.include_www !== false,
        includeWildcard: args.include_wildcard === true,
        apply: args.apply === true,
      });

    case "purge_cache":
      return await purgeCache(client, domain, {
        everything: args.everything === true,
        files: args.urls,
        apply: args.apply === true,
      });

    default:
      return { error: `unknown tool: ${name}` };
  }
}

// ── JSON-RPC 2.0 / MCP dispatch ──
function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRpc(msg, env) {
  const { id, method, params } = msg || {};
  // Notifications (no id) — acknowledge with nothing.
  if (id === undefined || id === null) return null;

  if (method === "initialize") {
    const requested = params && params.protocolVersion;
    return rpcResult(id, {
      protocolVersion: typeof requested === "string" ? requested : PROTOCOL_FALLBACK,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER,
      instructions:
        "zonemender audits and fixes a domain's Cloudflare DNS and email-authentication setup. " +
        "Use it to: scan a Cloudflare zone (all DNS records plus parsed SPF, DMARC, BIMI, and Email Routing status); " +
        "diagnose email deliverability and spoofing gaps; and apply targeted fixes — set or enforce a DMARC policy " +
        "(none → quarantine → reject), publish or repair SPF, set up BIMI (your brand logo in inboxes, gated on DMARC " +
        "enforcement), configure Email Routing forwards, or upsert any single DNS record (TXT/CNAME/MX/A/…). " +
        "Safety: every write is DRY-RUN by default and returns a diff; nothing changes unless you pass apply=true, and " +
        "records are never deleted without explicit confirmation. The scoped Cloudflare API token is supplied to the " +
        "server as a secret, never as a tool argument. " +
        "zonemender is an independent, third-party open-source tool — not affiliated with, endorsed by, or sponsored by " +
        "Cloudflare, Inc.; \"Cloudflare\" is used nominatively to name the service this tool works with.",
    });
  }
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });
  if (method === "tools/call") {
    const toolName = params && params.name;
    const args = (params && params.arguments) || {};
    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) return rpcError(id, -32602, `unknown tool: ${toolName}`);
    try {
      const out = await runTool(toolName, args, env);
      const isError = !!(out && out.error);
      // Best-effort audit to observability (redacted; never the token).
      if (args.apply === true && !isError) {
        console.log(redactToken(`[audit] ${toolName} apply domain=${args.domain}`));
      }
      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        isError,
      });
    } catch (e) {
      const safe = redactToken(String((e && e.message) || e));
      return rpcResult(id, { content: [{ type: "text", text: `Error: ${safe}` }], isError: true });
    }
  }
  return rpcError(id, -32601, `method not found: ${method}`);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, X-MCP-Key, Mcp-Session-Id, Mcp-Protocol-Version",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === "/oauth/cloudflare/start") return handleOAuthStart(request, env);
    if (url.pathname === "/oauth/cloudflare/callback") return handleOAuthCallback(request, env);
    if (url.pathname === "/oauth/cloudflare/status") return handleOAuthStatus(request, env);
    // Health/info on GET.
    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          ok: true,
          server: SERVER,
          tools: TOOLS.map((t) => t.name),
          auth_required: !!env.MCP_ACCESS_KEY,
          token_configured: !!env.CLOUDFLARE_API_TOKEN,
          note: "POST JSON-RPC 2.0 (MCP) to this endpoint.",
        }, null, 2),
        { status: 200, headers: { "content-type": "application/json", ...CORS } }
      );
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS });
    }

    // Endpoint lock: this server can MUTATE DNS, so a public URL must fail
    // closed. MCP_ACCESS_KEY is required for every POST; do not deploy this
    // Worker as a callable MCP server until the secret exists.
    const gate = env.MCP_ACCESS_KEY;
    if (!gate) {
      return new Response(JSON.stringify(rpcError(null, -32002, "server missing MCP_ACCESS_KEY")), {
        status: 503,
        headers: { "content-type": "application/json", ...CORS },
      });
    }
    const auth = request.headers.get("authorization") || "";
    const provided = (/^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "") : "").trim()
      || (request.headers.get("x-mcp-key") || "").trim();
    if (provided !== gate) {
      return new Response(JSON.stringify(rpcError(null, -32001, "unauthorized")), {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": "Bearer", ...CORS },
      });
    }

    let body;
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify(rpcError(null, -32700, "parse error")), { status: 400, headers: { "content-type": "application/json", ...CORS } });
    }

    // Support a single message or a batch.
    const single = !Array.isArray(body);
    const messages = single ? [body] : body;
    const out = [];
    for (const m of messages) {
      const r = await handleRpc(m, env);
      if (r) out.push(r);
    }

    // Notifications only → 202 with no body.
    if (out.length === 0) return new Response(null, { status: 202, headers: CORS });

    const payload = single ? out[0] : out;
    const wantsSse = /text\/event-stream/i.test(request.headers.get("accept") || "");
    if (wantsSse) {
      const sse = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...CORS } });
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json", ...CORS } });
  },
};
