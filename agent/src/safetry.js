export const SAFETRY_CAPABILITIES = Object.freeze([
  { area: "Account", operations: ["identity", "memberships", "feature availability"], lane: "read" },
  { area: "Workers", operations: ["scripts", "versions", "deployments", "routes", "custom domains", "bindings", "secret names", "tail errors"], lane: "read" },
  { area: "Workers changes", operations: ["deploy exact artifact", "promote exact version", "rollback exact version"], lane: "approval-required" },
  { area: "KV", operations: ["namespaces", "key prefixes", "metadata", "sample values with explicit scope"], lane: "read" },
  { area: "D1", operations: ["databases", "tables", "schema", "migrations", "SELECT and EXPLAIN queries"], lane: "read" },
  { area: "D1 changes", operations: ["reviewed migration", "parameterized write query"], lane: "approval-required" },
  { area: "R2", operations: ["buckets", "object folders and prefixes", "metadata", "lifecycle rules"], lane: "read" },
  { area: "Queues and Workflows", operations: ["inventory", "consumer config", "runs", "failures", "retry state"], lane: "read" },
  { area: "Durable Objects", operations: ["bindings", "migrations", "namespace metadata", "alarm and storage health"], lane: "read" },
  { area: "AI", operations: ["Workers AI bindings", "AI Gateway config", "model allowlist", "usage and failure state"], lane: "read" },
  { area: "Data and network", operations: ["Vectorize", "Hyperdrive", "Browser Run", "Turnstile", "cache", "DNS", "Email Routing"], lane: "read" },
  { area: "Pages", operations: ["projects", "production branch", "builds", "deployments", "custom domains", "environment bindings"], lane: "read" },
  { area: "Dangerous", operations: ["generic shell", "raw wrangler command", "arbitrary SQL", "mass delete", "secret value reads", "unreviewed publish"], lane: "blocked" },
]);

export const SAFETRY_FLOW = Object.freeze([
  "Resolve the authenticated account and exact target",
  "Discover the capability from the live API and current adapter manifest",
  "Validate arguments against a strict schema",
  "Run read-only inspection or generate a dry-run plan",
  "Canonicalize the plan and issue its SHA-256 approval hash",
  "Require approval quoting that exact current hash",
  "Re-run the plan and reject stale hashes",
  "Apply the stored deterministic action once",
  "Verify the result and write a durable receipt",
]);

export const HARD_NO_LIST = Object.freeze([
  "No owner token, OAuth token, connector key, cookie, or secret value in prompts, logs, arguments, or output",
  "No generic shell, raw Wrangler command, arbitrary JavaScript, or model-selected API endpoint",
  "No localhost, private network, custom-port, credentialed, non-HTTPS, or non-allowlisted browsing",
  "No publish, deploy, delete, write query, rollback, cache purge, or configuration mutation without an exact current approval hash",
  "No reuse of an approval after the dry-run plan changes",
  "No factual conclusion without source URLs; unsupported items remain gaps",
  "No automatic promotion of a proposed agent/template revision",
]);

export function landingGuide({ packet, packetHash, memory, memoryHash }) {
  return {
    identity: "Wrangler Craig worker under AMH WT master coordination",
    landing: {
      platform: memory.active_platform,
      repository: memory.repository,
      branch: memory.branch,
      live_target: memory.live_target,
      blocker: memory.current_blocker,
      next_safe_step: memory.next_safe_step,
    },
    job: { template_id: packet.template_id, objective: packet.objective, packet_hash: packetHash, memory_hash: memoryHash },
    scope: { allowed_domains: packet.allowed_domains, urls: packet.urls, limits: packet.limits },
    checks_before_work: SAFETRY_FLOW.slice(0, 4),
    hard_no_list: HARD_NO_LIST,
    must_return: ["packet acknowledgement", "source-linked claims", "gaps", "contradictions", "confidence", "revision proposals"],
  };
}

export function capabilitySummary() {
  return SAFETRY_CAPABILITIES.map((item) => ({ ...item, automatic: item.lane === "read" }));
}
