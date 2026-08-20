// =============================================================================
//  WALRUS TOOTH (WT) — the empire's content-addressable cache. 🦭
// -----------------------------------------------------------------------------
//  The guard that remembers. Hash any AI input into a KEY; on a repeat, return
//  the cached result by REF instead of re-calling the model. Same content, zero
//  reprocessing — "down the line to finish, never jump back to re-grab."
//
//  key    = SHA-256 fingerprint of the exact input (model + prompt/messages)
//  ref    = the cached value pulled by that key (no recompute)
//  pattern= callers key on the *shape* they care about (query+sources), so
//           equivalent requests collapse to one cached answer.
//
//  Zero-config + PORTABLE: uses the Cloudflare Cache API (caches.default) when
//  present — no binding, no KV, no D1 — and falls back to a bounded in-memory
//  LRU on any other runtime (Vercel / Node serverless, plain Node). So it saves
//  tokens EVERYWHERE it's dropped: Workers, Pages, Vercel, WALO, cards, study,
//  EZ Calorie… just wrap the model call with wtCached().
// =============================================================================

// Fingerprint an input into a stable hex key.
async function wtKey(input) {
  const s = typeof input === 'string' ? input : JSON.stringify(input);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const wtUrl = key => 'https://wt-cache.amh/' + key;
const cfCache = () => (typeof caches !== 'undefined' && caches.default) ? caches.default : null;

// Portable fallback store for runtimes WITHOUT the CF Cache API (Vercel / Node
// serverless, plain Node). Bounded LRU + TTL, per-instance. On a warm lambda
// this still collapses repeat calls; on Cloudflare the edge Cache API is used
// instead (shared across isolates, strictly better). So the tooth saves
// tokens EVERYWHERE it's dropped, not just on Workers.
const _mem = new Map();          // key -> { v, exp }
const MEM_MAX = 500;
function memGet(key) {
  const e = _mem.get(key);
  if (!e) return null;
  if (e.exp && e.exp < Date.now()) { _mem.delete(key); return null; }
  _mem.delete(key); _mem.set(key, e);                 // LRU bump
  return e.v;
}
function memPut(key, value, ttlSec) {
  _mem.set(key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
  if (_mem.size > MEM_MAX) _mem.delete(_mem.keys().next().value);   // evict oldest
}

// Read a cached value by key (null on miss). CF edge cache when present,
// in-memory fallback otherwise — never throws.
async function wtGet(key) {
  const c = cfCache();
  if (!c) return memGet(key);
  try {
    const hit = await c.match(new Request(wtUrl(key)));
    return hit ? await hit.json() : null;
  } catch { return memGet(key); }
}

// Store a value under a key with a TTL (best-effort; never throws).
async function wtPut(key, value, ttlSec = 86400) {
  const c = cfCache();
  if (!c) { memPut(key, value, ttlSec); return; }
  try {
    await c.put(new Request(wtUrl(key)), new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttlSec },
    }));
  } catch { memPut(key, value, ttlSec); }
}

// Single-flight: concurrent requests for the SAME key ride ONE compute, not N.
// In-memory per-isolate — catches the burst case (5 users hit the same query at
// once) with zero infra. The leader runs the model; followers share its promise.
const _inflight = new Map();
function wtCoalesce(key, compute) {
  if (_inflight.has(key)) return { p: _inflight.get(key), joined: true };
  const p = Promise.resolve().then(compute).finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return { p, joined: false };
}

// Wrap a compute (usually a model call). Every return is tagged { _wt, _wtKey }
// so callers SEE which rider caught it — and which ones cost an AI call:
//   'mem'    → REMEMBRANCE: the tooth remembered it (cache hit)     — 0 calls
//   'joined' → rode a Solo Flight already in the air                — 0 calls
//   'solo'   → SOLO FLIGHT: flew the real model call alone          — 1 call
//   'skip'   → no cache present, fail-safe straight-through         — 1 call
async function wtCached(keyInput, compute, { ttlSec = 86400, ok = v => v && v.ok } = {}) {
  let key;
  try { key = await wtKey(keyInput); } catch { return { ...(await compute()), _wt: 'skip' }; }
  const hit = await wtGet(key);
  if (hit) return { ...hit, _wt: 'mem', _wtKey: key.slice(0, 12) };   // remembrance
  const { p, joined } = wtCoalesce(key, compute);   // burst of the same query → one flight
  const val = await p;
  if (!joined && ok(val)) await wtPut(key, val, ttlSec);   // only the solo flyer writes the cache
  return { ...val, _wt: joined ? 'joined' : 'solo', _wtKey: key.slice(0, 12) };
}

// VENDORED into the WT Agent Harness (ESM worker). Canonical CJS home is
// github.com/pain2hustle/walrus-tooth (wt-cache.js). Only change from canonical:
// this export line (module.exports -> ESM export) so the ESM worker can import it.
export { wtKey, wtGet, wtPut, wtCoalesce, wtCached };
