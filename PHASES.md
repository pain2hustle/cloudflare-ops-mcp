# Cloudflare Ops MCP Phases

Cloudflare Ops MCP is public, standalone infrastructure tooling. It is not tied to any private operator account. The same core rule applies in every phase: scan first, show the diff, approve, then apply.

## Phase 1 - Local CLI

Status: live in the repo.

A user exports their own scoped Cloudflare API token and runs Cloudflare Ops MCP locally.

- Reads `CLOUDFLARE_API_TOKEN` from the user's environment.
- Dry-run by default.
- Supports DNS scan, SPF/DMARC/BIMI/MX/email-routing checks, cache purge, and Pages DNS cutover.
- No shared hosted token, no vendor account, no hidden credentials.

This is the fastest path for a developer or operator fixing their own domain.

## Phase 2 - Self-Hosted MCP Worker

Status: live in the repo.

A user deploys the included Worker to their own Cloudflare account with Wrangler.

- `CLOUDFLARE_API_TOKEN` is stored as that user's Worker secret.
- Public users authenticate with isolated `cfops_` connector keys created after OAuth. `MCP_ACCESS_KEY` is an optional private-owner fallback.
- Agents call tools over MCP without ever seeing the Cloudflare token.
- Mutating tools still require `apply: true` after the owner reviews the diff.

This is the right path for people who want Codex, Claude, Cursor, or another MCP client to operate their own zones safely.

## Phase 3 - Safer Launch Recipes

Status: in progress.

Add focused recipes for common launch blockers.

- Cloudflare Pages DNS cutover.
- Google Search Console verification TXT.
- Google Workspace and Microsoft 365 mail records.
- Resend, Stripe, Shopify, and other common SaaS verification records.
- Deploy health checks: DNS, SSL, 200s, and route sanity.

Each recipe must preserve unrelated DNS records unless the user explicitly approves deleting them.

## Phase 4 - Reports, Audit, and Client Hand-Offs

Status: planned.

Make Cloudflare Ops MCP useful for non-technical owners and service providers.

- HTML/Markdown reports showing what is wrong, why it matters, and the exact fix.
- Before/after audit receipts for every applied change.
- Plain-English warnings for risky changes like DMARC enforcement or wildcard removal.
- Exportable handoff docs for clients and small businesses.

This phase makes the tool easier to trust before writes happen.

## Phase 5 - Hosted OAuth Connector

Status: architecture target, not in the public CLI yet.

A host app can embed Cloudflare Ops MCP and let users connect Cloudflare with OAuth instead of manually creating an API token.

The safe hosted flow is:

1. User clicks Connect Cloudflare.
2. Cloudflare OAuth asks the user to approve scoped permissions for selected accounts/zones.
3. The host app stores the OAuth token in its own encrypted token vault.
4. The agent never receives the raw token.
5. The agent calls approval-gated Cloudflare Ops MCP tools.
6. The host app shows the diff and applies only after the owner approves.
7. The user can revoke access from Cloudflare at any time.

Phase 5 is how Cloudflare Ops MCP becomes easy for strangers and businesses without making them paste secrets into chat. The public cloudflare-ops-mcp package stays generic; the OAuth/token-vault belongs to the host app that embeds it.

## Non-Negotiables

- No Global API Keys.
- No hardcoded Cloudflare tokens.
- No shared operator account for public users.
- No silent destructive DNS writes.
- No agent gets raw credentials when a server-side tool can hold them.
