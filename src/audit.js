// src/audit.js
// Append-only audit log. One JSON line per apply. NEVER contains the API token.

import { appendFileSync } from "node:fs";

const DEFAULT_AUDIT_PATH = "./cloudflare-ops-mcp-audit.log";

/**
 * Defensively strip anything that could be a secret from an audit entry.
 * Removes any key literally named 'token' (case-insensitive) and any
 * Authorization header, at any depth.
 * @param {*} value
 * @returns {*}
 */
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const lk = k.toLowerCase();
      if (lk === "token" || lk === "authorization" || lk === "api_token") {
        continue; // drop secret-bearing keys entirely
      }
      out[k] = scrub(v);
    }
    return out;
  }
  return value;
}

/**
 * Append a single audit entry as one JSON line.
 * The caller supplies `ts` (a timestamp) — pure logic does not call Date.now().
 *
 * @param {string|null} path defaults to ./cloudflare-ops-mcp-audit.log
 * @param {object} entry { ts, action, domain, record, before, after }
 * @returns {object} the (scrubbed) entry that was written
 */
export function appendAudit(path, entry) {
  const file = path || DEFAULT_AUDIT_PATH;
  const safe = scrub(entry || {});
  appendFileSync(file, JSON.stringify(safe) + "\n", "utf8");
  return safe;
}

export const AUDIT_DEFAULT_PATH = DEFAULT_AUDIT_PATH;
export default { appendAudit, AUDIT_DEFAULT_PATH };
