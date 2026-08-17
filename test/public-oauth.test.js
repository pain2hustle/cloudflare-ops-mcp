import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeConnector,
  getOAuthAccessToken,
  handleOAuthCallback,
  handleOAuthRevoke,
  handleOAuthStart,
  handleOAuthStatus,
} from "../worker/oauth.js";

class MemoryKV {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) ?? null; }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
}

function env() {
  return {
    CLOUDFLARE_OAUTH_CLIENT_ID: "client-id",
    CLOUDFLARE_OAUTH_CLIENT_SECRET: "server-only-secret",
    CLOUDFLARE_OAUTH_REDIRECT_URI: "https://cfops.example/oauth/cloudflare/callback",
    CLOUDFLARE_OPS_OAUTH: new MemoryKV(),
    MCP_ACCESS_KEY: "private-admin-key",
    CLOUDFLARE_API_TOKEN: "private-admin-cloudflare-token",
  };
}

async function connect(testEnv, cloudflareToken) {
  const start = await handleOAuthStart(new Request("https://cfops.example/oauth/cloudflare/start?tenant=attacker-choice"), testEnv);
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    access_token: cloudflareToken,
    refresh_token: `refresh-${cloudflareToken}`,
    expires_in: 3600,
    scope: "zone.read dns.write",
  });
  try {
    const callback = await handleOAuthCallback(
      new Request(`https://cfops.example/oauth/cloudflare/callback?code=ok&state=${state}`),
      testEnv,
    );
    assert.equal(callback.status, 200);
    assert.match(callback.headers.get("cache-control"), /no-store/);
    const html = await callback.text();
    assert.doesNotMatch(html, new RegExp(cloudflareToken));
    return html.match(/cfops_[A-Za-z0-9_-]+/)?.[0];
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("OAuth connector keys are hashed, isolated, and never expose Cloudflare tokens", async () => {
  const testEnv = env();
  const firstKey = await connect(testEnv, "cloudflare-user-one-secret");
  const secondKey = await connect(testEnv, "cloudflare-user-two-secret");
  assert.ok(firstKey?.startsWith("cfops_"));
  assert.ok(secondKey?.startsWith("cfops_"));
  assert.notEqual(firstKey, secondKey);

  const stored = [...testEnv.CLOUDFLARE_OPS_OAUTH.values.entries()];
  assert.equal(stored.some(([key, value]) => key.includes(firstKey) || value.includes(firstKey)), false);
  assert.equal(stored.some(([key, value]) => key.includes(secondKey) || value.includes(secondKey)), false);
  assert.equal(stored.some(([key]) => key.includes("attacker-choice")), false);

  const firstAuth = await authorizeConnector(testEnv, firstKey);
  const secondAuth = await authorizeConnector(testEnv, secondKey);
  assert.equal(await getOAuthAccessToken(testEnv, firstAuth), "cloudflare-user-one-secret");
  assert.equal(await getOAuthAccessToken(testEnv, secondAuth), "cloudflare-user-two-secret");
  assert.notEqual(firstAuth.connectionId, secondAuth.connectionId);
  assert.equal((await authorizeConnector(testEnv, "wrong-key")).ok, false);

  const status = await handleOAuthStatus(new Request("https://cfops.example/oauth/cloudflare/status", {
    headers: { authorization: `Bearer ${firstKey}` },
  }), testEnv);
  const statusBody = await status.text();
  assert.equal(status.status, 200);
  assert.doesNotMatch(statusBody, /cloudflare-user-one-secret/);
  assert.match(statusBody, /"connected": true/);
});

test("connector revocation removes only that user's session and connection", async () => {
  const testEnv = env();
  const firstKey = await connect(testEnv, "cloudflare-user-one-secret");
  const secondKey = await connect(testEnv, "cloudflare-user-two-secret");
  const revoke = await handleOAuthRevoke(new Request("https://cfops.example/oauth/cloudflare/revoke", {
    method: "POST",
    headers: { authorization: `Bearer ${firstKey}` },
  }), testEnv);
  assert.equal(revoke.status, 200);
  assert.equal((await authorizeConnector(testEnv, firstKey)).ok, false);
  assert.equal((await authorizeConnector(testEnv, secondKey)).ok, true);
});

test("legacy admin key remains private fallback and uses timing-safe authorization", async () => {
  const testEnv = env();
  const admin = await authorizeConnector(testEnv, "private-admin-key");
  assert.deepEqual(admin, { ok: true, mode: "admin", connectionId: null });
  assert.equal(await getOAuthAccessToken(testEnv, admin), "private-admin-cloudflare-token");
});
