// test/dns.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudflareClient } from "../src/client.js";
import { applyDnsRecord, findRecord, deleteDnsRecord } from "../src/dns.js";
import { makeMock } from "./mock.js";

function client(mock) {
  return new CloudflareClient({ token: "test-token", fetch: mock.fetch });
}

test("upsert: create when record is absent (dry-run writes nothing)", async () => {
  const mock = makeMock({ domain: "example.com", dns: [] });
  const c = client(mock);
  const plan = await applyDnsRecord(
    c,
    "example.com",
    { type: "TXT", name: "_dmarc.example.com", content: '"v=DMARC1; p=none"' },
    { apply: false }
  );
  assert.equal(plan.action, "create");
  assert.equal(plan.before, null);
  assert.equal(mock.writeCalls().length, 0, "dry-run must not write");
});

test("upsert: create actually writes when apply:true", async () => {
  const mock = makeMock({ domain: "example.com", dns: [] });
  const c = client(mock);
  const plan = await applyDnsRecord(
    c,
    "example.com",
    { type: "TXT", name: "_dmarc.example.com", content: '"v=DMARC1; p=none"' },
    { apply: true }
  );
  assert.equal(plan.action, "create");
  assert.equal(mock.writeCalls().length, 1);
  assert.equal(mock.writeCalls()[0].method, "POST");
  assert.equal(mock.state.dns.length, 1);
});

test("upsert: update when content differs (uses PATCH)", async () => {
  const mock = makeMock({
    domain: "example.com",
    dns: [
      { id: "d1", type: "TXT", name: "_dmarc.example.com", content: '"v=DMARC1; p=none"', ttl: 1 },
    ],
  });
  const c = client(mock);
  const plan = await applyDnsRecord(
    c,
    "example.com",
    { type: "TXT", name: "_dmarc.example.com", content: '"v=DMARC1; p=quarantine"' },
    { apply: true }
  );
  assert.equal(plan.action, "update");
  assert.ok(plan.diff.fields.includes("content"));
  const writes = mock.writeCalls();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "PATCH");
  assert.equal(mock.state.dns[0].content, '"v=DMARC1; p=quarantine"');
});

test("upsert: no-op when identical (no write even with apply:true)", async () => {
  const mock = makeMock({
    domain: "example.com",
    dns: [
      { id: "d1", type: "TXT", name: "_dmarc.example.com", content: '"v=DMARC1; p=none"', ttl: 1, proxied: false },
    ],
  });
  const c = client(mock);
  const plan = await applyDnsRecord(
    c,
    "example.com",
    { type: "TXT", name: "_dmarc.example.com", content: '"v=DMARC1; p=none"', ttl: 1 },
    { apply: true }
  );
  assert.equal(plan.action, "noop");
  assert.equal(mock.writeCalls().length, 0, "identical record must not write");
});

test("findRecord matches type + name case-insensitively and ignores trailing dot", () => {
  const records = [
    { type: "txt", name: "_DMARC.Example.com.", content: "x" },
    { type: "A", name: "example.com", content: "1.2.3.4" },
  ];
  const found = findRecord(records, "TXT", "_dmarc.example.com");
  assert.ok(found);
  assert.equal(found.content, "x");
});

test("deleteDnsRecord refuses without confirm and never calls DELETE", async () => {
  const mock = makeMock({ domain: "example.com", dns: [{ id: "d1", type: "A", name: "example.com", content: "1.2.3.4" }] });
  const c = client(mock);
  const res = await deleteDnsRecord(c, "example.com", "d1", { confirm: false });
  assert.equal(res.action, "refused");
  assert.equal(mock.calls.filter((x) => x.method === "DELETE").length, 0);
});

test("deleteDnsRecord deletes with confirm:true", async () => {
  const mock = makeMock({ domain: "example.com", dns: [{ id: "d1", type: "A", name: "example.com", content: "1.2.3.4" }] });
  const c = client(mock);
  const res = await deleteDnsRecord(c, "example.com", "d1", { confirm: true, zoneId: "zone123" });
  assert.equal(res.action, "delete");
  assert.equal(mock.state.dns.length, 0);
});
