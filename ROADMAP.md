# ZoneMender Roadmap

ZoneMender's direction is simple: make Cloudflare operations safe enough for AI agents and easy enough for non-traditional builders.

## Next upgrades

- One-command project initializer: create Worker config, generate MCP access key, guide Cloudflare token/OAuth setup, and store secrets through Wrangler.
- Better plain-English plans: show "what changes", "why it matters", and "what can go wrong".
- HTML report output for clients and small-business owners.
- GitHub Action to validate `server.json`, run tests, and publish releases.
- Optional hosted WALO connector so users can connect Cloudflare through OAuth instead of pasting tokens.
- More DNS recipes: Google Search Console verification, Microsoft 365 mail, Google Workspace mail, Resend, Stripe, and common SaaS verification records.
- Safer multi-tenant mode with encrypted token storage, tenant-scoped audit logs, and approval receipts.

## What ZoneMender should not become

- It should not hide destructive DNS writes.
- It should not require Global API Keys.
- It should not pretend to be Cloudflare.
- It should not ship local secret files.
- It should not make every agent action automatic by default.

## Core promise

Scan first. Diff second. Approve third. Apply last.
