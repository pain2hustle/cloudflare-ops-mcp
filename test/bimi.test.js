// test/bimi.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudflareClient } from "../src/client.js";
import { parseBimi, buildBimi, setupBimi } from "../src/bimi.js";
import { makeMock } from "./mock.js";

function client(mock) {
  return new CloudflareClient({ token: "test-token", fetch: mock.fetch });
}

// A stub fetch for SVG validation so no real network is hit.
async function svgFetch() {
  return {
    status: 200,
    headers: { get: () => "image/svg+xml" },
    async text() {
      return '<svg version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100"><title>Brand</title></svg>';
    },
  };
}

test("buildBimi / parseBimi round-trip", () => {
  const s = buildBimi({ logo: "https://x.com/logo.svg", vmc: "https://x.com/vmc.pem" });
  assert.equal(s, "v=BIMI1; l=https://x.com/logo.svg; a=https://x.com/vmc.pem");
  const p = parseBimi(s);
  assert.equal(p.valid, true);
  assert.equal(p.tags.l, "https://x.com/logo.svg");
  assert.equal(p.tags.a, "https://x.com/vmc.pem");
});

const NONE_DMARC = {
  id: "d1",
  type: "TXT",
  name: "_dmarc.example.com",
  content: '"v=DMARC1; p=none; rua=mailto:x@y.com"',
  ttl: 1,
};
const ENFORCING_DMARC = {
  id: "d1",
  type: "TXT",
  name: "_dmarc.example.com",
  content: '"v=DMARC1; p=quarantine; rua=mailto:x@y.com"',
  ttl: 1,
};

test("setupBimi REFUSES to write when DMARC=none in apply mode", async () => {
  const mock = makeMock({ domain: "example.com", dns: [NONE_DMARC] });
  const c = client(mock);
  const plan = await setupBimi(
    c,
    "example.com",
    { logo: "https://example.com/logo.svg" },
    { apply: true, fetch: svgFetch }
  );
  assert.equal(plan.blocked, true);
  assert.match(plan.error, /DMARC/);
  assert.equal(mock.writeCalls().length, 0, "must not write when blocked");
});

test("setupBimi allows a dry-run plan when DMARC=none (warns, no write)", async () => {
  const mock = makeMock({ domain: "example.com", dns: [NONE_DMARC] });
  const c = client(mock);
  const plan = await setupBimi(
    c,
    "example.com",
    { logo: "https://example.com/logo.svg" },
    { apply: false, fetch: svgFetch }
  );
  assert.notEqual(plan.blocked, true);
  assert.equal(plan.action, "create");
  assert.equal(plan.dmarcOk, false);
  assert.ok(plan.warnings.some((w) => /DMARC/.test(w)));
  assert.equal(mock.writeCalls().length, 0);
});

test("setupBimi with force:true writes even when DMARC=none", async () => {
  const mock = makeMock({ domain: "example.com", dns: [NONE_DMARC] });
  const c = client(mock);
  const plan = await setupBimi(
    c,
    "example.com",
    { logo: "https://example.com/logo.svg" },
    { apply: true, force: true, fetch: svgFetch }
  );
  assert.notEqual(plan.blocked, true);
  assert.equal(plan.forced, true);
  assert.equal(mock.writeCalls().length, 1);
  assert.equal(mock.writeCalls()[0].method, "POST");
});

test("setupBimi writes normally when DMARC is enforcing", async () => {
  const mock = makeMock({ domain: "example.com", dns: [ENFORCING_DMARC] });
  const c = client(mock);
  const plan = await setupBimi(
    c,
    "example.com",
    { logo: "https://example.com/logo.svg", vmc: "https://example.com/vmc.pem" },
    { apply: true, fetch: svgFetch }
  );
  assert.equal(plan.dmarcOk, true);
  assert.equal(mock.writeCalls().length, 1);
  const written = mock.state.dns.find((r) => r.name === "default._bimi.example.com");
  assert.ok(written);
  assert.match(written.content, /v=BIMI1/);
});
