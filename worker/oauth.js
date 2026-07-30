// worker/oauth.js
// Cloudflare OAuth helper routes for hosted ZoneMender connectors.
// Tokens stay server-side in KV; agents call approval-gated MCP tools instead
// of receiving raw OAuth tokens.

const AUTH_URL = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
const DEFAULT_SCOPES = [
  "zone.read",
  "dns.write",
  "email-routing-address.write",
  "email-routing-rule.write",
];
const STATE_TTL_SECONDS = 600;

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requireOAuthEnv(env) {
  const missing = [];
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) missing.push("CLOUDFLARE_OAUTH_CLIENT_ID");
  if (!env.CLOUDFLARE_OAUTH_CLIENT_SECRET) missing.push("CLOUDFLARE_OAUTH_CLIENT_SECRET");
  if (!env.CLOUDFLARE_OAUTH_REDIRECT_URI) missing.push("CLOUDFLARE_OAUTH_REDIRECT_URI");
  if (!env.ZONEMENDER_OAUTH) missing.push("ZONEMENDER_OAUTH KV binding");
  return missing;
}

function cleanTenant(value) {
  return String(value || "default").trim().replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120) || "default";
}

function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

function scopes(env) {
  return String(env.CLOUDFLARE_OAUTH_SCOPES || DEFAULT_SCOPES.join(" "))
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function handleOAuthStart(request, env) {
  const missing = requireOAuthEnv(env);
  if (missing.length) {
    return json({ ok: false, error: "oauth_not_configured", missing }, 503);
  }

  const url = new URL(request.url);
  const tenant = cleanTenant(url.searchParams.get("tenant"));
  const returnTo = url.searchParams.get("return_to") || "/oauth/cloudflare/status";
  const state = randomState();
  await env.ZONEMENDER_OAUTH.put("state:" + state, JSON.stringify({ tenant, returnTo, created_at: Date.now() }), {
    expirationTtl: STATE_TTL_SECONDS,
  });

  const auth = new URL(AUTH_URL);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", env.CLOUDFLARE_OAUTH_CLIENT_ID);
  auth.searchParams.set("redirect_uri", env.CLOUDFLARE_OAUTH_REDIRECT_URI);
  auth.searchParams.set("scope", scopes(env).join(" "));
  auth.searchParams.set("state", state);

  return Response.redirect(auth.toString(), 302);
}

export async function handleOAuthCallback(request, env) {
  const missing = requireOAuthEnv(env);
  if (missing.length) {
    return json({ ok: false, error: "oauth_not_configured", missing }, 503);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return json({ ok: false, error: "cloudflare_oauth_error", detail: oauthError }, 400);
  }
  if (!code || !state) return json({ ok: false, error: "missing_code_or_state" }, 400);

  const raw = await env.ZONEMENDER_OAUTH.get("state:" + state);
  if (!raw) return json({ ok: false, error: "bad_or_expired_state" }, 400);
  await env.ZONEMENDER_OAUTH.delete("state:" + state);
  const session = JSON.parse(raw);
  const tenant = cleanTenant(session.tenant);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.CLOUDFLARE_OAUTH_REDIRECT_URI,
    client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID,
    client_secret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET,
  });

  const tokenResp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenJson = await tokenResp.json().catch(() => ({}));
  if (!tokenResp.ok) {
    return json({ ok: false, error: "token_exchange_failed", status: tokenResp.status, detail: tokenJson.error || tokenJson.error_description || "unknown" }, 502);
  }

  const now = Date.now();
  const record = {
    provider: "cloudflare",
    tenant,
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token || null,
    token_type: tokenJson.token_type || "bearer",
    scope: tokenJson.scope || scopes(env).join(" "),
    expires_at: tokenJson.expires_in ? now + Number(tokenJson.expires_in) * 1000 : null,
    connected_at: now,
  };
  await env.ZONEMENDER_OAUTH.put("token:" + tenant, JSON.stringify(record));

  const done = new URL(session.returnTo || "/oauth/cloudflare/status", url.origin);
  done.searchParams.set("tenant", tenant);
  done.searchParams.set("cloudflare", "connected");
  return Response.redirect(done.toString(), 302);
}

export async function handleOAuthStatus(request, env) {
  if (!env.ZONEMENDER_OAUTH) return json({ ok: false, connected: false, error: "missing_kv_binding" }, 503);
  const url = new URL(request.url);
  const tenant = cleanTenant(url.searchParams.get("tenant"));
  const raw = await env.ZONEMENDER_OAUTH.get("token:" + tenant);
  if (!raw) return json({ ok: true, connected: false, tenant });
  const record = JSON.parse(raw);
  return json({
    ok: true,
    connected: true,
    tenant,
    provider: "cloudflare",
    scope: record.scope,
    expires_at: record.expires_at,
    connected_at: record.connected_at,
  });
}

export async function getOAuthAccessToken(env, tenant = "default") {
  if (!env.ZONEMENDER_OAUTH) return null;
  const raw = await env.ZONEMENDER_OAUTH.get("token:" + cleanTenant(tenant));
  if (!raw) return null;
  const record = JSON.parse(raw);
  return record.access_token || null;
}
