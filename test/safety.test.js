// test/safety.test.js
// Cross-cutting safety guarantee: a mutating function with no { apply: true }
// performs ZERO write requests (no POST/PUT/PATCH/DELETE).

import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudflareClient } from "../src/client.js";
import { applyDnsRecord } from "../src/dns.js";
import { setDmarcPolicy } from "../src/dmarc.js";
import { setupBimi } from "../src/bimi.js";
import { setupEmailRouting } from "../src/email.js";
import { makeMock } from "./mock.js";

function client(mock) {
  return new CloudflareClient({ token: "test-token", fetch: mock.fetch });
}

async function svgFetch() {
  return { status: 200, headers: { get: () => "image/svg+xml" }, async text() { return "<svg baseProfile=\"tiny-ps\"><title>x</title></svg>"; } };
}

test("applyDnsRecord dry-run: zero writes", async () => {
  const mock = makeMock({ domain: "example.com", dns: [] });
  await applyDnsRecord(
    client(mock),
    "example.com",
    { type: "TXT", name: "x.example.com", content: '"hello"' }
    // no opts -> apply defaults to false
  );
  assert.equal(mock.writeCalls().length, 0);
});

test("setDmarcPolicy dry-run: zero writes", async () => {
  const mock = makeMock({
    domain: "example.com",
    dns: [{ id: "d1", type: "TXT", name: "_dmarc.example.com", content: '"v=DMARC1; p=none"', ttl: 1 }],
  });
  // rua supplied because escalating to quarantine/reject without a reporting
  // address is now refused outright (2026-08-21 guard). The point of this test
  // is that a PERMITTED escalation still writes nothing without apply:true.
  await setDmarcPolicy(client(mock), "example.com", "quarantine", { rua: "mailto:dmarc@example.com" });
  assert.equal(mock.writeCalls().length, 0);
});

test("setupBimi dry-run: zero writes", async () => {
  const mock = makeMock({
    domain: "example.com",
    dns: [{ id: "d1", type: "TXT", name: "_dmarc.example.com", content: '"v=DMARC1; p=quarantine"', ttl: 1 }],
  });
  await setupBimi(client(mock), "example.com", { logo: "https://example.com/l.svg" }, { fetch: svgFetch });
  assert.equal(mock.writeCalls().length, 0);
});

test("setupEmailRouting dry-run: zero writes", async () => {
  const mock = makeMock({ domain: "example.com" });
  await setupEmailRouting(
    client(mock),
    "example.com",
    { forwards: [{ address: "hi@example.com", to: "me@gmail.com" }], catchAll: "me@gmail.com" }
    // no opts -> apply defaults to false
  );
  assert.equal(mock.writeCalls().length, 0);
});

test("apply:true DOES write (proves the dry-run guard is what gates writes)", async () => {
  const mock = makeMock({ domain: "example.com", dns: [] });
  await applyDnsRecord(
    client(mock),
    "example.com",
    { type: "TXT", name: "x.example.com", content: '"hello"' },
    { apply: true }
  );
  assert.equal(mock.writeCalls().length, 1);
});

// ── DMARC guardrails (added 2026-08-21) ──────────────────────────────────────
// These encode the three ways set_dmarc_policy could previously break real mail.

test("setDmarcPolicy reads the REAL dmarc record past a verification TXT", async () => {
  const mock = makeMock({
    domain: "example.com",
    dns: [
      { id: "verif", type: "TXT", name: "_dmarc.example.com", content: "dmarcian-verification=abc", ttl: 1 },
      { id: "real", type: "TXT", name: "_dmarc.example.com", content: "v=DMARC1; p=reject; rua=mailto:d@example.com; sp=reject", ttl: 3600 },
    ],
  });
  // Weakening is refused — which proves it saw p=reject rather than "no policy".
  await assert.rejects(
    () => setDmarcPolicy(client(mock), "example.com", "none", {}),
    /Refusing to WEAKEN DMARC/,
  );
  assert.equal(mock.writeCalls().length, 0);
});

test("setDmarcPolicy preserves rua/ruf/sp when only p changes", async () => {
  const mock = makeMock({
    domain: "example.com",
    dns: [
      { id: "verif", type: "TXT", name: "_dmarc.example.com", content: "google-site-verification=xyz", ttl: 1 },
      { id: "real", type: "TXT", name: "_dmarc.example.com", content: "v=DMARC1; p=reject; rua=mailto:d@example.com; ruf=mailto:f@example.com; sp=reject; adkim=s", ttl: 3600 },
    ],
  });
  const out = await setDmarcPolicy(client(mock), "example.com", "quarantine", { force: true });
  const after = (out.after && out.after.content) || "";
  assert.match(after, /p=quarantine/);
  assert.match(after, /rua=mailto:d@example\.com/);
  assert.match(after, /ruf=mailto:f@example\.com/);
  assert.match(after, /sp=reject/);
  assert.match(after, /adkim=s/);
  assert.equal(mock.writeCalls().length, 0);
});

test("setDmarcPolicy refuses to jump straight to p=reject", async () => {
  const mock = makeMock({ domain: "example.com", dns: [] });
  await assert.rejects(
    () => setDmarcPolicy(client(mock), "example.com", "reject", { rua: "mailto:d@example.com" }),
    /Refusing to jump .* straight to p=reject/,
  );
  assert.equal(mock.writeCalls().length, 0);
});

test("setDmarcPolicy refuses two DMARC records rather than guessing", async () => {
  const mock = makeMock({
    domain: "example.com",
    dns: [
      { id: "a", type: "TXT", name: "_dmarc.example.com", content: "v=DMARC1; p=none", ttl: 1 },
      { id: "b", type: "TXT", name: "_dmarc.example.com", content: "v=DMARC1; p=reject; rua=mailto:d@example.com", ttl: 1 },
    ],
  });
  await assert.rejects(
    () => setDmarcPolicy(client(mock), "example.com", "quarantine", { rua: "mailto:d@example.com" }),
    /2 DMARC records exist/,
  );
  assert.equal(mock.writeCalls().length, 0);
});
