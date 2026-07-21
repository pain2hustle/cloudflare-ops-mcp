// src/plan.js
// planEmailAuth: a read-only report of desired vs current SPF / DKIM / DMARC /
// Email Routing posture for a domain. Writes nothing.

import { scanZone } from "./zone.js";
import { getRoutingStatus } from "./email.js";

/**
 * Assess a domain's email-authentication posture and report what is missing or
 * wrong. Never writes.
 *
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @param {object} [cfg]
 * @param {string} [cfg.inbox] a desired forwarding inbox to note in the plan
 * @returns {Promise<{domain:string, zone_id:string, ok:boolean, findings:Array,
 *   snapshot:object}>}
 */
export async function planEmailAuth(client, domain, cfg = {}) {
  const snap = await scanZone(client, domain);
  const findings = [];

  // --- SPF ---
  if (!snap.spf) {
    findings.push({
      area: "SPF",
      severity: "warn",
      status: "missing",
      message:
        "No SPF record at the apex. Add one TXT: v=spf1 <includes> ~all (exactly one SPF record).",
    });
  } else {
    const spf = snap.spf.parsed;
    if (spf.lookupCount >= 10) {
      findings.push({
        area: "SPF",
        severity: "error",
        status: "too-many-lookups",
        message: `SPF has ${spf.lookupCount} DNS-lookup mechanisms (limit is 10; permerror = SPF fail).`,
      });
    } else if (spf.lookupCount >= 8) {
      findings.push({
        area: "SPF",
        severity: "warn",
        status: "near-lookup-limit",
        message: `SPF has ${spf.lookupCount} DNS-lookup mechanisms; approaching the 10-lookup limit.`,
      });
    } else {
      findings.push({
        area: "SPF",
        severity: "ok",
        status: "present",
        message: `SPF present with ${spf.lookupCount} DNS-lookup mechanisms (all=${spf.all || "none"}).`,
      });
    }
  }

  // --- DKIM (heuristic: any *_domainkey record) ---
  const dkimRecords = snap.dns.filter((r) =>
    /_domainkey\./i.test(String(r.name))
  );
  if (dkimRecords.length === 0) {
    findings.push({
      area: "DKIM",
      severity: "warn",
      status: "missing",
      message:
        "No *_domainkey records found. Add the ESP's DKIM selector (CNAME or TXT) so DKIM signs with d=<your domain> (alignment).",
    });
  } else {
    findings.push({
      area: "DKIM",
      severity: "ok",
      status: "present",
      message: `${dkimRecords.length} DKIM selector record(s) found: ${dkimRecords
        .map((r) => r.name)
        .join(", ")}.`,
    });
  }

  // --- DMARC ---
  if (!snap.dmarc) {
    findings.push({
      area: "DMARC",
      severity: "warn",
      status: "missing",
      message:
        "No DMARC record at _dmarc. Start with v=DMARC1; p=none; rua=mailto:dmarc@<domain> to collect reports.",
    });
  } else {
    const p = (snap.dmarc.parsed.tags.p || "").toLowerCase();
    const hasRua = Boolean(snap.dmarc.parsed.tags.rua);
    if (p === "none") {
      findings.push({
        area: "DMARC",
        severity: hasRua ? "ok" : "warn",
        status: "monitoring",
        message: hasRua
          ? "DMARC at p=none with rua (monitoring). Once reports show all mail aligned, ramp to p=quarantine."
          : "DMARC at p=none WITHOUT rua — no visibility. Add rua=mailto:... to collect aggregate reports.",
      });
    } else if (p === "quarantine" || p === "reject") {
      findings.push({
        area: "DMARC",
        severity: "ok",
        status: "enforcing",
        message: `DMARC enforcing (p=${p}). BIMI precondition satisfied.`,
      });
    } else {
      findings.push({
        area: "DMARC",
        severity: "warn",
        status: "unknown-policy",
        message: `DMARC present but policy is '${p || "unset"}'.`,
      });
    }
  }

  // --- BIMI ---
  if (snap.bimi) {
    const dmarcP = snap.dmarc ? (snap.dmarc.parsed.tags.p || "").toLowerCase() : null;
    const enforced = dmarcP === "quarantine" || dmarcP === "reject";
    findings.push({
      area: "BIMI",
      severity: enforced ? "ok" : "error",
      status: enforced ? "present" : "present-but-inert",
      message: enforced
        ? "BIMI record present and DMARC is enforcing."
        : "BIMI record present but DMARC is NOT enforcing (p must be quarantine/reject) — the logo will not display.",
    });
  }

  // --- Email Routing ---
  let routing = null;
  try {
    routing = await getRoutingStatus(client, snap.zone_id);
  } catch {
    routing = snap.email_routing;
  }
  if (routing) {
    findings.push({
      area: "EmailRouting",
      severity: routing.enabled ? "ok" : "warn",
      status: routing.enabled ? "enabled" : "disabled",
      message: `Email Routing status: ${routing.status || (routing.enabled ? "enabled" : "disabled")}.`,
    });
  }

  if (cfg.inbox) {
    findings.push({
      area: "EmailRouting",
      severity: "info",
      status: "desired-inbox",
      message: `Desired forwarding inbox noted: ${cfg.inbox}. Use the 'email' command to create a forward rule.`,
    });
  }

  const ok = !findings.some((f) => f.severity === "error");
  return { domain, zone_id: snap.zone_id, ok, findings, snapshot: snap };
}

export default { planEmailAuth };
