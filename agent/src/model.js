import { RESULT_SCHEMA, cleanText, validateResult } from "./contracts.js";
import { CAPABILITY_TREE, TEMPLATES } from "./templates.js";
import { wtCached } from "./wt-cache.js";

function sourceBundle(sources) {
  return sources.map((source, index) => [
    `SOURCE ${index + 1}: ${source.url}`,
    `METHOD: ${source.method || "unknown"}`,
    `TITLE: ${source.title || ""}`,
    `CONTENT:\n${source.text || `[unavailable: ${source.error || "unknown"}]`}`,
  ].join("\n")).join("\n\n");
}

export function parseModelJson(response) {
  const toolCalls = response?.tool_calls ?? response?.result?.tool_calls ?? response?.choices?.[0]?.message?.tool_calls;
  const selectedTool = Array.isArray(toolCalls)
    ? toolCalls.find((call) => (call?.name || call?.function?.name) === "submit_result") || toolCalls[0]
    : null;
  const toolArguments = selectedTool?.arguments ?? selectedTool?.function?.arguments;
  const message = response?.choices?.[0]?.message?.content;
  const messageText = Array.isArray(message) ? message.map((item) => item?.text || item?.content || "").join("") : message;
  const raw = toolArguments ?? response?.response ?? response?.result?.response ?? response?.result ?? messageText ?? response?.output_text ?? response;
  if (raw && typeof raw === "object") return raw;
  const body = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(body);
}

export function normalizeModelEvidence(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.claims)) return result;
  return {
    ...result,
    claims: result.claims.map((claim) => {
      if (!claim || typeof claim !== "object") return claim;
      if (claim.support === "unsupported" || (Array.isArray(claim.source_urls) && claim.source_urls.length)) return claim;
      return {
        ...claim,
        support: "unsupported",
        source_urls: [],
        note: [String(claim.note || "").trim(), "No supporting source URL was supplied by the model; downgraded by the harness."].filter(Boolean).join(" "),
      };
    }),
  };
}

function systemPrompt(mode) {
  return [
    `You are ${CAPABILITY_TREE.name}, harness ${CAPABILITY_TREE.version}.`,
    CAPABILITY_TREE.role,
    "You are a small bounded worker. Do not write a polished final article and do not invent facts.",
    "Every factual claim marked direct, partial, or contradicted must include the exact supporting source URL.",
    "Put unsupported points in gaps. Keep proposed_revisions empty unless a reusable instruction improvement is genuinely supported.",
    mode === "verify" ? "Act independently as a verifier. Find unsupported, incomplete, stale, or contradictory claims." : "Perform only the assigned template and return the required evidence packet.",
    "Call submit_result exactly once and satisfy its supplied schema.",
  ].join("\n");
}

export async function runModel(env, { packet, packetHash, memoryHash, memory, sources, mode = "primary", prior = null, cacheScope = "isolated", onModelCall = null }) {
  const template = TEMPLATES[packet.template_id];
  const prompt = [
    `PACKET HASH: ${packetHash}`,
    `CURRENT MEMORY HASH: ${memoryHash}`,
    `CURRENT PROJECT SNAPSHOT:\n${JSON.stringify(memory)}`,
    `TEMPLATE: ${template.title}`,
    `PURPOSE: ${template.purpose}`,
    `OBJECTIVE: ${packet.objective}`,
    packet.context ? `CONTEXT:\n${packet.context}` : "",
    prior ? `PRIOR RESULT TO VERIFY:\n${JSON.stringify(prior)}` : "",
    `SOURCES:\n${sourceBundle(sources)}`,
    "Acknowledge PACKET HASH exactly in acknowledgement.packet_hash.",
    "Treat CURRENT PROJECT SNAPSHOT as newer than contradictory background context.",
  ].filter(Boolean).join("\n\n");

  const profile = String(env.MODEL_PROFILE || "free").toLowerCase();
  const models = profile === "paid-k2"
    ? [env.PRIMARY_MODEL || "@cf/moonshotai/kimi-k2.6", env.FALLBACK_MODEL]
    : [
        mode === "verify" ? (env.FREE_VERIFIER_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast") : (env.FREE_PRIMARY_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast"),
        env.FALLBACK_MODEL,
        mode === "verify" ? (env.FREE_PRIMARY_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast") : (env.FREE_VERIFIER_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast"),
      ];
  let lastError;
  const ttlSec = Math.max(60, Math.min(Number(env.WT_CACHE_TTL || 86400), 604800));
  const system = systemPrompt(mode);
  let calls = 0;
  for (const model of [...new Set(models)]) {
    try {
      const maxTokens = profile === "paid-k2" ? (mode === "verify" ? 3500 : 5000) : (mode === "verify" ? 1800 : 2500);
      const thinking = mode === "verify" ? "medium" : "low";
      // Walrus Tooth: the exact model input is the cache key. A repeat of the
      // same (model, system, prompt, decoding params) returns the remembered
      // result for ZERO model calls. Only a schema-valid result is cached
      // (compute throws on invalid → nothing remembered). _wt tag: mem|joined|solo.
      const attempt = await wtCached(
        { scope: cacheScope, model, system, prompt, maxTokens, thinking, schema: "result.v1" },
        async () => {
          calls += 1;
          if (onModelCall) await onModelCall({ model, mode, call: calls });
          const response = await env.AI.run(model, {
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt },
            ],
            tools: [{
              name: "submit_result",
              description: "Submit the complete evidence-backed job result. Always call this tool exactly once.",
              parameters: RESULT_SCHEMA,
            }],
            tool_choice: "required",
            max_tokens: maxTokens,
            chat_template_kwargs: { thinking },
          });
          const result = normalizeModelEvidence(parseModelJson(response));
          const errors = validateResult(result, packetHash);
          if (errors.length) throw new Error(`schema validation failed: ${errors.join("; ")}`);
          return { model, profile, result };
        },
        { ttlSec, ok: (v) => !!(v && v.result) },
      );
      return { model: attempt.model, profile: attempt.profile, result: attempt.result, cache: attempt._wt, calls };
    } catch (error) {
      lastError = new Error(`${model}: ${cleanText(error?.message || error, 900)}`);
    }
  }
  throw lastError || new Error("No model is configured");
}
