---
name: cfops-safe-deploy
description: Deploy Cloudflare Workers or the AMH WT harness with scoped credentials, dry-run checks, an immutable Git checkpoint, and a live acceptance gate. Use for deploys, releases, route changes, version bumps, or roll-forward/rollback decisions.
---

# Safe Cloudflare Deploy

## Workflow

1. Resolve the repository, Wrangler config, active account, Worker name, routes, and expected public marker.
2. Stop if unrelated worktree changes overlap the deployment. Never discard user changes.
3. Run tests, syntax checks, git diff --check, a secret scan, and Wrangler dry-run.
4. Create a reviewable Git commit before production deployment.
5. Remove stale shell credentials from the child process. Use the intended Wrangler profile or OAuth session; never print secrets.
6. Run node scripts/deploy-verified.mjs from this repository with the target directory, public URL, path, and exact expected version.
7. Record the deployment ID, public status, marker match, commit, and timestamp.

## Hard stops

- Do not deploy with an unresolved account, hostname, route collision, or failed check.
- Do not treat upload success as release success; the public acceptance gate must pass.
- Do not expose account tokens, OAuth grants, .dev.vars, or local stashes.
- Do not roll back destructively. Prefer a reviewed roll-forward or an explicit Cloudflare version rollback.

If public verification fails, preserve the failed deployment evidence and restore service through the smallest reviewed change.
