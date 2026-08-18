import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHealthSource } from "../src/health.js";

test("site health accepts an explicit 2xx even when the valid page is small", () => {
  assert.deepEqual(evaluateHealthSource({ ok: false, status: 204, text: "" }), {
    healthy: true,
    status: 204,
    textMatch: true,
    detail: "HTTP reachable",
  });
});

test("site health requires the optional expected marker", () => {
  assert.equal(evaluateHealthSource({ ok: true, status: 200, text: "wrong site" }, "release-42").healthy, false);
  assert.equal(evaluateHealthSource({ ok: false, status: 200, text: "release-42" }, "release-42").healthy, true);
});

test("site health rejects redirects and non-2xx responses", () => {
  assert.equal(evaluateHealthSource({ ok: true, status: 302, text: "release-42" }, "release-42").healthy, false);
  assert.equal(evaluateHealthSource({ ok: true, status: 503, text: "release-42" }, "release-42").healthy, false);
});
