# Cloudflare OAuth Connector

This is the no-mega-token path.

The Git repo can safely ship the OAuth routes, setup helper, KV binding shape, and MCP tools. It must not ship a permanent Cloudflare API token, OAuth client secret, user access token, refresh token, or account-wide admin credential.

## What Git can include

- `worker/oauth.js`: OAuth start/callback/status routes.
- `worker/wrangler.jsonc`: the `CLOUDFLARE_OPS_OAUTH` KV binding shape.
- `scripts/oauth-setup.mjs`: prints the redirect URI and secret setup commands.
- Docs that explain required scopes and deployment steps.

## What Git must not include

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_OAUTH_CLIENT_SECRET`
- OAuth access/refresh tokens
- `.dev.vars` with real values
- Any one forever mega token

## How a deployed Git app gets OAuth

1. Deploy the Worker from this repo.
2. Create a Cloudflare OAuth client in the Cloudflare dashboard or API.
3. Set the redirect URI to:

```txt
https://<your-worker-host>/oauth/cloudflare/callback
```

4. Store the OAuth client values as Worker secrets:

```sh
cd worker
npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_ID
npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_SECRET
npx wrangler secret put CLOUDFLARE_OAUTH_REDIRECT_URI
npx wrangler deploy
```

5. Send the user to:

```txt
https://<your-worker-host>/oauth/cloudflare/start?tenant=<user-or-account-id>
```

6. Cloudflare shows the consent screen. After approval, the Worker stores the tenant token in `CLOUDFLARE_OPS_OAUTH` KV. MCP tools can then be called with `{ "tenant": "<user-or-account-id>" }`.

## Scopes

Default core scopes:

```txt
zone.read dns.write email-routing-address.write email-routing-rule.write
```

For broader Cloudflare Ops, configure the OAuth client with only the additional scopes your UI exposes, then set the exact selected scope list as a Worker secret:

```sh
npx wrangler secret put CLOUDFLARE_OAUTH_SCOPES
```

Example value:

```txt
zone.read dns.write email-routing-address.write email-routing-rule.write
```

Do not blindly request every available scope. If you add Pages, cache purge, Turnstile, Workers, KV, R2, D1, or account-level tools, add the matching Cloudflare OAuth scopes only when those tools exist and remain approval-gated.

Cloudflare says OAuth apps use the Authorization Code flow, and OAuth scope names correspond to Cloudflare API token permission names. Use Cloudflare's current scope list when creating the OAuth client.

## Routes

- `GET /oauth/cloudflare/start?tenant=<id>` redirects the user to Cloudflare consent.
- `GET /oauth/cloudflare/callback` exchanges the code for a token and stores it server-side.
- `GET /oauth/cloudflare/status?tenant=<id>` reports connection status without exposing the token.

The Worker root JSON also reports whether OAuth is configured and shows the start/callback/status URLs.

## Safety model

- OAuth access tokens stay inside the Worker/KV.
- Agents never receive Cloudflare tokens.
- The MCP endpoint still requires `MCP_ACCESS_KEY`.
- Mutating tools stay dry-run until `apply: true`.
- Users can revoke the OAuth client in Cloudflare.
- Prefer OAuth per user/tenant over a shared permanent API token.

## Setup helper

```sh
npm run oauth:setup -- https://<your-worker-host>
```