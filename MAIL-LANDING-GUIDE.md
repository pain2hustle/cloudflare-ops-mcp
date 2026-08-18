# Mail Landing Guide

This is the generic, publishable acceptance contract. Private AMH repair heuristics and customer-specific patterns are not included.

## Eligibility

- Cloudflare DNS is required.
- Email Routing (inbound) is available on Workers Free and Paid.
- Sending to arbitrary recipients requires Workers Paid.
- Sending to verified destination addresses can be free and does not consume the arbitrary-recipient quota.

The console must check capability first and explain the missing plan/domain step in plain language. It must never silently switch providers or request a global API key.

## Acceptance layers

1. **Domain onboarded** — Cloudflare Email Sending/Email Routing recognizes the domain.
2. **Authentication aligned** — SPF and DKIM are present; DMARC is present and aligned with the visible From domain.
3. **Provider accepted** — the send response is delivered/queued rather than rejected, bounced, or suppressed.
4. **Loopback confirmed** — a unique one-time code is sent to the Worker's routed address and caught by `EmailVerifier` without an AI call.
5. **Google inbox confirmed (optional adapter)** — a dedicated Gmail seed mailbox connected through OAuth finds the unique ID and reports its real labels. `INBOX` / Primary is not inferred from SMTP acceptance.

The loopback badge proves Cloudflare send, DNS, inbound routing, and Worker receipt. It does not claim that a separate personal inbox avoided Spam or Promotions.

Every transactional template sends honest subject text plus both plain-text and HTML bodies. Recurring mail needs appropriate unsubscribe handling. Bounces, complaints, and suppressions must stop retries rather than creating spam.
