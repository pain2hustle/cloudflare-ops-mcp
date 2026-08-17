#!/usr/bin/env node

const host = process.argv[2] || "https://<your-worker-host>";
const origin = host.replace(/\/$/, "");
const redirect = `${origin}/oauth/cloudflare/callback`;

console.log(`Cloudflare OAuth setup for Cloudflare Ops MCP\n`);
console.log(`1. Create a Cloudflare OAuth client with Authorization Code flow.`);
console.log(`2. Redirect URI:`);
console.log(`   ${redirect}`);
console.log(`3. Choose least-privilege scopes for the tools you want.`);
console.log(`   Core DNS/email scopes:`);
console.log(`   zone.read dns.write email-routing-address.write email-routing-rule.write`);
console.log(`   Add cache/pages/turnstile scopes only if your OAuth client lists them and you expose those tools.`);
console.log(`4. Store the OAuth client values as Worker secrets, never in Git:\n`);
console.log(`   cd worker`);
console.log(`   npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_ID`);
console.log(`   npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_SECRET`);
console.log(`   npx wrangler secret put CLOUDFLARE_OAUTH_REDIRECT_URI`);
console.log(`   npx wrangler secret put CLOUDFLARE_OAUTH_SCOPES   # optional override`);
console.log(`   npx wrangler deploy\n`);
console.log(`5. Connect a tenant/user:`);
console.log(`   ${origin}/oauth/cloudflare/start`);
console.log(`\n5. MCP clients use:\n   ${origin}/mcp`);
console.log(`\nNo permanent mega token is needed. Users can revoke the OAuth client in Cloudflare.`);
