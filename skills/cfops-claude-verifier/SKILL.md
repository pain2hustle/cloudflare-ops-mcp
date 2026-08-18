---
name: cfops-claude-verifier
description: Route a difficult, bounded verification packet to a user-configured Claude model and reconcile its independent result without sharing hidden secrets or excessive context. Use for second opinions on security, architecture, code review, research synthesis, or strict-schema findings that exceed the free model lane.
---

# Claude Second Opinion

## Prepare the packet

Send only the objective, allowed artifacts, evidence, constraints, required schema, and packet hash. Redact credentials, cookies, private customer data, internal-only lessons, and unrelated conversation.

## Verify independently

Ask Claude to challenge assumptions, identify missing evidence, attempt to refute each finding, cite exact artifact locations, and return the required packet hash and schema. Do not reveal the primary agent's desired answer.

## Reconcile

Compare claims by evidence, not model authority. Keep disagreements visible. Confirm a conclusion only when its evidence survives both passes; otherwise mark it uncertain or rejected.

Use only a provider/model lane explicitly configured and paid for by the operator. Never embed or export an Anthropic key, silently switch providers, or retry without respecting the daily call budget.
