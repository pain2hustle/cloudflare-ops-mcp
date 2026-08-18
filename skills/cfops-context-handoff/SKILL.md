---
name: cfops-context-handoff
description: Create lean, safe, restorable agent handoffs and durable lessons without retaining the whole conversation. Use when work spans sessions, an agent changes, context is crowded, a repeated correction should become a revision, or stale working memory should expire.
---

# Context Handoff Keeper

## Keep only durable state

Record the objective, scope, current version/commit, completed evidence, unresolved blockers, exact next safe action, relevant file/route identifiers, and decisions that would otherwise be rediscovered.

Exclude secrets, tokens, cookies, raw customer data, full source bodies, speculative conclusions, and completed chatter.

## Lifecycle

1. Redact and hash the handoff packet.
2. Mark facts as verified, inferred, or pending.
3. Keep short working context for four days, useful active context for seven days, and only approved durable lessons beyond that.
4. Convert repeated proven guidance into a candidate skill/template revision.
5. Require review, tests, and a release before activating instruction changes.
6. Preserve an immutable audit receipt while deleting expired working payloads.

Do not spawn another agent merely to remember context. Reuse a named profile and attach the compact packet to the next bounded job.
