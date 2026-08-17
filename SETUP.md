# Cloudflare Ops MCP Setup

Choose the lane that fits you:

1. **Public hosted OAuth:** connect your own Cloudflare account and use a one-user connector key. No owner API token is shared.
2. **Local CLI:** create your own least-privilege Cloudflare API token and keep it in your terminal environment.
3. **Self-hosted Worker:** clone the repo, create your own OAuth app, and deploy through Wrangler.

## Fastest: public hosted OAuth

Open [https://cfops.nothingunseen.com/oauth/cloudflare/start](https://cfops.nothingunseen.com/oauth/cloudflare/start), approve Cloudflare consent, and copy the one-time MCP configuration. Point your client to:

```txt
https://cfops.nothingunseen.com/mcp
```

The returned `cfops_` connector key is not a Cloudflare API token. Keep it private and out of Git. See [OAUTH.md](OAUTH.md) for Claude/Cursor/Codex examples, status, and revoke commands.

## Local CLI

Use a scoped token, never a Global API Key. Common DNS/email permissions are Zone Read, DNS Edit, and Email Routing Rules Edit. Limit the token to the exact zones you manage.

```sh
export CLOUDFLARE_API_TOKEN=your_scoped_token
npx cloudflare-ops-mcp scan example.com
npx cloudflare-ops-mcp plan example.com --inbox owner@example.com
npx cloudflare-ops-mcp dmarc example.com --policy quarantine --pct 100
npx cloudflare-ops-mcp dmarc example.com --policy quarantine --pct 100 --apply
```

Dry-run is the default. A write occurs only with `--apply`.

## Self-hosted OAuth Worker

```sh
git clone https://github.com/pain2hustle/cloudflare-ops-mcp.git
cd cloudflare-ops-mcp
npm install
npm test
npm run oauth:setup -- https://your-worker-host
cd worker
npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_ID
npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_SECRET
npx wrangler secret put CLOUDFLARE_OAUTH_REDIRECT_URI
npx wrangler deploy
```

Configure the Cloudflare OAuth callback as:

```txt
https://your-worker-host/oauth/cloudflare/callback
```

The Worker uses the `CLOUDFLARE_OPS_OAUTH` KV binding in `worker/wrangler.jsonc`. Replace the namespace ID when deploying under another Cloudflare account.

Optional private-owner compatibility secrets:

```sh
npx wrangler secret put MCP_ACCESS_KEY
npx wrangler secret put CLOUDFLARE_API_TOKEN
```

Do not distribute that admin key. Public users should connect through OAuth.

## Safe operating flow

1. Call a scan, plan, doctor, or verification tool.
2. Read the exact planned diff.
3. Get the account owner's approval.
4. Repeat the call with `apply: true` only for that change.
5. Verify the result.

Wrangler manages deployment, KV, secrets, and logs. Cloudflare Ops MCP adds the intent-aware checks, diffs, and approval gates.
