// Cloudflare OAuth for the hosted connector. Cloudflare tokens stay server-side
// in KV; each user's opaque key maps to exactly one OAuth connection.
const AUTH_URL = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
const DEFAULT_SCOPES = ["zone.read", "dns.write", "email-routing-address.write", "email-routing-rule.write"];
const STATE_TTL_SECONDS = 600;
const REFRESH_SKEW_MS = 60_000;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extraHeaders },
  });
}

function requireOAuthEnv(env) {
  const missing = [];
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) missing.push("CLOUDFLARE_OAUTH_CLIENT_ID");
  if (!env.CLOUDFLARE_OAUTH_CLIENT_SECRET) missing.push("CLOUDFLARE_OAUTH_CLIENT_SECRET");
  if (!env.CLOUDFLARE_OAUTH_REDIRECT_URI) missing.push("CLOUDFLARE_OAUTH_REDIRECT_URI");
  if (!env.CLOUDFLARE_OPS_OAUTH) missing.push("CLOUDFLARE_OPS_OAUTH KV binding");
  return missing;
}

function cleanTenant(value) {
  return String(value || "default").trim().replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120) || "default";
}

function b64url(bytes) {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function timingSafeEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right))),
  ]);
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(leftHash, rightHash);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function bearerFromRequest(request) {
  const auth = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  return bearer || (request.headers.get("x-mcp-key") || "").trim();
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderConnectedHtml(origin, connectorKey) {
  const config = JSON.stringify({
    mcpServers: { cloudflareOps: { url: `${origin}/mcp`, headers: { Authorization: `Bearer ${connectorKey}` } } },
  }, null, 2);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Cloudflare connected · AMH / WT</title><style>
  :root{color-scheme:dark;--g:#6ee7a3;--ink:#07140d;--cream:#fffaf0}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 0%,#16462b,#07140d 55%);font:16px/1.55 Inter,system-ui;color:var(--cream);padding:18px}.card{width:min(760px,100%);border:1px solid #2f6446;background:rgba(7,20,13,.9);border-radius:22px;padding:clamp(22px,5vw,42px);box-shadow:0 28px 90px #0008}.tag{color:var(--g);font-weight:900;letter-spacing:.12em}h1{font-size:clamp(34px,7vw,62px);line-height:1;margin:.35em 0}.key,pre{overflow:auto;border:1px solid #37684b;background:#020906;border-radius:12px;padding:14px;color:#c9ffe0}.key{font:700 14px ui-monospace,monospace;word-break:break-all}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.btn{border:0;border-radius:11px;background:var(--g);color:var(--ink);font-weight:900;padding:12px 16px;cursor:pointer}.muted{color:#a8c4b2;font-size:14px}.warn{border-left:3px solid #f7d66d;padding-left:12px}</style></head><body><main class="card"><div class="tag">-/\\-\\ M H // WT · CONNECTED</div><h1>Your Cloudflare stays yours.</h1><p>Copy this connector key now. It is <strong>not</strong> your Cloudflare API token. The server stores only its SHA-256 hash and binds it to this one OAuth connection.</p><div id="key" class="key">${escapeHtml(connectorKey)}</div><div class="actions"><button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('key').textContent)">Copy connector key</button><button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('config').textContent)">Copy MCP config</button></div><pre id="config">${escapeHtml(config)}</pre><p class="muted warn">This key is shown once. Keep it private like a password. You can disconnect it later or revoke the app in Cloudflare.</p></main></body></html>`;
}

export function getOAuthScopes(env) {
  return String(env.CLOUDFLARE_OAUTH_SCOPES || DEFAULT_SCOPES.join(" ")).split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean);
}

export async function authorizeConnector(env, provided) {
  if (!provided) return { ok: false, reason: "missing_connector_key" };
  if (env.MCP_ACCESS_KEY && await timingSafeEqual(provided, env.MCP_ACCESS_KEY)) {
    return { ok: true, mode: "admin", connectionId: null };
  }
  if (!env.CLOUDFLARE_OPS_OAUTH) return { ok: false, reason: "oauth_storage_unavailable" };
  const keyHash = await sha256Hex(provided);
  const raw = await env.CLOUDFLARE_OPS_OAUTH.get(`session:${keyHash}`);
  if (!raw) return { ok: false, reason: "invalid_connector_key" };
  const session = JSON.parse(raw);
  if (!session.connection_id) return { ok: false, reason: "invalid_connector_session" };
  const connection = await env.CLOUDFLARE_OPS_OAUTH.get(`connection:${session.connection_id}`);
  if (!connection) return { ok: false, reason: "connection_revoked" };
  return { ok: true, mode: "oauth", connectionId: session.connection_id, keyHash };
}

export async function handleOAuthStart(request, env) {
  const missing = requireOAuthEnv(env);
  if (missing.length) return json({ ok: false, error: "oauth_not_configured", missing }, 503);
  const state = randomToken();
  const connectionId = randomToken(18);
  await env.CLOUDFLARE_OPS_OAUTH.put(`state:${state}`, JSON.stringify({
    connection_id: connectionId,
    created_at: Date.now(),
  }), { expirationTtl: STATE_TTL_SECONDS });

  const auth = new URL(AUTH_URL);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", env.CLOUDFLARE_OAUTH_CLIENT_ID);
  auth.searchParams.set("redirect_uri", env.CLOUDFLARE_OAUTH_REDIRECT_URI);
  auth.searchParams.set("scope", getOAuthScopes(env).join(" "));
  auth.searchParams.set("state", state);
  return Response.redirect(auth.toString(), 302);
}

export async function handleOAuthCallback(request, env) {
  const missing = requireOAuthEnv(env);
  if (missing.length) return json({ ok: false, error: "oauth_not_configured", missing }, 503);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) return json({ ok: false, error: "cloudflare_oauth_error", detail: oauthError }, 400);
  if (!code || !state) return json({ ok: false, error: "missing_code_or_state" }, 400);

  const raw = await env.CLOUDFLARE_OPS_OAUTH.get(`state:${state}`);
  if (!raw) return json({ ok: false, error: "bad_or_expired_state" }, 400);
  await env.CLOUDFLARE_OPS_OAUTH.delete(`state:${state}`);
  const pending = JSON.parse(raw);
  if (!pending.connection_id) return json({ ok: false, error: "invalid_oauth_state" }, 400);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.CLOUDFLARE_OAUTH_REDIRECT_URI,
    client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID,
    client_secret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET,
  });
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenJson = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenJson.access_token) {
    return json({
      ok: false,
      error: "token_exchange_failed",
      status: tokenResponse.status,
      detail: tokenJson.error || tokenJson.error_description || "unknown",
    }, 502);
  }

  const now = Date.now();
  const record = {
    provider: "cloudflare",
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token || null,
    token_type: tokenJson.token_type || "bearer",
    scope: tokenJson.scope || getOAuthScopes(env).join(" "),
    expires_at: tokenJson.expires_in ? now + Number(tokenJson.expires_in) * 1000 : null,
    connected_at: now,
    updated_at: now,
  };
  await env.CLOUDFLARE_OPS_OAUTH.put(`connection:${pending.connection_id}`, JSON.stringify(record));

  const connectorKey = `cfops_${randomToken()}`;
  const keyHash = await sha256Hex(connectorKey);
  await env.CLOUDFLARE_OPS_OAUTH.put(`session:${keyHash}`, JSON.stringify({
    connection_id: pending.connection_id,
    provider: "cloudflare",
    created_at: now,
  }));
  return new Response(renderConnectedHtml(url.origin, connectorKey), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, private",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    },
  });
}

async function refreshConnection(env, connectionId, record) {
  if (!record.refresh_token) throw new Error("Cloudflare OAuth connection expired. Reconnect Cloudflare to continue.");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: record.refresh_token,
    client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID,
    client_secret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET,
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error("Cloudflare OAuth refresh failed. Reconnect Cloudflare to continue.");
  }
  const now = Date.now();
  const updated = {
    ...record,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || record.refresh_token,
    token_type: payload.token_type || record.token_type || "bearer",
    scope: payload.scope || record.scope,
    expires_at: payload.expires_in ? now + Number(payload.expires_in) * 1000 : null,
    updated_at: now,
  };
  await env.CLOUDFLARE_OPS_OAUTH.put(`connection:${connectionId}`, JSON.stringify(updated));
  return updated;
}

export async function getOAuthAccessToken(env, authContext, legacyTenant = "default") {
  if (!authContext?.ok) return null;
  if (authContext.mode === "admin") {
    if (env.CLOUDFLARE_OPS_OAUTH) {
      const legacy = await env.CLOUDFLARE_OPS_OAUTH.get(`token:${cleanTenant(legacyTenant)}`);
      if (legacy) return JSON.parse(legacy).access_token || env.CLOUDFLARE_API_TOKEN || null;
    }
    return env.CLOUDFLARE_API_TOKEN || null;
  }
  if (!env.CLOUDFLARE_OPS_OAUTH || !authContext.connectionId) return null;
  const raw = await env.CLOUDFLARE_OPS_OAUTH.get(`connection:${authContext.connectionId}`);
  if (!raw) return null;
  let record = JSON.parse(raw);
  if (record.expires_at && record.expires_at <= Date.now() + REFRESH_SKEW_MS) {
    record = await refreshConnection(env, authContext.connectionId, record);
  }
  return record.access_token || null;
}

export async function handleOAuthStatus(request, env) {
  const authContext = await authorizeConnector(env, bearerFromRequest(request));
  if (!authContext.ok) {
    return json({ ok: false, connected: false, error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
  }
  if (authContext.mode === "admin") {
    return json({ ok: true, connected: !!env.CLOUDFLARE_API_TOKEN, mode: "admin" });
  }
  const raw = await env.CLOUDFLARE_OPS_OAUTH.get(`connection:${authContext.connectionId}`);
  if (!raw) return json({ ok: true, connected: false });
  const record = JSON.parse(raw);
  return json({
    ok: true,
    connected: true,
    provider: "cloudflare",
    scope: record.scope,
    expires_at: record.expires_at,
    connected_at: record.connected_at,
  });
}

export async function handleOAuthRevoke(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const authContext = await authorizeConnector(env, bearerFromRequest(request));
  if (!authContext.ok || authContext.mode !== "oauth") {
    return json({ ok: false, error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
  }
  await Promise.all([
    env.CLOUDFLARE_OPS_OAUTH.delete(`session:${authContext.keyHash}`),
    env.CLOUDFLARE_OPS_OAUTH.delete(`connection:${authContext.connectionId}`),
  ]);
  return json({ ok: true, disconnected: true });
}

export function getOAuthConfigStatus(env, origin = "") {
  const missing = requireOAuthEnv(env);
  return {
    configured: missing.length === 0,
    missing,
    scopes: getOAuthScopes(env),
    routes: {
      start: `${origin}/oauth/cloudflare/start`,
      callback: `${origin}/oauth/cloudflare/callback`,
      status: `${origin}/oauth/cloudflare/status`,
      revoke: `${origin}/oauth/cloudflare/revoke`,
      mcp: `${origin}/mcp`,
    },
  };
}
