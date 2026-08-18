---
name: cfops-operator-context
description: The operator's project map and common stack — load this to orient fast on who Austin is and what he actually works on, so you never make him re-brief you. Use at session start or whenever a task references one of his projects/tools by shorthand.
---

# Operator context — Austin (handle Pain2HuStle), Service Pricer LLC

Founder = Austin. Prefers: radical honesty (no fake "done", verify live), tight execution (narrow scope = narrow execution, ~4 commits or delegate), Lambo aesthetic (dark + honey gold, never blue-and-white office), free-tier / git-as-pipeline, route low-stakes work to local Ollama for token relief.

## Live projects he works on (besides Covey)

- **AMH — Artificial Mind Hive** (`artificialmindhive.com`, blue hub) + **Agent Book** (`amhagentbook.com`, 3D office) + **FieldScan**. Repo `code\amh-hive` (NOT git; deploy via wrangler pages). AI-agents studio.
- **Nothing Unseen / NU** (`nothingunseen.com`) — fair public-record search + health-records library. Repo `code\neighbordoors`. Hard line: no faked PII, no FCRA.
- **Service Pricer** (`servicepricer.app`) — CF Worker; his branded company (AMH "by Service Pricer LLC").
- **WALO** (`walohq.com`) — everyday AI food-cam / command hub. Repo `code\recoil\walo-site` (truth) + `code\walo-*`.
- **Apiary** (`apiarybee.com`) — the bee community / knowledge-drip / autopilot experiment. Heavy locked rules (read `code\apiary\PROCESS.md`; only `/live` is editable).
- **Austin's (Affordable) Garage Doors** — Fremont; two sites + Doorbot/Jubber lead widget.
- **AMH Site Revival** (`amhsiterevival.com`) — redesign-weak-sites business. ⚠️ deploy to project `amhsiterevival`, NEVER `artificialmindhive`.
- **ReCoil** (`paycovay.com`) — torsion-spring / garage hardware.

## Common stack + accounts

- **Cloudflare** Pages / Workers / D1 across TWO accounts (see `cfops-pages-deploy`): austinsdoors1 (`1d5fae…`) and pain2hustle1 (`0ebf6d65…`).
- **wrangler** profiles `austinsdoors` + `default`. Secrets in `~\.amh-secrets\`.
- **Mail** via mail-gateway `x-app-token` (see `cfops-mail-send-verify`); Resend + Cloudflare Email Routing.
- **Local Ollama** (gemma/qwen, 8B ceiling, CPU-only 31GB) via cloudflared tunnel — front-line for low-stakes/free work.
- **Stripe** — AMH acct `acct_1Td4Xv`; Service Pricer / Covey acct `acct_1TMnui`.
- **Landing protection**: `cfops-landing-guard` watches all his live landings.

Full detail: the memory index `MEMORY.md` + `landing-guard\LAST-SESSION.md` (auto-logged last-session brief).
