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
  await setDmarcPolicy(client(mock), "example.com", "quarantine", {});
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
