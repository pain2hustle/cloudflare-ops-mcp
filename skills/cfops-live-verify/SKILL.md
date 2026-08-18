---
name: cfops-live-verify
description: Verify a deployed website or Worker end to end with status, redirects, expected content, navigation, protected routes, mobile UI, and regression evidence. Use after releases, DNS or route edits, reported 404s, UI changes, or when a user asks whether a feature is truly live.
---

# Live Site Verifier

## Verification ladder

1. Check DNS and the final HTTPS origin without following away evidence silently.
2. Assert the exact allowed status, redirect policy, content type, and expected build/version marker.
3. Check every changed or user-visible route, including navigation targets and protected-route behavior.
4. Use browser automation when layout, interaction, motion, responsive behavior, or JavaScript matters.
5. Test phone and desktop viewports for changed UI.
6. For APIs, validate response shape and authorization boundaries without logging credentials.
7. Report each check as pass, fail, or not tested with direct evidence.

Use node scripts/verify-live.mjs for deterministic status/marker gates. A 200 response serving the wrong app is a failure. A redirect is a failure when the acceptance contract forbids it.

Do not claim "live" from a deploy log alone.
