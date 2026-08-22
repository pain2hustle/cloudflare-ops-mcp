// src/federation.js
// Lightweight MCP federation. Register upstream MCP servers; their tools appear
// in THIS server's catalog under a namespace (namespace__tool), and tools/call
// is proxied to them. Turns cfops into a single front-door over a fleet of MCP
// servers (walo-mcp, covey-mcp, Gmail, …) without re-implementing their tools.
//
// State lives in the same KV as OAuth (env.CLOUDFLARE_OPS_OAUTH), keyed under
// fed:* so it never collides with session:/connection:/state:.

const IDX_KEY = "fed:index";
const up = (ns) => `fed:upstream:${ns}`;
const NS_SEP = "__";

function cleanNs(ns) {
  return String(ns || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
}

async function readIndex(env) {
  try { return JSON.parse((await env.CLOUDFLARE_OPS_OAUTH.get(IDX_KEY)) || "[]"); } catch { return []; }
}
async function writeIndex(env, list) {
  await env.CLOUDFLARE_OPS_OAUTH.put(IDX_KEY, JSON.stringify([...new Set(list)]));
}
async function getUpstream(env, ns) {
  try { return JSON.parse(await env.CLOUDFLARE_OPS_OAUTH.get(up(ns))); } catch { return null; }
}

// Reject upstreams that point anywhere except a public HTTPS host. Previously the
// only check was a `https://` prefix, so an operator (or anything that reached
// this tool) could aim the Worker at loopback, link-local, RFC1918, or cloud
// metadata and have it POST caller-supplied JSON there from Cloudflare's edge.
// 2026-08-21.
function validateUpstreamUrl(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch { return "url must be a valid absolute URL"; }
  if (u.protocol !== "https:") return "url must be https://";
  if (u.username || u.password) return "url must not embed credentials";
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return `refusing non-public host: ${host}`;
  }
  // IPv4 literal — block loopback / private / link-local / metadata / CGNAT.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254) ||          // link-local incl. 169.254.169.254 metadata
        (a === 100 && b >= 64 && b <= 127)) { // CGNAT
      return `refusing non-public address: ${host}`;
    }
  }
  // IPv6 literal — block loopback, unique-local, link-local, and v4-mapped.
  if (host.includes(":")) {
    if (host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe80/.test(host) || host.includes("::ffff:")) {
      return `refusing non-public address: ${host}`;
    }
  }
  return null;
}
export async function addUpstream(env, { namespace, url, auth } = {}) {
  const ns = cleanNs(namespace);
  if (!ns) return { error: true, message: "namespace required (a-z0-9_-)" };
  const urlErr = validateUpstreamUrl(url);
  if (urlErr) return { error: true, message: urlErr };
  const record = { namespace: ns, url: String(url), auth: auth ? String(auth) : null, added_at: Date.now() };
  await env.CLOUDFLARE_OPS_OAUTH.put(up(ns), JSON.stringify(record));
  const idx = await readIndex(env);
  idx.push(ns);
  await writeIndex(env, idx);
  return { ok: true, namespace: ns, url: record.url, authed: !!record.auth };
}

export async function removeUpstream(env, namespace) {
  const ns = cleanNs(namespace);
  await env.CLOUDFLARE_OPS_OAUTH.delete(up(ns));
  await writeIndex(env, (await readIndex(env)).filter((x) => x !== ns));
  return { ok: true, removed: ns };
}

export async function listUpstreams(env) {
  const idx = await readIndex(env);
  const out = [];
  for (const ns of idx) {
    const r = await getUpstream(env, ns);
    if (r) out.push({ namespace: r.namespace, url: r.url, authed: !!r.auth });
  }
  return out;
}

// Talk MCP JSON-RPC to an upstream over streamable-HTTP; parse the SSE data line
// (plain JSON also handled). Never throws — returns null on any failure so a dead
// upstream can't break the whole catalog.
async function upstreamRpc(record, method, params) {
  try {
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (record.auth) headers.authorization = /^Bearer\s/i.test(record.auth) ? record.auth : `Bearer ${record.auth}`;
    const res = await fetch(record.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || {} }),
    });
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(line ? line.slice(5).trim() : text);
  } catch { return null; }
}

// Merge all upstream tools, namespaced, for tools/list. Dead upstreams are skipped.
export async function federatedTools(env) {
  const idx = await readIndex(env);
  const tools = [];
  for (const ns of idx) {
    const record = await getUpstream(env, ns);
    if (!record) continue;
    const resp = await upstreamRpc(record, "tools/list", {});
    const upstreamTools = (resp && resp.result && resp.result.tools) || [];
    for (const t of upstreamTools) {
      tools.push({
        ...t,
        name: `${ns}${NS_SEP}${t.name}`,
        description: `[${ns}] ${t.description || ""}`.slice(0, 1024),
      });
    }
  }
  return tools;
}

// Given a called tool name and the set of live namespaces, resolve whether it is
// a federated call. Returns { ns, tool } or null.
export function isFederated(name, namespaces) {
  const i = String(name).indexOf(NS_SEP);
  if (i < 0) return null;
  const ns = String(name).slice(0, i);
  return namespaces.includes(ns) ? { ns, tool: String(name).slice(i + NS_SEP.length) } : null;
}

// Proxy a namespaced tools/call to its upstream and unwrap the result.
export async function callFederated(env, ns, toolName, args) {
  const record = await getUpstream(env, ns);
  if (!record) return { error: `unknown federated namespace: ${ns}` };
  const resp = await upstreamRpc(record, "tools/call", { name: toolName, arguments: args || {} });
  if (!resp) return { error: `no/invalid response from upstream "${ns}"` };
  if (resp.error) return { error: `upstream "${ns}" error: ${resp.error.message || JSON.stringify(resp.error)}` };
  const content = resp.result && resp.result.content;
  if (Array.isArray(content) && content[0] && typeof content[0].text === "string") {
    try { return JSON.parse(content[0].text); } catch { return { text: content[0].text }; }
  }
  return resp.result || {};
}

export { NS_SEP };
