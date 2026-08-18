import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

test("worker GET advertises broad Cloudflare Ops tool catalog", async () => {
  const res = await worker.fetch(new Request("https://example.test/"), {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.server.title, "AMH WT Cloudflare Ops MCP — SafeTry Agent Harness");
  for (const tool of [
    "scan_zone",
    "apply_dns_record",
    "setup_email_routing",
    "pages_cutover",
    "purge_cache",
    "create_turnstile_widget",
  ]) {
    assert.ok(body.tools.includes(tool), `missing ${tool}`);
  }
});
test("worker browser status page uses green OAuth connect UI", async () => {
  const res = await worker.fetch(new Request("https://example.test/", { headers: { accept: "text/html" } }), {
    MCP_ACCESS_KEY: "test-key",
    CLOUDFLARE_OAUTH_CLIENT_ID: "client-id",
    CLOUDFLARE_OAUTH_CLIENT_SECRET: "client-secret",
    CLOUDFLARE_OAUTH_REDIRECT_URI: "https://example.test/oauth/cloudflare/callback",
    CLOUDFLARE_OPS_OAUTH: { get: async () => null, put: async () => {}, delete: async () => {} },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  const html = await res.text();
  assert.match(html, /#6ee7a3/);
  assert.match(html, /Connect Cloudflare/);
  assert.match(html, /no shared API token/i);
  assert.match(html, /AMH|M H/);
  assert.match(html, /Per-user keys/i);
});
