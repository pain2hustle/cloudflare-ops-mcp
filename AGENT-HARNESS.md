# AMH WT Agent Harness

The harness is a companion Cloudflare Worker. It does not expose a generic shell, raw Wrangler command, owner API token, or public Agent route.

## Office model

- **Jack** starts as the permanent Personal Assistant / Office Manager profile. The display name is editable; the role remains visible.
- Specialists are reused by template. Leave the name empty to get a scenario-aware person, pet, or callsign; supply a name to create/reuse that profile.
- Process skills under `skills/` are selected automatically by template and written into the immutable job packet. The live Skills tab shows the mapping.
- Supported learning may file a candidate revision against a skill. No agent can silently change an active skill; promotion still requires review, tests, Git, and a verified release.
- Existing job packets and audit events keep the name used when they ran. Renaming changes future work, not history.
- The web console supports click, edit, Enter. The optional terminal supports `agents`, `job <id>`, and `name <agent-id> <new name>`.

## Cost controls

The default `MODEL_PROFILE=free` uses GLM Flash for the primary pass and Gemma for independent verification. `paid-k2` enables Kimi K2.6 only on Workers Paid. The console shows exact harness calls, remaining daily calls, zero-AI jobs, and the 00:00 UTC reset. It does not guess neuron consumption; exact neurons stay in Workers AI analytics.

`site_health` is deterministic: plain HTTPS fetch, HTTP code, redirect, TLS failure, and optional expected-text marker. It never starts Playwright or a model. A scheduled health watch can run hourly; research schedules show their calls per run before enabling.

## Required secrets

Set these with `wrangler secret put` inside `agent/`; never commit values:

- `HARNESS_ACCESS_KEY`
- `SESSION_SIGNING_KEY`
- `HARNESS_INTERNAL_KEY` (same value on the core MCP Worker)
- `AUDIT_HMAC_KEY`

Optional notification/security secrets:

- `ALERT_FROM`, `ALERT_TO`, `ALERT_LOOPBACK_TO`
- `ALERT_WEBHOOK_URL`
- `TURNSTILE_SECRET` plus non-secret `TURNSTILE_SITEKEY` and `TURNSTILE_HOSTNAMES`

Deploy the harness first, then the core Worker so its service binding resolves. Use `npm run agent:deploy:verified`; a Wrangler upload without a passing public `/health` receipt is not landed.

## Retention and privacy

Raw source detail is compacted after four days, detailed results after seven, and ordinary events after thirty by default. Pressure compaction runs before the configured detail cap. Tokens, cookies, passwords, API keys, and client IPs are excluded from prompts and redacted from events. Per-user state and MCP OAuth tokens stay in the user's Durable Object.

The public repository contains generic contracts and safety mechanisms. AMH-specific repair decision trees, learned policy packs, customer data, and unpublished operating patterns belong in private storage/repositories and must not be exported into public job packets or knowledge-vault commits.
