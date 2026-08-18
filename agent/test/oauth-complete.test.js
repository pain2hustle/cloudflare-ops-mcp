import test from "node:test";
import assert from "node:assert/strict";
import { mcpOAuthCompletionResponse } from "../src/oauth-complete.js";

test("OAuth completion returns a no-store success page without tokens", async () => {
  const response = mcpOAuthCompletionResponse({ authSuccess: true, serverId: "cloudflare_api", accessToken: "must-not-render" });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(html, /Cloudflare connected/);
  assert.match(html, /amh-mcp-oauth/);
  assert.match(html, /cloudflare_api/);
  assert.doesNotMatch(html, /must-not-render/);
});

test("OAuth completion fails safely and does not render provider errors", async () => {
  const response = mcpOAuthCompletionResponse({ authSuccess: false, authError: "<script>secret detail</script>" });
  const html = await response.text();
  assert.equal(response.status, 400);
  assert.match(html, /needs attention/);
  assert.doesNotMatch(html, /secret detail|<script>secret/);
});
