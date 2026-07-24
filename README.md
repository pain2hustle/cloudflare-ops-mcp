# ZoneMender - Unofficial Cloudflare DNS, Email Auth, BIMI, DMARC, SPF, Email Routing & MCP Server for AI Agents

**An independent Cloudflare DNS, DMARC, BIMI, SPF, Email Routing, and Wrangler-friendly MCP toolkit for developers, operators, and AI agents.**

ZoneMender scans a Cloudflare zone, computes a **diff** of desired vs current **DNS / Email Routing / BIMI / DMARC / SPF** configuration, and **applies fixes only after explicit approval**. It is built for people who want an AI agent to help with Cloudflare safely: scan first, show the plan, then write only when the owner approves.

It works three ways:

- **CLI**: run `zonemend` locally with a scoped Cloudflare token.
- **Library**: import the zero-dependency engine into your own app.
- **Remote MCP Worker**: deploy the included Worker with Wrangler so Claude, Codex, Cursor, or another MCP client can call Cloudflare DNS tools through a locked endpoint.

ZoneMender is especially useful for Cloudflare operators who need repeatable DNS hygiene across many zones: SPF cleanup, DMARC enforcement, BIMI records, MX checks, DKIM discovery, Cloudflare Email Routing, TXT verification records, safe DNS upserts, and audit logs for every approved write.

> **Unofficial Cloudflare tool.** ZoneMender is made by **AMH - Artificial Mind Hive**, operated by **Service Pricer LLC**. It is independent, third-party, open-source software. It is **not affiliated with, endorsed by, sponsored by, or made by Cloudflare, Inc.** "Cloudflare" and "Wrangler" are referenced only to describe compatibility with Cloudflare's platform and official developer tooling. You are responsible for every DNS, Email Routing, DMARC, BIMI, SPF, or Worker change you approve and apply.

---

## What ZoneMender handles

ZoneMender is focused on the Cloudflare zone tasks that regularly break launches, email trust, brand display, and AI-agent workflows:

- DNS record scan, lookup, create, update, no-op detection, and guarded delete.
- SPF detection and planning so you do not accidentally create multiple SPF records.
- DMARC parsing and policy updates that only change the fields you asked for.
- BIMI TXT setup with a DMARC enforcement gate.
- DKIM discovery so the report can tell whether sender keys exist.
- MX and Cloudflare Email Routing checks.
- Email Routing destination/rule setup with verified-destination protection.
- Audit logs for applied changes.
- MCP endpoint deployment on Cloudflare Workers with Wrangler secrets.
- AI-agent safety defaults: dry-run first, diff display, no token in tool args, no accidental deletes.

This is not meant to replace every Cloudflare feature. It is the narrow, safe lane for the zone/email-auth work an operator or AI agent should be allowed to do.

## Examples are operator recipes

The examples below are intentionally direct. They are not toy examples. They show the exact dry-run -> review -> apply pattern users should follow when fixing real domains.

## Why build this with Wrangler?

Wrangler is Cloudflare's official developer CLI. ZoneMender can run without Wrangler as a local CLI/library, but Wrangler is the right path when you want a remote MCP server because it deploys the Worker, stores secrets, tails logs, and manages Cloudflare bindings from the same toolchain Cloudflare documents.

Use Wrangler when you want:

- a hosted MCP endpoint for agents and teammates;
- Worker secrets for `CLOUDFLARE_API_TOKEN` and `MCP_ACCESS_KEY`;
- Cloudflare Pages/Workers deployment checks;
- observability through Cloudflare logs;
- a repeatable production setup instead of local-only scripts.

Use the plain CLI when you only need one local terminal to scan or fix a zone.
---

## Current release notes

<table>
<tr>
<td>

**Agent-safe Cloudflare writes**

ZoneMender keeps the write path narrow: scan the zone, show the diff, wait for explicit approval, then apply only the requested DNS, DMARC, BIMI, SPF, or Email Routing change.

</td>
</tr>
<tr>
<td>

**Worker MCP endpoint hardening**

The hosted MCP lane is built for Cloudflare Workers and Wrangler. The Cloudflare API token stays in Worker secrets, the public endpoint requires an MCP access key, and mutating tools stay dry-run unless `apply: true` is sent.

</td>
</tr>
<tr>
<td>

**Email trust diagnostics**

The scanner reports SPF, DKIM discovery, DMARC policy, BIMI readiness, MX records, and Cloudflare Email Routing status so an agent or operator can see what is missing before touching production DNS.

</td>
</tr>
<tr>
<td>

**Other highlights**

- Zero-dependency core library for host apps and CLI use.
- Scoped Cloudflare token guidance instead of Global API Key usage.
- Audit logging for applied changes, with token redaction.
- WALO-ready phone workflow documented for non-traditional builders.

</td>
</tr>
</table>

---

## Safety model (the whole point)

1. **Dry-run by default.** Every mutating function takes an options object and
   only writes when `{ apply: true }` is passed. The CLI is dry-run unless you
   add `--apply`. A dry-run returns the *planned* change plus a before/after
   diff and writes nothing.
2. **Scan before write.** Apply paths re-fetch current state and return a
   before/after diff, so you always see exactly what will change.
3. **Never delete as a side effect.** Deleting a DNS record requires an explicit
   `deleteDnsRecord(..., { confirm: true })` call (CLI: `--force`). An `apply`
   never deletes anything.
4. **Token hygiene.** The Cloudflare API token is read **only** from
   `process.env.CLOUDFLARE_API_TOKEN`. It is never logged, never written to the
   audit log, and never included in thrown error messages - any token-looking
   substring is redacted defensively.
5. **Scoped token only.** Use a least-privilege scoped API token. **Do not use
   the Global API Key.**
6. **BIMI precondition.** `setupBimi` first checks the domain's DMARC policy. If
   `p` is missing or `none`, it **refuses to write in apply mode** (BIMI is not
   honored below enforcement) unless you pass `{ force: true }`. In dry-run it
   warns.
7. **Audit log.** Every apply appends one JSON line to an audit log
   (default `./zonemender-audit.log`) with
   `{ ts, action, domain, record, before, after }` - never the token.

---

## Quick setup

For the fastest path, start with [SETUP.md](SETUP.md). It explains the CLI path, the Wrangler-hosted MCP path, and the phone-first WALO workflow. See [ROADMAP.md](ROADMAP.md) for the next upgrades.

## Install

```sh
npm install zonemender
# or run the CLI without installing:
npx zonemender scan example.com
```

Requires **Node.js >= 18** (for the built-in global `fetch`). No other
dependencies.

---

## Create a scoped Cloudflare API token (least privilege)

1. Cloudflare dashboard -> **My Profile** -> **API Tokens** -> **Create Token**.
2. Choose **Create Custom Token**.
3. Under **Permissions**, add exactly these three:
   - **Zone** -> **Zone** -> **Read**
   - **Zone** -> **DNS** -> **Edit**
   - **Zone** -> **Email Routing Rules** -> **Edit**
4. Under **Zone Resources**, select **Include -> Specific zone ->** *your domain*
   (not "All zones").
5. *(Recommended)* set a **TTL** and/or **Client IP Address Filtering**.
6. **Continue -> Create Token**, then copy the token value **once** (it is shown
   only at creation; if lost, roll it).

> Do **not** use the Global API Key - it has access to everything, cannot be
> scoped or time-limited, and there is only one per account.

### Provide the token

Put it in your environment (never in a CLI argument or in code):

```sh
export CLOUDFLARE_API_TOKEN="your-scoped-token"
```

or copy `.env.example` to `.env` and fill it in:

```sh
cp .env.example .env
# then load it however you prefer (e.g. `set -a; . ./.env; set +a`)
```

`zonemender` reads `CLOUDFLARE_API_TOKEN` from the environment only.

---

## CLI usage

```
zonemend <command> <domain> [options]
```

| Command | What it does |
| --- | --- |
| `scan <domain>` | Full read-only snapshot: DNS, SPF, DKIM, DMARC, BIMI, Email Routing. |
| `plan <domain> [--inbox x@y]` | Report desired vs current email-auth posture (no writes). |
| `dns <domain> --type T --name N --content C [--ttl n] [--proxied] [--apply]` | Upsert a DNS record (create / update / no-op). |
| `email <domain> --forward a@b=to@c [--catch-all to@c] [--apply]` | Plan/apply Email Routing forward rules + catch-all. |
| `dmarc <domain> --policy quarantine [--rua mailto:x] [--pct 25] [--apply]` | Change **only** the DMARC `p=` (and `rua`/`pct`), safely. |
| `bimi <domain> --logo <url> [--vmc <url>] [--apply] [--force]` | Set `default._bimi` TXT (refuses if DMARC=`none` unless `--force`). |
| `verify <domain>` | Verify the API token, then resolve the zone. |

Global flags: `--apply` (perform the write; default is dry-run), `--force`
(BIMI DMARC override / delete), `--audit <path>` (audit log location),
`-h`/`--help`.

**Everything is a dry-run until you add `--apply`.** BIMI needs a **hosted
SVG Tiny-PS logo URL** that you supply via `--logo` (and, for Gmail/Apple Mail
display, a VMC/CMC via `--vmc`).

---

## Worked example - three real jobs

Assume a scoped token is exported and each domain is a zone in your account.

### (a) Add `default._bimi` TXT to `example.com`

First, dry-run (writes nothing - shows the diff):

```sh
zonemend bimi example.com --logo https://example.com/bimi/logo.svg
```

```
BIMI for example.com (DMARC p=quarantine, enforcing=true):
  new record: v=BIMI1; l=https://example.com/bimi/logo.svg
  action: create (dry-run)
  record: TXT default._bimi.example.com
  - before: (record does not exist)
  + after:  content="v=BIMI1; l=https://example.com/bimi/logo.svg" ttl=1
  warn: No VMC/CMC supplied (a=). Gmail and Apple Mail require a VMC/CMC to display the logo; Yahoo/AOL do not.

Dry-run only. Re-run with --apply to write this change.
```

Then apply:

```sh
zonemend bimi example.com --logo https://example.com/bimi/logo.svg --apply
```

> If `example.com`'s DMARC were still at `p=none`, the apply would be **blocked**
> with an error telling you to raise DMARC first (or pass `--force`). Fix DMARC,
> then set BIMI.

### (b) Add `default._bimi` TXT to `example.org`

Dry-run:

```sh
zonemend bimi example.org --logo https://example.org/bimi/logo.svg
```

Apply once the diff looks right:

```sh
zonemend bimi example.org --logo https://example.org/bimi/logo.svg --apply
```

(For broad display in Gmail/Apple Mail, host a VMC/CMC and add
`--vmc https://example.org/bimi/vmc.pem`.)

### (c) Change `_dmarc.example.org` from `p=none` to `p=quarantine`

Dry-run first - note it changes **only** `p`, preserving your existing `rua`:

```sh
zonemend dmarc example.org --policy quarantine --rua mailto:dmarc@example.org --pct 25
```

```
DMARC none -> quarantine for example.org:
  new record: v=DMARC1; p=quarantine; rua=mailto:dmarc@example.org; pct=25
  action: update (dry-run)
  record: TXT _dmarc.example.org
  - before: content="\"v=DMARC1; p=none; rua=mailto:dmarc@example.org\"" ttl=1
  + after:  content="\"v=DMARC1; p=quarantine; rua=mailto:dmarc@example.org; pct=25\"" ttl=1
  changed fields: content

Dry-run only. Re-run with --apply to write this change.
```

Then apply:

```sh
zonemend dmarc example.org --policy quarantine --rua mailto:dmarc@example.org --pct 25 --apply
```

> **Ramp safely.** Only flip to `quarantine` after `p=none` + `rua` reports show
> all your legitimate mail is authenticating with **alignment**. Then widen
> `--pct 25 -> 50 -> 100` over a couple of weeks before ever considering
> `p=reject`. `pct` is honored today but is being removed in the in-progress
> DMARCbis revision - treat it as current best practice, not forever.

---

## Library usage (host apps)

`zonemender` exposes clean named exports so a host app can import and wrap it
(add your own auth, approval UI, or multi-tenant token vault) - but it has
**no dependency on any host** and runs perfectly standalone.

```js
import {
  CloudflareClient,
  scanZone,
  applyDnsRecord,
  setDmarcPolicy,
  setupBimi,
  setupEmailRouting,
  planEmailAuth,
  appendAudit,
} from "zonemender";

const client = new CloudflareClient(); // reads CLOUDFLARE_API_TOKEN from env
// (you may also inject { token, fetch } - useful for tests)

// Read-only snapshot:
const snapshot = await scanZone(client, "example.com");

// Plan a DMARC flip (dry-run - writes nothing):
const plan = await setDmarcPolicy(client, "example.com", "quarantine", {
  rua: "mailto:dmarc@example.com",
  pct: 25,
});

// Apply it, then record the change yourself (you supply the timestamp):
const applied = await setDmarcPolicy(
  client,
  "example.com",
  "quarantine",
  { rua: "mailto:dmarc@example.com", pct: 25 },
  { apply: true }
);
appendAudit("./zonemender-audit.log", {
  ts: new Date().toISOString(),
  action: "dmarc.policy",
  domain: "example.com",
  record: applied.record,
  before: applied.before,
  after: applied.after,
});
```

Every mutating export is dry-run unless you pass `{ apply: true }`, and pure
logic never calls `Date.now()` - you (or the CLI) supply audit timestamps.

### Public exports

- `CloudflareClient`, `CloudflareError`, `redactToken`
- `resolveZoneId`, `resolveZone`, `scanZone`
- `listRecords`, `findRecord`, `applyDnsRecord`, `deleteDnsRecord`
- `getRoutingStatus`, `enableRouting`, `listDestinations`, `addDestination`,
  `listRules`, `getCatchAll`, `setupEmailRouting`
- `parseDmarc`, `buildDmarc`, `parseSpf`, `getDmarc`, `setDmarcPolicy`,
  `quoteTxt`, `unquoteTxt`
- `parseBimi`, `buildBimi`, `validateBimiSvgUrl`, `setupBimi`
- `planEmailAuth`
- `appendAudit`, `AUDIT_DEFAULT_PATH`

---

## Embedding in a platform

`zonemender` is a generic, open tool. A larger platform can `import` it to
automate zone hygiene for its users (wrapping it with per-account tokens and an
approval step), but it is completely standalone - the library and CLI run on
their own with nothing but a scoped Cloudflare token.

---

## Remote MCP server for Cloudflare DNS agents

`worker/` is an optional [Model Context Protocol](https://modelcontextprotocol.io)
server (a Cloudflare Worker) that exposes the same engine as tools over a URL, so
any MCP client - an agent, Claude, Cursor - can `scan_zone`, `plan_email_auth`,
`set_dmarc_policy`, `setup_bimi`, etc. by pointing at it.

Three deliberate hardening choices:

- **The token is a Worker secret, never a tool parameter** - so it never travels
  through an MCP client's logs or an agent's transcript.
- **The endpoint itself is locked.** Because these tools can mutate DNS, a public
  Worker URL must not be callable by anyone who finds it. Set `MCP_ACCESS_KEY` and
  the server rejects any request without `Authorization: Bearer <MCP_ACCESS_KEY>`
  (or an `X-MCP-Key` header). Deploying without it leaves the endpoint open - don't.
- **Every mutating tool is dry-run by default**; the caller must pass
  `apply: true` after seeing the diff. BIMI keeps its DMARC precondition.

```sh
npm run worker:generate-key                 # creates a strong MCP_ACCESS_KEY
cd worker
npx wrangler secret put CLOUDFLARE_API_TOKEN   # the scoped CF token the tools use
npx wrangler secret put MCP_ACCESS_KEY         # paste generated zm_ key
npx wrangler deploy
```

Point your MCP client at the deployed URL and add the header
`Authorization: Bearer <MCP_ACCESS_KEY>`.

The core library has **zero dependencies**; the Worker is an optional surface -
you never need it to use the CLI.

---

## Development

```sh
npm test        # node --test (mock fetch, no live network calls)
```

## Maker

Made by AMH - Artificial Mind Hive, operated by Service Pricer LLC.

## Contact / company

- Service Pricer: https://servicepricer.app
- GitHub: https://github.com/pain2hustle/zonemender

## License

MIT (c) 2026 Pain2HuStle
