# Cloudflare Ops MCP Roadmap

Cloudflare Ops MCP's direction is simple: make Cloudflare operations safe enough for AI agents and easy enough for non-traditional builders. The five-phase rollout is tracked in [PHASES.md](PHASES.md).

## Next upgrades

- One-command project initializer: create Worker config, generate MCP access key, guide Cloudflare token/OAuth setup, and store secrets through Wrangler.
- Better plain-English plans: show "what changes", "why it matters", and "what can go wrong".
- HTML report output for clients and small-business owners.
- GitHub Action to validate `server.json`, run tests, and publish releases.
- Host-app integration examples that reuse the shipped per-user OAuth connector without exposing user tokens to agents.
- More DNS recipes: Google Search Console verification, Microsoft 365 mail, Google Workspace mail, Resend, Stripe, and common SaaS verification records.
- Tenant-scoped durable audit logs and signed approval receipts. Per-user OAuth isolation and hashed connector sessions shipped in v0.3.0.

## Proposed v0.4 Wrangler + browser tool pack

- `wrangler_doctor`: read-only account, auth profile, config, compatibility date, route, binding, and required-secret-name checks.
- `list_deployments` and `deployment_diff`: show current and previous Worker versions without changing production.
- `rollback_deployment`: explicit version plus dry-run/approval gate before Wrangler rollback.
- `tail_worker_errors`: bounded, redacted structured logs—never an open-ended shell.
- `audit_bindings` and `audit_secret_names`: compare Wrangler config with deployed bindings; report secret names only, never values.
- `check_routes_domains`: catch the wrong-account, wrong-zone, or missing custom-domain problem before deploy.
- `kv_health`, `d1_health`, and `r2_health`: bounded read-only resource and binding checks.
- Cloudflare Workers runtime integration tests with `@cloudflare/vitest-pool-workers`.
- A thin Playwright suite for the landing page, phone viewport, OAuth redirect, one-time connector screen, copy buttons, status, and revoke UI. Real Cloudflare login and 2FA remain manual.

Do not expose a generic `wrangler_run` or arbitrary shell tool. Every operation should be allowlisted, schema-validated, redacted, and read-only or dry-run unless the user explicitly approves a narrowly scoped mutation.

## AMH agent middle layer

Target architecture:

```txt
User / Claude / Codex
          ↓
AMH Cloudflare Ops Agent
  plan → check → explain → approve → apply → verify
          ↓
Guarded MCP tools
          ↓
Cloudflare API + Wrangler
```

The MCP server remains the deterministic safety boundary. A Cloudflare Agents SDK coordinator, backed by one Durable Object per user/session, keeps task state, streams progress, resumes interrupted jobs, records approval receipts, and prevents one user's context from crossing into another's. Long deploy-and-verify sequences can move to Cloudflare Workflows for durable retries. The agent must call allowlisted MCP operations; it must not receive a generic shell or raw Cloudflare token.

## Change Guardian — prevent AI overwrite/revert loss

- Bind every plan to the exact Git SHA, Worker deployment version, DNS record ID, ruleset version, or content hash it inspected.
- Re-read before apply and reject stale plans. If the target changed, produce a new three-way diff instead of overwriting.
- Use one Durable Object lock per repo, Worker, zone, or ruleset during a mutation.
- Attach an idempotency key and signed approval receipt to the exact proposed diff.
- Snapshot Cloudflare configuration before edits and preserve fields/rules outside the tool's ownership.
- Put source edits on a branch/PR with required tests. Never use `git reset --hard`, blind checkout, broad delete, or force-push as an agent recovery step.
- Make rollback target one immutable deployment/config version; never roll back unrelated later Git work.
- Require separate exact-ID confirmation for deletes. A normal `apply` cannot hide a delete.
- Keep an append-only audit trail of plan, approval, apply, verification, and rollback.

## Vercel-safe hosting ops (make Cloudflare as hands-off as Vercel — but self-owned)

Goal: everything Vercel does automatically for a Next.js app, done through Cloudflare Ops MCP so a hands-on builder owns it for free. Each ships as CLI + lib + MCP tool, dry-run by default.

- ✅ **Cache purge** — whole-zone or per-URL (`cfops purge`). Done: CLI + lib + MCP `purge_cache`.
- **Cache Rules (edge-TTL override)** — the big one: set a short edge TTL for HTML pages so deploys go live on their own (Vercel's "auto-fresh" behavior) while hashed assets stay long-cached. Ends the "purge after every deploy" chore. ⚠️ Uses CF's Rulesets engine (read-modify-write the `http_request_cache_settings` entrypoint) — MUST preserve existing rules and be tested on a throwaway zone before touching production cache config.
- **Custom domain attach/detach** - bind a domain to a Worker or Pages project in one command, cleanly replacing conflicting DNS after an explicit dry-run diff. Needs a token with Workers/Pages + DNS edit.
- **Deploy health-check** — after a ship: verify key paths return 200, DNS resolves to the worker, SSL is active. Fail loud.
- **Worker ops** — list deployments, show current version, one-command rollback.
- **Uptime/monitoring recipe** — scheduled health checks that alert on a down path.

### Cache Guardian and instance safeguards

- `cache_audit`, `cache_plan`, `cache_verify`, and `cache_rollback` around the existing dry-run `purge_cache` tool.
- Snapshot cache rules before edits and verify important URLs, status codes, and cache headers afterward.
- Require stronger confirmation for purge-everything and cap per-URL purge batches.
- Use a Durable Object lock per account/zone so two agents cannot change the same cache configuration simultaneously.
- Require idempotency keys for retried mutations and store approval receipts with the job.
- Rate-limit per connector and keep OAuth/API tokens out of the Cache API.

## What Cloudflare Ops MCP should not become

- It should not hide destructive DNS writes.
- It should not require Global API Keys.
- It should not pretend to be Cloudflare.
- It should not ship local secret files.
- It should not make every agent action automatic by default.

## Core promise

Scan first. Diff second. Approve third. Apply last.
