// src/doctor.js
// Account cartography — answers the questions Cloudflare makes you assemble by
// hand across four dashboard tabs, and that burn multi-account operators:
//
//   who_serves_domain : domain → zone → worker routes / worker custom domains /
//                       Pages projects. "What is ACTUALLY serving this URL?"
//   account_doctor    : what accounts can this token see, does the expected one
//                       match, and do any SAME-NAME Pages projects exist across
//                       accounts (the "decoy project silently eating deploys"
//                       failure mode).
//
// Everything here is READ-ONLY. No apply flag because there is nothing to apply.

async function safeRequest(client, method, path) {
  try {
    return await client.request(method, path);
  } catch (err) {
    return { result: null, error: (err && err.message) || String(err) };
  }
}

/**
 * Resolve what serves a domain: zone, worker routes, worker custom domains,
 * and Pages projects whose attached domains match.
 * @param {import('./client.js').CloudflareClient} client
 * @param {string} domain e.g. "example.com" or "app.example.com"
 * @returns {Promise<object>} report; fields are null/[] when the token can't see them
 */
export async function whoServesDomain(client, domain) {
  if (!domain) throw new Error("whoServesDomain: domain is required");
  const host = String(domain).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // The zone is the registrable tail of the hostname; try the exact host first
  // (it may itself be a zone), then walk up the labels.
  const labels = host.split(".");
  let zone = null;
  for (let i = 0; i < labels.length - 1 && !zone; i++) {
    const candidate = labels.slice(i).join(".");
    const { result } = await safeRequest(client, "GET", `/zones?name=${encodeURIComponent(candidate)}`);
    if (Array.isArray(result) && result[0]) zone = result[0];
  }
  if (!zone) {
    return { domain: host, zone: null, note: "No zone visible to this token matches this domain." };
  }

  const accountId = zone.account && zone.account.id;
  const report = {
    domain: host,
    zone: { id: zone.id, name: zone.name, status: zone.status, account: zone.account || null },
    worker_routes: [],
    worker_custom_domains: [],
    pages_projects: [],
    warnings: [],
  };

  const routes = await safeRequest(client, "GET", `/zones/${zone.id}/workers/routes`);
  if (Array.isArray(routes.result)) {
    report.worker_routes = routes.result.map((r) => ({ pattern: r.pattern, script: r.script || null }));
  } else if (routes.error) {
    report.warnings.push(`workers/routes unreadable: ${routes.error}`);
  }

  if (accountId) {
    const domains = await safeRequest(client, "GET", `/accounts/${accountId}/workers/domains`);
    if (Array.isArray(domains.result)) {
      report.worker_custom_domains = domains.result
        .filter((d) => d.hostname === host || String(d.hostname || "").endsWith(`.${zone.name}`) || d.hostname === zone.name)
        .map((d) => ({ hostname: d.hostname, service: d.service, environment: d.environment }));
    } else if (domains.error) {
      report.warnings.push(`workers/domains unreadable: ${domains.error}`);
    }

    const pages = await safeRequest(client, "GET", `/accounts/${accountId}/pages/projects`);
    if (Array.isArray(pages.result)) {
      report.pages_projects = pages.result
        .filter((p) => (p.domains || []).some((d) => d === host || d === zone.name || String(d).endsWith(`.${zone.name}`)))
        .map((p) => ({ name: p.name, production_branch: p.production_branch, domains: p.domains || [] }));
    } else if (pages.error) {
      report.warnings.push(`pages/projects unreadable: ${pages.error}`);
    }
  }

  const claimants =
    report.worker_routes.length + report.worker_custom_domains.length + report.pages_projects.length;
  if (claimants === 0) report.warnings.push("Nothing claims this domain — it is served by DNS/origin only, or by products this token cannot read.");
  if (claimants > 1) report.warnings.push("MULTIPLE products claim this domain — the winner depends on Cloudflare precedence (custom domains beat routes). Verify which one you meant.");
  return report;
}

/**
 * Diagnose the token/account situation:
 *  - which accounts the token can see
 *  - whether an expected account id is among them (wrong-token detection)
 *  - same-name Pages projects across accounts (decoy detection: a deploy with
 *    the wrong token lands on the same-named project in the WRONG account and
 *    "succeeds" while production never changes)
 * @param {import('./client.js').CloudflareClient} client
 * @param {object} [opts]
 * @param {string} [opts.expected_account_id]
 * @returns {Promise<object>}
 */
export async function accountDoctor(client, opts = {}) {
  const { expected_account_id } = opts;
  // Classic API tokens verify via /user/tokens/verify and list /accounts. OAuth
  // access tokens do NEITHER — that token endpoint is API-token-namespace only,
  // and the granted OAuth scopes (zone.read, dns.write, email-routing.*, …) don't
  // include account enumeration. Probing only those two makes a perfectly healthy
  // OAuth connection look like an "Invalid API Token" with zero accounts. So we
  // ALSO probe the broadly-granted zone.read (GET /zones) and derive both liveness
  // and the visible account set from the zones' own account objects.
  const verify = await safeRequest(client, "GET", "/user/tokens/verify");
  const accounts = await safeRequest(client, "GET", "/accounts?per_page=50");
  const zones = await safeRequest(client, "GET", "/zones?per_page=50");

  const accountMap = new Map();
  if (Array.isArray(accounts.result)) {
    for (const a of accounts.result) accountMap.set(a.id, { id: a.id, name: a.name });
  }
  if (Array.isArray(zones.result)) {
    for (const z of zones.result) {
      const a = z && z.account;
      if (a && a.id && !accountMap.has(a.id)) accountMap.set(a.id, { id: a.id, name: a.name });
    }
  }
  const accountList = [...accountMap.values()];

  const tokenLive =
    (verify.result && verify.result.status === "active") ||
    Array.isArray(zones.result) ||
    Array.isArray(accounts.result);

  const report = {
    token_status: tokenLive
      ? (verify.result && verify.result.status ? verify.result.status : "active (oauth scope)")
      : (verify.error || accounts.error || zones.error || "unknown"),
    accounts_visible: accountList,
    expected_account_id: expected_account_id || null,
    expected_account_visible: expected_account_id
      ? accountList.some((a) => a.id === expected_account_id)
      : null,
    duplicate_pages_projects: [],
    warnings: [],
  };

  if (expected_account_id && !report.expected_account_visible) {
    report.warnings.push(
      "The expected account is NOT visible to this token — deploys and API calls are going somewhere else. This is the classic wrong-token failure."
    );
  }
  if (accountList.length > 1) {
    // Same-name Pages projects across accounts = decoys that silently eat deploys.
    const seen = new Map();
    for (const a of accountList) {
      const pages = await safeRequest(client, "GET", `/accounts/${a.id}/pages/projects`);
      for (const p of Array.isArray(pages.result) ? pages.result : []) {
        const key = String(p.name).toLowerCase();
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key).push({ account: a.name, account_id: a.id, production_branch: p.production_branch });
      }
    }
    for (const [name, where] of seen) {
      if (where.length > 1) report.duplicate_pages_projects.push({ project: name, accounts: where });
    }
    if (report.duplicate_pages_projects.length) {
      report.warnings.push(
        "Same-name Pages project(s) exist in MORE THAN ONE account. A deploy with the wrong token lands on the decoy and reports success while production never updates."
      );
    }
  }
  return report;
}

/**
 * Read a Pages project's production branch so a caller can compare it against
 * the branch it is about to deploy. The classic silent failure: git says
 * `master`, the project says `main`, and every deploy lands on a preview URL.
 * @param {import('./client.js').CloudflareClient} client
 * @param {object} opts
 * @param {string} opts.account_id
 * @param {string} opts.project
 * @param {string} [opts.git_branch] branch the caller intends to deploy; when
 *   given, the report includes an explicit match/mismatch verdict
 * @returns {Promise<object>}
 */
export async function pagesBranchCheck(client, opts = {}) {
  const { account_id, project, git_branch } = opts;
  if (!account_id || !project) throw new Error("pagesBranchCheck: account_id and project are required");
  const { result } = await client.request(
    "GET",
    `/accounts/${encodeURIComponent(account_id)}/pages/projects/${encodeURIComponent(project)}`
  );
  const production_branch = result && result.production_branch;
  const report = {
    project,
    production_branch: production_branch || null,
    domains: (result && result.domains) || [],
    git_branch: git_branch || null,
    verdict: null,
  };
  if (git_branch && production_branch) {
    report.verdict =
      git_branch === production_branch
        ? "match — this deploy will be PRODUCTION"
        : `MISMATCH — deploying "${git_branch}" lands on a PREVIEW; production only builds from "${production_branch}". Pass --branch=${production_branch} or change the project setting.`;
  }
  return report;
}

export default whoServesDomain;
