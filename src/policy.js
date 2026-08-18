// src/policy.js
// Per-tool policy gate: allow | approve | block, stored in KV (policy:*). Checked
// before ANY tool runs (native + federated). cfops writes are already dry-run by
// default; this adds a coarse governance layer across the whole federated catalog.
//   allow   → runs normally (default for any tool without an explicit policy)
//   approve → refused unless the caller passes "_approved": true (a human/agent gate)
//   block   → always refused

const IDX_KEY = "policy:index";
const key = (tool) => `policy:${tool}`;
const VALID = new Set(["allow", "approve", "block"]);

export async function setPolicy(env, tool, mode) {
  const t = String(tool || "").trim();
  const m = String(mode || "").trim().toLowerCase();
  if (!t) return { error: true, message: "tool required" };
  if (!VALID.has(m)) return { error: true, message: "mode must be allow | approve | block" };
  await env.CLOUDFLARE_OPS_OAUTH.put(key(t), m);
  let idx = [];
  try { idx = JSON.parse((await env.CLOUDFLARE_OPS_OAUTH.get(IDX_KEY)) || "[]"); } catch {}
  idx.push(t);
  await env.CLOUDFLARE_OPS_OAUTH.put(IDX_KEY, JSON.stringify([...new Set(idx)]));
  return { ok: true, tool: t, mode: m };
}

export async function listPolicy(env) {
  let idx = [];
  try { idx = JSON.parse((await env.CLOUDFLARE_OPS_OAUTH.get(IDX_KEY)) || "[]"); } catch {}
  const out = {};
  for (const t of idx) {
    const m = await env.CLOUDFLARE_OPS_OAUTH.get(key(t));
    if (m) out[t] = m;
  }
  return out;
}

// Returns { allowed, mode, reason }. Default mode = allow.
export async function checkPolicy(env, tool, args) {
  let mode = "allow";
  try { mode = (await env.CLOUDFLARE_OPS_OAUTH.get(key(tool))) || "allow"; } catch {}
  if (mode === "block") return { allowed: false, mode, reason: `Tool "${tool}" is BLOCKED by policy.` };
  if (mode === "approve" && !(args && args._approved === true)) {
    return { allowed: false, mode, reason: `Tool "${tool}" requires approval — re-call with "_approved": true to proceed.` };
  }
  return { allowed: true, mode };
}
