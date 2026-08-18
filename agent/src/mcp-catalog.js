export const CLOUDFLARE_MCP_SERVERS = Object.freeze({
  cloudflare_api: { name: "Cloudflare API", url: "https://mcp.cloudflare.com/mcp", purpose: "Account configuration and scoped Cloudflare API operations." },
  workers_builds: { name: "Workers Builds", url: "https://builds.mcp.cloudflare.com/mcp", purpose: "Build status, failure evidence, previews, and deployment diagnostics." },
  workers_bindings: { name: "Workers Bindings", url: "https://bindings.mcp.cloudflare.com/mcp", purpose: "Build Workers with Cloudflare storage, AI, and compute bindings." },
  observability: { name: "Observability", url: "https://observability.mcp.cloudflare.com/mcp", purpose: "Read Worker logs and analytics for bounded diagnosis." },
  cloudflare_docs: { name: "Cloudflare Docs", url: "https://docs.mcp.cloudflare.com/mcp", purpose: "Retrieve current primary Cloudflare documentation." },
});

export function cloudflareMcpList() {
  return Object.entries(CLOUDFLARE_MCP_SERVERS).map(([id, value]) => ({ id, ...value }));
}
