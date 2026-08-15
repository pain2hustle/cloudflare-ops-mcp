// test/doctor.test.js
// Cartography contract: who_serves_domain walks hostname → zone and reports
// every claimant; account_doctor catches the wrong-token and decoy-project
// failure modes. All read-only — zero writes, ever.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudflareClient } from "../src/client.js";
import { whoServesDomain, accountDoctor, pagesBranchCheck } from "../src/doctor.js";

function makeFetch(routes) {
  const calls = [];
  async function fetchImpl(url, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    calls.push({ url: String(url), method });
    const u = String(url);
    const hit = routes.find((r) => u.includes(r.match));
    const result = hit ? hit.result : [];
    return {
      status: 200,
      ok: true,
      headers: { get: (n) => (String(n).toLowerCase() === "content-type" ? "application/json" : null) },
      async text() {
        return JSON.stringify({ success: true, errors: [], messages: [], result });
      },
    };
  }
  fetchImpl.calls = calls;
  fetchImpl.writes = () => calls.filter((c) => c.method !== "GET");
  return fetchImpl;
}

const client = (f) => new CloudflareClient({ token: "t-read-only-token", fetch: f });

test("whoServesDomain walks up labels to the zone and reports all claimants", async () => {
  const f = makeFetch([
    { match: "/zones?name=app.example.com", result: [] },
    {
      match: "/zones?name=example.com",
      result: [{ id: "z1", name: "example.com", status: "active", account: { id: "a1", name: "Acct" } }],
    },
    { match: "/zones/z1/workers/routes", result: [{ pattern: "app.example.com/*", script: "app-worker" }] },
    {
      match: "/accounts/a1/workers/domains",
      result: [{ hostname: "app.example.com", service: "app-worker", environment: "production" }],
    },
    {
      match: "/accounts/a1/pages/projects",
      result: [{ name: "app-pages", production_branch: "main", domains: ["app.example.com"] }],
    },
  ]);
  const out = await whoServesDomain(client(f), "https://app.example.com/x");
  assert.equal(out.zone.id, "z1");
  assert.equal(out.worker_routes.length, 1);
  assert.equal(out.worker_custom_domains.length, 1);
  assert.equal(out.pages_projects.length, 1);
  assert.ok(out.warnings.some((w) => /MULTIPLE products/.test(w)));
  assert.equal(f.writes().length, 0);
});

test("whoServesDomain reports an invisible zone instead of guessing", async () => {
  const f = makeFetch([]);
  const out = await whoServesDomain(client(f), "ghost.example");
  assert.equal(out.zone, null);
  assert.match(out.note, /No zone visible/);
});

test("accountDoctor flags a missing expected account and same-name Pages decoys", async () => {
  const f = makeFetch([
    { match: "/user/tokens/verify", result: { status: "active" } },
    {
      match: "/accounts?",
      result: [
        { id: "acct-real", name: "Real" },
        { id: "acct-decoy", name: "Decoy" },
      ],
    },
    { match: "/accounts/acct-real/pages/projects", result: [{ name: "my-site", production_branch: "main" }] },
    { match: "/accounts/acct-decoy/pages/projects", result: [{ name: "my-site", production_branch: "main" }] },
  ]);
  const out = await accountDoctor(client(f), { expected_account_id: "acct-elsewhere" });
  assert.equal(out.expected_account_visible, false);
  assert.ok(out.warnings.some((w) => /wrong-token/.test(w)));
  assert.equal(out.duplicate_pages_projects.length, 1);
  assert.equal(out.duplicate_pages_projects[0].project, "my-site");
  assert.ok(out.warnings.some((w) => /decoy/.test(w)));
  assert.equal(f.writes().length, 0);
});

test("pagesBranchCheck gives an explicit mismatch verdict", async () => {
  const f = makeFetch([
    {
      match: "/accounts/a1/pages/projects/my-site",
      result: { production_branch: "main", domains: ["example.com"] },
    },
  ]);
  const out = await pagesBranchCheck(client(f), { account_id: "a1", project: "my-site", git_branch: "master" });
  assert.match(out.verdict, /MISMATCH/);
  assert.match(out.verdict, /--branch=main/);
  const ok = await pagesBranchCheck(client(f), { account_id: "a1", project: "my-site", git_branch: "main" });
  assert.match(ok.verdict, /PRODUCTION/);
});
