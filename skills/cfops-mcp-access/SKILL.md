---
name: cfops-mcp-access
description: Connect and operate Cloudflare MCP tools with per-user OAuth isolation, least privilege, SafeTry previews, and redacted receipts. Use when adding an MCP connector, authorizing a Cloudflare account, discovering tools, diagnosing permissions, or running Cloudflare operations for another user.
---

# Private MCP Access

## Connection

1. Use the fixed HTTPS connector catalog; never accept an arbitrary MCP URL from a job packet.
2. Open Cloudflare OAuth for the current user and require that user to approve it.
3. Store the grant inside that user's Durable Object/session boundary. Never copy the owner's token to users or Git.
4. Discover tools after connection and show server, scopes, connection state, and revocation controls.

## Operation

- Run read-only diagnosis first.
- Preview mutations with exact account, zone, hostname, and resource identifiers.
- Require approval for deploy, delete, DNS, cache purge, routing, secret, or spend-changing operations.
- Verify the public result and save a redacted receipt.

If no connector is authorized, report "not connected" and provide the OAuth action. Do not fall back to a shared master token.
