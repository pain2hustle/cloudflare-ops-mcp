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
  const { apply = false } = opts;
  let zone_id = opts.zoneId;
  if (!zone_id) {
    const z = await resolveZone(client, domain);
    zone_id = z.id;
  }

  const existingRules = await listRules(client, zone_id);
  const forwards = Array.isArray(cfg.forwards) ? cfg.forwards : [];

  const plan = [];
  for (const fwd of forwards) {
    const existing = existingRules.find((r) => ruleMatches(r, fwd.address));
    const desiredAction = [{ type: "forward", value: [fwd.to] }];
    const desiredMatchers = [
      { type: "literal", field: "to", value: fwd.address },
    ];
    const body = {
      name: `Forward ${fwd.address} to ${fwd.to}`,
      enabled: true,
      matchers: desiredMatchers,
      actions: desiredAction,
    };

    let action = "create";
    if (existing) {
      const curTo =
        existing.actions &&
        existing.actions[0] &&
        Array.isArray(existing.actions[0].value)
          ? existing.actions[0].value
          : [];
      const same = curTo.length === 1 && curTo[0] === fwd.to;
      action = same ? "noop" : "update";
    }

    const item = {
      action,
      address: fwd.address,
      to: fwd.to,
      before: existing || null,
      after: body,
    };

    if (apply && action !== "noop") {
      if (action === "create") {
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
    catchAll = {
      action: same ? "noop" : "update",
      to: cfg.catchAll,
      before: current || null,
      after: body,
    };
    if (apply && !same) {
      const { result } = await client.request(
        "PUT",
        `/zones/${zone_id}/email/routing/rules/catch_all`,
        body
      );
      catchAll.result = result;
    }
  }

  const changes =
    plan.filter((p) => p.action !== "noop").length +
    (catchAll && catchAll.action !== "noop" ? 1 : 0);

  return {
    apply: Boolean(apply),
    domain,
    zone_id,
    plan,
    catchAll,
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
