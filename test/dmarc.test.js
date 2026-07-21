// test/dmarc.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudflareClient } from "../src/client.js";
import { parseDmarc, buildDmarc, parseSpf, setDmarcPolicy } from "../src/dmarc.js";
import { makeMock } from "./mock.js";

function client(mock) {
  return new CloudflareClient({ token: "test-token", fetch: mock.fetch });
}

test("parseDmarc parses tags and validity", () => {
  const p = parseDmarc('"v=DMARC1; p=none; rua=mailto:d@x.com; pct=100"');
  assert.equal(p.valid, true);
  assert.equal(p.tags.p, "none");
  assert.equal(p.tags.rua, "mailto:d@x.com");
  assert.equal(p.tags.pct, "100");
});

test("buildDmarc round-trips and keeps v=DMARC1 first", () => {
  const original = "v=DMARC1; p=quarantine; rua=mailto:d@x.com; pct=25";
  const parsed = parseDmarc(original);
  const rebuilt = buildDmarc(parsed.tags, parsed.order);
  assert.equal(rebuilt, original);
  assert.ok(rebuilt.startsWith("v=DMARC1"));
});

test("parseSpf counts DNS-lookup mechanisms", () => {
  const s = parseSpf("v=spf1 include:a.com include:b.com a mx ~all");
  assert.equal(s.valid, true);
  assert.equal(s.lookupCount, 4); // 2 includes + a + mx
  assert.equal(s.all, "~all");
});

test("setDmarcPolicy none->quarantine changes ONLY p, preserving other tags", async () => {
  const mock = makeMock({
    domain: "example.org",
    dns: [
      {
        id: "d1",
        type: "TXT",
        name: "_dmarc.example.org",
        content: '"v=DMARC1; p=none; rua=mailto:dmarc@example.org; fo=1"',
        ttl: 1,
      },
    ],
  });
  const c = client(mock);
  const plan = await setDmarcPolicy(c, "example.org", "quarantine", {}, { apply: true });

  assert.equal(plan.policyBefore, "none");
  assert.equal(plan.policyAfter, "quarantine");
  // Only p changed; rua and fo preserved.
  const written = mock.state.dns[0].content;
  assert.match(written, /p=quarantine/);
  assert.match(written, /rua=mailto:dmarc@example\.org/);
  assert.match(written, /fo=1/);
  assert.doesNotMatch(written, /p=none/);
});

test("setDmarcPolicy dry-run writes nothing", async () => {
  const mock = makeMock({
    domain: "example.org",
    dns: [
      { id: "d1", type: "TXT", name: "_dmarc.example.org", content: '"v=DMARC1; p=none; rua=mailto:x@y.com"', ttl: 1 },
    ],
  });
  const c = client(mock);
  const plan = await setDmarcPolicy(c, "example.org", "quarantine", {}, { apply: false });
  assert.equal(plan.action, "update");
  assert.equal(mock.writeCalls().length, 0);
});

test("setDmarcPolicy can add rua/pct while flipping policy", async () => {
  const mock = makeMock({
    domain: "example.com",
    dns: [{ id: "d1", type: "TXT", name: "_dmarc.example.com", content: '"v=DMARC1; p=none"', ttl: 1 }],
  });
  const c = client(mock);
  const plan = await setDmarcPolicy(
    c,
    "example.com",
    "quarantine",
    { rua: "mailto:r@example.com", pct: 25 },
    { apply: true }
  );
  assert.match(plan.dmarc, /p=quarantine/);
  assert.match(plan.dmarc, /rua=mailto:r@example\.com/);
  assert.match(plan.dmarc, /pct=25/);
});

test("setDmarcPolicy rejects an invalid policy", async () => {
  const mock = makeMock({ domain: "example.com" });
  const c = client(mock);
  await assert.rejects(
    () => setDmarcPolicy(c, "example.com", "bogus", {}, { apply: false }),
    /Invalid DMARC policy/
  );
});
