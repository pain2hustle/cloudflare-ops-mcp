// src/dns.js
// DNS record read + upsert + delete against a Cloudflare zone.
//
// Safety:
//  - applyDnsRecord is DRY-RUN unless { apply: true } is passed. In dry-run it
//    fetches current state and returns the planned change + diff, writing nothing.
//  - deleteDnsRecord refuses to delete unless { confirm: true }. Deletion is
//    never a side effect of an apply.

import { resolveZoneId } from "./zone.js";

/**
 * List all DNS records for a domain (paginated).
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @param {object} [opts]
 * @param {string} [opts.zoneId] pre-resolved zone id (skips a lookup)
 * @returns {Promise<Array>}
 */
export async function listRecords(client, domain, { zoneId } = {}) {
  const zone_id = zoneId || (await resolveZoneId(client, domain));
  return client.paginate(`/zones/${zone_id}/dns_records`);
}

/** Normalize a name for comparison (lowercase, drop trailing dot). */
function normName(n) {
  return String(n).toLowerCase().replace(/\.$/, "");
}

/** Strip one layer of RFC1035 double-quotes from a TXT value, if present. */
function bareTxt(content) {
  return String(content == null ? "" : content).replace(/^"(.*)"$/s, "$1").trim();
}

/**
 * Classify a TXT value so an upsert can bind to the RIGHT record when several
 * TXT records share one name (the classic apex case: SPF + a verification TXT).
 * Singleton kinds (spf/dmarc/bimi/dkim) should have exactly one record; any
 * other value is treated as opaque and matched only by exact content, so adding
 * a new verification token can never clobber an unrelated one.
 * @returns {string} 'spf'|'dmarc'|'bimi'|'dkim'|'other'
 */
export function txtKind(content) {
  const c = bareTxt(content).toLowerCase();
  if (/^v=spf1\b/.test(c)) return "spf";
  if (/^v=dmarc1\b/.test(c)) return "dmarc";
  if (/^v=bimi1\b/.test(c)) return "bimi";
  if (/^v=dkim1\b/.test(c)) return "dkim";
  return "other";
}

/**
 * Find ALL records matching type + name (case-insensitive, trailing-dot-agnostic).
 * @returns {Array}
 */
export function findRecords(records, type, name) {
  if (!Array.isArray(records)) return [];
  const wantType = String(type).toUpperCase();
  const wantName = normName(name);
  return records.filter(
    (r) =>
      String(r.type).toUpperCase() === wantType &&
      normName(r.name) === wantName
  );
}

/**
 * Find the single record an upsert should target, disambiguating when more than
 * one record shares type + name. Returns { match, candidates, ambiguous }.
 *  - TXT: narrow by content signature (kind); 'other' TXT narrows by exact value.
 *  - Non-TXT with >1 match (round-robin A, multiple MX): ambiguous unless a
 *    recordId is given.
 * A caller can force the choice with opts.recordId.
 */
export function selectUpsertTarget(records, desired, opts = {}) {
  const type = String(desired.type).toUpperCase();
  let candidates = findRecords(records, type, desired.name);

  if (opts.recordId) {
    const byId = candidates.find((r) => r.id === opts.recordId);
    return { match: byId, candidates, ambiguous: false, targetedById: !byId ? false : true };
  }

  if (type === "TXT") {
    const kind = txtKind(desired.content);
    if (kind === "other") {
      // Opaque TXT: only an identical value is "the same record"; otherwise add new.
      const exact = candidates.filter((r) => bareTxt(r.content) === bareTxt(desired.content));
      candidates = exact;
    } else {
      // Singleton kind: bind to the record of the same kind (SPF↔SPF, etc.).
      candidates = candidates.filter((r) => txtKind(r.content) === kind);
    }
  }

  if (candidates.length === 0) return { match: undefined, candidates: [], ambiguous: false };
  if (candidates.length === 1) return { match: candidates[0], candidates, ambiguous: false };
  return { match: undefined, candidates, ambiguous: true };
}

/**
 * Find a single record by type + name (legacy helper). Returns the first match.
 * Prefer selectUpsertTarget for writes — it will not silently pick one of many.
 * @returns {object|undefined}
 */
export function findRecord(records, type, name) {
  return findRecords(records, type, name)[0];
}

/**
 * Build the create/update body for a record, honoring the proxied/ttl and
 * type constraints from the Cloudflare contract:
 *  - TXT and MX cannot be proxied (proxied is dropped for them).
 *  - When proxied:true, Cloudflare forces ttl to 1; we normalize to 1.
 * @param {object} desired {type,name,content,ttl,proxied,priority,comment}
 * @returns {object}
 */
function buildRecordBody(desired, existing = null) {
  const type = String(desired.type).toUpperCase();
  const body = {
    type,
    name: desired.name,
    content: desired.content,
  };

  // 2026-08-21: PRESERVE what the caller did not ask to change.
  // Previously an update that only touched `content` also sent proxied:false
  // and ttl:1, because both fell through to defaults. Changing an origin IP
  // therefore flipped the record orange -> grey, PUBLISHING THE ORIGIN IP and
  // dropping WAF/DDoS/SSL-mode behaviour, and reset a deliberate TTL to Auto.
  // Now: explicit wins, otherwise inherit the live record, otherwise default.
  const proxiableTypes = new Set(["A", "AAAA", "CNAME"]);
  const inherit = existing || null;
  let proxied;
  if (!proxiableTypes.has(type)) {
    proxied = false;                                  // TXT/MX etc. cannot proxy
  } else if (desired.proxied === true || desired.proxied === false) {
    proxied = desired.proxied;                        // caller was explicit
  } else if (inherit && typeof inherit.proxied === "boolean") {
    proxied = inherit.proxied;                        // keep what is live
  } else {
    proxied = false;                                  // new record default
  }
  if (proxiableTypes.has(type)) {
    body.proxied = proxied;
  }

  // ttl: 1 = automatic. When proxied, CF forces ttl to 1.
  if (proxied) {
    body.ttl = 1;
  } else if (desired.ttl != null) {
    body.ttl = desired.ttl;                           // caller was explicit
  } else if (inherit && inherit.ttl != null) {
    body.ttl = inherit.ttl;                           // keep what is live
  } else {
    body.ttl = 1;
  }

  if (type === "MX" && desired.priority != null) {
    body.priority = desired.priority;
  }
  if (desired.comment != null) body.comment = desired.comment;
  if (desired.tags != null) body.tags = desired.tags;
  return body;
}

/**
 * Compute the diff between a current record and a desired body.
 * @returns {{changed:boolean, fields:string[]}}
 */
function diffRecord(current, desiredBody) {
  const fields = [];
  // 2026-08-21: "comment" deliberately excluded from change detection.
  // Every DMARC/BIMI apply attaches its own "(cloudflare-ops-mcp)" comment, so
  // including it here made the FIRST apply against an already-correct record
  // report changed:true and rewrite it — a phantom write that also clobbered an
  // operator's hand-written note. The comment is still SENT on create/update;
  // it just no longer counts as a reason to write.
  const compareKeys = ["content", "ttl", "proxied", "priority"];
  const isTxt = String(desiredBody.type).toUpperCase() === "TXT";
  for (const k of compareKeys) {
    if (!(k in desiredBody)) continue;
    let cur = current ? current[k] : undefined;
    let want = desiredBody[k];
    // TXT content is stored UNQUOTED by Cloudflare; normalize both sides so an
    // already-correct record is detected as no-op instead of a phantom update.
    if (k === "content" && isTxt) {
      cur = bareTxt(cur);
      want = bareTxt(want);
    }
    if (cur !== want) fields.push(k);
  }
  return { changed: fields.length > 0, fields };
}

/**
 * Upsert a DNS record: create if absent, update if content/fields differ,
 * no-op if identical. DRY-RUN unless { apply: true }.
 *
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @param {object} desired {type,name,content,ttl?,proxied?,priority?,comment?}
 * @param {object} [opts]
 * @param {boolean} [opts.apply=false]
 * @param {string}  [opts.zoneId]
 * @param {Array}   [opts.records] pre-fetched record list (avoids a lookup)
 * @returns {Promise<{action:'create'|'update'|'noop', apply:boolean, domain:string,
 *                    record:object, before:object|null, after:object, diff:object}>}
 */
export async function applyDnsRecord(client, domain, desired, opts = {}) {
  const { apply = false } = opts;
  const zone_id = opts.zoneId || (await resolveZoneId(client, domain));
  const records =
    opts.records || (await client.paginate(`/zones/${zone_id}/dns_records`));

  const { match: existing, candidates, ambiguous } = selectUpsertTarget(records, desired, opts);
  // Built AFTER the target is resolved so unspecified proxied/ttl inherit from
  // the record we are about to overwrite instead of silently resetting it.
  const desiredBody = buildRecordBody(desired, existing);

  // Refuse to guess when several records share this type+name and we can't tell
  // which one to update — writing would silently clobber an unrelated record
  // (e.g. an apex verification TXT overwriting SPF). Caller must pass an explicit
  // recordId (or delete the extras). NEVER auto-picks one of many.
  if (ambiguous) {
    return {
      action: "ambiguous",
      apply: Boolean(apply),
      domain,
      zone_id,
      record: { type: desiredBody.type, name: desiredBody.name },
      candidates: candidates.map((r) => ({ id: r.id, content: r.content, ttl: r.ttl, priority: r.priority })),
      before: null,
      after: desiredBody,
      diff: { changed: false, fields: [] },
      warning:
        `${candidates.length} records share ${desiredBody.type} ${desiredBody.name}. ` +
        `Refusing to update blindly — pass an explicit recordId (CLI: --record-id <id>) to target one.`,
    };
  }

  const diff = diffRecord(existing, desiredBody);

  let action;
  if (!existing) action = "create";
  else if (diff.changed) action = "update";
  else action = "noop";

  const before = existing
    ? {
        id: existing.id,
        type: existing.type,
        name: existing.name,
        content: existing.content,
        ttl: existing.ttl,
        proxied: existing.proxied,
        priority: existing.priority,
        comment: existing.comment,
      }
    : null;

  const plan = {
    action,
    apply: Boolean(apply),
    domain,
    zone_id,
    record: { type: desiredBody.type, name: desiredBody.name },
    before,
    after: desiredBody,
    diff,
  };

  if (!apply || action === "noop") {
    // Dry-run OR nothing to do: write nothing.
    if (action === "noop") plan.after = before;
    return plan;
  }

  // apply === true and there is a change to make.
  if (action === "create") {
    const { result } = await client.request(
      "POST",
      `/zones/${zone_id}/dns_records`,
      desiredBody
    );
    plan.after = result;
    plan.record.id = result && result.id;
  } else if (action === "update") {
    // PATCH is safer than PUT (only changes the fields we send).
    const patch = {};
    for (const f of diff.fields) patch[f] = desiredBody[f];
    // If content changed we always resend content; PATCH leaves the rest.
    const { result } = await client.request(
      "PATCH",
      `/zones/${zone_id}/dns_records/${existing.id}`,
      patch
    );
    plan.after = result;
    plan.record.id = existing.id;
  }

  return plan;
}

/**
 * Delete a DNS record by id. Refuses unless { confirm: true }.
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @param {string} id dns_record_id
 * @param {object} [opts]
 * @param {boolean} [opts.confirm=false]
 * @param {string}  [opts.zoneId]
 * @returns {Promise<{action:'delete'|'refused', confirmed:boolean, id:string, result?:any, reason?:string}>}
 */
export async function deleteDnsRecord(client, domain, id, opts = {}) {
  const { confirm = false } = opts;
  if (!confirm) {
    return {
      action: "refused",
      confirmed: false,
      id,
      reason:
        "Refusing to delete without { confirm: true } (CLI requires --force).",
    };
  }
  const zone_id = opts.zoneId || (await resolveZoneId(client, domain));
  const { result } = await client.request(
    "DELETE",
    `/zones/${zone_id}/dns_records/${id}`
  );
  return { action: "delete", confirmed: true, id, result };
}

// Exported for tests / advanced host use.
export const _internal = { buildRecordBody, diffRecord };
