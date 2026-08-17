import test from "node:test";
import assert from "node:assert/strict";
import { issueSession, verifySession } from "../src/crypto.js";

const secret = "a-strong-test-secret-that-is-long-enough";

test("signed sessions verify and expose no secret", async () => {
  const issued = await issueSession(secret, "actor-one", 600);
  const session = await verifySession(secret, issued.token);
  assert.equal(session.actor, "actor-one");
  assert.equal(session.csrf, issued.csrf);
  assert.equal(issued.token.includes(secret), false);
});

test("tampered sessions fail closed", async () => {
  const issued = await issueSession(secret, "actor-one", 600);
  const tampered = issued.token.slice(0, -1) + (issued.token.endsWith("a") ? "b" : "a");
  assert.equal(await verifySession(secret, tampered), null);
  assert.equal(await verifySession("another-strong-secret-that-is-long", issued.token), null);
});

test("weak signing secrets are rejected", async () => {
  await assert.rejects(() => issueSession("weak", "actor", 600), /must be configured/);
});
