import test from "node:test";
import assert from "node:assert/strict";
import { knowledgeFilename, redactedKnowledgeExport } from "../src/knowledge.js";

test("knowledge filenames include safe site, date, and time", () => {
  assert.equal(knowledgeFilename("https://MCP.ArtificialMindHive.com", "Release Manifest", new Date("2026-08-17T18:42:08Z")), "mcp.artificialmindhive.com/2026-08-17_18-42-08Z_release-manifest.json");
});

test("compact export omits detailed job payloads and unapproved revisions", () => {
  const out = redactedKnowledgeExport({ briefing: { memory: { live_target: "x" }, memory_hash: "h" }, revisions: [{ id: "r1", status: "proposed" }, { id: "r2", status: "approved", proposal: { title: "ok" } }], jobs: [{ id: "j", status: "completed", packet_hash: "p", packet: { template_id: "x", objective: "o", context: "private" } }] });
  assert.equal(out.approved_revisions.length, 1);
  assert.equal(out.recent_jobs[0].context, undefined);
  assert.equal(JSON.stringify(out).includes("private"), false);
});
