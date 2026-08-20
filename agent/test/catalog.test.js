import test from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_TREE, LEARNING_LOG, TEMPLATES, templateList } from "../src/templates.js";
import { cloudflareMcpList } from "../src/mcp-catalog.js";
import { skillList, skillsForTemplate } from "../src/skill-catalog.js";

test("catalog includes research, verification, continuity revision, and data review templates", () => {
  for (const id of ["web_research", "secondary_dive", "citation_verify", "ui_playwright", "site_health", "cloudflare_diagnose", "cloudflare_inventory", "data_query_review", "missed_items", "revision_proposal", "security_review"]) {
    assert.ok(TEMPLATES[id], id);
  }
  // security_review must ship the refute-then-confirm doctrine and require sources.
  assert.match(TEMPLATES.security_review.purpose, /refute/i);
  assert.equal(TEMPLATES.security_review.requiresUrls, true);
  assert.equal(TEMPLATES.security_review.verifier, true);
  assert.equal(templateList().length, Object.keys(TEMPLATES).length);
  assert.ok(CAPABILITY_TREE.cannot.some((item) => item.includes("token")));
  assert.ok(LEARNING_LOG.length >= 4);
});

test("process skills are complete and automatically mapped to jobs", () => {
  const skills = skillList();
  const ids = new Set(skills.map((item) => item.id));
  assert.equal(skills.length, 14);
  for (const id of ["cfops-google-research", "cfops-claude-verifier", "cfops-live-verify", "cfops-landing-guard", "cfops-error-sentinel", "cfops-operator-context"]) assert.ok(ids.has(id), id);
  assert.deepEqual(skillsForTemplate("site_health"), ["cfops-live-verify", "cfops-landing-guard", "cfops-error-sentinel", "cfops-context-handoff", "cfops-operator-context"]);
  assert.ok(skillsForTemplate("security_review").includes("cfops-security-review"));
  assert.ok(skillsForTemplate("security_review").includes("cfops-claude-verifier"));
});

test("official Cloudflare MCP catalog uses fixed HTTPS endpoints", () => {
  const connectors = cloudflareMcpList();
  assert.ok(connectors.some((item) => item.id === "cloudflare_api" && item.url === "https://mcp.cloudflare.com/mcp"));
  assert.ok(connectors.some((item) => item.id === "workers_builds" && item.url === "https://builds.mcp.cloudflare.com/mcp"));
  assert.ok(connectors.every((item) => item.url.startsWith("https://") && item.url.endsWith("/mcp")));
});
