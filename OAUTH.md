# Cloudflare OAuth Connector

<p align="center"><code>-/\-\ M H // WT · YOUR CLOUDFLARE STAYS YOURS</code></p>

Version 0.3.0 is the public, per-user OAuth lane. A user authorizes Cloudflare directly and receives a one-time `cfops_` connector key. The user never receives the service owner's Cloudflare API token, and the service never puts a user's Cloudflare token in Git, MCP arguments, chat, or status responses.

## Use the hosted connector

1. Open:

   ```txt
   https://cfops.nothingunseen.com/oauth/cloudflare/start
   ```

2. Review and approve Cloudflare's consent screen.
3. Copy the connector key or complete MCP configuration shown once on the success page.
4. Use this MCP endpoint:

   ```txt
   https://cfops.nothingunseen.com/mcp
   ```

5. Send the connector key:

   ```http
   Authorization: Bearer cfops_YOUR_CONNECTOR_KEY
   ```

The connector key is a password for this MCP connection, not a Cloudflare API token. Keep it out of source control and screenshots.

## Client examples

Claude Desktop or Cursor-style JSON:

```json
{
  "mcpServers": {
    "cloudflareOps": {
      "url": "https://cfops.nothingunseen.com/mcp",
      "headers": {
        "Authorization": "Bearer cfops_YOUR_CONNECTOR_KEY"
      }
    }
  }
}
```

Codex CLI:

```sh
codex mcp add cloudflare-ops --url https://cfops.nothingunseen.com/mcp \
  --bearer-token-env-var CFOPS_CONNECTOR_KEY
```

Store `CFOPS_CONNECTOR_KEY` in your own environment, not in Git.

## Isolation model

- OAuth state and connection IDs are generated with cryptographically secure randomness.
- The raw `cfops_` key is displayed once after consent.
- KV stores only `SHA-256(connector key)` → one random connection ID.
- That connection ID stores one Cloudflare OAuth grant server-side.
- MCP tool arguments cannot change the authenticated connection.
- Two users cannot select each other's connection with a `tenant` value.
- Expiring access tokens refresh server-side when a refresh token is available.
- Status returns scope and timestamps, never access or refresh tokens.
- Revocation deletes both the connector-key mapping and its OAuth connection.
- Mutating tools remain dry-run until the caller explicitly passes `apply: true`.

## Routes

| Route | Method | Authentication | Purpose |
|---|---:|---|---|
| `/oauth/cloudflare/start` | GET | None | Begin Cloudflare consent |
| `/oauth/cloudflare/callback` | GET | OAuth state | Exchange the code and show the connector key once |
| `/oauth/cloudflare/status` | GET | Bearer connector key | Report safe connection metadata |
| `/oauth/cloudflare/revoke` | POST | Bearer connector key | Delete that connector and connection |
| `/mcp` | POST | Bearer connector key | MCP JSON-RPC / Streamable HTTP endpoint |

Status example:

```sh
curl -H "Authorization: Bearer $CFOPS_CONNECTOR_KEY" \
  https://cfops.nothingunseen.com/oauth/cloudflare/status
```

Revoke example:

```sh
curl -X POST -H "Authorization: Bearer $CFOPS_CONNECTOR_KEY" \
  https://cfops.nothingunseen.com/oauth/cloudflare/revoke
```

## Self-host from Git

The repository contains code and placeholders only. It must never contain:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_OAUTH_CLIENT_SECRET`
- OAuth access or refresh tokens
- connector keys
- populated `.dev.vars`, `.env`, or credentials copied into config

Deploy your own connector:

```sh
git clone https://github.com/pain2hustle/cloudflare-ops-mcp.git
cd cloudflare-ops-mcp
npm install
npm run oauth:setup -- https://your-worker-host
cd worker
npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_ID
npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_SECRET
npx wrangler secret put CLOUDFLARE_OAUTH_REDIRECT_URI
npx wrangler deploy
```

Set the OAuth redirect URI to:

```txt
https://your-worker-host/oauth/cloudflare/callback
```

The included `CLOUDFLARE_OPS_OAUTH` KV binding stores OAuth state, hashed connector sessions, and encrypted-at-rest connection records.

## Optional private admin fallback

A private owner may set `MCP_ACCESS_KEY` and `CLOUDFLARE_API_TOKEN` as Worker secrets for backward compatibility. That path is an administrator fallback, not the public-user credential model. Never share the admin key with public users.

## Scope policy

Default core scopes:

```txt
zone.read dns.write email-routing-address.write email-routing-rule.write
```

Request only the scopes required by the enabled tools. Pages, cache purge, Turnstile, Workers, KV, R2, D1, or account-level tools may require additional Cloudflare permissions. Keep every OAuth app least-privilege and keep every write approval-gated.

## Upgrade note from v0.2

The old `?tenant=<id>` public flow is retired. Do not pass tenant IDs in MCP calls. Reconnect through `/oauth/cloudflare/start` to receive a per-user `cfops_` key. Existing private admin deployments may keep their owner-only fallback while users migrate.
