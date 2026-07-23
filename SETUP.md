# ZoneMender Setup for Vibe Coders

ZoneMender is meant to make Cloudflare DNS work feel like this:

1. Scan first.
2. See the exact planned change.
3. Approve only what you understand.
4. Let the tool write the DNS safely.

You can use raw Wrangler, but ZoneMender gives you safer lanes on top of Wrangler: DMARC, SPF, BIMI, Email Routing, and DNS fixes with dry-run defaults.

## What the user must provide

A user needs one of these authorization paths:

1. **Best path: OAuth through the host app.** The user clicks Connect Cloudflare, approves Cloudflare permissions, and the host app stores encrypted tokens. This is best for WALO-style customer accounts.
2. **Self-hosted path: scoped Cloudflare API token.** The user creates a least-privilege token in Cloudflare and puts it into Worker secrets. This is best for developers and self-hosted MCP users.

ZoneMender can generate the **MCP access key** that protects the Worker endpoint. It cannot safely invent a user's Cloudflare API token without Cloudflare approval. That ownership proof has to come from OAuth or Cloudflare's dashboard.

Generate the MCP endpoint key:

```sh
npm run worker:generate-key
```

Then store it as a Worker secret:

```sh
cd worker
npx wrangler secret put MCP_ACCESS_KEY
```


## Phone-only Git and WALO workflow

This is the no-PC lane for a builder using ChatGPT, Claude, Codex, or another agent from a phone.

<table>
<tr>
<td>

**1. Inspect from the phone**

The user asks a phone AI assistant to inspect a GitHub repo, write a fix plan, or produce a small code/document change. The assistant should return the exact repo, file path, change summary, and risk notes.

</td>
</tr>
<tr>
<td>

**2. Send to WALO**

The user sends the approved request to WALO in chat. WALO uses the user's connected GitHub account to stage a branch or commit, and the connected Cloudflare account to verify or deploy when that action is authorized.

</td>
</tr>
<tr>
<td>

**3. ZoneMender handles Cloudflare safely**

For DNS, DMARC, BIMI, SPF, MX, or Email Routing work, WALO calls ZoneMender. ZoneMender scans first, returns a diff, and writes only after explicit approval.

</td>
</tr>
<tr>
<td>

**4. Proof comes back to chat**

After apply/deploy, WALO should send the commit, changed files, live URL, 200/404 checks, and any warnings back to the phone chat so the user can keep moving without opening a PC.

</td>
</tr>
</table>

What still has to be real:

- GitHub must be connected by OAuth or a scoped token before repo writes.
- Cloudflare must be connected by OAuth or a scoped API token before DNS or deploy writes.
- Sensitive actions need approval gates: DNS, deploys, public posts, payments, and production code writes.
- If a connector is not connected, WALO should say what is missing instead of pretending the action ran.

## Fast local CLI

Use this when you are fixing your own domain from your terminal.

```sh
export CLOUDFLARE_API_TOKEN=your_scoped_token
npx zonemender scan example.com
npx zonemender plan example.com --inbox owner@example.com
npx zonemender dmarc example.com --policy quarantine --pct 100
npx zonemender dmarc example.com --policy quarantine --pct 100 --apply
```

Dry-run is the default. The write only happens when you add `--apply`.

## Hosted MCP with Wrangler

Use this when you want Claude, Codex, Cursor, WALO, or another agent to call ZoneMender as a remote MCP server.

```sh
git clone https://github.com/pain2hustle/zonemender.git
cd zonemender
npm install
npm run worker:generate-key
npm run worker:set-token
npm run worker:set-key
npm run worker:deploy
```

Then connect your MCP client to the deployed Worker URL and send the header:

```
Authorization: Bearer <MCP_ACCESS_KEY>
```

## Cloudflare token permissions

Use a scoped Cloudflare API token. Never use your Global API Key.

Minimum permissions:

- Zone / Zone / Read
- Zone / DNS / Edit
- Zone / Email Routing Rules / Edit

Best practice: limit the token to the exact zones the agent should manage.

## Why this is easier than raw Wrangler

Wrangler is the official Cloudflare developer CLI. It is powerful, but it does not know your intent. ZoneMender adds intent:

- "check my email auth" -> scans SPF, DMARC, DKIM, MX, BIMI, Email Routing.
- "fix dmarc" -> changes only the DMARC policy tag.
- "add bimi" -> refuses if DMARC is still `p=none`.
- "apply" -> writes only after a dry-run diff.
- "delete" -> blocked unless explicitly confirmed.

Wrangler still handles deployment, secrets, and logs. ZoneMender handles safe Cloudflare DNS workflows.

## For WALO-style phone workflows

A small business owner should not need to understand every record by name. A good agent flow is:

1. Owner texts: "check email walohq.com".
2. WALO calls ZoneMender MCP scan tools.
3. WALO replies with plain-English status and exact DNS diff.
4. Owner replies "YES apply dmarc".
5. ZoneMender applies one scoped fix and writes an audit log.

That is the lane: phone-first, approval-first, no dashboard maze.
