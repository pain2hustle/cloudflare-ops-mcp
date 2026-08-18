---
name: cfops-landing-guard
description: Stash, log, and one-click-restore live Cloudflare Pages landings so a stray/wrong-project deploy never permanently swipes a site. Use when a landing regressed, when protecting landings from overwrites, or to roll a Pages site back to its last-good version in ~1 second.
---

# Landing Guard — never lose a landing

A landing gets "swiped" when a build is deployed to the wrong Pages project (e.g. the Site Revival build pushed to `--project-name artificialmindhive` instead of `amhsiterevival`). Cloudflare keeps every deployment, so the fix is a rollback, not a rebuild.

## Restore in one second

Panel: `node C:\Users\Servi\landing-guard\guard-server.mjs` → open `http://localhost:8791` → click **RESTORE**. No token, no paste.
CLI equivalent: `node C:\Users\Servi\landing-guard\guard.mjs --rollback <domain>`.

Under the hood it POSTs `/accounts/{aid}/pages/projects/{project}/deployments/{goodDeployId}/rollback`.

## Critical gotcha — canonical vs latest

The Pages project object has TWO deploy pointers. `latest_deployment` = newest *created* and **lies after a rollback**. `canonical_deployment` = what actually serves production. Always read `canonical_deployment` for the good-version id, or you will "restore" to the bad deploy.

## Detect + stash

`node guard.mjs` snapshots each landing's live HTML (dedup by content hash, 90-day retention), appends `log.jsonl`, and compares the live `<title>` to a blessed baseline. Drift = REGRESSED + prints the rollback command. Scheduled task `AMH-Landing-Guard` runs it every 30 min, hidden (WScript shim, no console popup).

## After an INTENTIONAL redesign

Run `node guard.mjs --bless` to accept the new live titles as the baseline — otherwise the guard flags the redesign as a swipe.

## Watched landings (both accounts)

pain2hustle1: artificialmindhive.com, amhagentbook.com · austinsdoors1: nothingunseen.com, walohq.com, paycovay.com, austinsaffordablegaragedoor.com, austinsaffordablegaragedoors.net. Tokens read from `~\.amh-secrets\cf-tokens-clip-2026-08-17.txt` (never hardcode).
