# AMH Cloudflare Ops MCP by WT

`-/\-\ M H // WT`

The remote server is an unofficial Cloudflare operations MCP for DNS, Email Routing, DMARC, SPF, BIMI, Pages, cache, Turnstile, account diagnostics, and scoped-token workflows. It is independent open-source software, not made or endorsed by Cloudflare.

## Public hosted endpoint

```txt
https://mcp.artificialmindhive.com/mcp
```

Connect your Cloudflare account first:

```txt
https://mcp.artificialmindhive.com/oauth/cloudflare/start
```

After consent, copy the one-time `cfops_` key and send it as:

```http
Authorization: Bearer cfops_YOUR_CONNECTOR_KEY
```

This key is not a Cloudflare API token. The Cloudflare OAuth grant remains server-side and is bound to only this connector.

## MCP configuration

```json
{
  "mcpServers": {
    "cloudflareOps": {
      "url": "https://mcp.artificialmindhive.com/mcp",
      "headers": {
        "Authorization": "Bearer cfops_YOUR_CONNECTOR_KEY"
      }
    }
  }
}
```

## Tool lanes

- Zone and DNS scan, plan, guarded upsert, and verification.
- SPF, DKIM, MX, DMARC, BIMI, and Email Routing diagnostics.
- DMARC, BIMI, Email Routing, Pages cutover, cache purge, and Turnstile changes.
- Account doctor, domain ownership diagnosis, and Pages branch checks.
- Least-privilege token mint/list/revoke workflows.

Every mutating tool is dry-run by default. Read the returned diff, then pass `apply: true` only after the account owner approves it.

## Version 0.5 private Agent Harness

Version 0.5 can delegate bounded work to the companion Agent Harness through five MCP tools:

- `agent_research_start` starts a bounded template job, including zero-AI `site_health` checks.
- `agent_research_status` returns one job's redacted sources, timeline, primary result, and independent verifier result.
- `agent_research_list` lists recent tenant-isolated jobs.
- `agent_briefing` returns the Continuity Keeper's compact current briefing and memory hash.
- `agent_control` pauses/resumes work, requests cancellation, forces read-only mode, or runs retention cleanup. Models cannot disable read-only mode.

Start a bounded job:

```json
{"name":"agent_research_start","arguments":{"agent_name":"Jack","template_id":"site_health","objective":"Verify the release endpoint","allowed_domains":["example.com"],"urls":["https://example.com/health"],"expected_text":"0.5.1"}}
```

Read status or recent jobs:

```json
{"name":"agent_research_status","arguments":{"job_id":"JOB_ID"}}
{"name":"agent_research_list","arguments":{}}
```

Read the compact briefing or pause new work:

```json
{"name":"agent_briefing","arguments":{}}
{"name":"agent_control","arguments":{"action":"pause"}}
```

These tools are available only when the MCP Worker has the private `AGENT_HARNESS` service binding and matching `HARNESS_INTERNAL_KEY`. They call the harness over the binding, not a public harness URL. The service binding does not expose the Agent Harness console publicly; console access remains separately authenticated and should be restricted to its intended operators.

## Self-host with Wrangler

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

Real credentials belong in Wrangler secrets, never in `worker/wrangler.jsonc` or Git. See [OAUTH.md](OAUTH.md) for the complete hosted and self-hosted authorization model.

## Contact

- Artificial Mind Hive: https://artificialmindhive.com
- Walrus Tusk (WT): https://artificialmindhive.com/WalrusTooth
- Company: Service Pricer LLC - https://servicepricer.app
- GitHub: https://github.com/pain2hustle/cloudflare-ops-mcp
