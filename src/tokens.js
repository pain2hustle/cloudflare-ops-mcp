// src/tokens.js
// Scoped-token vending machine — the thing neither Wrangler nor the official
// Cloudflare MCP will ever do. Wrangler CONSUMES tokens; this MINTS them.
//
// The model: the operator grants ONE bootstrap token that has "API Tokens
// Write". Agents then ask this module for a narrow, short-lived token for a
// single job ("DNS writes on example.com for one hour"), run the job, and the
// token expires on its own. Least privilege becomes the default instead of a
// chore, and a leaked task-token is worth almost nothing.
//
// Same safety model as the rest of cloudflare-ops-mcp:
//  - DRY-RUN by DEFAULT. Nothing is minted unless { apply: true } is passed;
//    the dry-run returns the exact policy JSON that WOULD be created.
//  - Mint DOWN, never up: presets are ZONE-scoped. There is deliberately no
//    "mint me a super token" path — an agent that needs more asks the human
//    for a bigger bootstrap token instead.
//  - The minted token value is returned ONCE (Cloudflare never shows it
//    again), flagged as a secret, and is never logged or written to the audit
//    trail. redactToken() in client.js scrubs token-shaped strings from any
//    error path as a second line of defense.

const DEFAULT_TTL_SECONDS = 3600; // 1 hour — long enough for a task, short enough to not matter if leaked
const MAX_TTL_SECONDS = 86400; // 24h hard cap unless confirm_long is passed

/**
 * Zone-scoped presets. Each maps to Cloudflare permission-group NAMES, which
 * are resolved to ids live via the API (ids differ per release; names are the
 * stable contract). A preset that can't resolve every group errors loudly and
 * lists what the API offered — it never guesses.
 */
export const TOKEN_PRESETS = {
  "zone-read": {
    description: "Read-only: inspect zone settings and DNS records.",
    groups: ["Zone Read", "DNS Read"],
  },
  "dns-zone": {
    description: "DNS fixer: read the zone, write DNS records. The bread-and-butter scope for SPF/DMARC/BIMI fixes.",
    groups: ["Zone Read", "DNS Read", "DNS Write"],
  },
  "cache-purge": {
    description: "Cache buster: read the zone, purge its cache.",
    groups: ["Zone Read", "Cache Purge"],
  },
};

/**
 * Fetch and index the live permission-group catalog.
 * @param {import('./client.js').CloudflareClient} client
 * @returns {Promise<Map<string, {id:string, name:string}>>} keyed by lower-cased name
 */
export async function listPermissionGroups(client) {
  const { result } = await client.request("GET", "/user/tokens/permission_groups");
  const map = new Map();
  for (const g of Array.isArray(result) ? result : []) {
    if (g && g.name && g.id) map.set(String(g.name).toLowerCase(), { id: g.id, name: g.name });
  }
  return map;
}

function resolveGroups(catalog, names) {
  const resolved = [];
  const missing = [];
  for (const name of names) {
    const hit = catalog.get(String(name).toLowerCase());
    if (hit) resolved.push({ id: hit.id });
    else missing.push(name);
  }
  return { resolved, missing };
}

async function resolveZone(client, domain) {
  const { result } = await client.request(
    "GET",
    `/zones?name=${encodeURIComponent(String(domain).toLowerCase())}`
  );
  const zone = Array.isArray(result) && result[0] ? result[0] : null;
  return zone ? { id: zone.id, name: zone.name } : null;
}

/**
 * Plan (and optionally apply) minting a scoped, expiring API token for ONE zone.
 *
 * @param {import('./client.js').CloudflareClient} client bootstrap-token client (needs "API Tokens Write")
 * @param {object} opts
 * @param {string} opts.domain zone the token is confined to, e.g. "example.com"
 * @param {string} [opts.preset] one of TOKEN_PRESETS (default "dns-zone")
 * @param {string[]} [opts.extra_groups] additional permission-group NAMES (still zone-scoped)
 * @param {number} [opts.ttl_seconds] lifetime (default 3600, capped at 86400 unless confirm_long)
 * @param {boolean} [opts.confirm_long] required to exceed the 24h cap
 * @param {string} [opts.name] token label shown in the CF dashboard
 * @param {boolean} [opts.apply] actually mint (default: dry-run)
 * @returns {Promise<object>} dry-run: the exact policy; apply: { token_value (ONCE), id, expires_on }
 */
export async function mintScopedToken(client, opts = {}) {
  const {
    domain,
    preset = "dns-zone",
    extra_groups = [],
    ttl_seconds = DEFAULT_TTL_SECONDS,
    confirm_long = false,
    name,
    apply = false,
  } = opts;

  if (!domain) throw new Error("mintScopedToken: domain is required — every minted token is confined to one zone.");
  const presetDef = TOKEN_PRESETS[preset];
  if (!presetDef) {
    throw new Error(
      `mintScopedToken: unknown preset "${preset}". Available: ${Object.keys(TOKEN_PRESETS).join(", ")}. ` +
        "There is deliberately no account-wide or super preset — mint down, never up."
    );
  }

  let ttl = Number(ttl_seconds) > 0 ? Math.floor(Number(ttl_seconds)) : DEFAULT_TTL_SECONDS;
  if (ttl > MAX_TTL_SECONDS && confirm_long !== true) {
    return {
      action: "mint",
      apply: false,
      blocked: true,
      reason: `ttl_seconds ${ttl} exceeds the ${MAX_TTL_SECONDS}s (24h) cap. Pass confirm_long=true if a long-lived token is truly intended.`,
    };
  }

  const zone = await resolveZone(client, domain);
  if (!zone) {
    return { action: "mint", apply: false, blocked: true, reason: `Zone "${domain}" is not visible to the bootstrap token.` };
  }

  const catalog = await listPermissionGroups(client);
  const wanted = [...presetDef.groups, ...extra_groups];
  const { resolved, missing } = resolveGroups(catalog, wanted);
  if (missing.length) {
    return {
      action: "mint",
      apply: false,
      blocked: true,
      reason: `Permission group(s) not found by name: ${missing.join(", ")}.`,
      available_groups: [...catalog.values()].map((g) => g.name).sort(),
    };
  }

  const expiresOn = new Date(Date.now() + ttl * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const body = {
    name: name || `cfops ${preset} ${zone.name} (auto-expires)`,
    policies: [
      {
        effect: "allow",
        resources: { [`com.cloudflare.api.account.zone.${zone.id}`]: "*" },
        permission_groups: resolved,
      },
    ],
    expires_on: expiresOn,
  };

  // Dry-run: show exactly what WOULD be minted, mint nothing.
  if (apply !== true) {
    return { action: "mint", apply: false, domain: zone.name, preset, ttl_seconds: ttl, expires_on: expiresOn, policy: body };
  }

  const { result } = await client.request("POST", "/user/tokens", body);
  return {
    action: "mint",
    apply: true,
    domain: zone.name,
    preset,
    id: result && result.id,
    expires_on: expiresOn,
    // Cloudflare returns the secret exactly once, here. It is NOT logged and
    // NOT audited — hand it to the agent that needed it and let it expire.
    token_value: result && result.value,
    secret: true,
    warning: "This value is shown ONCE. Do not log it. It expires automatically at expires_on.",
  };
}

/**
 * List tokens on the bootstrap token's user — id, name, status, expiry. Never values.
 * @param {import('./client.js').CloudflareClient} client
 * @returns {Promise<Array<{id:string,name:string,status:string,expires_on:(string|null),issued_by_cfops:boolean}>>}
 */
export async function listTokens(client) {
  const { result } = await client.request("GET", "/user/tokens?per_page=50");
  return (Array.isArray(result) ? result : []).map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    expires_on: t.expires_on || null,
    issued_by_cfops: /^cfops /.test(String(t.name || "")),
  }));
}

/**
 * Plan (and optionally apply) revoking a token by id. DRY-RUN by default.
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} tokenId
 * @param {object} [opts]
 * @param {boolean} [opts.apply]
 */
export async function revokeToken(client, tokenId, opts = {}) {
  const { apply = false } = opts;
  if (!tokenId) throw new Error("revokeToken: tokenId is required");
  if (apply !== true) {
    return { action: "revoke", apply: false, id: tokenId };
  }
  const { result } = await client.request("DELETE", `/user/tokens/${encodeURIComponent(tokenId)}`);
  return { action: "revoke", apply: true, id: tokenId, result };
}

export default mintScopedToken;
