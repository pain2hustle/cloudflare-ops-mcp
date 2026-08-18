---
name: cfops-mail-send-verify
description: Send email through the operator's mail gateway and self-verify delivery via a Gmail loopback, without asking the human to check their inbox. Use for transactional/agent email, deliverability tests, or confirming a "did it actually send and land" question.
---

# Mail send + self-verify

## Send through the gateway (not raw Resend)

All sends route through **mail-gateway** with an `x-app-token` header (per-app tokens in `~\.amh-secrets\`). This centralizes the Resend key and avoids scattering secrets. Do NOT paste a Resend key into app code.

## Resend domain limits (why FROM ≠ domain)

Resend free = 1 verified domain per key. Agents RECEIVE at `@artificialmindhive.com` (Cloudflare Email Routing catch-all → worker) but SEND from the one verified domain (`@amhsiterevival.com` / `walohq.com` depending on account), with Reply-To set to the real address so replies loop back.

## Self-verify WITHOUT asking the human

The operator does NOT want to be asked "did you get the test email?". Instead:

1. Send the test to a mailbox the agent can read (the Gmail connector = the `austinsdoors1` mailbox; user email pain2hustle@gmail.com).
2. Poll that inbox via the Gmail tool (search by a unique subject token you generated) until the message appears — proven <1s inbound in practice.
3. Report PASS/FAIL from what you actually observed. If FAIL, fix (SPF/DKIM/route/domain) and retry; log repeated failures so they are not re-debugged from scratch.

## Log repeated issues

If the same mail failure recurs, write it to the learning vault so K2/the harness surfaces it next time instead of rediscovering it.
