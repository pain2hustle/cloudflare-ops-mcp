# Official Cloudflare MCP connectors

The harness uses fixed official endpoints:

| Connector | Endpoint | Purpose |
|---|---|---|
| Cloudflare API | `https://mcp.cloudflare.com/mcp` | Scoped account configuration and operations |
| Workers Builds | `https://builds.mcp.cloudflare.com/mcp` | Builds, failures, previews, deployment diagnostics |
| Workers Bindings | `https://bindings.mcp.cloudflare.com/mcp` | Storage, AI, and compute binding guidance/builds |
| Observability | `https://observability.mcp.cloudflare.com/mcp` | Logs and analytics |
| Cloudflare Docs | `https://docs.mcp.cloudflare.com/mcp` | Current primary documentation |

Click **Cloudflare → Connect with Cloudflare**. The Agents SDK opens Cloudflare OAuth, stores the resulting token inside that user's Durable Object SQLite, restores it after wake-up, and exposes only sanitized connection/tool metadata in the console.

Connection is not blanket approval. SafeTry still separates read, plan, approval-required, and blocked lanes. A deploy must target a preview or explicit release, then pass the public acceptance gate. Arbitrary MCP URLs are not accepted by the connector catalog.

This project is an independent third-party tool, not a Cloudflare product or endorsement.
