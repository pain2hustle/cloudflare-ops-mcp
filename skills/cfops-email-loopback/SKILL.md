---
name: cfops-email-loopback
description: Prove transactional email through a real outbound-to-inbound loop, including sender authorization, DNS/MX routing, Worker receipt, unique-code matching, timeout, and a redacted delivery receipt. Use after email code, DNS, routing, templates, or provider credentials change.
---

# Email Loopback Verifier

## Workflow

1. Generate a one-use test ID and random challenge; store only the hash when practical.
2. Send through the same production path the product uses. Do not substitute a console-only provider test.
3. Route the message back through public MX and Cloudflare Email Routing to the verifier Worker.
4. Match recipient, test ID, and challenge inside the expiry window.
5. Report confirmed, expired, or failed with transport and timestamps, never message credentials.
6. Inspect the rendered message separately for logo, button, calendar link, plain-text fallback, and phone layout.

Provider acceptance proves send submission, not inbox placement. The loopback proves transport and routing; Gmail Primary placement needs a connected seed mailbox and remains a distinct result.

Never publish provider keys, raw inbound messages, customer addresses, or DKIM private material.
