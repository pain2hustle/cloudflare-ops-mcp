// Cloudflare OAuth for the hosted connector. Cloudflare tokens stay server-side
// in KV; each user's opaque key maps to exactly one OAuth connection.
const AUTH_URL = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
const REVOKE_URL = "https://dash.cloudflare.com/oauth2/revoke";
// offline_access requests a refresh token so the 1-hour access token can be
// auto-renewed (refreshConnection) instead of the connection dying hourly and
// forcing a manual reconnect. Without it Cloudflare returns no refresh_token.
// 2026-08-19: added the Workers scopes. Without them the connector could read
// DNS but every Workers/Pages call returned "Authentication error" (code 10000),
// so who_serves_domain reported "Nothing claims this domain" for domains that
// are plainly served by a Worker. Verified against the Cloudflare OAuth client
// API — Pages has NO valid OAuth scope, so Pages work still needs wrangler.
const DEFAULT_SCOPES = ["zone.read", "dns.write", "email-routing-address.write", "email-routing-rule.write", "cache.purge", "challenge-widgets.write", "workers-scripts.write", "workers-routes.write", "workers-tail.read", "account-settings.read", "offline_access"];
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

export async function renderConnectedHtmlExact(origin, connectorKey, env) {
  if (!env.ASSETS) throw new Error("WT Connected UI asset binding is unavailable.");
  const assetResponse = await env.ASSETS.fetch(new Request(new URL("/WT-Connected.html", origin)));
  if (!assetResponse.ok) throw new Error("WT Connected UI asset could not be loaded.");
  let bundle = await assetResponse.text();
  const templatePattern = /(<script type="__bundler\/template">)([\s\S]*?)(<\/script>)/;
  if (!templatePattern.test(bundle)) throw new Error("WT Connected UI template payload is missing.");

  bundle = bundle.replace(templatePattern, (_match, open, encoded, close) => {
    let page = JSON.parse(encoded);
    page = page
      .replace("<html><head>", '<html lang="en"><head>\n<title>Connected — Walrus Tusk // AMH</title>')
      .replace(/\s*<a\s+href="https:\/\/cfops\.nothingunseen\.com"[\s\S]*?<\/a>/gi, "")
      .replace(/\s*<a\s+href="https:\/\/nothingunseen\.com"[\s\S]*?<\/a>/gi, "")
      .replaceAll('href="WT Landing.dc.html"', 'href="https://artificialmindhive.com/WalrusTooth"')
      .replaceAll('href="WT Docs.dc.html"', 'href="https://artificialmindhive.com/wtdocs"')
      .replaceAll('href="WT Agents.dc.html"', 'href="https://console.artificialmindhive.com/console"')
      .replaceAll('href="WT FAQ.dc.html"', 'href="https://artificialmindhive.com/wtfaq"')
      .replaceAll('href="AMH Agent Console.dc.html"', 'href="https://console.artificialmindhive.com/console"')
      .replaceAll('href="WT Console Unlock.dc.html"', 'href="https://console.artificialmindhive.com/console"')
      .replaceAll('href="/docs"', 'href="https://artificialmindhive.com/wtdocs"')
      .replaceAll('href="/agents"', 'href="https://console.artificialmindhive.com/console"')
      .replaceAll('href="/faq"', 'href="https://artificialmindhive.com/wtfaq"')
      .replaceAll('href="/console"', 'href="https://console.artificialmindhive.com/console"')
      .replaceAll('href="/"', 'href="https://artificialmindhive.com/WalrusTooth"')
      .replace(/https:\/\/mcp\.artificialmindhive\.com\/mcp/gi, `${origin}/mcp`)
      .replace(/https:\/\/cfops\.nothingunseen\.com\/mcp/gi, `${origin}/mcp`)
      .replace(/https:\/\/cfops\.nothingunseen\.com/gi, origin)
      .replace(/cfops_[A-Za-z0-9_-]+/g, connectorKey);
    return open + JSON.stringify(page).replace(/</g, "\\u003c") + close;
  });

  return bundle
    .replace(/https:\/\/mcp\.artificialmindhive\.com\/mcp/gi, `${origin}/mcp`)
    .replace(/https:\/\/cfops\.nothingunseen\.com\/mcp/gi, `${origin}/mcp`)
    .replace(/https:\/\/cfops\.nothingunseen\.com/gi, origin)
    .replace(/https:\/\/nothingunseen\.com/gi, "https://artificialmindhive.com")
    .replace(/cfops_[A-Za-z0-9_-]+/g, connectorKey);
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


// ── RATE LIMITING (2026-08-21) ───────────────────────────────────────────────
// There was none. 30 authenticated calls landed in 153ms with nothing in the
// way, so a leaked cfops_ key could drain the owner's Cloudflare quota (and
// bill) before anyone noticed.
//
// FIRST ATTEMPT WAS WRONG AND IS WORTH RECORDING: a KV counter (get, increment,
// put). KV is EVENTUALLY CONSISTENT, so 100 concurrent requests each read a
// stale 0, wrote 1, and the counter never climbed — measured 800/800 allowed.
// KV cannot rate limit. This now uses the native Workers Rate Limiting binding
// (GA Sept 2025), which is backed by the same infrastructure as WAF rate
// limiting rules and is actually consistent.
//
// Configure in wrangler.jsonc:
//   "ratelimits": [{ "name": "RATE_LIMITER", "namespace_id": "1001",
//                    "simple": { "limit": 120, "period": 60 } }]
// If the binding is absent the connector keeps working unlimited — this
// protects a budget, not a secret, so it fails OPEN by design.
//
// ⚠️ MEASURED 2026-08-22, NOT YET ENFORCING ON THIS ACCOUNT.
// The binding attaches and limit() is called on every request, but Cloudflare
// returns { success: true } every time — verified by logging the raw result.
// Tested: 900 requests against a 600 limit, then 20 and 18 against a limit of
// 10, on both the custom domain and workers.dev, with a fresh namespace_id.
// Always allowed, no exception thrown. So this is account/plan level, not a
// wiring bug. The code is correct and starts enforcing the moment the account
// supports it. If enforcement is needed NOW, the alternative is a Durable
// Object counter (strongly consistent, works on the free plan) — that is a
// bigger change and a deliberate one. Do NOT assume this is protecting you.
export async function checkRateLimit(env, authContext) {
  const limiter = env.RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== "function") return { allowed: true };

  // Bucket per connector key. The admin key has no keyHash, and is the owner's
  // own key, so it gets its own bucket via the separate ADMIN limiter when one
  // is configured (falling back to the shared one).
  const isAdmin = authContext.mode === "admin";
  const who = authContext.keyHash || (isAdmin ? "admin" : "anon");
  const chosen = (isAdmin && env.RATE_LIMITER_ADMIN && typeof env.RATE_LIMITER_ADMIN.limit === "function")
    ? env.RATE_LIMITER_ADMIN
    : limiter;
  try {
    const { success } = await chosen.limit({ key: who });
    if (!success) {
      return { allowed: false, limit: isAdmin ? "admin" : "per-key", retryAfter: 60, by: "binding" };
    }
  } catch {
    // fall through to the DO — availability over precision
  }

  // The native binding said yes (or was unavailable). On this account it always
  // says yes, so the Durable Object below is what actually enforces. It is
  // strongly consistent: every request for one key routes to ONE object.
  return checkRateLimitDO(env, who, isAdmin);
}

async function checkRateLimitDO(env, who, isAdmin) {
  const ns = env.RATE_LIMITER_DO;
  if (!ns || typeof ns.idFromName !== "function") return { allowed: true };
  const limit = Number(
    isAdmin ? (env.RATE_LIMIT_ADMIN_PER_MIN || 600) : (env.RATE_LIMIT_PER_MIN || 120),
  );
  if (!Number.isFinite(limit) || limit <= 0) return { allowed: true };
  try {
    const stub = ns.get(ns.idFromName(who));
    const res = await stub.fetch(`https://rl.local/?limit=${limit}&period=60`);
    const out = await res.json();
    if (out && out.allowed === false) {
      return { allowed: false, limit, retryAfter: out.retryAfter || 60, by: "durable-object" };
    }
    return { allowed: true };
  } catch {
    return { allowed: true }; // fail open — this protects a budget, not a secret
  }
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
  return new Response(await renderConnectedHtmlExact(url.origin, connectorKey, env), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, private",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com blob:; script-src 'unsafe-inline' 'unsafe-eval' blob:; img-src data: blob:; font-src data: blob: https://fonts.gstatic.com; frame-src blob:; worker-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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
  // 2026-08-21: actually revoke AT CLOUDFLARE, not just locally.
  // This used to delete the two KV records and report disconnected:true. The
  // refresh_token — long-lived, because we request offline_access — stayed
  // valid on Cloudflare's side forever. If it had ever leaked (a KV read, a
  // log, a backup) "disconnect" gave the user no protection at all, despite the
  // connect page promising "you can disconnect it later".
  let raw = null;
  try { raw = await env.CLOUDFLARE_OPS_OAUTH.get(`connection:${authContext.connectionId}`); } catch {}
  let upstream = "skipped";
  if (raw) {
    try {
      const rec = JSON.parse(raw);
      // Revoke the refresh token — per RFC 7009 that invalidates the whole
      // grant, access token included. Revoke the access token too, best effort.
      const targets = [rec.refresh_token, rec.access_token].filter(Boolean);
      const results = await Promise.all(targets.map((token) =>
        fetch(REVOKE_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token,
            client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID || "",
            client_secret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET || "",
          }),
        }).then((r) => r.ok).catch(() => false)
      ));
      upstream = results.length && results.every(Boolean) ? "revoked"
        : results.some(Boolean) ? "partial" : "failed";
    } catch { upstream = "failed"; }
  }

  // Always clear local state, even if the upstream revoke failed — the user
  // asked to disconnect and must not stay connected here regardless.
  await Promise.all([
    env.CLOUDFLARE_OPS_OAUTH.delete(`session:${authContext.keyHash}`),
    env.CLOUDFLARE_OPS_OAUTH.delete(`connection:${authContext.connectionId}`),
  ]);

  return json({
    ok: true,
    disconnected: true,
    // Told honestly: if this is not "revoked", the grant may still exist at
    // Cloudflare and the user should also remove it in
    // Profile > Access Management > Connected Applications.
    cloudflare_grant: upstream,
    ...(upstream === "revoked" ? {} : {
      note: "The Cloudflare-side grant could not be confirmed revoked. Remove it at https://dash.cloudflare.com/profile/access-management/authorization to be certain.",
    }),
  });
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
