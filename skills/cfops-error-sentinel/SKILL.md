---
name: cfops-error-sentinel
description: Standing backstop that periodically looks across whatever surfaces the operator has (widgets, workers, endpoints, mail), and if anything smells wrong it informs, investigates, and writes the suspicion + logs into the next-run briefing so the master AI comes in already aware. Use to catch errors the operator did not — before they learn it from a stray email.
---

# Error Sentinel — catch what the operator missed

The operator should never learn about a broken widget or an abused key days later from an email. A K2 job (or the operator) runs the look on a schedule; the master AI does not have to be present for detection.

## The loop

1. **Look** — run the bounded checks for every registered surface (see below). Zero-AI where possible (deterministic probes), so it is free to run often.
2. **Judge suspicion** — a check is suspicious if it errors, returns the wrong shape (not just a 200), spikes in volume, or shows unknown recipients / non-2xx / rate-limit responses.
3. **Inform + investigate** — on suspicion, log it and dive: reproduce, find the cause, and classify the fix as safe-auto (reversible: restore a swiped landing, retry) or needs-operator (risky/irreversible).
4. **Surface to the NEXT run** — write the suspicion and the exact log lines into the session briefing / `LAST-SESSION.md`, and set the `<!--LASTSESSION-->` pointer at the top of MEMORY.md so the master AI opens the next run already suspicious, with the evidence in front of it — not starting blind.

## What it watches (extensible — new surface = one target line)

- **Widgets / endpoints**: functional probe, not up/down — POST a synthetic request and assert the expected JSON/redirect, so a silently-broken-but-200 widget is caught.
- **Workers**: hit each worker's health route; flag 5xx / exceptions.
- **Mail**: recent sends + API logs — unknown recipients, volume spikes, 429/limit, non-2xx (the Resend-key-abuse pattern). Read-only.
- **Landings**: title/deploy drift (delegates to `cfops-landing-guard`; auto-restore is the one safe-auto fix).

## Boundaries

Detection and diving are always allowed. Auto-fix only the reversible, logged, clearly-safe cases and tell the operator; ask first on anything risky or irreversible. Never store a broad-scope credential just to watch — prefer read-only access or run under the operator's live session. Every silently-capped or skipped check must be logged, never presented as "all clear."
