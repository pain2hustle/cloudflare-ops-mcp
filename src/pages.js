// src/pages.js
// Cloudflare Pages DNS cutover helper.
//
// Safety:
//  - Dry-run by default. Nothing is written unless opts.apply === true.
//  - Deletes are narrow: apex/www A/AAAA/CNAME conflicts, plus www NS
//    delegations. TXT/MX/DKIM/DMARC records are never removed.
//  - Wildcard records are left alone unless includeWildcard is explicit.

import { resolveZoneId } from "./zone.js";
import { listRecords, applyDnsRecord, deleteDnsRecord } from "./dns.js";

const DIRECT_CONFLICT_TYPES = new Set(["A", "AAAA", "CNAME"]);
const WWW_CONFLICT_TYPES = new Set(["A", "AAAA", "CNAME", "NS"]);

function normName(value) {
  return String(value || "").toLowerCase().replace(/\.$/, "");
}

function cleanTarget(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

function sameHost(a, b) {
  return normName(a) === normName(b);
}

function publicRecord(record) {
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    content: record.content,
    proxied: record.proxied,
    ttl: record.ttl,
  };
}

function isConflictRecord(record, domain, target, opts) {
  const name = normName(record.name);
  const type = String(record.type || "").toUpperCase();
  const root = normName(domain);
  const www = `www.${root}`;
  const wildcard = `*.${root}`;

  if (name === root) {
    if (!DIRECT_CONFLICT_TYPES.has(type)) return false;
    if (type === "CNAME") return !sameHost(record.content, target);
    return true;
  }

  if (opts.includeWww !== false && name === www) {
    if (!WWW_CONFLICT_TYPES.has(type)) return false;
    if (type === "CNAME") return !sameHost(record.content, target);
    return true;
  }

  if (opts.includeWildcard === true && name === wildcard) {
    if (!DIRECT_CONFLICT_TYPES.has(type)) return false;
    if (type === "CNAME") return !sameHost(record.content, target);
    return true;
  }

  return false;
}

function desiredRecords(domain, target, includeWww) {
  const root = normName(domain);
  const names = includeWww === false ? [root] : [root, `www.${root}`];
  return names.map((name) => ({
    type: "CNAME",
    name,
    content: target,
    ttl: 1,
    proxied: true,
  }));
}

/**
 * Plan or apply a Cloudflare Pages DNS cutover.
 *
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @param {object} opts
 * @param {string} opts.target Pages hostname, normally <project>.pages.dev
 * @param {boolean} [opts.apply=false]
 * @param {boolean} [opts.includeWww=true]
 * @param {boolean} [opts.includeWildcard=false]
 * @param {string} [opts.zoneId]
 * @param {Array} [opts.records] pre-fetched records for tests/advanced use
 */
export async function planPagesCutover(client, domain, opts = {}) {
  const target = cleanTarget(opts.target);
  if (!target) throw new Error("pages cutover requires --target <project.pages.dev>");

  const root = normName(domain);
  const includeWww = opts.includeWww !== false;
  const includeWildcard = opts.includeWildcard === true;
  const apply = opts.apply === true;
  const zone_id = opts.zoneId || (await resolveZoneId(client, root));
  const current = opts.records || (await listRecords(client, root, { zoneId: zone_id }));

  const warnings = [];
  if (!/\.pages\.dev$/i.test(target)) {
    warnings.push(
      `Target '${target}' is not a *.pages.dev hostname; continuing because custom CNAME targets are allowed.`
    );
  }
  if (!includeWildcard) {
    const hasWildcardConflict = current.some((r) =>
      isConflictRecord(r, root, target, { includeWww, includeWildcard: true }) &&
      normName(r.name) === `*.${root}`
    );
    if (hasWildcardConflict) {
      warnings.push("Wildcard A/AAAA/CNAME records exist and were left untouched. Add --wildcard to remove them too.");
    }
  }

  const deletePlan = current
    .filter((r) => isConflictRecord(r, root, target, { includeWww, includeWildcard }))
    .map(publicRecord);

  let recordsForUpsert = current.filter((r) => !deletePlan.some((d) => d.id === r.id));
  const deleted = [];

  // 2026-08-21 — CUTOVER IS NOW RECOVERABLE.
  // This used to delete every conflicting apex/www record in a loop and THEN
  // create the CNAMEs, with no try/catch anywhere. Any failure in between (a
  // Cloudflare 5xx, a permission gap, or the free-tier 50-subrequest cap after
  // ~45 deletions) left the apex records gone and no CNAME — site offline — and
  // because the exception propagated out, the `deleted` array was lost, so
  // there was no record anywhere of what had been removed. Nothing to restore
  // from. Now we snapshot first and roll back on any failure.
  const snapshot = current
    .filter((r) => deletePlan.some((d) => d.id === r.id))
    .map((r) => ({ type: r.type, name: r.name, content: r.content, ttl: r.ttl, proxied: r.proxied, priority: r.priority, comment: r.comment }));

  const upserts = [];
  let restored = null;

  try {
    if (apply) {
      for (const record of deletePlan) {
        deleted.push(await deleteDnsRecord(client, root, record.id, { zoneId: zone_id, confirm: true }));
      }
      recordsForUpsert = await listRecords(client, root, { zoneId: zone_id });
    }

    for (const desired of desiredRecords(root, target, includeWww)) {
      const result = await applyDnsRecord(client, root, desired, {
        zoneId: zone_id,
        records: recordsForUpsert,
        apply,
      });
      upserts.push(result);

      if (apply && result.after && result.after.id) {
        recordsForUpsert = recordsForUpsert.filter((r) => r.id !== result.after.id);
        recordsForUpsert.push(result.after);
      }
    }
  } catch (e) {
    if (!apply || deleted.length === 0) throw e;
    // We already deleted records and then failed. Put them back, best effort,
    // and surface BOTH the original failure and the exact snapshot so a human
    // can finish the restore by hand if any re-create also failed.
    restored = { attempted: snapshot.length, ok: 0, failed: [] };
    for (const rec of snapshot) {
      try {
        await applyDnsRecord(client, root, rec, { zoneId: zone_id, apply: true });
        restored.ok += 1;
      } catch (re) {
        restored.failed.push({ record: rec, error: (re && re.message) || String(re) });
      }
    }
    const err = new Error(
      `pages_cutover FAILED after deleting ${deleted.length} record(s): ${(e && e.message) || e}. ` +
      `Rollback restored ${restored.ok}/${restored.attempted}.` +
      (restored.failed.length ? ` ${restored.failed.length} could NOT be restored — see .restore for the exact records to re-create by hand.` : ` The zone is back to its previous state.`)
    );
    err.restore = { snapshot, restored, deleted };
    throw err;
  }

  return {
    action: "pages_cutover",
    // Everything needed to undo this cutover by hand, always returned.
    undo: { restore_records: snapshot },
    apply,
    domain: root,
    target,
    zone_id,
    include_www: includeWww,
    include_wildcard: includeWildcard,
    delete: deletePlan,
    deleted,
    upserts,
    warnings,
    has_changes: deletePlan.length > 0 || upserts.some((p) => p.action !== "noop"),
  };
}

export default { planPagesCutover };
