# Cloudflare OAuth Connector

This is the Phase 5 hosted connector path. It lets a host app connect a user's Cloudflare account without asking them to paste API tokens into chat.

## What ships here

The Worker exposes three OAuth routes:

- `GET /oauth/cloudflare/start?tenant=<id>` - redirects the user to Cloudflare consent.
- `GET /oauth/cloudflare/callback` - exchanges the authorization code for a token and stores it server-side.
- `GET /oauth/cloudflare/status?tenant=<id>` - reports whether that tenant has a Cloudflare token stored, without exposing the token.

MCP tools accept an optional `tenant` argument. If a tenant has connected Cloudflare, the Worker uses that tenant OAuth token. Otherwise it falls back to the self-hosted `CLOUDFLARE_API_TOKEN` secret.

## Required Cloudflare OAuth client settings

Create an OAuth client in Cloudflare, then configure:

- Redirect URI: `https://<your-worker-host>/oauth/cloudflare/callback`
- Authorization URL: `https://dash.cloudflare.com/oauth2/auth`
- Token URL: `https://dash.cloudflare.com/oauth2/token`
- Scopes:
  - `zone.read`
  - `dns.write`
  - `email-routing-address.write`
  - `email-routing-rule.write`

## Worker secrets

```sh
cd worker
npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_ID
npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_SECRET
npx wrangler secret put CLOUDFLARE_OAUTH_REDIRECT_URI
npx wrangler deploy
```

Optional custom scope list:

```sh
npx wrangler secret put CLOUDFLARE_OAUTH_SCOPES
```

## Storage

OAuth state and tokens are stored in the `ZONEMENDER_OAUTH` KV binding. The public package includes the binding shape; operators deploying their own Worker should create their own KV namespace and update `worker/wrangler.jsonc`.

## Safety model

- The agent never receives the OAuth access token.
- The token is only read inside the Worker.
- MCP remains locked by `MCP_ACCESS_KEY`.
- Mutating DNS tools stay dry-run until `apply: true`.
- Users can revoke the OAuth client in Cloudflare.
