#!/usr/bin/env node
import { writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.argv[2];
const origin = (process.env.CLOUDFLARE_OPS_WORKER_ORIGIN || process.argv[3] || "https://cloudflare-ops-mcp.austinsdoors.workers.dev").replace(/\/$/, "");
const token = process.env.CLOUDFLARE_API_TOKEN;
const deploy = process.argv.includes("--deploy");
const secretFile = "C:/tmp/cloudflare-ops-mcp-oauth-secrets.json";

if (!token) fail("CLOUDFLARE_API_TOKEN is missing. Use a token with OAuth Client Write.");
if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) fail("Pass CLOUDFLARE_ACCOUNT_ID or first arg as the 32-character account id.");

const redirect = `${origin}/oauth/cloudflare/callback`;
const scopes = [
  "zone.read",
  "dns.write",
  "email-routing-address.write",
  "email-routing-rule.write",
  "cache.purge",
  "challenge-widgets.write",
];

const body = {
  client_name: "Cloudflare Ops MCP - Green Public",
  grant_types: ["authorization_code", "refresh_token"],
  redirect_uris: [redirect],
  response_types: ["code"],
  scopes,
  token_endpoint_auth_method: "client_secret_post",
  allowed_cors_origins: [origin],
  client_uri: origin,
  policy_uri: `${origin}/oauth/cloudflare/status`,
  tos_uri: `${origin}/oauth/cloudflare/status`,
  post_logout_redirect_uris: [origin],
};

const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/oauth_clients`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});
const json = await res.json().catch(() => ({}));
if (!json.success) {
  const messages = (json.errors || []).map((e) => e.message).join("; ") || `HTTP ${res.status}`;
  fail(`Cloudflare refused OAuth client creation: ${messages}. Required permission: OAuth Client Write.`);
}

const client = json.result || {};
if (!client.client_id || !client.client_secret) fail("Cloudflare did not return client_id/client_secret. Rotate the client secret manually or create a new client.");

writeFileSync(secretFile, JSON.stringify({
  CLOUDFLARE_OAUTH_CLIENT_ID: client.client_id,
  CLOUDFLARE_OAUTH_CLIENT_SECRET: client.client_secret,
  CLOUDFLARE_OAUTH_REDIRECT_URI: redirect,
  CLOUDFLARE_OAUTH_SCOPES: scopes.join(" "),
}, null, 2));

console.log(`Created OAuth client: ${client.client_name}`);
console.log(`Client ID prefix: ${client.client_id.slice(0, 8)}`);
console.log(`Redirect URI: ${redirect}`);
console.log(`Scopes: ${scopes.join(" ")}`);

if (deploy) {
  const bulk = spawnSync("npx", ["wrangler", "secret", "bulk", secretFile], { cwd: "worker", stdio: "inherit", shell: true });
  try { rmSync(secretFile, { force: true }); } catch {}
  if (bulk.status !== 0) process.exit(bulk.status || 1);
  const dep = spawnSync("npx", ["wrangler", "deploy"], { cwd: "worker", stdio: "inherit", shell: true });
  if (dep.status !== 0) process.exit(dep.status || 1);
  console.log(`OAuth connect URL: ${origin}/oauth/cloudflare/start`);
  console.log(`MCP endpoint:      ${origin}/mcp`);
} else {
  console.log(`Secret bulk file written to ${secretFile}`);
  console.log(`Run: cd worker && npx wrangler secret bulk ${secretFile} && npx wrangler deploy`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
