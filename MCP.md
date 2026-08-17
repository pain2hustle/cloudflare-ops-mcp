# AMH Cloudflare Ops MCP by WT

`-/\-\ M H // WT`

The remote server is an unofficial Cloudflare operations MCP for DNS, Email Routing, DMARC, SPF, BIMI, Pages, cache, Turnstile, account diagnostics, and scoped-token workflows. It is independent open-source software, not made or endorsed by Cloudflare.

## Public hosted endpoint

```txt
https://cfops.nothingunseen.com/mcp
```

Connect your Cloudflare account first:

```txt
https://cfops.nothingunseen.com/oauth/cloudflare/start
```

After consent, copy the one-time `cfops_` key and send it as:

```http
Authorization: Bearer cfops_YOUR_CONNECTOR_KEY
```

This key is not a Cloudflare API token. The Cloudflare OAuth grant remains server-side and is bound to only this connector.

## MCP configuration

```json
{
  "mcpServers": {
    "cloudflareOps": {
      "url": "https://cfops.nothingunseen.com/mcp",
      "headers": {
        "Authorization": "Bearer cfops_YOUR_CONNECTOR_KEY"
      }
    }
  }
}
```

## Tool lanes

- Zone and DNS scan, plan, guarded upsert, and verification.
- SPF, DKIM, MX, DMARC, BIMI, and Email Routing diagnostics.
- DMARC, BIMI, Email Routing, Pages cutover, cache purge, and Turnstile changes.
- Account doctor, domain ownership diagnosis, and Pages branch checks.
- Least-privilege token mint/list/revoke workflows.

Every mutating tool is dry-run by default. Read the returned diff, then pass `apply: true` only after the account owner approves it.

## Self-host with Wrangler

```sh
git clone https://github.com/pain2hustle/cloudflare-ops-mcp.git
cd cloudflare-ops-mcp
npm install
npm run oauth:setup -- https://your-worker-host
cd worker
npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_ID
npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_SECRET
npx wrangler secret put CLOUDFLARE_OAUTH_REDIRECT_URI
npx wrangler deploy
```

Real credentials belong in Wrangler secrets, never in `worker/wrangler.jsonc` or Git. See [OAUTH.md](OAUTH.md) for the complete hosted and self-hosted authorization model.

## Contact

- Service Pricer: https://servicepricer.app
- GitHub: https://github.com/pain2hustle/cloudflare-ops-mcp
