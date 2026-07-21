// test/client.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudflareClient, CloudflareError, redactToken } from "../src/client.js";

const SECRET = "cf_supersecret_token_abcdefghijklmnop1234567890";

test("token never appears in a thrown error message (envelope error)", async () => {
  // A fetch that returns a CF error envelope AND echoes the auth header (as a
  // buggy library might). The client must scrub the token from what it throws.
  const fetchImpl = async (_url, init) => ({
    status: 403,
    async text() {
      return JSON.stringify({
        success: false,
        errors: [
          {
            code: 9109,
            message: `Unauthorized. Sent header ${init.headers.Authorization}`,
          },
        ],
        messages: [],
        result: null,
      });
    },
  });
  const c = new CloudflareClient({ token: SECRET, fetch: fetchImpl });
  await assert.rejects(
    () => c.request("GET", "/zones"),
    (err) => {
      assert.ok(err instanceof CloudflareError);
      assert.equal(err.code, 9109);
      assert.ok(!err.message.includes(SECRET), "token must not be in message");
      assert.ok(!JSON.stringify(err.errors).includes(SECRET), "token must not be in errors[]");
      return true;
    }
  );
});

test("token never appears in a thrown error message (network error)", async () => {
  const fetchImpl = async () => {
    throw new Error(`connect failed using ${SECRET}`);
  };
  const c = new CloudflareClient({ token: SECRET, fetch: fetchImpl });
  await assert.rejects(
    () => c.request("GET", "/zones"),
    (err) => {
      assert.ok(!err.message.includes(SECRET));
      return true;
    }
  );
});

test("redactToken scrubs the known token and long token-like strings", () => {
  assert.ok(!redactToken(`x ${SECRET} y`, SECRET).includes(SECRET));
  assert.ok(!redactToken(`Bearer ${SECRET}`).includes(SECRET));
  // Long token-like run scrubbed even without a known value.
  assert.match(redactToken("abcdefghijklmnopqrstuvwxyz0123456789"), /REDACTED/);
});

test("envelope error parsing surfaces CF code + message", async () => {
  const fetchImpl = async () => ({
    status: 400,
    async text() {
      return JSON.stringify({
        success: false,
        errors: [{ code: 81044, message: "Record already exists." }],
        messages: [],
        result: null,
      });
    },
  });
  const c = new CloudflareClient({ token: "faketoken123456", fetch: fetchImpl });
  await assert.rejects(
    () => c.request("POST", "/zones/z/dns_records", { type: "A" }),
    (err) => {
      assert.equal(err.code, 81044);
      assert.match(err.message, /Record already exists/);
      assert.match(err.message, /code 81044/);
      return true;
    }
  );
});

test("successful envelope returns result + result_info", async () => {
  const fetchImpl = async () => ({
    status: 200,
    async text() {
      return JSON.stringify({
        success: true,
        errors: [],
        messages: [],
        result: [{ id: "z1" }],
        result_info: { page: 1, total_pages: 1 },
      });
    },
  });
  const c = new CloudflareClient({ token: "faketoken123456", fetch: fetchImpl });
  const { result, result_info } = await c.request("GET", "/zones");
  assert.equal(result[0].id, "z1");
  assert.equal(result_info.total_pages, 1);
});

test("verifyToken returns the token status", async () => {
  const fetchImpl = async () => ({
    status: 200,
    async text() {
      return JSON.stringify({ success: true, errors: [], messages: [], result: { status: "active" } });
    },
  });
  const c = new CloudflareClient({ token: "faketoken123456", fetch: fetchImpl });
  const status = await c.verifyToken();
  assert.equal(status.status, "active");
});

test("missing token throws before any fetch", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { status: 200, async text() { return "{}"; } };
  };
  const c = new CloudflareClient({ token: "", fetch: fetchImpl });
  await assert.rejects(() => c.request("GET", "/zones"), /Missing Cloudflare API token/);
  assert.equal(called, false);
});
