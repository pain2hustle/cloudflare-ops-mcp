// src/bimi.js
// BIMI (default._bimi TXT) parsing/building + setup with a HARD DMARC precondition.
//
// Safety (Rule 6):
//  - setupBimi first checks the domain's DMARC policy. If p is missing or 'none'
//    it REFUSES to write in apply mode (returns an error object) unless
//    { force: true }. In dry-run it warns but still returns the planned diff.

import { resolveZoneId } from "./zone.js";
import { applyDnsRecord, listRecords, findRecord } from "./dns.js";
import { getDmarc, quoteTxt, unquoteTxt } from "./dmarc.js";

/**
 * Parse a BIMI TXT value into its tags.
 * @param {string} txt
 * @returns {{valid:boolean, tags:{v?:string,l?:string,a?:string}, raw:string,
 *            declined:boolean}}
 */
export function parseBimi(txt) {
  const raw = unquoteTxt(txt);
  const tags = {};
  for (const part of raw.split(";")) {
    const seg = part.trim();
    if (!seg) continue;
    const eq = seg.indexOf("=");
    if (eq === -1) continue;
    const key = seg.slice(0, eq).trim().toLowerCase();
    tags[key] = seg.slice(eq + 1).trim();
  }
  const valid = (tags.v || "").toUpperCase() === "BIMI1";
  // Decline-to-publish: valid record with empty l=.
  const declined = valid && (tags.l === undefined || tags.l === "");
  return { valid, tags, raw, declined };
}

/**
 * Build a BIMI TXT string.
 * @param {object} arg
 * @param {string} arg.logo HTTPS URL of the SVG Tiny PS logo (l=)
 * @param {string} [arg.vmc] HTTPS URL of the VMC/CMC .pem (a=)
 * @returns {string}
 */
export function buildBimi({ logo, vmc } = {}) {
  const parts = ["v=BIMI1"];
  parts.push(`l=${logo == null ? "" : logo}`);
  // a= is emitted when a vmc is provided; self-asserted records may omit it,
  // but emitting a=; (present-and-empty) is a valid self-assertion signal.
  if (vmc != null) parts.push(`a=${vmc}`);
  return parts.join("; ");
}

/**
 * Best-effort validation that a URL points at an SVG (Tiny PS). Never throws
 * hard — returns a report the caller can surface as warnings.
 * @param {string} url
 * @param {Function} [fetchImpl] injectable fetch (defaults to global fetch)
 * @returns {Promise<{ok:boolean, https:boolean, warnings:string[]}>}
 */
export async function validateBimiSvgUrl(url, fetchImpl) {
  const warnings = [];
  const https = typeof url === "string" && /^https:\/\//i.test(url);
  if (!https) warnings.push("Logo URL must be HTTPS (l= cannot be http).");

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function" || !https) {
    return { ok: https && warnings.length === 0, https, warnings };
  }

  try {
    const res = await doFetch(url, { method: "GET" });
    const ctype = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* ignore body read errors */
    }
    if (!/svg/i.test(ctype) && !/<svg[\s>]/i.test(body)) {
      warnings.push("Response does not look like an SVG (no svg content-type or <svg> tag).");
    }
    if (body) {
      if (!/baseProfile\s*=\s*["']tiny-ps["']/i.test(body)) {
        warnings.push('SVG is missing baseProfile="tiny-ps" (required by BIMI).');
      }
      if (!/<title[\s>]/i.test(body)) {
        warnings.push("SVG is missing a <title> element (brand name).");
      }
      const bytes = Buffer.byteLength(body, "utf8");
      if (bytes > 32 * 1024) {
        warnings.push(`SVG exceeds 32KB (${bytes} bytes).`);
      }
    }
    return { ok: warnings.length === 0, https, warnings };
  } catch (err) {
    warnings.push(`Could not fetch logo URL: ${err && err.message}`);
    return { ok: false, https, warnings };
  }
}

/**
 * Set up the default._bimi TXT record, enforcing the DMARC precondition.
 * DRY-RUN unless { apply: true }.
 *
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @param {object} arg { logo, vmc }
 * @param {object} [opts] { apply, force, zoneId, records, fetch }
 * @returns {Promise<object>} plan with { dmarcOk, warnings } — or, when apply is
 *   blocked by the DMARC precondition, { blocked:true, error, ... }.
 */
export async function setupBimi(client, domain, arg = {}, opts = {}) {
  const { apply = false, force = false } = opts;
  const zone_id = opts.zoneId || (await resolveZoneId(client, domain));
  const records = opts.records || (await listRecords(client, domain, { zoneId: zone_id }));

  // --- DMARC precondition (Rule 6) ---
  const { parsed: dmarc } = await getDmarc(client, domain, { zoneId: zone_id, records });
  const policy = dmarc && dmarc.valid ? (dmarc.tags.p || "").toLowerCase() : null;
  const dmarcEnforced = policy === "quarantine" || policy === "reject";

  const warnings = [];
  if (!dmarcEnforced) {
    const reason =
      policy === "none"
        ? "DMARC policy is p=none. BIMI is not honored until DMARC is at p=quarantine or p=reject."
        : "No enforcing DMARC record found. BIMI requires DMARC at p=quarantine or p=reject.";
    warnings.push(reason);
    if (apply && !force) {
      // Refuse to write in apply mode.
      return {
        action: "blocked",
        apply: true,
        blocked: true,
        domain,
        zone_id,
        dmarcPolicy: policy,
        dmarcOk: false,
        error: `${reason} Fix DMARC first, or pass { force: true } to override.`,
        warnings,
      };
    }
  }

  // Best-effort SVG validation (adds warnings, never blocks).
  if (arg.logo) {
    const svg = await validateBimiSvgUrl(arg.logo, opts.fetch);
    for (const w of svg.warnings) warnings.push(w);
  } else {
    warnings.push("No logo URL supplied (l=). BIMI needs a hosted SVG Tiny-PS logo.");
  }
  if (arg.vmc == null) {
    warnings.push(
      "No VMC/CMC supplied (a=). Gmail and Apple Mail require a VMC/CMC to display the logo; Yahoo/AOL do not."
    );
  }

  const name = `default._bimi.${domain}`;
  const bimiString = buildBimi(arg);
  // Send the RAW value (see dmarc.js) — Cloudflare quotes short TXT itself.
  const content = bimiString;

  const plan = await applyDnsRecord(
    client,
    domain,
    { type: "TXT", name, content, comment: "BIMI record (zonemender)" },
    { apply, zoneId: zone_id, records }
  );

  return {
    ...plan,
    dmarcPolicy: policy,
    dmarcOk: dmarcEnforced,
    forced: Boolean(force && !dmarcEnforced),
    bimi: bimiString,
    warnings,
  };
}

export default { parseBimi, buildBimi, validateBimiSvgUrl, setupBimi };
