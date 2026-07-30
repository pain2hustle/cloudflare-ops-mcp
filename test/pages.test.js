// test/pages.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudflareClient } from "../src/client.js";
import { planPagesCutover } from "../src/pages.js";
import { makeMock } from "./mock.js";

function client(mock) {
  return new CloudflareClient({ token: "test-token", fetch: mock.fetch });
}

const messyDns = [
  { id: "a1", type: "A", name: "example.com", content: "13.223.25.84", proxied: true },
  { id: "a2", type: "AAAA", name: "example.com", content: "2600:1f18::1", proxied: true },
  { id: "w1", type: "CNAME", name: "www.example.com", content: "traff-https.hugedomains.com", proxied: true },
  { id: "w2", type: "NS", name: "www.example.com", content: "nsg1.namebrightdns.com" },
  { id: "wild", type: "A", name: "*.example.com", content: "54.243.117.197", proxied: true },
  { id: "spf", type: "TXT", name: "example.com", content: '"v=spf1 -all"' },
];

test("pages cutover dry-run deletes only apex/www conflicts and preserves TXT/wildcard", async () => {
  const mock = makeMock({ domain: "example.com", dns: messyDns });
  const plan = await planPagesCutover(client(mock), "example.com", {
    target: "demo-project.pages.dev",
    zoneId: "zone123",
  });

  assert.equal(plan.apply, false);
  assert.deepEqual(plan.delete.map((r) => r.id).sort(), ["a1", "a2", "w1", "w2"]);
  assert.equal(plan.upserts.length, 2);
  assert.deepEqual(plan.upserts.map((p) => p.action), ["create", "create"]);
  assert.equal(mock.writeCalls().length, 0, "dry-run must not write");
  assert.ok(plan.warnings.some((w) => w.includes("Wildcard")));
});

test("pages cutover apply deletes conflicts then creates proxied CNAMEs", async () => {
  const mock = makeMock({ domain: "example.com", dns: messyDns });
  const plan = await planPagesCutover(client(mock), "example.com", {
    target: "demo-project.pages.dev",
    zoneId: "zone123",
    apply: true,
  });

  assert.equal(plan.apply, true);
  assert.deepEqual(plan.deleted.map((r) => r.id).sort(), ["a1", "a2", "w1", "w2"]);
  const writes = mock.writeCalls();
  assert.equal(writes.filter((c) => c.method === "DELETE").length, 4);
  assert.equal(writes.filter((c) => c.method === "POST").length, 2);

  const cnames = mock.state.dns.filter((r) => r.type === "CNAME").sort((a, b) => a.name.localeCompare(b.name));
  assert.equal(cnames.length, 2);
  assert.equal(cnames[0].name, "example.com");
  assert.equal(cnames[0].content, "demo-project.pages.dev");
  assert.equal(cnames[0].proxied, true);
  assert.equal(cnames[1].name, "www.example.com");
  assert.equal(cnames[1].content, "demo-project.pages.dev");
  assert.ok(mock.state.dns.find((r) => r.id === "spf"), "TXT/SPF must survive");
  assert.ok(mock.state.dns.find((r) => r.id === "wild"), "wildcard must survive by default");
});

test("pages cutover can skip www", async () => {
  const mock = makeMock({ domain: "example.com", dns: messyDns });
  const plan = await planPagesCutover(client(mock), "example.com", {
    target: "demo-project.pages.dev",
    zoneId: "zone123",
    includeWww: false,
  });

  assert.deepEqual(plan.delete.map((r) => r.id).sort(), ["a1", "a2"]);
  assert.deepEqual(plan.upserts.map((p) => p.record.name), ["example.com"]);
});

test("pages cutover can explicitly include wildcard conflicts", async () => {
  const mock = makeMock({ domain: "example.com", dns: messyDns });
  const plan = await planPagesCutover(client(mock), "example.com", {
    target: "demo-project.pages.dev",
    zoneId: "zone123",
    includeWildcard: true,
  });

  assert.ok(plan.delete.some((r) => r.id === "wild"));
});

test("pages cutover no-ops when correct CNAMEs already exist", async () => {
  const mock = makeMock({
    domain: "example.com",
    dns: [
      { id: "c1", type: "CNAME", name: "example.com", content: "demo-project.pages.dev", proxied: true, ttl: 1 },
      { id: "c2", type: "CNAME", name: "www.example.com", content: "demo-project.pages.dev", proxied: true, ttl: 1 },
    ],
  });
  const plan = await planPagesCutover(client(mock), "example.com", {
    target: "demo-project.pages.dev",
    zoneId: "zone123",
    apply: true,
  });

  assert.equal(plan.delete.length, 0);
  assert.deepEqual(plan.upserts.map((p) => p.action), ["noop", "noop"]);
  assert.equal(mock.writeCalls().length, 0);
});
