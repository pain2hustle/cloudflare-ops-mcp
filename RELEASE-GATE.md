# Release gate: uploaded is not landed

A release is accepted only after the real public URL answers correctly.

```text
tests → Worker bundle → deploy/preview → public HTTPS scan → expected marker → receipt
```

`npm run worker:deploy:verified` deploys the core Worker, then checks `https://cfops.nothingunseen.com/?format=json` for HTTP 2xx, no redirect, and version `0.4.1`.

`npm run agent:deploy:verified` deploys the harness, extracts its `workers.dev` URL, then checks `/health` for version `0.1.0`.

`npm run verify:live -- --url https://example.com --expect expected-marker` can gate any landing page. It retries boundedly and emits a receipt with timestamps, HTTP status, response size, and SHA-256 body hash. A 404, redirect, TLS/fetch failure, or wrong marker exits non-zero and prints `LAND FAILED`.

The scheduled `site_health` template is the post-release backup. It uses no AI and emits outage/recovery events with deduped daily reminders. Deeper phone/desktop Playwright checks belong on deployment and verify important clicks, visible controls, overflow, and expected destinations.

Workers Builds should use non-production branches for preview versions and promote from the intended production branch only after tests. Exact Worker names and project roots must match their Wrangler configurations.
