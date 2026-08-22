// src/email.js
// Cloudflare Email Routing: status, enable, destination addresses (account-scoped),
// routing rules + catch-all (zone-scoped).
//
// Safety:
//  - setupEmailRouting is DRY-RUN unless { apply: true }. It plans the rules and
//    returns a diff; it writes only when apply is true.
//  - Adding a destination address triggers a Cloudflare verification email; the
//    rule stays disabled until the recipient verifies. We surface that clearly.

import { resolveZone } from "./zone.js";

/**
 * Get Email Routing settings/status for a zone.
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} zoneId
 * @returns {Promise<object>} { enabled, name, status, ... }
 */
export async function getRoutingStatus(client, zoneId) {
  const { result } = await client.request(
    "GET",
    `/zones/${zoneId}/email/routing`
  );
  return result || {};
}

/**
 * Enable Email Routing on a zone (Cloudflare auto-adds MX + SPF DNS).
 * DRY-RUN unless { apply: true }.
 * @returns {Promise<object>}
 */
export async function enableRouting(client, zoneId, { apply = false } = {}) {
  if (!apply) {
    return { action: "enable", apply: false, zone_id: zoneId, planned: true };
  }
  const { result } = await client.request(
    "POST",
    `/zones/${zoneId}/email/routing/enable`,
    {}
  );
  return { action: "enable", apply: true, zone_id: zoneId, result };
}

/**
 * List destination addresses for an account (account-scoped, shared across zones).
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} accountId
 * @returns {Promise<Array>}
 */
export async function listDestinations(client, accountId) {
  return client.paginate(`/accounts/${accountId}/email/routing/addresses`);
}

/**
 * Add a destination address (account-scoped). Triggers a CF verification email.
 * DRY-RUN unless { apply: true }.
 * @returns {Promise<object>}
 */
export async function addDestination(client, accountId, email, { apply = false } = {}) {
  if (!apply) {
    return {
      action: "add-destination",
      apply: false,
      account_id: accountId,
      email,
      planned: true,
      note: "Would send a verification email; address stays unverified until the recipient clicks the link.",
    };
  }
  const { result } = await client.request(
    "POST",
    `/accounts/${accountId}/email/routing/addresses`,
    { email }
  );
  return {
    action: "add-destination",
    apply: true,
    account_id: accountId,
    email,
    result,
    note: "Verification email sent. Rules to this address stay disabled until verified.",
  };
}

/**
 * List routing rules for a zone (excludes the catch-all singleton).
 * @returns {Promise<Array>}
 */
export async function listRules(client, zoneId) {
  return client.paginate(`/zones/${zoneId}/email/routing/rules`);
}

/**
 * Get the catch-all rule (singleton) for a zone.
 * @returns {Promise<object>}
 */
export async function getCatchAll(client, zoneId) {
  const { result } = await client.request(
    "GET",
    `/zones/${zoneId}/email/routing/rules/catch_all`
  );
  return result || {};
}

function ruleMatches(rule, sourceAddr) {
  if (!rule || !Array.isArray(rule.matchers)) return false;
  return rule.matchers.some(
    (m) =>
      m.type === "literal" &&
      m.field === "to" &&
      String(m.value).toLowerCase() === String(sourceAddr).toLowerCase()
  );
}

/**
 * Plan + optionally apply Email Routing forward rules and (optionally) a
 * catch-all. DRY-RUN unless { apply: true }.
 *
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @param {object} cfg
 * @param {Array<{address:string,to:string}>} [cfg.forwards]
 * @param {string} [cfg.catchAll] destination email for the catch-all
 * @param {object} [opts] { apply, zoneId, accountId }
 * @returns {Promise<{apply:boolean, domain:string, plan:Array, catchAll:object|null, diff:object}>}
 */
export async function setupEmailRouting(client, domain, cfg = {}, opts = {}) {
  const { apply = false, force = false } = opts;
  let zone_id = opts.zoneId;
  let account_id = opts.accountId || null;
  if (!zone_id || !account_id) {
    const z = await resolveZone(client, domain);
    zone_id = zone_id || z.id;
    account_id = account_id || z.account_id;
  }

  // Pull the account's verified destination addresses up front. Cloudflare keeps
  // a forward rule DISABLED until its destination is verified, so we refuse to
  // create a rule to an unverified address (unless forced) rather than leave a
  // silently-dead rule behind. A destination's `verified` field is a timestamp
  // (or null). If we CAN'T read the list we now refuse on apply (fail closed) —
  // a gate that protects mail must not evaporate when it goes blind. force:true
  // overrides.
  const verifiedSet = new Set();
  let destKnown = false;
  if (account_id) {
    try {
      const dests = await listDestinations(client, account_id);
      for (const d of dests) if (d && d.email && d.verified) verifiedSet.add(String(d.email).toLowerCase());
      destKnown = true;
    } catch { destKnown = false; }
  }
  const isVerified = (email) => verifiedSet.has(String(email || "").toLowerCase());
  const warnings = [];

  // Email Routing must be ENABLED (Cloudflare MX/SPF present) or every rule is
  // inert — it exists but no mail is ever delivered. Ensure it's on before we
  // touch rules. Idempotent; enable is a no-op when already ready.
  let routing_enabled = null;
  try {
    const status = await getRoutingStatus(client, zone_id);
    routing_enabled = !!(status && (status.enabled === true || status.status === "ready"));
  } catch { routing_enabled = null; }
  if (apply && routing_enabled !== true) {
    try {
      await enableRouting(client, zone_id, { apply: true });
      routing_enabled = true;
    } catch (e) {
      // 2026-08-21: this used to be a WARNING and execution continued to create
      // forward rules. Without Email Routing enabled the zone has no Cloudflare
      // MX, so every rule created is inert — mail silently black-holes while the
      // tool returns a plan that reads as success (worker sets isError from the
      // absence of .error). Enable failing is a HARD STOP.
      const msg = (e && e.message) || String(e);
      return {
        error: `Email Routing could not be enabled on ${domain}: ${msg}. ` +
          `No forward rules were created — without routing enabled they would never deliver. ` +
          `Check the token has Account > Email Routing Addresses and Zone > Email Routing Rules.`,
        domain,
        zone_id,
        routing_enabled: false,
        rules_created: 0,
        warnings,
      };
    }
  } else if (!apply && routing_enabled !== true) {
    warnings.push("Email Routing is NOT enabled on this zone — applying will enable it (adds MX/SPF) before creating rules.");
  }

  const existingRules = await listRules(client, zone_id);
  const forwards = Array.isArray(cfg.forwards) ? cfg.forwards : [];

  const plan = [];
  for (const fwd of forwards) {
    const existing = existingRules.find((r) => ruleMatches(r, fwd.address));
    // A forward may target an email address (fwd.to) OR a Cloudflare Email Worker
    // (fwd.worker, or fwd.to = "worker:<name>"). Worker rules need no verified
    // destination — they route inbound mail straight into the Worker's email().
    const workerTarget =
      fwd.worker ||
      (typeof fwd.to === "string" && /^worker:/i.test(fwd.to) ? fwd.to.replace(/^worker:/i, "").trim() : null);
    const target = workerTarget || fwd.to;
    const desiredAction = workerTarget
      ? [{ type: "worker", value: [workerTarget] }]
      : [{ type: "forward", value: [fwd.to] }];
    const desiredMatchers = [
      { type: "literal", field: "to", value: fwd.address },
    ];
    const body = {
      name: workerTarget
        ? `Route ${fwd.address} to worker ${workerTarget}`
        : `Forward ${fwd.address} to ${fwd.to}`,
      enabled: true,
      matchers: desiredMatchers,
      actions: desiredAction,
    };

    let action = "create";
    if (existing) {
      const curAction = (existing.actions && existing.actions[0]) || {};
      const curVal =
        Array.isArray(curAction.value) && curAction.value.length === 1 ? curAction.value[0] : null;
      const same = curAction.type === desiredAction[0].type && curVal === desiredAction[0].value[0];
      action = same ? "noop" : "update";
    }

    // Worker destinations are always "verified" — no confirmation email needed.
    const verified = workerTarget ? true : isVerified(fwd.to);
    const item = {
      action,
      address: fwd.address,
      to: target,
      target_type: workerTarget ? "worker" : "forward",
      destinationVerified: verified,
      before: existing || null,
      after: body,
    };
    if (!verified && action !== "noop") {
      const w = destKnown
        ? `Destination ${fwd.to} is NOT verified — Cloudflare keeps the rule disabled until its owner clicks the verification email. Add it with add_email_destination, then have them verify.`
        : `Could not confirm ${fwd.to} is a verified destination (destination list unavailable).`;
      item.warning = w;
      warnings.push(w);
    }

    // Refuse to write a rule to an unverified destination unless forced — it would
    // just create a dead, disabled rule. Verified destinations proceed normally.
    if (apply && action !== "noop") {
      // 2026-08-21: fail CLOSED. Was `destKnown && ...`, so an unreadable
      // destination list silently disabled this mail-safety gate.
      if (!force && (!destKnown || !verified)) {
        item.action = "blocked-unverified";
      } else if (action === "create") {
        const { result } = await client.request(
          "POST",
          `/zones/${zone_id}/email/routing/rules`,
          body
        );
        item.result = result;
      } else {
        const { result } = await client.request(
          "PUT",
          `/zones/${zone_id}/email/routing/rules/${existing.id}`,
          body
        );
        item.result = result;
      }
    }
    plan.push(item);
  }

  // Catch-all (singleton, PUT only).
  let catchAll = null;
  if (cfg.catchAll) {
    const current = await getCatchAll(client, zone_id).catch(() => null);
    const curTo =
      current && current.actions && current.actions[0] && Array.isArray(current.actions[0].value)
        ? current.actions[0].value
        : [];
    const same =
      current &&
      current.enabled &&
      curTo.length === 1 &&
      curTo[0] === cfg.catchAll;
    const body = {
      name: `Catch-all to ${cfg.catchAll}`,
      enabled: true,
      matchers: [{ type: "all" }],
      actions: [{ type: "forward", value: [cfg.catchAll] }],
    };
    const caVerified = isVerified(cfg.catchAll);
    catchAll = {
      action: same ? "noop" : "update",
      to: cfg.catchAll,
      destinationVerified: caVerified,
      before: current || null,
      after: body,
    };
    if (!caVerified && !same) {
      const w = destKnown
        ? `Catch-all destination ${cfg.catchAll} is NOT verified — Cloudflare keeps it disabled until verified.`
        : `Could not confirm catch-all ${cfg.catchAll} is a verified destination.`;
      catchAll.warning = w;
      warnings.push(w);
    }
    if (apply && !same) {
      // 2026-08-21: fail CLOSED (see note above).
      if (!force && (!destKnown || !caVerified)) {
        catchAll.action = "blocked-unverified";
      } else {
        const { result } = await client.request(
          "PUT",
          `/zones/${zone_id}/email/routing/rules/catch_all`,
          body
        );
        catchAll.result = result;
      }
    }
  }

  const changes =
    plan.filter((p) => p.action !== "noop" && p.action !== "blocked-unverified").length +
    (catchAll && catchAll.action !== "noop" && catchAll.action !== "blocked-unverified" ? 1 : 0);

  return {
    apply: Boolean(apply),
    domain,
    zone_id,
    account_id,
    routing_enabled,
    plan,
    catchAll,
    warnings,
    diff: { changes },
  };
}

export default {
  getRoutingStatus,
  enableRouting,
  listDestinations,
  addDestination,
  listRules,
  getCatchAll,
  setupEmailRouting,
};
