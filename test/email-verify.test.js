// test/email-verify.test.js
// Locks Codex's requirement: setupEmailRouting must not create a live rule to an
// UNVERIFIED destination (Cloudflare keeps it disabled anyway) — it refuses
// unless forced, and always surfaces a warning.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudflareClient } from "../src/client.js";
import { setupEmailRouting } from "../src/email.js";
import { makeMock } from "./mock.js";

const client = (m) => new CloudflareClient({ token: "t", fetch: m.fetch });
const ruleWrites = (m) =>
  m.writeCalls().filter((c) => c.method === "POST" && /email\/routing\/rules/.test(c.path)).length;

test("apply REFUSES to create a rule to an unverified destination (no write)", async () => {
  const mock = makeMock({ addresses: [{ id: "a1", email: "you@gmail.com", verified: null }] });
  const res = await setupEmailRouting(
    client(mock),
    "example.com",
    { forwards: [{ address: "hello@example.com", to: "you@gmail.com" }] },
    { apply: true }
  );
  assert.equal(res.plan[0].destinationVerified, false);
  assert.equal(res.plan[0].action, "blocked-unverified");
  assert.ok(res.warnings.length >= 1);
  assert.equal(ruleWrites(mock), 0); // nothing written
});

test("apply CREATES the rule when the destination is verified", async () => {
  const mock = makeMock({ addresses: [{ id: "a1", email: "you@gmail.com", verified: "2026-01-01T00:00:00Z" }] });
  const res = await setupEmailRouting(
    client(mock),
    "example.com",
    { forwards: [{ address: "hello@example.com", to: "you@gmail.com" }] },
    { apply: true }
  );
  assert.equal(res.plan[0].destinationVerified, true);
  assert.equal(res.plan[0].action, "create");
  assert.equal(ruleWrites(mock), 1);
});

test("force overrides the unverified block", async () => {
  const mock = makeMock({ addresses: [{ id: "a1", email: "you@gmail.com", verified: null }] });
  const res = await setupEmailRouting(
    client(mock),
    "example.com",
    { forwards: [{ address: "hello@example.com", to: "you@gmail.com" }] },
    { apply: true, force: true }
  );
  assert.equal(res.plan[0].action, "create");
  assert.equal(ruleWrites(mock), 1);
});
