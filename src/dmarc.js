// src/dmarc.js
// DMARC + SPF parsing/building and a safe p=none -> p=quarantine/reject flip.
//
// Safety:
//  - setDmarcPolicy is DRY-RUN unless { apply: true }.
//  - It only changes the `p` tag (and adds rua/pct if supplied); it preserves
//    every other tag already present on the record.

import { resolveZoneId } from "./zone.js";
import { applyDnsRecord, listRecords, findRecord, findRecords, txtKind } from "./dns.js";

/**
 * Strip the surrounding RFC1035 quotes Cloudflare stores TXT values with, and
 * join multi-string chunks. Returns a plain tag-string.
 * @param {string} raw
 * @returns {string}
 */
export function unquoteTxt(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  // Multiple quoted chunks: "a" "b" -> ab
  const chunks = s.match(/"((?:[^"\\]|\\.)*)"/g);
  if (chunks && chunks.length) {
    return chunks
      .map((c) => c.slice(1, -1).replace(/\\"/g, '"'))
      .join("");
  }
  return s.replace(/^"|"$/g, "");
}

/**
 * Wrap a value in a single RFC1035 quoted character-string (the quotes are part
 * of the stored content). Values >255 bytes are split into multiple quoted
 * strings.
 * @param {string} value
 * @returns {string}
 */
export function quoteTxt(value) {
  const v = String(value);
  if (v.length <= 255) return `"${v}"`;
  const parts = [];
  for (let i = 0; i < v.length; i += 255) parts.push(v.slice(i, i + 255));
  return parts.map((p) => `"${p}"`).join(" ");
}

/**
 * Parse a DMARC TXT value into an ordered tag map.
 * @param {string} txt raw or unquoted TXT value
 * @returns {{valid:boolean, tags:Object, order:string[], raw:string}}
 */
export function parseDmarc(txt) {
  const raw = unquoteTxt(txt);
  const tags = {};
  const order = [];
  for (const part of raw.split(";")) {
    const seg = part.trim();
    if (!seg) continue;
    const eq = seg.indexOf("=");
    if (eq === -1) continue;
    const key = seg.slice(0, eq).trim().toLowerCase();
    const val = seg.slice(eq + 1).trim();
    if (!(key in tags)) order.push(key);
    tags[key] = val;
  }
  const valid = (tags.v || "").toUpperCase() === "DMARC1";
  return { valid, tags, order, raw };
}

/**
 * Build a DMARC TXT string from a tag map. Ensures v=DMARC1 comes first.
 * @param {Object} tags
 * @param {string[]} [order] preferred tag order
 * @returns {string}
 */
export function buildDmarc(tags, order) {
  const merged = { v: "DMARC1", ...tags };
  const keys = [];
  keys.push("v");
  const rest = order && order.length ? order : Object.keys(merged);
  for (const k of rest) {
    if (k === "v") continue;
    if (merged[k] === undefined || merged[k] === null) continue;
    if (!keys.includes(k)) keys.push(k);
  }
  // Include any tags not covered by order.
  for (const k of Object.keys(merged)) {
    if (merged[k] === undefined || merged[k] === null) continue;
    if (!keys.includes(k)) keys.push(k);
  }
  return keys.map((k) => `${k}=${merged[k]}`).join("; ");
}

/**
 * Parse an SPF TXT value.
 * @param {string} txt
 * @returns {{valid:boolean, mechanisms:string[], all:string|null,
 *            lookupCount:number, raw:string}}
 */
export function parseSpf(txt) {
  const raw = unquoteTxt(txt);
  const valid = /^v=spf1\b/i.test(raw.trim());
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const mechanisms = tokens.slice(1); // drop v=spf1
  // Count DNS-lookup mechanisms (include/a/mx/ptr/exists/redirect).
  let lookupCount = 0;
  let all = null;
  for (const t of mechanisms) {
    const bare = t.replace(/^[+\-~?]/, "");
    const mech = bare.split(":")[0].split("=")[0].toLowerCase();
    if (["include", "a", "mx", "ptr", "exists", "redirect"].includes(mech)) {
      lookupCount += 1;
    }
    if (mech === "all") all = t;
  }
  return { valid, mechanisms, all, lookupCount, raw };
}

/**
 * Read the current _dmarc TXT record for a domain.
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @param {object} [opts]
 * @returns {Promise<{record:object|null, parsed:object|null, name:string}>}
 */
export async function getDmarc(client, domain, opts = {}) {
  const zone_id = opts.zoneId || (await resolveZoneId(client, domain));
  const name = `_dmarc.${domain}`;
  const records = opts.records || (await listRecords(client, domain, { zoneId: zone_id }));
  // 2026-08-21 FIX: this used to take findRecord(...) — the FIRST TXT at _dmarc.
  // Verification tokens (dmarcian-verification=, google-site-verification=, ...)
  // routinely sit alongside the real record, and if one of them is listed first
  // we read it as "no DMARC", report policy_before: null, and then write a
  // minimal v=DMARC1; p=<new> over the REAL record — silently downgrading a
  // p=reject domain and deleting its rua/ruf/sp/adkim/aspf. The write path
  // (dns.js selectUpsertTarget) already matches on txtKind; the read path did not.
  const dmarcRecords = findRecords(records, "TXT", name).filter((r) => txtKind(r.content) === "dmarc");
  // Two DMARC records at _dmarc is invalid per RFC 7489 (receivers ignore both).
  // Refuse rather than guess which one to overwrite.
  if (dmarcRecords.length > 1) {
    throw new Error(
      `Refusing to act: ${dmarcRecords.length} DMARC records exist at ${name}. ` +
      `RFC 7489 requires exactly one — receivers ignore DMARC entirely when there are several. ` +
      `Delete the extras in the Cloudflare dashboard first.`
    );
  }
  const record = dmarcRecords[0] || null;
  const parsed = record ? parseDmarc(record.content) : null;
  return { record, parsed, name, zone_id, records };
}

/**
 * Change ONLY the DMARC policy (p) tag (optionally adding rua/pct), preserving
 * every other tag. DRY-RUN unless { apply: true }. Upserts the _dmarc TXT record.
 *
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @param {'none'|'quarantine'|'reject'} policy
 * @param {object} [extra] { rua, ruf, pct, fo, sp }
 * @param {object} [opts] { apply, zoneId, records }
 * @returns {Promise<object>} the applyDnsRecord plan, plus {policyBefore, policyAfter}
 */
export async function setDmarcPolicy(client, domain, policy, extra = {}, opts = {}) {
  const valid = new Set(["none", "quarantine", "reject"]);
  if (!valid.has(policy)) {
    throw new Error(
      `Invalid DMARC policy '${policy}'. Use 'none', 'quarantine', or 'reject'.`
    );
  }
  const { record, parsed, name, zone_id, records } = await getDmarc(client, domain, opts);

  // Start from existing tags (or a minimal record) and change only p / extras.
  const baseTags = parsed && parsed.valid ? { ...parsed.tags } : { v: "DMARC1" };
  const order = parsed && parsed.valid && parsed.order.length ? [...parsed.order] : ["v", "p"];
  const policyBefore = baseTags.p || null;


  // ── GUARDRAILS (2026-08-21) ────────────────────────────────────────────────
  // Two ways this tool could break a domain's real mail, both previously
  // ungated. setupBimi has had a hard DMARC precondition since day one; the
  // DMARC writer itself had none.
  const RANK = { none: 0, quarantine: 1, reject: 2 };
  const force = extra.force === true || opts.force === true;

  // (a) NEVER WEAKEN SILENTLY. Going reject -> none/quarantine turns off
  // protection that someone deliberately turned on. Require an explicit force.
  if (!force && policyBefore && RANK[policy] < RANK[policyBefore]) {
    throw new Error(
      `Refusing to WEAKEN DMARC for ${domain}: p=${policyBefore} -> p=${policy}. ` +
      `This reduces protection an operator deliberately enabled. ` +
      `Pass force:true if that is genuinely intended.`
    );
  }

  // (b) NEVER ENFORCE BLIND. Moving to quarantine/reject without a reporting
  // address means failures are invisible — legitimate mail from an unaligned
  // sender (ESP, helpdesk, CRM) starts getting rejected and nobody finds out
  // until customers complain. RFC 7489 §6.3: rua is how you see it coming.
  if (!force && RANK[policy] >= RANK.quarantine) {
    const ruaAfter = extra.rua != null ? extra.rua : baseTags.rua;
    if (!ruaAfter) {
      throw new Error(
        `Refusing to set p=${policy} for ${domain} with no rua= reporting address. ` +
        `Enforcement without reports hides the mail it starts blocking. ` +
        `Supply rua (e.g. rua=mailto:dmarc@${domain}), or pass force:true.`
      );
    }
    // Jumping straight from no-policy/none to reject skips the monitoring
    // period entirely. quarantine is the reversible middle step.
    if (RANK[policy] === RANK.reject && RANK[policyBefore || "none"] < RANK.quarantine) {
      throw new Error(
        `Refusing to jump ${domain} straight to p=reject from p=${policyBefore || "none"}. ` +
        `Move to p=quarantine first, watch the rua reports until aligned mail is clean, ` +
        `then escalate. Pass force:true to override.`
      );
    }
  }

  baseTags.p = policy;
  if (!order.includes("p")) order.push("p");

  if (extra.rua != null) {
    baseTags.rua = extra.rua;
    if (!order.includes("rua")) order.push("rua");
  }
  if (extra.pct != null) {
    baseTags.pct = String(extra.pct);
    if (!order.includes("pct")) order.push("pct");
  }
  if (extra.fo != null) {
    baseTags.fo = String(extra.fo);
    if (!order.includes("fo")) order.push("fo");
  }
  if (extra.ruf != null) {
    baseTags.ruf = extra.ruf;
    if (!order.includes("ruf")) order.push("ruf");
  }
  if (extra.sp != null) {
    baseTags.sp = extra.sp;
    if (!order.includes("sp")) order.push("sp");
  }

  const dmarcString = buildDmarc(baseTags, order);
  // Send the RAW value — Cloudflare stores short TXT unquoted and adds RFC1035
  // quoting itself. Quoting here caused every apply to look "changed" (phantom
  // re-write) and risked publishing literal quotes.
  const content = dmarcString;

  const plan = await applyDnsRecord(
    client,
    domain,
    { type: "TXT", name, content, comment: "DMARC policy (cloudflare-ops-mcp)" },
    { apply: opts.apply, zoneId: zone_id, records }
  );

  return {
    ...plan,
    policyBefore,
    policyAfter: policy,
    dmarc: dmarcString,
  };
}

export default { parseDmarc, buildDmarc, parseSpf, getDmarc, setDmarcPolicy };
