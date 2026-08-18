---
name: cfops-pages-deploy
description: Deploy a static site or app to Cloudflare Pages across the operator's two accounts without hitting the account wall, the wrong-branch preview trap, or a false-green deploy. Use for any Cloudflare Pages deploy, custom-domain attach, or "the deploy said success but the site didn't change" debugging.
---

# Cloudflare Pages deploy (two-account safe)

## Two accounts, two profiles

- **austinsdoors1** = `1d5fae607a857fc56cd575763bf8f3bc` — wrangler profile `austinsdoors`. Owns nothingunseen, walo, recoil, garage sites.
- **pain2hustle1** = `0ebf6d65d7a9ddccd41cba0b8bd1414c` — wrangler profile `default`. Owns artificialmindhive, amhagentbook (the domain zones live here).

The env var `CLOUDFLARE_API_TOKEN` is usually the austinsdoors1 one. Deploying to a pain2hustle1 project with it → **auth error 10000**. Fix: `unset CLOUDFLARE_API_TOKEN` and set `CLOUDFLARE_ACCOUNT_ID=<target>` so wrangler uses the OAuth session, OR pass the right profile.

## The branch trap (false-green)

If the repo is on `master` but the Pages project's production branch is `main`, `wrangler pages deploy` succeeds **as a preview** — production keeps serving the old build while every message looks normal. Always pass `--branch main` (match the project's production branch).

## Judge by CONTENT, not exit code or 200

SPA fallback returns 200 for `/anything`, and a client-rendered `.dc.html` shell returns 200 even when a runtime error makes it render blank. Verify by fetching the live URL and matching a known string / `<title>`, not by wrangler's exit code.

## Canonical deploy command

```
npx wrangler pages deploy <dir> --project-name <project> --branch main --commit-dirty=true
```

## After deploy

Re-run the landing guard (`cfops-landing-guard`) to stash the new version and update the baseline if the change was intended.
