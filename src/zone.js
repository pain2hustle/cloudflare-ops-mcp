// src/zone.js
// Zone resolution + a full read-only snapshot of a zone's mail/DNS posture.

import { parseDmarc, parseSpf, unquoteTxt } from "./dmarc.js";
import { parseBimi } from "./bimi.js";

/**
 * Resolve a domain name to its Cloudflare zone_id.
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @returns {Promise<string>} zone_id
 * @throws if the domain is not in the account / token not scoped to it
 */
export async function resolveZoneId(client, domain) {
  const { result } = await client.request(
    "GET",
    `/zones?name=${encodeURIComponent(domain)}`
  );
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error(
      `Zone not found for '${domain}'. The domain may not be in this account, or the API token is not scoped to it.`
    );
  }
  return result[0].id;
}

/**
 * Resolve a domain to its full zone summary object (id, name, status, account).
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @returns {Promise<{id:string,name:string,status:string,account_id:string|null}>}
 */
export async function resolveZone(client, domain) {
  const { result } = await client.request(
    "GET",
    `/zones?name=${encodeURIComponent(domain)}`
  );
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error(
      `Zone not found for '${domain}'. The domain may not be in this account, or the API token is not scoped to it.`
    );
  }
  const z = result[0];
  return {
    id: z.id,
    name: z.name,
    status: z.status,
    account_id: z.account && z.account.id ? z.account.id : null,
  };
}

/**
 * Read the Email Routing status for a zone (best-effort; returns null on error
 * so a scan of a zone without routing still succeeds).
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} zoneId
 * @returns {Promise<object|null>}
 */
async function safeRoutingStatus(client, zoneId) {
  try {
    const { result } = await client.request(
      "GET",
      `/zones/${zoneId}/email/routing`
    );
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Produce a full read-only snapshot of a zone: all DNS records plus parsed
 * DMARC / SPF / BIMI and Email Routing status. Writes nothing.
 *
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @returns {Promise<{zone_id:string, name:string, status:string,
 *   account_id:string|null, dns:Array, email_routing:object|null,
 *   dmarc:object|null, spf:object|null, bimi:object|null}>}
 */
export async function scanZone(client, domain) {
  const zone = await resolveZone(client, domain);
  const dns = await client.paginate(`/zones/${zone.id}/dns_records`);

  const norm = (n) => String(n).toLowerCase().replace(/\.$/, "");
  const bare = norm(domain);

  const dmarcRec = dns.find(
    (r) => r.type === "TXT" && norm(r.name) === `_dmarc.${bare}`
  );
  const spfRec = dns.find(
    (r) =>
      r.type === "TXT" &&
      norm(r.name) === bare &&
      /^v=spf1\b/i.test(unquoteTxt(r.content))
  );
  const bimiRec = dns.find(
    (r) => r.type === "TXT" && norm(r.name) === `default._bimi.${bare}`
  );

  const email_routing = await safeRoutingStatus(client, zone.id);

  return {
    zone_id: zone.id,
    name: zone.name,
    status: zone.status,
    account_id: zone.account_id,
    dns,
    email_routing,
    dmarc: dmarcRec
      ? { record: dmarcRec, parsed: parseDmarc(dmarcRec.content) }
      : null,
    spf: spfRec ? { record: spfRec, parsed: parseSpf(spfRec.content) } : null,
    bimi: bimiRec
      ? { record: bimiRec, parsed: parseBimi(bimiRec.content) }
      : null,
  };
}

export default { resolveZoneId, resolveZone, scanZone };
