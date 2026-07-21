// src/client.js
// Minimal, zero-dependency Cloudflare v4 REST client.
//
// Safety invariants baked in here:
//  - The API token is read ONLY from process.env.CLOUDFLARE_API_TOKEN (or an
//    explicitly injected value) and is NEVER logged, NEVER embedded in a thrown
//    error message, and NEVER echoed. redactToken() scrubs any token-looking
//    substring defensively.
//  - Every response is parsed through the standard Cloudflare envelope
//    { success, errors, messages, result, result_info } and errors surface as a
//    CloudflareError carrying the CF error code + message (but never the token).

const CF_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Redact anything that looks like a Cloudflare API token from an arbitrary
 * string. Cloudflare tokens are ~40 char [A-Za-z0-9_-] strings; we also scrub
 * an explicitly known token value if one is supplied. Best-effort and defensive
 * so a secret can never leak through an error/log path.
 * @param {string} str
 * @param {string} [known] the actual token value to remove verbatim
 * @returns {string}
 */
export function redactToken(str, known) {
  if (str == null) return str;
  let out = String(str);
  // Only scrub a known token if it is long enough to actually be a secret.
  // Cloudflare API tokens are ~40 chars; guarding against very short values
  // avoids pathologically redacting common substrings (e.g. a token of "t").
  if (known && known.length >= 8) {
    // Escape regex metacharacters in the known token before building the RegExp.
    const esc = known.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "g"), "[REDACTED]");
  }
  // Scrub a Bearer header if it ever appears.
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [REDACTED]");
  // Scrub long token-looking runs (>= 30 chars of the token alphabet).
  out = out.replace(/[A-Za-z0-9_-]{30,}/g, "[REDACTED]");
  return out;
}

export class CloudflareError extends Error {
  /**
   * @param {string} message already-redacted human message
   * @param {object} [opts]
   * @param {number} [opts.code] Cloudflare error code
   * @param {number} [opts.status] HTTP status
   * @param {Array}  [opts.errors] raw CF errors array (redacted)
   */
  constructor(message, { code, status, errors } = {}) {
    super(message);
    this.name = "CloudflareError";
    this.code = code;
    this.status = status;
    this.errors = errors;
  }
}

export class CloudflareClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.token] defaults to process.env.CLOUDFLARE_API_TOKEN
   * @param {Function} [opts.fetch] injectable fetch (defaults to global fetch)
   * @param {string} [opts.baseUrl]
   */
  constructor({ token, fetch: fetchImpl, baseUrl } = {}) {
    // Token: env only by default. Accepting an explicit value is allowed for
    // tests / host apps, but it still lives only in this closure/instance and
    // is never logged.
    this._token =
      token !== undefined ? token : process.env.CLOUDFLARE_API_TOKEN;
    this._fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.baseUrl = baseUrl || CF_BASE;

    if (typeof this._fetch !== "function") {
      throw new Error(
        "No fetch implementation available. Use Node >=18 or inject { fetch }."
      );
    }
  }

  /** Whether a token is present (does not reveal its value). */
  hasToken() {
    return typeof this._token === "string" && this._token.length > 0;
  }

  /**
   * Perform a request against the Cloudflare API and unwrap the envelope.
   * @param {string} method
   * @param {string} path path beginning with '/', may include query string
   * @param {object|null} [body]
   * @returns {Promise<{result:any, result_info:any, messages:any}>}
   */
  async request(method, path, body) {
    if (!this.hasToken()) {
      throw new CloudflareError(
        "Missing Cloudflare API token. Set CLOUDFLARE_API_TOKEN in the environment."
      );
    }

    const url = path.startsWith("http")
      ? path
      : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;

    const headers = { Authorization: `Bearer ${this._token}` };
    const init = { method, headers };
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    let res;
    try {
      // Call fetch as a BARE function (this = undefined). Calling it as a method
      // (this._fetch(...)) makes `this` the client, which the Cloudflare Workers
      // runtime rejects with "Illegal invocation".
      const doFetch = this._fetch;
      res = await doFetch(url, init);
    } catch (err) {
      // Network-level failure: scrub anything that might carry the token.
      throw new CloudflareError(
        redactToken(
          `Network error calling Cloudflare API: ${err && err.message}`,
          this._token
        )
      );
    }

    let payload;
    const text = await res.text();
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new CloudflareError(
        redactToken(
          `Non-JSON response from Cloudflare API (HTTP ${res.status}).`,
          this._token
        ),
        { status: res.status }
      );
    }

    // Always branch on the success boolean, not just the HTTP status.
    if (!payload || payload.success !== true) {
      const errs = Array.isArray(payload && payload.errors)
        ? payload.errors
        : [];
      const first = errs[0] || {};
      const codePart = first.code != null ? ` (code ${first.code})` : "";
      const msg = redactToken(
        `Cloudflare API error${codePart}: ${
          first.message || `HTTP ${res.status}`
        }`,
        this._token
      );
      // Redact each error object's message defensively too.
      const safeErrors = errs.map((e) => ({
        code: e.code,
        message: redactToken(e.message, this._token),
      }));
      throw new CloudflareError(msg, {
        code: first.code,
        status: res.status,
        errors: safeErrors,
      });
    }

    return {
      result: payload.result,
      result_info: payload.result_info,
      messages: payload.messages,
    };
  }

  /**
   * Fetch every page of a paginated list endpoint, following result_info.
   * @param {string} path base path (may already contain query params)
   * @param {object} [opts]
   * @param {number} [opts.perPage=100]
   * @returns {Promise<Array>} concatenated results
   */
  async paginate(path, { perPage = 100 } = {}) {
    const out = [];
    let page = 1;
    // Guard against runaway loops.
    for (let guard = 0; guard < 1000; guard++) {
      const sep = path.includes("?") ? "&" : "?";
      const { result, result_info } = await this.request(
        "GET",
        `${path}${sep}page=${page}&per_page=${perPage}`
      );
      if (Array.isArray(result)) out.push(...result);
      const info = result_info || {};
      const totalPages = info.total_pages || 1;
      if (!info.page || page >= totalPages) break;
      page += 1;
    }
    return out;
  }

  /**
   * Validate the token at startup. Returns { status } on success.
   * Never echoes the token.
   * @returns {Promise<{status:string, id?:string}>}
   */
  async verifyToken() {
    const { result } = await this.request("GET", "/user/tokens/verify");
    return result || {};
  }
}

export default CloudflareClient;
