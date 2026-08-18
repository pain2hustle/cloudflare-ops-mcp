import test from "node:test";
import assert from "node:assert/strict";
import { verifyLive } from "../scripts/verify-live.mjs";

test("live gate accepts only a 2xx response with the expected public marker", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response('{"version":"0.4.0"}', { status: 200 });
  const receipt = await verifyLive({ url: "https://example.com/health", expect: "0.4.0", attempts: 1, intervalMs: 0 });
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.marker_ok, true);
  assert.match(receipt.body_sha256, /^[a-f0-9]{64}$/);
});

test("live gate fails closed on a 404 or wrong page marker", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response("old page", { status: 404 });
  await assert.rejects(
    () => verifyLive({ url: "https://example.com/", expect: "new page", attempts: 1, intervalMs: 0 }),
    (error) => error.receipt?.accepted === false && error.receipt?.last?.status === 404,
  );
});

test("live gate refuses plaintext URLs", async () => {
  await assert.rejects(() => verifyLive({ url: "http://example.com/" }), /must use HTTPS/);
});
