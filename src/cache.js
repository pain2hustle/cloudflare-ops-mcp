// src/cache.js
// Cloudflare cache purge — the one common CF op zonemender didn't cover yet.
//
// Same safety model as the rest of zonemender:
//  - DRY-RUN by DEFAULT. Nothing is purged unless { apply: true } is passed.
//  - The API token lives only in the CloudflareClient (env CLOUDFLARE_API_TOKEN)
//    and is never logged or echoed.
//  - Zone is resolved by name via the CF API; a not-found zone is reported, never
//    guessed.
//
// Purge modes (Cloudflare /zones/{id}/purge_cache):
//  - everything : { purge_everything: true } — the whole zone cache.
//  - files      : specific absolute URLs (max 30 per call).
//  - prefixes   : URL prefixes (Enterprise).
//  - tags       : Cache-Tag values (Enterprise).
// When nothing targeted is given, defaults to purge_everything.

/**
 * Resolve a zone id by exact name. Returns null if the token can't see it.
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain
 * @returns {Promise<string|null>}
 */
export async function resolveCacheZoneId(client, domain) {
  const { result } = await client.request(
    "GET",
    `/zones?name=${encodeURIComponent(String(domain).toLowerCase())}`
  );
  return Array.isArray(result) && result[0] && result[0].id ? result[0].id : null;
}

/**
 * Plan (and optionally apply) a Cloudflare cache purge for a zone.
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain zone name, e.g. "example.com"
 * @param {object} [opts]
 * @param {boolean} [opts.everything] purge the whole zone cache
 * @param {string[]} [opts.files] purge specific absolute URLs (max 30)
 * @param {string[]} [opts.prefixes] purge by URL prefix (Enterprise)
 * @param {string[]} [opts.tags] purge by Cache-Tag (Enterprise)
 * @param {boolean} [opts.apply] actually purge (default: dry-run)
 * @returns {Promise<{action:string, apply:boolean, domain:string, zoneId:(string|null), scope:string, body?:object, result?:any, blocked?:boolean}>}
 */
export async function purgeCache(client, domain, opts = {}) {
  const { everything, files, prefixes, tags, apply = false } = opts;
  if (!domain) throw new Error("purgeCache: domain is required");

  const hasFiles = Array.isArray(files) && files.length > 0;
  const hasPrefixes = Array.isArray(prefixes) && prefixes.length > 0;
  const hasTags = Array.isArray(tags) && tags.length > 0;
  const targeted = hasFiles || hasPrefixes || hasTags;
  const purgeAll = everything === true || !targeted;

  if (hasFiles && files.length > 30) {
    throw new Error("purgeCache: Cloudflare allows at most 30 files per purge call.");
  }

  const zoneId = await resolveCacheZoneId(client, domain);
  if (!zoneId) {
    return { action: "not-found", apply, domain, zoneId: null, scope: "", blocked: true };
  }

  const body = purgeAll
    ? { purge_everything: true }
    : {
        ...(hasFiles ? { files } : {}),
        ...(hasPrefixes ? { prefixes } : {}),
        ...(hasTags ? { tags } : {}),
      };
  const scope = purgeAll
    ? "everything (whole zone)"
    : Object.keys(body)
        .map((k) => `${k} (${body[k].length})`)
        .join(", ");

  // Dry-run: report exactly what WOULD be purged, write nothing.
  if (apply !== true) {
    return { action: "purge", apply: false, domain, zoneId, scope, body };
  }

  const { result } = await client.request("POST", `/zones/${zoneId}/purge_cache`, body);
  return { action: "purge", apply: true, domain, zoneId, scope, body, result };
}

export default purgeCache;
