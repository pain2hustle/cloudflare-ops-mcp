import test from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_TREE, LEARNING_LOG, TEMPLATES, templateList } from "../src/templates.js";
import { cloudflareMcpList } from "../src/mcp-catalog.js";

test("catalog includes research, verification, continuity revision, and data review templates", () => {
  for (const id of ["web_research", "secondary_dive", "citation_verify", "ui_playwright", "site_health", "cloudflare_diagnose", "cloudflare_inventory", "data_query_review", "missed_items", "revision_proposal"]) {
    assert.ok(TEMPLATES[id], id);
  }
  assert.equal(templateList().length, Object.keys(TEMPLATES).length);
  assert.ok(CAPABILITY_TREE.cannot.some((item) => item.includes("token")));
  assert.ok(LEARNING_LOG.length >= 4);
});

test("official Cloudflare MCP catalog uses fixed HTTPS endpoints", () => {
  const connectors = cloudflareMcpList();
  assert.ok(connectors.some((item) => item.id === "cloudflare_api" && item.url === "https://mcp.cloudflare.com/mcp"));
  assert.ok(connectors.some((item) => item.id === "workers_builds" && item.url === "https://builds.mcp.cloudflare.com/mcp"));
  assert.ok(connectors.every((item) => item.url.startsWith("https://") && item.url.endsWith("/mcp")));
});
