import test from "node:test";
import assert from "node:assert/strict";
import { normalizePacket, validateResult, validateUrl } from "../src/contracts.js";

test("URL policy requires HTTPS, a public host, and the explicit allowlist", () => {
  assert.equal(validateUrl("https://docs.example.com/a#x", ["example.com"]), "https://docs.example.com/a");
  assert.throws(() => validateUrl("http://example.com", ["example.com"]), /Only HTTPS/);
  assert.throws(() => validateUrl("https://127.0.0.1/a", ["127.0.0.1"]), /Private or local/);
  assert.throws(() => validateUrl("https://attacker.example.net", ["example.com"]), /outside the allowlist/);
  assert.throws(() => validateUrl("https://user:pass@example.com", ["example.com"]), /Credentials/);
});

test("job packets clamp budgets and reject unknown templates", () => {
  const packet = normalizePacket({
    template_id: "web_research",
    objective: "Verify the current documentation",
    allowed_domains: ["example.com"],
    urls: ["https://example.com/a"],
    limits: { max_source_chars: 999999, max_auto_followups: 50 },
    schedule: { enabled: true, every_minutes: 1 },
  }, { MAX_URLS: "3" });
  assert.equal(packet.limits.max_source_chars, 30000);
  assert.equal(packet.limits.max_auto_followups, 1);
  assert.equal(packet.schedule.every_minutes, 5);
  assert.equal(packet.agent_name, "Web research");
  assert.equal(packet.template_title, "Web research");
  assert.throws(() => normalizePacket({ template_id: "invented", objective: "x" }), /Unknown template/);
});

test("result validation requires exact transfer acknowledgement and cited supported claims", () => {
  const result = {
    acknowledgement: { packet_hash: "wrong", understood_task: "check" },
    summary: "summary",
    claims: [{ claim: "Fact", source_urls: [], support: "direct", note: "note" }],
    gaps: [], contradictions: [], confidence: 0.5, proposed_revisions: [],
  };
  const errors = validateResult(result, "expected");
  assert.ok(errors.some((item) => item.includes("hash")));
  assert.ok(errors.some((item) => item.includes("source URL")));
});
