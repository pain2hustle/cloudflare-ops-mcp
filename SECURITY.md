# Security Policy

## Credential handling

Cloudflare Ops MCP is designed for bring-your-own Cloudflare credentials.

- Do not commit real Cloudflare API tokens, Global API Keys, MCP access keys, `.env` files, `.dev.vars` files, Wrangler output, or audit logs.
- Do not paste tokens into GitHub issues, chat logs, screenshots, or support requests.
- Use scoped Cloudflare API tokens, not Global API Keys.
- Scope tokens to the exact zone(s) you manage.
- Store local tokens in your own shell environment or ignored `.env` file.
- Store hosted MCP tokens with `wrangler secret put`, not `vars` in config files.

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

## Reporting issues

Open a GitHub issue for security bugs that do not include credentials. If an example needs sensitive values, redact domains, record values, and tokens before sharing.