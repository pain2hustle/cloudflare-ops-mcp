import { getAgentByName, routeAgentEmail, routeAgentRequest } from "agents";
import { createCatchAllEmailResolver } from "agents/email";
import { Coordinator } from "./coordinator.js";
import { EmailVerifier } from "./email-verifier.js";
import { clearSessionCookie, cookieValue, hashIdentity, issueSession, sessionCookie, verifySession } from "./crypto.js";
import { capabilitySummary, SAFETRY_FLOW } from "./safetry.js";
import { CAPABILITY_TREE, LEARNING_LOG, MEMORY_SCHEMA, templateList } from "./templates.js";
import { renderConsole } from "./ui.js";
import { cloudflareMcpList } from "./mcp-catalog.js";

export { Coordinator, EmailVerifier };

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data, init = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: { ...JSON_HEADERS, ...(init.headers || {}) } });
}

function securityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("content-security-policy", "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function readJson(request, maxBytes = 65536) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) throw new Error("Content-Type must be application/json");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("Request body is too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new Error("Request body is too large");
  try { return JSON.parse(text || "{}"); } catch { throw new Error("Invalid JSON"); }
}

function bearer(request) {
  const value = request.headers.get("authorization") || "";
  return /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, "").trim() : "";
}

function constantTextEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function requireSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new Error("Origin check failed");
}

async function verifyTurnstile(request, env, token) {
  const configured = !!(env.TURNSTILE_SECRET && env.TURNSTILE_SITEKEY);
  if (!configured) return { configured: false };
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) throw new Error("Turnstile verification required");
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: request.headers.get("cf-connecting-ip") || "",
    }),
  });
  if (!response.ok) throw new Error("Turnstile verification failed");
  const result = await response.json();
  const hosts = new Set(String(env.TURNSTILE_HOSTNAMES || "").split(",").map((item) => item.trim()).filter(Boolean));
  if (!result.success || result.action !== "harness_login" || hosts.size === 0 || !hosts.has(result.hostname)) throw new Error("Turnstile verification failed");
  return { configured: true, hostname: result.hostname };
}

async function openSession(request, env) {
  requireSameOrigin(request);
  if (!env.HARNESS_ACCESS_KEY || !env.SESSION_SIGNING_KEY) return json({ error: "Console secrets are not configured" }, { status: 503 });
  const provided = bearer(request);
  const [providedHash, expectedHash] = await Promise.all([hashIdentity(provided), hashIdentity(env.HARNESS_ACCESS_KEY)]);
  if (!provided || !constantTextEqual(providedHash, expectedHash)) return json({ error: "Unauthorized" }, { status: 401 });
  const body = await readJson(request, 8192);
  await verifyTurnstile(request, env, body.turnstile_token);
  const actorHash = (await hashIdentity(provided)).slice(0, 40);
  const session = await issueSession(env.SESSION_SIGNING_KEY, actorHash, 14400);
  return json({ ok: true, csrf: session.csrf, expires_at: session.expires_at, key_window: session.key_window }, {
    headers: { "set-cookie": sessionCookie(session.token, 14400) },
  });
}

async function authenticated(request, env) {
  const token = cookieValue(request, "amhwt_session");
  const session = await verifySession(env.SESSION_SIGNING_KEY, token);
  if (!session) return null;
  if (!["GET", "HEAD"].includes(request.method)) {
    requireSameOrigin(request);
    if (!constantTextEqual(request.headers.get("x-csrf-token") || "", session.csrf)) return null;
  }
  return session;
}

async function coordinator(env, actor) {
  return getAgentByName(env.COORDINATORS, `user-${actor}`);
}

async function emailVerifier(env) {
  return getAgentByName(env.EMAIL_VERIFIERS, "loopback");
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return "AMHWT-" + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function startEmailLoopback(env) {
  if (!env.EMAIL || !env.ALERT_FROM || !env.ALERT_LOOPBACK_TO) throw new Error("Email loopback is not configured");
  const id = crypto.randomUUID();
  const code = randomCode();
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const verifier = await emailVerifier(env);
  await verifier.beginTest({ id, code, expires_at });
  await env.EMAIL.send({
    to: env.ALERT_LOOPBACK_TO,
    from: { email: env.ALERT_FROM, name: "AMH WT Mail Check" },
    subject: `AMH WT loopback verification ${code}`,
    text: `Automatic mail-system verification. Code: ${code}`,
    html: `<p>Automatic mail-system verification.</p><p><strong>${code}</strong></p>`,
  });
  return { id, status: "pending", expires_at, meaning: "Confirms Cloudflare send, DNS, inbound routing, and Worker receipt; it does not certify a separate personal inbox's spam placement." };
}

async function internalApi(request, env) {
  if (!env.HARNESS_INTERNAL_KEY) return json({ error: "Internal binding secret is not configured" }, { status: 503 });
  const supplied = request.headers.get("x-amh-internal-key") || "";
  const [left, right] = await Promise.all([hashIdentity(supplied), hashIdentity(env.HARNESS_INTERNAL_KEY)]);
  if (!supplied || !constantTextEqual(left, right)) return json({ error: "Unauthorized" }, { status: 401 });
  const rawActor = request.headers.get("x-amh-actor") || "";
  if (!rawActor || rawActor.length > 200) return json({ error: "Actor is required" }, { status: 400 });
  const actor = (await hashIdentity(rawActor)).slice(0, 40);
  const agent = await coordinator(env, actor);
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/internal/jobs") {
    return json(await agent.enqueueJob(await readJson(request), "mcp"), { status: 202 });
  }
  if (request.method === "GET" && /^\/internal\/jobs\/[^/]+$/.test(url.pathname)) {
    const job = await agent.getJob(decodeURIComponent(url.pathname.split("/").pop()));
    return job ? json(job) : json({ error: "Job not found" }, { status: 404 });
  }
  if (request.method === "GET" && url.pathname === "/internal/jobs") return json({ jobs: await agent.listJobs(50) });
  if (request.method === "GET" && url.pathname === "/internal/dashboard") {
    const dashboard = await agent.dashboard();
    return json({ ...dashboard, catalog: { templates: templateList(), capability_tree: CAPABILITY_TREE, learning_log: LEARNING_LOG, memory_schema: MEMORY_SCHEMA, capabilities: capabilitySummary(), safety_flow: SAFETRY_FLOW, cloudflare_mcp: cloudflareMcpList() }, cloudflare_mcp: await agent.cloudflareMcpStatus() });
  }
  if (request.method === "GET" && url.pathname === "/internal/briefing") return json(await agent.getBriefing());
  if (request.method === "GET" && url.pathname === "/internal/revisions") return json({ revisions: await agent.listRevisions() });
  if (request.method === "PATCH" && /^\/internal\/agents\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readJson(request, 4096);
    return json(await agent.renameAgentProfile(id, body.name, "oauth-console"));
  }
  if (request.method === "DELETE" && /^\/internal\/agents\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    await readJson(request, 4096);
    return json(await agent.removeAgentProfile(id, "oauth-console"));
  }
  if (request.method === "POST" && url.pathname === "/internal/control") {
    const body = await readJson(request, 4096);
    if (!["pause", "resume", "cancel_job", "readonly_on", "retention_sweep"].includes(body.action)) return json({ error: "Control action is not allowed through MCP" }, { status: 400 });
    return json(await agent.control(body.action, { job_id: body.job_id }, "mcp"));
  }
  if (request.method === "POST" && /^\/internal\/revisions\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readJson(request, 4096);
    return json(await agent.reviewRevision(id, body.decision, "oauth-console"));
  }
  if (request.method === "DELETE" && /^\/internal\/schedules\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    await readJson(request, 4096);
    return json(await agent.deleteTemplateSchedule(id, "oauth-console"));
  }
  if (request.method === "POST" && url.pathname === "/internal/memory") return json(await agent.updateMemory(await readJson(request, 32768), "oauth-console"));
  if (request.method === "POST" && url.pathname === "/internal/retention/run") {
    await readJson(request, 4096);
    return json(await agent.retentionSweep());
  }
  if (request.method === "POST" && url.pathname === "/internal/alerts/test") {
    await readJson(request, 4096);
    const test = await startEmailLoopback(env);
    await agent.log(null, "email_loopback_started", { test_id: test.id, expires_at: test.expires_at }, "operator");
    return json(test, { status: 202 });
  }
  if (request.method === "GET" && /^\/internal\/alerts\/test\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const result = await (await emailVerifier(env)).testStatus(id);
    return result ? json(result) : json({ error: "Email test not found" }, { status: 404 });
  }
  return json({ error: "Not found" }, { status: 404 });
}

async function privateApi(request, env, session) {
  const url = new URL(request.url);
  const agent = await coordinator(env, session.actor);
  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    const dashboard = await agent.dashboard();
    return json({ ...dashboard, catalog: { templates: templateList(), capability_tree: CAPABILITY_TREE, learning_log: LEARNING_LOG, memory_schema: MEMORY_SCHEMA, capabilities: capabilitySummary(), safety_flow: SAFETRY_FLOW, cloudflare_mcp: cloudflareMcpList() }, cloudflare_mcp: await agent.cloudflareMcpStatus() });
  }
  if (request.method === "GET" && /^\/api\/jobs\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const job = await agent.getJob(id);
    return job ? json(job) : json({ error: "Job not found" }, { status: 404 });
  }
  if (request.method === "POST" && url.pathname === "/api/jobs") {
    const body = await readJson(request);
    return json(await agent.enqueueJob(body, "console"), { status: 202 });
  }
  if (request.method === "POST" && /^\/api\/cloudflare-mcp\/[^/]+\/connect$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    await readJson(request, 4096);
    return json(await agent.connectCloudflareMcp(id, new URL(request.url).origin, "console"));
  }
  if (request.method === "DELETE" && /^\/api\/cloudflare-mcp\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    await readJson(request, 4096);
    return json(await agent.disconnectCloudflareMcp(id, "console"));
  }
  if (request.method === "PATCH" && /^\/api\/agents\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readJson(request, 4096);
    return json(await agent.renameAgentProfile(id, body.name, "console"));
  }
  if (request.method === "DELETE" && /^\/api\/agents\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    await readJson(request, 4096);
    return json(await agent.removeAgentProfile(id, "console"));
  }
  if (request.method === "POST" && /^\/api\/jobs\/[^/]+\/run$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    await readJson(request, 4096);
    return json(await agent.runJob(id, "console"));
  }
  if (request.method === "POST" && /^\/api\/revisions\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readJson(request, 4096);
    return json(await agent.reviewRevision(id, body.decision, "console"));
  }
  if (request.method === "DELETE" && /^\/api\/schedules\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    await readJson(request, 4096);
    return json(await agent.deleteTemplateSchedule(id, "console"));
  }
  if (request.method === "POST" && url.pathname === "/api/memory") {
    const body = await readJson(request, 32768);
    return json(await agent.updateMemory(body, "console"));
  }
  if (request.method === "POST" && url.pathname === "/api/retention/run") {
    await readJson(request, 4096);
    return json(await agent.retentionSweep());
  }
  if (request.method === "POST" && url.pathname === "/api/alerts/test") {
    await readJson(request, 4096);
    const test = await startEmailLoopback(env);
    await agent.log(null, "email_loopback_started", { test_id: test.id, expires_at: test.expires_at }, "console");
    return json(test, { status: 202 });
  }
  if (request.method === "GET" && /^\/api\/alerts\/test\/[^/]+$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const result = await (await emailVerifier(env)).testStatus(id);
    return result ? json(result) : json({ error: "Email test not found" }, { status: 404 });
  }
  return json({ error: "Not found" }, { status: 404 });
}

async function fetchHandler(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && /^\/agents\/coordinator\/user-[A-Za-z0-9_-]+\/callback$/.test(url.pathname) && url.searchParams.has("state")) {
    return (await routeAgentRequest(request, env)) || json({ error: "MCP callback route not found" }, { status: 404 });
  }
  if (request.method === "GET" && url.pathname === "/") {
    return new Response(renderConsole({ turnstileSitekey: env.TURNSTILE_SITEKEY || "" }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "AMH WT MCP Agent Console", version: "0.1.1", turnstile_configured: !!(env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET), auth_configured: !!(env.HARNESS_ACCESS_KEY && env.SESSION_SIGNING_KEY), storage: "Cloudflare Durable Objects encrypted at rest", agent_routes_public: false });
  }
  if (request.method === "POST" && url.pathname === "/api/session") return openSession(request, env);
  if (request.method === "DELETE" && url.pathname === "/api/session") return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
  if (url.pathname.startsWith("/internal/")) return internalApi(request, env);
  if (url.pathname.startsWith("/api/")) {
    const session = await authenticated(request, env);
    if (!session) return json({ error: "Unauthorized" }, { status: 401 });
    return privateApi(request, env, session);
  }
  return json({ error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request, env) {
    try { return securityHeaders(await fetchHandler(request, env)); }
    catch (error) { return securityHeaders(json({ error: String(error?.message || error).slice(0, 800) }, { status: 400 })); }
  },
  async email(message, env) {
    await routeAgentEmail(message, env, {
      resolver: createCatchAllEmailResolver("EmailVerifier", "loopback"),
      onNoRoute: (email) => email.setReject("Unknown verification address"),
    });
  },
};
