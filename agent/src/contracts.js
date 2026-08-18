import { HARNESS_VERSION, TEMPLATES } from "./templates.js";
import { skillsForTemplate } from "./skill-catalog.js";

export const RESULT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    acknowledgement: {
      type: "object",
      properties: {
        packet_hash: { type: "string" },
        understood_task: { type: "string" },
      },
      required: ["packet_hash", "understood_task"],
    },
    summary: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          source_urls: { type: "array", items: { type: "string" } },
          support: { type: "string", enum: ["direct", "partial", "contradicted", "unsupported"] },
          note: { type: "string" },
        },
        required: ["claim", "source_urls", "support", "note"],
      },
    },
    gaps: { type: "array", items: { type: "string" } },
    contradictions: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    proposed_revisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          target_template: { type: "string" },
          target_skill: { type: "string" },
          current_instruction: { type: "string" },
          proposed_instruction: { type: "string" },
          rationale: { type: "string" },
          evidence_urls: { type: "array", items: { type: "string" } },
          tests: { type: "array", items: { type: "string" } },
        },
        required: ["title", "target_template", "current_instruction", "proposed_instruction", "rationale", "evidence_urls", "tests"],
      },
    },
  },
  required: ["acknowledgement", "summary", "claims", "gaps", "contradictions", "confidence", "proposed_revisions"],
});

export function cleanText(value, max = 4000) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, max);
}

export function normalizeHost(value) {
  return cleanText(value, 253).toLowerCase().replace(/^\.+|\.+$/g, "");
}

export function isPrivateHost(host) {
  const h = normalizeHost(host);
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local") ||
    /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^0\./.test(h);
}

export function validateUrl(raw, allowedDomains) {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`Invalid URL: ${cleanText(raw, 180)}`); }
  if (url.protocol !== "https:") throw new Error(`Only HTTPS URLs are allowed: ${url.href}`);
  if (url.username || url.password || url.port) throw new Error(`Credentials and custom ports are not allowed: ${url.href}`);
  if (isPrivateHost(url.hostname)) throw new Error(`Private or local hosts are blocked: ${url.hostname}`);
  const allow = allowedDomains.map(normalizeHost).filter(Boolean);
  const ok = allow.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  if (!ok) throw new Error(`URL host is outside the allowlist: ${url.hostname}`);
  url.hash = "";
  return url.href;
}

export function normalizePacket(input, env = {}) {
  const templateId = cleanText(input?.template_id, 60) || "web_research";
  const template = TEMPLATES[templateId];
  if (!template) throw new Error(`Unknown template: ${templateId}`);
  const objective = cleanText(input?.objective, 3000);
  if (!objective) throw new Error("objective is required");
  const allowedDomains = [...new Set((input?.allowed_domains || []).map(normalizeHost).filter(Boolean))].slice(0, 12);
  const maxUrls = Math.max(1, Math.min(Number(env.MAX_URLS || 8), 20));
  const urls = [...new Set((input?.urls || []).map((url) => validateUrl(url, allowedDomains)))].slice(0, maxUrls);
  if (template.requiresUrls && urls.length === 0) throw new Error(`${template.title} requires at least one allowlisted URL`);
  return {
    schema_version: "amh.wt.job.v1",
    harness_version: HARNESS_VERSION,
    template_id: templateId,
    agent_name: cleanText(input?.agent_name, 80) || template.title,
    template_title: template.title,
    skill_ids: skillsForTemplate(templateId),
    expected_text: cleanText(input?.expected_text, 200),
    objective,
    allowed_domains: allowedDomains,
    urls,
    context: cleanText(input?.context, 12000),
    limits: {
      max_urls: maxUrls,
      max_source_chars: Math.max(2000, Math.min(Number(input?.limits?.max_source_chars || env.MAX_SOURCE_CHARS || 12000), 30000)),
      max_auto_followups: Math.max(0, Math.min(Number(input?.limits?.max_auto_followups ?? env.MAX_AUTO_FOLLOWUPS ?? 1), 1)),
    },
    schedule: normalizeSchedule(input?.schedule),
    created_at: new Date().toISOString(),
  };
}

export function normalizeSchedule(schedule) {
  if (!schedule?.enabled) return { enabled: false, every_minutes: null };
  const every = Math.max(5, Math.min(Number(schedule.every_minutes || 60), 10080));
  return { enabled: true, every_minutes: every };
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function validateResult(result, packetHash) {
  const errors = [];
  if (!result || typeof result !== "object") return ["result must be an object"];
  if (result.acknowledgement?.packet_hash !== packetHash) errors.push("packet acknowledgement hash does not match");
  if (!cleanText(result.acknowledgement?.understood_task, 1000)) errors.push("understood_task is required");
  if (!cleanText(result.summary, 6000)) errors.push("summary is required");
  if (!Array.isArray(result.claims)) errors.push("claims must be an array");
  if (!Array.isArray(result.gaps)) errors.push("gaps must be an array");
  if (!Array.isArray(result.contradictions)) errors.push("contradictions must be an array");
  if (!Array.isArray(result.proposed_revisions)) errors.push("proposed_revisions must be an array");
  if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) errors.push("confidence must be between 0 and 1");
  for (const [index, claim] of (result.claims || []).entries()) {
    if (!cleanText(claim?.claim, 3000)) errors.push(`claims[${index}].claim is required`);
    if (!Array.isArray(claim?.source_urls)) errors.push(`claims[${index}].source_urls must be an array`);
    if (!["direct", "partial", "contradicted", "unsupported"].includes(claim?.support)) errors.push(`claims[${index}].support is invalid`);
    if (["direct", "partial", "contradicted"].includes(claim?.support) && !(claim.source_urls || []).length) errors.push(`claims[${index}] needs a source URL`);
  }
  return errors;
}
