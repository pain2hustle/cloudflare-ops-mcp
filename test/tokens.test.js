// test/tokens.test.js
// The vending machine's safety contract: dry-run mints NOTHING, presets only
// mint DOWN (zone-scoped), the TTL cap holds, and unknown permission groups
// block loudly instead of guessing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudflareClient } from "../src/client.js";
import { mintScopedToken, listTokens, revokeToken, TOKEN_PRESETS } from "../src/tokens.js";

const ZONE_ID = "zone123";
const GROUPS = [
  { id: "g-zone-read", name: "Zone Read" },
  { id: "g-dns-read", name: "DNS Read" },
  { id: "g-dns-write", name: "DNS Write" },
  { id: "g-cache", name: "Cache Purge" },
];

function makeFetch(overrides = {}) {
  const calls = [];
  async function fetchImpl(url, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null });
    const respond = (result) => ({
      status: 200,
      ok: true,
      headers: { get: (n) => (String(n).toLowerCase() === "content-type" ? "application/json" : null) },
      async text() {
        return JSON.stringify({ success: true, errors: [], messages: [], result });
      },
    });
    const u = String(url);
    if (overrides[u]) return respond(overrides[u]);
    if (u.includes("/zones?name=")) return respond([{ id: ZONE_ID, name: "example.com" }]);
    if (u.includes("/user/tokens/permission_groups")) return respond(GROUPS);
    if (u.endsWith("/user/tokens") && method === "POST")
      return respond({ id: "tok-1", value: "minted-secret-value-abcdefghijklmnop", status: "active" });
    if (u.includes("/user/tokens?")) return respond([{ id: "tok-1", name: "cfops dns-zone example.com (auto-expires)", status: "active", expires_on: "2099-01-01T00:00:00Z" }]);
    if (u.includes("/user/tokens/") && method === "DELETE") return respond({ id: "tok-1" });
    return respond([]);
  }
  fetchImpl.calls = calls;
  fetchImpl.writes = () => calls.filter((c) => c.method !== "GET");
  return fetchImpl;
}

function client(fetchImpl) {
  return new CloudflareClient({ token: "bootstrap-token", fetch: fetchImpl });
}

test("mint dry-run: zero writes, exact policy returned", async () => {
  const f = makeFetch();
  const out = await mintScopedToken(client(f), { domain: "example.com" });
  assert.equal(f.writes().length, 0);
  assert.equal(out.apply, false);
  assert.equal(out.preset, "dns-zone");
  assert.deepEqual(Object.keys(out.policy.policies[0].resources), [
    `com.cloudflare.api.account.zone.${ZONE_ID}`,
  ]);
  assert.deepEqual(
    out.policy.policies[0].permission_groups.map((g) => g.id).sort(),
    ["g-dns-read", "g-dns-write", "g-zone-read"]
  );
  assert.ok(out.policy.expires_on, "dry-run policy carries the expiry");
});

test("mint apply: one POST, value returned once and flagged secret", async () => {
  const f = makeFetch();
  const out = await mintScopedToken(client(f), { domain: "example.com", apply: true });
  const posts = f.writes().filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(out.apply, true);
  assert.equal(out.secret, true);
  assert.equal(out.token_value, "minted-secret-value-abcdefghijklmnop");
});

test("unknown preset throws and names the alternatives", async () => {
  const f = makeFetch();
  await assert.rejects(
    () => mintScopedToken(client(f), { domain: "example.com", preset: "super" }),
    /mint down, never up/
  );
});

test("unknown permission group blocks and lists the catalog", async () => {
  const f = makeFetch();
  const out = await mintScopedToken(client(f), {
    domain: "example.com",
    extra_groups: ["Account Firehose"],
  });
  assert.equal(out.blocked, true);
  assert.match(out.reason, /Account Firehose/);
  assert.ok(out.available_groups.includes("Zone Read"));
  assert.equal(f.writes().length, 0);
});

test("TTL above 24h blocks without confirm_long", async () => {
  const f = makeFetch();
  const out = await mintScopedToken(client(f), { domain: "example.com", ttl_seconds: 999999 });
  assert.equal(out.blocked, true);
  assert.match(out.reason, /confirm_long/);
  assert.equal(f.writes().length, 0);
});

test("every preset stays zone-scoped", () => {
  for (const def of Object.values(TOKEN_PRESETS)) {
    for (const g of def.groups) assert.doesNotMatch(g, /account|billing|member|token/i);
  }
});

test("listTokens never returns values; revoke dry-run deletes nothing", async () => {
  const f = makeFetch();
  const tokens = await listTokens(client(f));
  assert.ok(tokens.length > 0);
  for (const t of tokens) assert.equal("value" in t, false);
  assert.equal(tokens[0].issued_by_cfops, true);
  const out = await revokeToken(client(f), "tok-1");
  assert.equal(out.apply, false);
  assert.equal(f.writes().length, 0);
});
