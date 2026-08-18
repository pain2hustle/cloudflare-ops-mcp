---
name: cfops-security-review
description: Review Cloudflare Worker, API, database, auth, email, and frontend changes for exploitable security flaws, then independently try to refute every finding before confirmation. Use for security reviews, secret-leak checks, authorization changes, SQL/D1 work, public routes, or release gates.
---

# Refute-First Security Review

## Review

Trace untrusted input through authentication, authorization, ownership checks, parsing, storage, network calls, rendering, and logs. Check secret exposure, injection, SSRF, redirect abuse, CSRF, XSS, IDOR, replay, cache leaks, email abuse, and unsafe Cloudflare bindings.

For every candidate finding, include severity, CWE when applicable, exact location, preconditions, concrete exploit path, affected asset, and supporting code/evidence.

## Independent challenge

Have a separate verifier try to disprove reachability, attacker control, missing guards, impact, and severity. Confirm only findings that survive. Label the rest unproven or rejected.

Fail closed when the model cannot satisfy the strict findings schema. Do not weaken the schema to accommodate a smaller model. Never test destructive exploits against production without explicit authorization.
