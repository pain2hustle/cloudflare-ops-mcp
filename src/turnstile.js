// src/turnstile.js
// -----------------------------------------------------------------------------
// Auto-create a Cloudflare Turnstile widget (the free bot-check / CAPTCHA killer)
// via the API — so you never touch the dashboard. Returns the sitekey (public,
// goes in your HTML) + secret (server-side verify only).
//
// Turnstile is an ACCOUNT-level resource, so we resolve the account id from the
// domain's zone, then POST /accounts/{account_id}/challenges/widgets.
//
// Dry-run by DEFAULT (shows the plan, creates nothing). Pass { apply:true } to
// actually create it. Never logs the API token; the returned secret IS meant to
// be captured once by the caller (it's the widget key, not the account token).
// -----------------------------------------------------------------------------
import { resolveZone } from "./zone.js";

const VALID_MODES = new Set(["managed", "non-interactive", "invisible"]);

/**
 * Create a Turnstile widget for a domain.
 * @param {object} client CloudflareClient
 * @param {string} domain primary domain the widget runs on
 * @param {object} [opts]
 * @param {string}  [opts.name]         widget name (default "<domain> widget")
 * @param {string}  [opts.mode]         "managed" | "non-interactive" | "invisible"
 * @param {string[]}[opts.extraDomains] additional domains allowed to use the widget
 * @param {boolean} [opts.apply]        false = dry-run (default), true = create
 * @returns {Promise<object>} plan (+ sitekey/secret when applied)
 */
export async function createTurnstileWidget(client, domain, opts = {}) {
  const { name, mode = "managed", extraDomains = [], apply = false } = opts;
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Invalid Turnstile mode '${mode}'. Use: ${[...VALID_MODES].join(", ")}.`);
  }

  const zone = await resolveZone(client, domain);
  const accountId = zone.account_id;
  if (!accountId) {
    throw new Error(`Could not resolve the Cloudflare account for '${domain}' (token may lack Account access).`);
  }

  const widgetName = (name || `${domain} widget`).slice(0, 254);
  const domains = [...new Set([domain, ...extraDomains].filter(Boolean))];

  const plan = {
    action: "create",
    apply,
    account_id: accountId,
    widget: { name: widgetName, domains, mode },
  };

  if (!apply) return { ...plan, applied: false };

  const { result } = await client.request(
    "POST",
    `/accounts/${accountId}/challenges/widgets`,
    { name: widgetName, domains, mode },
  );

  return {
    ...plan,
    applied: true,
    sitekey: result && result.sitekey ? result.sitekey : null, // PUBLIC — put in the HTML widget
    secret: result && result.secret ? result.secret : null,    // SECRET — server-side verify only
    created: result || null,
  };
}
