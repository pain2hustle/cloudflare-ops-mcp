# ZoneMender - Cloudflare DNS and Email Auth MCP Server

ZoneMender includes an unofficial Cloudflare DNS MCP server for AI agents. It is made by AMH - Artificial Mind Hive, operated by Service Pricer LLC. It is built to run as a Cloudflare Worker and deploy with Wrangler.

## Tool lanes

- Cloudflare zone scan.
- DNS record upsert.
- DMARC policy planning and apply.
- BIMI setup with DMARC precondition.
- SPF, DKIM, MX, and Email Routing diagnostics.
- Email Routing rule setup.
- Approval-gated writes and audit logging.

## What it does

- Scan Cloudflare zones for DNS, SPF, DKIM, DMARC, BIMI, MX, and Email Routing status.
- Plan email-authentication fixes without writing anything.
- Apply DNS, DMARC, BIMI, and Email Routing changes only after explicit approval.
- Keep the Cloudflare API token as a Worker secret, not a tool parameter.
- Require an MCP access key so the public Worker URL is not open to the internet; POST requests fail closed if the key is missing.

## Official status

ZoneMender is made by AMH - Artificial Mind Hive, operated by Service Pricer LLC. It is independent open-source software. It is not made by Cloudflare, not endorsed by Cloudflare, and not sponsored by Cloudflare. It is compatible with Cloudflare APIs and Wrangler.

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

## Contact

- Service Pricer: https://servicepricer.app
- GitHub: https://github.com/pain2hustle/zonemender
