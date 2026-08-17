import { RESULT_SCHEMA, cleanText, validateResult } from "./contracts.js";
import { CAPABILITY_TREE, TEMPLATES } from "./templates.js";

function sourceBundle(sources) {
  return sources.map((source, index) => [
    `SOURCE ${index + 1}: ${source.url}`,
    `METHOD: ${source.method || "unknown"}`,
    `TITLE: ${source.title || ""}`,
    `CONTENT:\n${source.text || `[unavailable: ${source.error || "unknown"}]`}`,
  ].join("\n")).join("\n\n");
}

function parseModelJson(response) {
  const raw = response?.response ?? response?.result ?? response;
  if (raw && typeof raw === "object") return raw;
  const body = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(body);
}

function systemPrompt(mode) {
  return [
    `You are ${CAPABILITY_TREE.name}, harness ${CAPABILITY_TREE.version}.`,
    CAPABILITY_TREE.role,
    "You are a small bounded worker. Do not write a polished final article and do not invent facts.",
    "Every factual claim marked direct, partial, or contradicted must include the exact supporting source URL.",
    "Put unsupported points in gaps. Keep proposed_revisions empty unless a reusable instruction improvement is genuinely supported.",
    mode === "verify" ? "Act independently as a verifier. Find unsupported, incomplete, stale, or contradictory claims." : "Perform only the assigned template and return the required evidence packet.",
    "Return JSON only and satisfy the supplied schema.",
  ].join("\n");
}

export async function runModel(env, { packet, packetHash, memoryHash, memory, sources, mode = "primary", prior = null }) {
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
    : [mode === "verify" ? (env.FREE_VERIFIER_MODEL || "@cf/google/gemma-4-26b-a4b-it") : (env.FREE_PRIMARY_MODEL || "@cf/zai-org/glm-4.7-flash"), env.FALLBACK_MODEL];
  let lastError;
  for (const model of [...new Set(models)]) {
    try {
      const response = await env.AI.run(model, {
        messages: [
          { role: "system", content: systemPrompt(mode) },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_schema", json_schema: RESULT_SCHEMA },
        max_tokens: profile === "paid-k2" ? (mode === "verify" ? 3500 : 5000) : (mode === "verify" ? 1800 : 2500),
        chat_template_kwargs: { thinking: mode === "verify" ? "medium" : "low" },
      });
      const result = parseModelJson(response);
      const errors = validateResult(result, packetHash);
      if (errors.length) throw new Error(`schema validation failed: ${errors.join("; ")}`);
      return { model, profile, result };
    } catch (error) {
      lastError = new Error(`${model}: ${cleanText(error?.message || error, 900)}`);
    }
  }
  throw lastError || new Error("No model is configured");
}
