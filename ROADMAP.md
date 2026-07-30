# ZoneMender Roadmap

ZoneMender's direction is simple: make Cloudflare operations safe enough for AI agents and easy enough for non-traditional builders.

## Next upgrades

- One-command project initializer: create Worker config, generate MCP access key, guide Cloudflare token/OAuth setup, and store secrets through Wrangler.
- Better plain-English plans: show "what changes", "why it matters", and "what can go wrong".
- HTML report output for clients and small-business owners.
- GitHub Action to validate `server.json`, run tests, and publish releases.
- Optional host-app connector pattern so products can add Cloudflare OAuth without exposing user tokens to agents.
- More DNS recipes: Google Search Console verification, Microsoft 365 mail, Google Workspace mail, Resend, Stripe, and common SaaS verification records.
- Safer multi-tenant mode with encrypted token storage, tenant-scoped audit logs, and approval receipts.

## Vercel-safe hosting ops (make Cloudflare as hands-off as Vercel — but self-owned)

Goal: everything Vercel does automatically for a Next.js app, done through ZoneMender so a hands-on builder owns it for free. Each ships as CLI + lib + MCP tool, dry-run by default.

- ✅ **Cache purge** — whole-zone or per-URL (`zonemend purge`). Done: CLI + lib + MCP `purge_cache`.
- **Cache Rules (edge-TTL override)** — the big one: set a short edge TTL for HTML pages so deploys go live on their own (Vercel's "auto-fresh" behavior) while hashed assets stay long-cached. Ends the "purge after every deploy" chore. ⚠️ Uses CF's Rulesets engine (read-modify-write the `http_request_cache_settings` entrypoint) — MUST preserve existing rules and be tested on a throwaway zone before touching production cache config.
- **Custom domain attach/detach** - bind a domain to a Worker or Pages project in one command, cleanly replacing conflicting DNS after an explicit dry-run diff. Needs a token with Workers/Pages + DNS edit.
- **Deploy health-check** — after a ship: verify key paths return 200, DNS resolves to the worker, SSL is active. Fail loud.
- **Worker ops** — list deployments, show current version, one-command rollback.
- **Uptime/monitoring recipe** — scheduled health checks that alert on a down path.

## What ZoneMender should not become

- It should not hide destructive DNS writes.
- It should not require Global API Keys.
- It should not pretend to be Cloudflare.
- It should not ship local secret files.
- It should not make every agent action automatic by default.

## Core promise

Scan first. Diff second. Approve third. Apply last.
