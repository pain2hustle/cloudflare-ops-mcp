# Cloudflare Ops MCP Setup

Cloudflare Ops MCP is meant to make Cloudflare operations safe and reviewable:

1. Scan first.
2. See the exact planned change.
3. Approve only what you understand.
4. Apply the DNS change only after review.

Cloudflare Ops MCP is a standalone open-source tool. It does not include anyone's Cloudflare API keys, account credentials, hosted proxy token, or private connector. Each user brings their own Cloudflare authorization. See [PHASES.md](PHASES.md) for the public rollout path from local CLI to hosted OAuth connector.

## Authorization paths

A user needs one of these authorization paths:

1. **Local CLI path.** Create a least-privilege Cloudflare API token and export it as `CLOUDFLARE_API_TOKEN` in your own terminal.
2. **Self-hosted MCP path.** Deploy the included Worker to your own Cloudflare account and store your own `CLOUDFLARE_API_TOKEN` and `MCP_ACCESS_KEY` as Worker secrets.
3. **Host-app path.** If a separate product embeds Cloudflare Ops MCP, that product must implement its own OAuth/token vault and approval flow. Cloudflare Ops MCP itself does not provide shared hosted credentials.

Cloudflare Ops MCP can generate the **MCP access key** that protects the Worker endpoint. It cannot create a user's Cloudflare API token without Cloudflare approval. That ownership proof has to come from Cloudflare OAuth or the Cloudflare dashboard.

## Cloudflare token permissions

Use a scoped Cloudflare API token. Never use your Global API Key.

Minimum permissions for the common DNS/email-auth tools:

- Zone / Zone / Read
- Zone / DNS / Edit
- Zone / Email Routing Rules / Edit

Best practice: limit the token to the exact zones the operator should manage.

## Fast local CLI

Use this when you are fixing your own domain from your terminal.

```sh
export CLOUDFLARE_API_TOKEN=your_scoped_token
npx cloudflare-ops-mcp scan example.com
npx cloudflare-ops-mcp plan example.com --inbox owner@example.com
npx cloudflare-ops-mcp dmarc example.com --policy quarantine --pct 100
npx cloudflare-ops-mcp dmarc example.com --policy quarantine --pct 100 --apply
```

Dry-run is the default. The write only happens when you add `--apply`.

## Hosted MCP with Wrangler

Use this when you want an MCP-compatible agent or editor to call Cloudflare Ops MCP as a remote tool while keeping the Cloudflare API token in your own Worker secrets.

```sh
git clone https://github.com/pain2hustle/cloudflare-ops-mcp.git
cd cloudflare-ops-mcp
npm install
npm run worker:generate-key
npm run worker:set-token
npm run worker:set-key
npm run worker:deploy
```

Then connect your MCP client to the deployed Worker URL and send the access key in a header:

```http
Authorization: Bearer <MCP_ACCESS_KEY>
```

## Worker secrets

Store real secrets only with Wrangler, never in git:

```sh
cd worker
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put MCP_ACCESS_KEY
```

The example files contain placeholders only. `.env`, `.env.local`, `.dev.vars`, `worker/.dev.vars`, logs, and Wrangler output are ignored by git.

## Approval workflow

A safe operator flow is:

1. Run `scan` or `plan` first.
2. Read the diff.
3. Apply only the exact command you approved with `--apply`.
4. Keep the audit log for the applied change.

For hosted MCP use, keep the same rule: the agent should call read-only tools first, show the diff, then call mutating tools only when the owner approves.

## Why this is easier than raw Wrangler

Wrangler is the official Cloudflare developer CLI. It is powerful, but it does not know your intent. Cloudflare Ops MCP adds intent:

- "check my email auth" -> scans SPF, DMARC, DKIM, MX, BIMI, Email Routing.
- "fix dmarc" -> changes only the DMARC policy tag.
- "add bimi" -> refuses if DMARC is still `p=none`.
- "apply" -> writes only after a dry-run diff.
- "delete" -> blocked unless explicitly confirmed.

Wrangler still handles deployment, secrets, and logs. Cloudflare Ops MCP handles safe Cloudflare DNS, email, Pages, cache, and Turnstile workflows.