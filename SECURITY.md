# Security Policy

## Credential handling

Cloudflare Ops MCP is designed for bring-your-own Cloudflare credentials.

- Do not commit real Cloudflare API tokens, Global API Keys, MCP access keys, `.env` files, `.dev.vars` files, Wrangler output, or audit logs.
- Do not paste tokens into GitHub issues, chat logs, screenshots, or support requests.
- Do not publish AMH/customer repair playbooks, learned policy packs, task memory, or proprietary scoring logic. Keep the public engine generic and private policy/data in access-controlled storage or repositories.
- Use scoped Cloudflare API tokens, not Global API Keys.
- Scope tokens to the exact zone(s) you manage.
- Store local tokens in your own shell environment or ignored `.env` file.
- Store hosted MCP tokens with `wrangler secret put`, not `vars` in config files.
- Public hosted users must connect through Cloudflare OAuth. They receive an opaque `cfops_` connector key, never the service owner's Cloudflare API token.
- Connector keys are stored only as SHA-256 hashes and are bound to one server-side OAuth connection.
- Treat a connector key like a password. Do not commit it or paste it into an issue.

## Hosted OAuth isolation

- OAuth access and refresh tokens remain server-side in the `CLOUDFLARE_OPS_OAUTH` KV namespace.
- Tool arguments cannot select another user's connection.
- Missing, invalid, or revoked connector keys fail closed with HTTP 401.
- The status endpoint returns metadata only and never returns Cloudflare tokens.
- `POST /oauth/cloudflare/revoke` deletes that connector-key mapping and OAuth connection.
- The optional `MCP_ACCESS_KEY` path is a private owner fallback and must not be distributed to public users.

## Minimum Cloudflare permissions

For the common DNS and email-auth workflow, create a custom Cloudflare token with:

- Zone / Zone / Read
- Zone / DNS / Edit
- Zone / Email Routing Rules / Edit

Only add broader permissions when a specific command documents that it needs them.

## If a token is exposed

1. Revoke the token in Cloudflare immediately.
2. Create a new scoped token.
3. Update your local environment or Worker secret.
4. Review recent DNS and Email Routing changes in Cloudflare.

If a `cfops_` connector key is exposed, revoke it with `POST /oauth/cloudflare/revoke` using that key, or revoke the OAuth app from Cloudflare, then reconnect.

## Reporting issues

Open a GitHub issue for security bugs that do not include credentials. If an example needs sensitive values, redact domains, record values, and tokens before sharing.
