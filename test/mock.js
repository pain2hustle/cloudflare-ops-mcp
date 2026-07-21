// test/mock.js
// A zero-network mock of the Cloudflare v4 API for tests. Injectable as
// `new CloudflareClient({ token, fetch })`. Records every call for assertions.

function envelope(result, result_info) {
  return {
    success: true,
    errors: [],
    messages: [],
    result,
    ...(result_info ? { result_info } : {}),
  };
}

function errEnvelope(code, message) {
  return { success: false, errors: [{ code, message }], messages: [], result: null };
}

function mkResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-type") return "application/json";
        return null;
      },
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

/**
 * @param {object} [initial]
 * @param {Array} [initial.zones]
 * @param {Array} [initial.dns]
 * @param {object} [initial.routing]
 * @param {Array} [initial.rules]
 * @param {object} [initial.catchAll]
 * @param {Array} [initial.addresses]
 * @param {string} [initial.domain]
 * @returns {{fetch:Function, calls:Array, state:object,
 *            writeCalls:()=>Array}}
 */
export function makeMock(initial = {}) {
  const state = {
    zones:
      initial.zones ||
      [
        {
          id: "zone123",
          name: initial.domain || "example.com",
          status: "active",
          account: { id: "acct1" },
        },
      ],
    dns: (initial.dns || []).map((r, i) => ({
      id: r.id || `rec${i}`,
      ttl: 1,
      proxied: false,
      ...r,
    })),
    routing: initial.routing || { enabled: false, status: "unconfigured", name: initial.domain || "example.com" },
    rules: initial.rules || [],
    catchAll: initial.catchAll || { id: "ca", enabled: false, matchers: [{ type: "all" }], actions: [] },
    addresses: initial.addresses || [],
  };

  const calls = [];
  let idCounter = 5000;

  async function fetch(url, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    const parsed = new URL(url);
    const full = parsed.pathname; // /client/v4/...
    const after = full.replace(/^\/client\/v4/, "");
    const segs = after.split("/").filter(Boolean);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: after, query: parsed.search, body });

    // GET /user/tokens/verify
    if (method === "GET" && after.startsWith("/user/tokens/verify")) {
      return mkResponse(200, envelope({ id: "tok", status: "active" }));
    }

    // GET /zones?name=...
    if (method === "GET" && segs[0] === "zones" && segs.length === 1) {
      const name = parsed.searchParams.get("name");
      const list = name ? state.zones.filter((z) => z.name === name) : state.zones;
      return mkResponse(200, envelope(list, {
        page: 1, per_page: 100, count: list.length, total_count: list.length, total_pages: 1,
      }));
    }

    // /zones/{id}/...
    if (segs[0] === "zones" && segs.length >= 3) {
      const zoneId = segs[1];
      const sub = segs.slice(2);

      // dns_records
      if (sub[0] === "dns_records") {
        if (sub.length === 1 && method === "GET") {
          return mkResponse(200, envelope([...state.dns], {
            page: 1, per_page: 100, count: state.dns.length, total_count: state.dns.length, total_pages: 1,
          }));
        }
        if (sub.length === 1 && method === "POST") {
          const rec = { id: `new${idCounter++}`, ttl: 1, proxied: false, ...body };
          state.dns.push(rec);
          return mkResponse(200, envelope(rec));
        }
        if (sub.length === 2) {
          const rid = sub[1];
          const idx = state.dns.findIndex((r) => r.id === rid);
          if (method === "PATCH") {
            if (idx === -1) return mkResponse(404, errEnvelope(81044, "Record not found"));
            state.dns[idx] = { ...state.dns[idx], ...body };
            return mkResponse(200, envelope(state.dns[idx]));
          }
          if (method === "PUT") {
            if (idx === -1) return mkResponse(404, errEnvelope(81044, "Record not found"));
            state.dns[idx] = { id: rid, ...body };
            return mkResponse(200, envelope(state.dns[idx]));
          }
          if (method === "DELETE") {
            if (idx !== -1) state.dns.splice(idx, 1);
            return mkResponse(200, envelope({ id: rid }));
          }
        }
      }

      // email/routing...
      if (sub[0] === "email" && sub[1] === "routing") {
        const r = sub.slice(2);
        if (r.length === 0 && method === "GET") {
          return mkResponse(200, envelope(state.routing));
        }
        if (r[0] === "enable" && method === "POST") {
          state.routing = { ...state.routing, enabled: true, status: "ready" };
          return mkResponse(200, envelope(state.routing));
        }
        if (r[0] === "rules") {
          if (r[1] === "catch_all") {
            if (method === "GET") return mkResponse(200, envelope(state.catchAll));
            if (method === "PUT") {
              state.catchAll = { id: "ca", ...body };
              return mkResponse(200, envelope(state.catchAll));
            }
          }
          if (r.length === 1 && method === "GET") {
            return mkResponse(200, envelope([...state.rules], {
              page: 1, per_page: 100, count: state.rules.length, total_count: state.rules.length, total_pages: 1,
            }));
          }
          if (r.length === 1 && method === "POST") {
            const rule = { id: `rule${idCounter++}`, ...body };
            state.rules.push(rule);
            return mkResponse(200, envelope(rule));
          }
          if (r.length === 2 && method === "PUT") {
            const idx = state.rules.findIndex((x) => x.id === r[1]);
            if (idx !== -1) state.rules[idx] = { id: r[1], ...body };
            return mkResponse(200, envelope(state.rules[idx] || { id: r[1], ...body }));
          }
        }
      }
    }

    // /accounts/{id}/email/routing/addresses
    if (segs[0] === "accounts" && segs[2] === "email") {
      const acct = segs[1];
      const r = segs.slice(3); // routing/addresses...
      if (r[0] === "routing" && r[1] === "addresses") {
        if (r.length === 2 && method === "GET") {
          return mkResponse(200, envelope([...state.addresses], {
            page: 1, per_page: 100, count: state.addresses.length, total_count: state.addresses.length, total_pages: 1,
          }));
        }
        if (r.length === 2 && method === "POST") {
          const addr = { id: `addr${idCounter++}`, email: body.email, verified: null };
          state.addresses.push(addr);
          return mkResponse(200, envelope(addr));
        }
      }
    }

    return mkResponse(404, errEnvelope(9999, `Unhandled mock route: ${method} ${after}`));
  }

  return {
    fetch,
    calls,
    state,
    // Calls that mutate server state.
    writeCalls() {
      return calls.filter((c) => ["POST", "PUT", "PATCH", "DELETE"].includes(c.method));
    },
  };
}

export default { makeMock };
