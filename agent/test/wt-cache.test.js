import test from "node:test";
import assert from "node:assert/strict";
import { wtCached, wtKey } from "../src/wt-cache.js";

test("WT keys are stable and tenant-scoped", async () => {
  assert.equal(await wtKey({ scope: "tenant-a", prompt: "same" }), await wtKey({ scope: "tenant-a", prompt: "same" }));
  assert.notEqual(await wtKey({ scope: "tenant-a", prompt: "same" }), await wtKey({ scope: "tenant-b", prompt: "same" }));
});

test("WT cache remembers a valid duplicate without recomputing", async () => {
  const input = { scope: "test", nonce: crypto.randomUUID() };
  let calls = 0;
  const compute = async () => ({ ok: true, value: ++calls });
  const first = await wtCached(input, compute, { ok: (value) => value.ok });
  const second = await wtCached(input, compute, { ok: (value) => value.ok });
  assert.equal(first._wt, "solo");
  assert.equal(second._wt, "mem");
  assert.equal(second.value, 1);
  assert.equal(calls, 1);
});

test("WT cache does not remember rejected results", async () => {
  const input = { scope: "test", nonce: crypto.randomUUID() };
  let calls = 0;
  const compute = async () => ({ ok: false, value: ++calls });
  await wtCached(input, compute);
  await wtCached(input, compute);
  assert.equal(calls, 2);
});
