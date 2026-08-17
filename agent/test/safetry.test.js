import test from "node:test";
import assert from "node:assert/strict";
import { HARD_NO_LIST, SAFETRY_CAPABILITIES, landingGuide } from "../src/safetry.js";

test("dangerous generic execution is blocked", () => {
  const blocked = SAFETRY_CAPABILITIES.find((item) => item.area === "Dangerous");
  assert.equal(blocked.lane, "blocked");
  assert.ok(blocked.operations.includes("generic shell"));
  assert.ok(HARD_NO_LIST.some((item) => item.includes("raw Wrangler")));
});

test("landing guide transfers target, hashes, limits, and hard no list", () => {
  const guide = landingGuide({
    packet: { template_id: "web_research", objective: "check", allowed_domains: ["example.com"], urls: [], limits: { max_urls: 2 } },
    packetHash: "packet-hash",
    memoryHash: "memory-hash",
    memory: { active_platform: "Cloudflare Workers", repository: "repo", branch: "main", live_target: "example.com", current_blocker: "none", next_safe_step: "verify" },
  });
  assert.equal(guide.job.packet_hash, "packet-hash");
  assert.equal(guide.job.memory_hash, "memory-hash");
  assert.equal(guide.landing.platform, "Cloudflare Workers");
  assert.ok(guide.hard_no_list.length >= 6);
});
