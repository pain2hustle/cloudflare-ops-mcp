import test from "node:test";
import assert from "node:assert/strict";
import { normalizeModelEvidence, parseModelJson, runModel } from "../src/model.js";
import { RESULT_SCHEMA } from "../src/contracts.js";

const result = { acknowledgement: { packet_hash: "abc", understood_task: "test" }, summary: "ok", claims: [], gaps: [], contradictions: [], confidence: 1, proposed_revisions: [] };

test("model parser unwraps Workers AI JSON mode responses", () => {
  assert.deepEqual(parseModelJson({ response: result }), result);
});

test("model parser unwraps OpenAI-compatible Workers AI choices", () => {
  assert.deepEqual(parseModelJson({ choices: [{ message: { content: JSON.stringify(result) } }] }), result);
});

test("model parser unwraps REST-style result envelopes", () => {
  assert.deepEqual(parseModelJson({ result: { response: JSON.stringify(result) }, success: true }), result);
});

test("model parser unwraps Workers AI tool-call arguments", () => {
  assert.deepEqual(parseModelJson({ tool_calls: [{ name: "submit_result", arguments: result }] }), result);
});

test("model parser unwraps OpenAI-compatible string tool arguments", () => {
  assert.deepEqual(parseModelJson({ choices: [{ message: { tool_calls: [{ function: { name: "submit_result", arguments: JSON.stringify(result) } }] } }] }), result);
});

test("uncited supported claims are downgraded instead of receiving invented citations", () => {
  const normalized = normalizeModelEvidence({ ...result, claims: [{ claim: "uncited", source_urls: [], support: "direct", note: "" }] });
  assert.equal(normalized.claims[0].support, "unsupported");
  assert.deepEqual(normalized.claims[0].source_urls, []);
  assert.match(normalized.claims[0].note, /downgraded/i);
});

test("model requests a required schema tool instead of JSON mode", async () => {
  let request;
  const env = {
    MODEL_PROFILE: "free",
    FREE_PRIMARY_MODEL: "primary",
    FREE_VERIFIER_MODEL: "verifier",
    FALLBACK_MODEL: "fallback",
    AI: {
      async run(_model, input) {
        request = input;
        return {
          tool_calls: [{
            name: "submit_result",
            arguments: { ...result, acknowledgement: { ...result.acknowledgement, packet_hash: "packet" } },
          }],
        };
      },
    },
  };
  await runModel(env, {
    packet: { template_id: "web_research", objective: "Test required result tool", skill_ids: [], limits: {} },
    packetHash: "packet",
    memoryHash: "memory",
    memory: {},
    sources: [],
  });
  assert.equal(request.tool_choice, "required");
  assert.equal(request.tools[0].name, "submit_result");
  assert.deepEqual(request.tools[0].parameters, RESULT_SCHEMA);
  assert.equal("response_format" in request, false);
});

test("malformed primary output falls back to a distinct model", async () => {
  const invoked = [];
  const packetHash = "fallback-packet";
  const env = {
    MODEL_PROFILE: "free",
    FREE_PRIMARY_MODEL: "primary",
    FREE_VERIFIER_MODEL: "verifier",
    FALLBACK_MODEL: "primary",
    AI: {
      async run(model) {
        invoked.push(model);
        if (model === "primary") return { response: '{"summary":"unterminated' };
        return {
          tool_calls: [{
            name: "submit_result",
            arguments: { ...result, acknowledgement: { ...result.acknowledgement, packet_hash: packetHash } },
          }],
        };
      },
    },
  };
  const output = await runModel(env, {
    packet: { template_id: "web_research", objective: `Fallback test ${crypto.randomUUID()}`, skill_ids: [], limits: {} },
    packetHash,
    memoryHash: "memory",
    memory: {},
    sources: [],
  });
  assert.deepEqual(invoked, ["primary", "verifier"]);
  assert.equal(output.model, "verifier");
  assert.equal(output.calls, 2);
});
