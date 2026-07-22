# ZoneMender MCP Server

ZoneMender includes an unofficial Cloudflare DNS MCP server for AI agents. It is built to run as a Cloudflare Worker and deploy with Wrangler.

## What it does

- Scan Cloudflare zones for DNS, SPF, DKIM, DMARC, BIMI, MX, and Email Routing status.
- Plan email-authentication fixes without writing anything.
- Apply DNS, DMARC, BIMI, and Email Routing changes only after explicit approval.
- Keep the Cloudflare API token as a Worker secret, not a tool parameter.
- Require an MCP access key so the public Worker URL is not open to the internet.

## Official status

ZoneMender is independent open-source software. It is not made by Cloudflare, not endorsed by Cloudflare, and not sponsored by Cloudflare. It is compatible with Cloudflare APIs and Wrangler.

## Wrangler deploy

```sh
cd worker
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put MCP_ACCESS_KEY
npx wrangler deploy
```

## MCP client

Point an MCP client at the deployed Worker URL and send:

```
Authorization: Bearer <MCP_ACCESS_KEY>
```

Use dry-run tools first, inspect the diff, then apply only when the owner approves.
