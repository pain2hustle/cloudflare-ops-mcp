// test/upsert-safety.test.js
// Locks in the two safety fixes:
//   1. An upsert must NOT clobber an unrelated record that shares a name
//      (apex SPF + a verification TXT), and must REFUSE when it can't tell which
//      of several same-kind records to update.
//   2. TXT content is compared unquoted, so an already-correct record is a
//      no-op (no phantom re-write) regardless of RFC1035 quoting.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudflareClient } from "../src/client.js";
import { applyDnsRecord } from "../src/dns.js";
import { makeMock } from "./mock.js";

function client(mock) {
  return new CloudflareClient({ token: "test-token", fetch: mock.fetch });
}

test("adding a verification TXT at the apex does NOT clobber an existing SPF", async () => {
  const mock = makeMock({
    dns: [
      { id: "spf1", type: "TXT", name: "example.com", content: "v=spf1 include:_spf.google.com ~all" },
      { id: "ver1", type: "TXT", name: "example.com", content: "google-site-verification=OLD" },
    ],
  });
  const plan = await applyDnsRecord(
    client(mock),
    "example.com",
    { type: "TXT", name: "example.com", content: "google-site-verification=NEW-token-xyz" },
    { apply: true }
  );
  // It's a brand-new opaque TXT → CREATE, not an update of SPF.
  assert.equal(plan.action, "create");
  // SPF record is still present and unchanged.
  const spf = mock.state.dns.find((r) => r.id === "spf1");
  assert.equal(spf.content, "v=spf1 include:_spf.google.com ~all");
  // No PATCH happened (only a POST create).
  assert.equal(mock.writeCalls().filter((c) => c.method === "PATCH").length, 0);
});

test("upsert REFUSES (ambiguous) when two same-kind records share the name — writes nothing", async () => {
  const mock = makeMock({
    dns: [
      { id: "spfA", type: "TXT", name: "example.com", content: "v=spf1 include:a ~all" },
      { id: "spfB", type: "TXT", name: "example.com", content: "v=spf1 include:b ~all" },
    ],
  });
  const plan = await applyDnsRecord(
    client(mock),
    "example.com",
    { type: "TXT", name: "example.com", content: "v=spf1 include:c ~all" },
    { apply: true }
  );
  assert.equal(plan.action, "ambiguous");
  assert.equal(plan.candidates.length, 2);
  assert.equal(mock.writeCalls().length, 0); // absolutely no write
});

test("explicit recordId resolves an ambiguous upsert to exactly that record", async () => {
  const mock = makeMock({
    dns: [
      { id: "spfA", type: "TXT", name: "example.com", content: "v=spf1 include:a ~all" },
      { id: "spfB", type: "TXT", name: "example.com", content: "v=spf1 include:b ~all" },
    ],
  });
  const plan = await applyDnsRecord(
    client(mock),
    "example.com",
    { type: "TXT", name: "example.com", content: "v=spf1 include:a include:c ~all" },
    { apply: true, recordId: "spfB" }
  );
  assert.equal(plan.action, "update");
  const patched = mock.state.dns.find((r) => r.id === "spfB");
  assert.match(patched.content, /include:c/);
  // The other SPF is untouched.
  assert.equal(mock.state.dns.find((r) => r.id === "spfA").content, "v=spf1 include:a ~all");
});

test("an already-correct TXT stored WITH quotes is a no-op vs a raw desired value", async () => {
  const mock = makeMock({
    dns: [
      { id: "d1", type: "TXT", name: "_dmarc.example.com", content: '"v=DMARC1; p=quarantine; rua=mailto:x@y.com"' },
    ],
  });
  const plan = await applyDnsRecord(
    client(mock),
    "example.com",
    { type: "TXT", name: "_dmarc.example.com", content: "v=DMARC1; p=quarantine; rua=mailto:x@y.com" },
    { apply: true }
  );
  assert.equal(plan.action, "noop");
  assert.equal(mock.writeCalls().length, 0); // no phantom re-write
});
