#!/usr/bin/env node
// bin/zonemend.js
// zonemender CLI — scan / plan / dns / email / dmarc / bimi / verify.
//
// Safety model:
//  - Dry-run by DEFAULT. Nothing is written unless you pass --apply.
//  - Deletes require --force (never happen as a side effect of --apply).
//  - The API token is read ONLY from CLOUDFLARE_API_TOKEN and is never printed.
//  - This CLI supplies the audit-log timestamps (Date). Pure src/ logic does not.

import { parseArgs } from "node:util";
import {
  CloudflareClient,
  scanZone,
  applyDnsRecord,
  setDmarcPolicy,
  setupBimi,
  setupEmailRouting,
  planEmailAuth,
  purgeCache,
  appendAudit,
  AUDIT_DEFAULT_PATH,
} from "../src/index.js";

const USAGE = `zonemender — a standalone Cloudflare zone fixer (dry-run by default)

Usage:
  zonemend <command> <domain> [options]

Commands:
  scan   <domain>                          Full read-only snapshot (DNS, SPF, DKIM, DMARC, BIMI, routing)
  plan   <domain> [--inbox x@y]            Report desired vs current email-auth posture (no writes)
  dns    <domain> --type T --name N --content C [--ttl n] [--proxied] [--record-id id] [--apply]
                                           Upsert a DNS record (create/update/no-op). If several records
                                           share the name it refuses and asks for --record-id (no clobber).
  email  <domain> --forward a@b=to@c [--forward ...] [--catch-all to@c] [--apply]
                                           Plan/apply Email Routing forward rules + catch-all
  dmarc  <domain> --policy quarantine [--rua mailto:x] [--pct 25] [--apply]
                                           Change only the DMARC p= (and rua/pct), safely
  purge  <domain> [--everything] [--url <abs-url> ...] [--apply]
                                           Purge Cloudflare cache — whole zone (default) or specific --url
                                           (repeatable). Dry-run by default; needs a token with Zone>Cache Purge.
  bimi   <domain> --logo <https-svg-url> [--vmc <https-pem-url>] [--apply] [--force]
                                           Set default._bimi TXT (refuses if DMARC=none unless --force)
  verify <domain>                          Verify the API token, then resolve the zone

Global options:
  --apply            Actually perform the write (default: dry-run, writes nothing)
  --force            For 'bimi', override the DMARC precondition
  --audit <path>     Audit log path (default: ${AUDIT_DEFAULT_PATH})
  -h, --help         Show this help

Environment:
  CLOUDFLARE_API_TOKEN   Scoped token: Zone(Read) + DNS(Edit) + Email Routing Rules(Edit).
                         Never use the Global API Key.

Examples:
  zonemend scan example.com
  zonemend dmarc example.com --policy quarantine --rua mailto:dmarc@example.com        # dry-run
  zonemend dmarc example.com --policy quarantine --rua mailto:dmarc@example.com --apply
  zonemend bimi example.com --logo https://example.com/bimi/logo.svg                    # dry-run
  zonemend dns example.com --type TXT --name @ --content "google-site-verification=..."  # dry-run (adds; won't clobber SPF)
`;

function log(...args) {
  console.log(...args);
}
function errExit(msg, code = 1) {
  console.error(`Error: ${msg}`);
  process.exit(code);
}

function fmtDiff(plan) {
  // Render a friendly diff for a DNS-style plan {action, before, after, diff}.
  const lines = [];
  lines.push(`  action: ${plan.action}${plan.apply ? " (APPLIED)" : " (dry-run)"}`);
  if (plan.record) {
    lines.push(`  record: ${plan.record.type || ""} ${plan.record.name || ""}`.trimEnd());
  }
  if (plan.action === "ambiguous") {
    lines.push(`  ⚠ ${plan.warning}`);
    for (const c of plan.candidates || []) {
      lines.push(`    - id=${c.id} content=${JSON.stringify(c.content)}`);
    }
    lines.push("  (nothing written — pick one with --record-id <id>)");
    return lines.join("\n");
  }
  if (plan.action === "noop") {
    lines.push("  (already correct — nothing to change)");
    return lines.join("\n");
  }
  const before = plan.before;
  const after = plan.after;
  if (before) {
    lines.push(`  - before: content=${JSON.stringify(before.content)} ttl=${before.ttl} proxied=${before.proxied}`);
  } else {
    lines.push("  - before: (record does not exist)");
  }
  if (after) {
    lines.push(`  + after:  content=${JSON.stringify(after.content)} ttl=${after.ttl}${after.proxied !== undefined ? ` proxied=${after.proxied}` : ""}`);
  }
  if (plan.diff && plan.diff.fields && plan.diff.fields.length) {
    lines.push(`  changed fields: ${plan.diff.fields.join(", ")}`);
  }
  return lines.join("\n");
}

function auditFromPlan(auditPath, action, domain, plan) {
  // Only write an audit line when a write actually happened.
  if (!plan || !plan.apply || plan.action === "noop" || plan.action === "ambiguous" || plan.blocked) return;
  appendAudit(auditPath, {
    ts: new Date().toISOString(),
    action,
    domain,
    record: plan.record || null,
    before: plan.before || null,
    after: plan.after || null,
  });
}

function makeClient() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    errExit(
      "CLOUDFLARE_API_TOKEN is not set. Create a scoped token and export it (see --help)."
    );
  }
  return new CloudflareClient();
}

// ---- collect repeatable --forward values -----------------------------------
function collectForwards(raw) {
  // parseArgs with multiple:true yields an array; each item "a@b=to@c".
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((item) => {
    const eq = item.indexOf("=");
    if (eq === -1) {
      errExit(`--forward expects the form source@domain=dest@domain (got '${item}')`);
    }
    return { address: item.slice(0, eq).trim(), to: item.slice(eq + 1).trim() };
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === "-h" || command === "--help" || command === "help") {
    log(USAGE);
    return;
  }

  const rest = argv.slice(1);
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        apply: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        proxied: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        type: { type: "string" },
        name: { type: "string" },
        content: { type: "string" },
        "record-id": { type: "string" },
        ttl: { type: "string" },
        policy: { type: "string" },
        rua: { type: "string" },
        pct: { type: "string" },
        logo: { type: "string" },
        vmc: { type: "string" },
        inbox: { type: "string" },
        forward: { type: "string", multiple: true },
        "catch-all": { type: "string" },
        everything: { type: "boolean", default: false },
        url: { type: "string", multiple: true },
        audit: { type: "string" },
      },
    });
  } catch (e) {
    errExit(e.message);
  }

  const { values, positionals } = parsed;
  if (values.help) {
    log(USAGE);
    return;
  }

  const domain = positionals[0];
  const auditPath = values.audit || AUDIT_DEFAULT_PATH;
  const needsDomain = ["scan", "plan", "dns", "email", "dmarc", "bimi", "verify", "purge"];
  if (needsDomain.includes(command) && !domain) {
    errExit(`'${command}' requires a <domain>. See --help.`);
  }

  try {
    switch (command) {
      case "purge": {
        // Cloudflare cache purge. Dry-run by default; --apply actually purges.
        // Whole zone by default; --url <abs-url> (repeatable) purges specific URLs.
        const client = makeClient();
        const plan = await purgeCache(client, domain, {
          everything: values.everything === true,
          files: values.url,
          apply: values.apply === true,
        });
        if (plan.blocked) errExit(`Zone not found for ${domain} — token can't see it (Zone:Read?), or wrong account.`);
        log(
          `Cache purge (${domain}) — scope: ${plan.scope}${
            plan.apply ? "  — PURGED" : "  — dry-run (add --apply to actually purge)"
          }`
        );
        break;
      }

      case "verify": {
        const client = makeClient();
        const status = await client.verifyToken();
        log(`Token status: ${status.status || "unknown"}`);
        const snap = await scanZone(client, domain);
        log(`Zone resolved: ${snap.name} (zone_id ${snap.zone_id}, status ${snap.status})`);
        break;
      }

      case "scan": {
        const client = makeClient();
        const snap = await scanZone(client, domain);
        log(`Zone: ${snap.name}  (zone_id ${snap.zone_id}, status ${snap.status})`);
        log(`DNS records: ${snap.dns.length}`);
        log(`SPF:   ${snap.spf ? snap.spf.parsed.raw : "(none)"}`);
        log(`DMARC: ${snap.dmarc ? snap.dmarc.parsed.raw : "(none)"}`);
        log(`BIMI:  ${snap.bimi ? snap.bimi.parsed.raw : "(none)"}`);
        log(
          `Email Routing: ${
            snap.email_routing
              ? snap.email_routing.status || (snap.email_routing.enabled ? "enabled" : "disabled")
              : "(unknown / not enabled)"
          }`
        );
        break;
      }

      case "plan": {
        const client = makeClient();
        const report = await planEmailAuth(client, domain, { inbox: values.inbox });
        log(`Email-auth plan for ${report.domain} (zone ${report.zone_id}):`);
        for (const f of report.findings) {
          const mark =
            f.severity === "ok" ? "[ok]" :
            f.severity === "error" ? "[ERR]" :
            f.severity === "warn" ? "[warn]" : "[info]";
          log(`  ${mark} ${f.area}: ${f.message}`);
        }
        log(report.ok ? "Overall: no blocking errors." : "Overall: blocking errors present.");
        break;
      }

      case "dns": {
        if (!values.type || !values.name || values.content == null) {
          errExit("dns requires --type, --name and --content.");
        }
        const client = makeClient();
        const desired = {
          type: values.type,
          name: values.name,
          content: values.content,
          proxied: values.proxied,
        };
        if (values.ttl != null) desired.ttl = Number(values.ttl);
        const plan = await applyDnsRecord(client, domain, desired, {
          apply: values.apply,
          recordId: values["record-id"],
        });
        log(`DNS upsert for ${domain}:`);
        log(fmtDiff(plan));
        auditFromPlan(auditPath, "dns.upsert", domain, plan);
        if (plan.action === "ambiguous") process.exitCode = 1;
        else if (!values.apply && plan.action !== "noop") {
          log("\nDry-run only. Re-run with --apply to write this change.");
        }
        break;
      }

      case "email": {
        const client = makeClient();
        const forwards = collectForwards(values.forward);
        const cfg = { forwards };
        if (values["catch-all"]) cfg.catchAll = values["catch-all"];
        const res = await setupEmailRouting(client, domain, cfg, { apply: values.apply, force: values.force });
        log(`Email Routing plan for ${domain} (zone ${res.zone_id}):`);
        for (const item of res.plan) {
          const tag = item.action === "blocked-unverified" ? " ⚠ BLOCKED (destination unverified)"
            : (res.apply && item.action !== "noop" ? " (APPLIED)" : "");
          log(`  ${item.action}${tag}: ${item.address} -> ${item.to}`);
        }
        for (const w of res.warnings || []) log(`  ⚠ ${w}`);
        if (res.catchAll) {
          log(`  catch-all ${res.catchAll.action}${res.apply && res.catchAll.action !== "noop" ? " (APPLIED)" : ""}: * -> ${res.catchAll.to}`);
        }
        log("Note: destination addresses must be verified (CF sends a verification email); rules stay disabled until then.");
        if (res.apply) {
          for (const item of res.plan) {
            if (item.action !== "noop") {
              appendAudit(auditPath, {
                ts: new Date().toISOString(),
                action: "email.rule",
                domain,
                record: { address: item.address, to: item.to },
                before: item.before,
                after: item.after,
              });
            }
          }
          if (res.catchAll && res.catchAll.action !== "noop") {
            appendAudit(auditPath, {
              ts: new Date().toISOString(),
              action: "email.catch_all",
              domain,
              record: { to: res.catchAll.to },
              before: res.catchAll.before,
              after: res.catchAll.after,
            });
          }
        } else if (res.diff.changes > 0) {
          log("\nDry-run only. Re-run with --apply to write these rules.");
        }
        break;
      }

      case "dmarc": {
        if (!values.policy) errExit("dmarc requires --policy (none|quarantine|reject).");
        const client = makeClient();
        const extra = {};
        if (values.rua) extra.rua = values.rua;
        if (values.pct != null) extra.pct = values.pct;
        const plan = await setDmarcPolicy(client, domain, values.policy, extra, { apply: values.apply });
        log(`DMARC ${plan.policyBefore || "(none)"} -> ${plan.policyAfter} for ${domain}:`);
        log(`  new record: ${plan.dmarc}`);
        log(fmtDiff(plan));
        auditFromPlan(auditPath, "dmarc.policy", domain, plan);
        if (!values.apply && plan.action !== "noop") {
          log("\nDry-run only. Re-run with --apply to write this change.");
        }
        break;
      }

      case "bimi": {
        if (!values.logo) errExit("bimi requires --logo <https-svg-url>.");
        const client = makeClient();
        const plan = await setupBimi(
          client,
          domain,
          { logo: values.logo, vmc: values.vmc },
          { apply: values.apply, force: values.force }
        );
        if (plan.blocked) {
          log(`BIMI for ${domain}: BLOCKED.`);
          log(`  ${plan.error}`);
          for (const w of plan.warnings || []) log(`  warn: ${w}`);
          process.exitCode = 1;
          break;
        }
        log(`BIMI for ${domain} (DMARC p=${plan.dmarcPolicy || "none"}, enforcing=${plan.dmarcOk}):`);
        log(`  new record: ${plan.bimi}`);
        log(fmtDiff(plan));
        for (const w of plan.warnings || []) log(`  warn: ${w}`);
        auditFromPlan(auditPath, "bimi.setup", domain, plan);
        if (!values.apply && plan.action !== "noop") {
          log("\nDry-run only. Re-run with --apply to write this change.");
        }
        break;
      }

      default:
        errExit(`Unknown command '${command}'. See --help.`);
    }
  } catch (e) {
    // e.message is already token-redacted by the client layer.
    errExit(e.message);
  }
}

main();
