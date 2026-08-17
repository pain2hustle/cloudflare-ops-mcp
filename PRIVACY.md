# Privacy Notice

Effective: August 17, 2026

This notice covers the open-source Cloudflare Ops MCP project and the hosted connector at `cfops.nothingunseen.com`. The project is made by AMH — Artificial Mind Hive and operated by Service Pricer LLC.

## Plain-language summary

- We do not sell personal information.
- We do not put advertising trackers in this repository or the hosted connector UI.
- The local CLI sends Cloudflare requests directly from your device using credentials you control.
- The hosted service keeps Cloudflare OAuth tokens server-side and gives you a separate `cfops_` connector key.
- The raw connector key is shown once and is stored only as a SHA-256 hash.
- MCP tools do not return OAuth access or refresh tokens.
- You can disconnect a hosted connection with `POST /oauth/cloudflare/revoke` or revoke the app in Cloudflare.

## Information processed

### Local CLI and library

Local commands may process Cloudflare account identifiers, zone names, DNS records, email-routing configuration, Pages settings, cache targets, and other information requested by the command. That processing occurs on your device and through Cloudflare's API. Applied local changes may be written to the local audit-log path documented in the README.

The open-source project does not receive your local environment variables or local audit log unless you intentionally share them.

### Hosted OAuth and MCP service

The hosted service may process:

- Cloudflare OAuth authorization codes, access tokens, refresh tokens, scopes, and expiration timestamps;
- a random connection identifier and the SHA-256 hash of your connector key;
- MCP requests, tool names, domains or resource identifiers you ask the tool to inspect, and tool results;
- limited operational logs such as request status, error details with token redaction, applied tool name, domain, timestamp, and authentication mode;
- standard network metadata processed by Cloudflare to deliver and protect the Worker.

## How information is used

Information is used only to authenticate your connection, perform the Cloudflare operation you request, enforce dry-run and approval gates, refresh or revoke OAuth access, diagnose failures, protect the service, and maintain an audit trail for approved changes.

## Storage and retention

- OAuth state expires after approximately 10 minutes.
- OAuth connection records remain in the bound Cloudflare KV namespace until revoked, removed by the operator, or the service is retired.
- Connector keys are not stored in raw form.
- Cloudflare Worker logs follow the retention settings of the hosting Cloudflare account.
- GitHub retains repository activity under GitHub's policies.

Do not send secrets through GitHub issues, chat messages, screenshots, or support requests.

## Service providers and user-selected clients

The project relies on Cloudflare for OAuth, Workers, KV, networking, and logs; GitHub for source hosting and project collaboration; and the MCP client you choose, such as Codex, Claude, or Cursor. Their privacy terms apply to their processing:

- [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/)
- [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)

Your MCP client may retain prompts and tool results. Review that client's settings before connecting a production Cloudflare account.

## Security and choices

Use least-privilege Cloudflare scopes, review every dry-run diff, and revoke access you no longer need. Security controls are described in [SECURITY.md](SECURITY.md). No internet service can guarantee absolute security.

To disconnect the hosted connector:

```sh
curl -X POST -H "Authorization: Bearer $CFOPS_CONNECTOR_KEY" \
  https://cfops.nothingunseen.com/oauth/cloudflare/revoke
```

You may also revoke the OAuth application from your Cloudflare account.

## Children

The hosted service is intended for operators and developers managing Cloudflare resources, not for children under 13.

## Changes and contact

Material changes will be committed to this file with a new effective date. For privacy questions, contact Service Pricer through [servicepricer.app](https://servicepricer.app) or open a GitHub issue without including credentials or private account data.

