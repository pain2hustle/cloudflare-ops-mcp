export const HARNESS_VERSION = "0.1.1";

export const TEMPLATES = Object.freeze({
  web_research: {
    title: "Web research",
    purpose: "Read the supplied pages, extract relevant facts, and return source-linked evidence.",
    tools: ["fetch", "playwright"],
    requiresUrls: true,
    verifier: true,
  },
  secondary_dive: {
    title: "Secondary deep dive",
    purpose: "Inspect only the gaps and weak claims left by a first pass; do not repeat completed work.",
    tools: ["fetch", "playwright"],
    requiresUrls: true,
    verifier: true,
  },
  citation_verify: {
    title: "Citation verification",
    purpose: "Check whether each cited page directly supports its attached claim and report mismatches.",
    tools: ["fetch", "playwright"],
    requiresUrls: true,
    verifier: true,
  },
  ui_playwright: {
    title: "UI and Playwright check",
    purpose: "Open the supplied page, exercise a bounded UI path, and return observations and failures.",
    tools: ["playwright"],
    requiresUrls: true,
    verifier: false,
  },
  site_health: {
    title: "Site health watch",
    purpose: "Check live URLs for HTTP, redirect, TLS, or expected-text failures and emit immediate outage/recovery events without calling an AI model.",
    tools: ["fetch"],
    requiresUrls: true,
    verifier: false,
    deterministic: true,
  },
  cloudflare_diagnose: {
    title: "Cloudflare and Wrangler diagnosis",
    purpose: "Analyze supplied Wrangler/config/log evidence and propose read-only checks and safe next steps.",
    tools: ["reason"],
    requiresUrls: false,
    verifier: true,
  },
  cloudflare_inventory: {
    title: "Wrangler Craig inventory",
    purpose: "Map Workers, Pages, routes, bindings, storage, queues, workflows, AI, and health without changing them.",
    tools: ["cfops_read"],
    requiresUrls: false,
    verifier: true,
  },
  data_query_review: {
    title: "Tables, folders, and query review",
    purpose: "Inspect supplied D1 schema/SELECT output, KV prefixes, or R2 folder metadata and report drift, risk, and safe next checks.",
    tools: ["reason", "cfops_read"],
    requiresUrls: false,
    verifier: true,
  },
  config_compare: {
    title: "Configuration comparison",
    purpose: "Compare current and intended configuration, identify drift, and produce a bounded change plan.",
    tools: ["reason"],
    requiresUrls: false,
    verifier: true,
  },
  missed_items: {
    title: "Find what the first pass missed",
    purpose: "Review an evidence packet and return only missing, unsupported, contradictory, or stale items.",
    tools: ["reason", "fetch", "playwright"],
    requiresUrls: false,
    verifier: true,
  },
  revision_proposal: {
    title: "Agent template revision proposal",
    purpose: "Turn a repeated correction or newly proven method into a reviewable template change without activating it.",
    tools: ["reason"],
    requiresUrls: false,
    verifier: true,
  },
  security_review: {
    title: "Security review",
    purpose: "Read the supplied diff or source pages and report auth bypasses, missing ownership checks, injection paths, and secret exposure as findings with severity, a CWE id where one fits, the exact location, and a concrete exploit scenario. The independent verifier then tries to refute each finding; only findings that survive refutation are reported as confirmed, the rest stay flagged as unproven.",
    tools: ["fetch", "reason"],
    requiresUrls: true,
    verifier: true,
    // Judgment-heavy: needs the paid-k2 lane. On the free lane the small model
    // cannot hold this strict schema and the coordinator rejects its output
    // rather than reporting malformed findings.
    prefersProfile: "paid-k2",
  },
});

export const PERSONAL_ASSISTANT = Object.freeze({
  id: "office-manager",
  name: "Jack",
  kind: "assistant",
  role_title: "Personal Assistant / Office Manager",
  description: "The main desk: keeps the briefing, watches limits, delegates bounded work, and explains which specialist and model lane handled it.",
});

const NAME_POOLS = Object.freeze({
  web_research: ["Scout", "Maya", "Otis", "Juniper", "Atlas", "Nell"],
  secondary_dive: ["Rook", "Priya", "Badger", "Marlow", "Echo", "Tess"],
  citation_verify: ["Quinn", "Sage", "Pepper", "Iris", "Finn", "Mochi"],
  ui_playwright: ["Pixel", "Zoe", "Dash", "Nico", "Puck", "Luma"],
  site_health: ["Lookout", "Rex", "Beacon", "Sunny", "Radar", "Blue"],
  cloudflare_diagnose: ["Craig", "Nova", "Patch", "Ravi", "Bolt", "Ada"],
  cloudflare_inventory: ["Craig", "Ranger", "Maple", "Dex", "Koda", "Rue"],
  data_query_review: ["Tally", "Mina", "Duke", "Cedar", "Sol", "Pip"],
  config_compare: ["Delta", "Remy", "Willow", "Gauge", "Ari", "Bean"],
  missed_items: ["FieldScan", "Sherlock", "Birdie", "Radar", "Lou", "Comet"],
  revision_proposal: ["Editor", "Mae", "Scribe", "Theo", "Basil", "Indie"],
});

export function suggestAgentName(templateId, ordinal = 0) {
  const pool = NAME_POOLS[templateId] || ["Scout", "Riley", "Milo", "Echo"];
  return pool[Math.abs(Number(ordinal) || 0) % pool.length];
}

export const CAPABILITY_TREE = Object.freeze({
  name: "AMH WT MCP Agent",
  role: "A bounded worker that gathers and checks evidence for the master coordinator.",
  version: HARNESS_VERSION,
  can: [
    "Accept a complete versioned job packet and acknowledge its hash",
    "Read allowlisted HTTPS pages with fetch and fall back to Playwright",
    "Use the configured free model lane or an explicitly enabled paid K2 lane for extraction and comparison",
    "Run deterministic site-health checks without spending an AI inference",
    "Return claims, sources, gaps, contradictions, confidence, and a concise summary",
    "Run an independent verifier and one gap-only follow-up when allowed",
    "Run saved templates automatically on a schedule",
    "Write redacted status and audit events to its Durable Object",
    "File a revision proposal with evidence and tests for master review",
  ],
  cannot: [
    "Receive or reveal the owner's Cloudflare API token",
    "Browse localhost, private IP ranges, non-HTTPS URLs, or domains outside the job allowlist",
    "Run a generic shell or arbitrary Wrangler command",
    "Deploy, publish, delete, or mutate Cloudflare without a separate approval receipt",
    "Change its own active instructions or capability version",
    "Treat a model answer as proof without a supporting source",
  ],
  escalates_when: [
    "Instructions conflict or required inputs are missing",
    "A source is blocked, stale, or contradicts another primary source",
    "The output schema fails validation after one retry",
    "A requested action could publish, deploy, delete, spend beyond budget, or expose secrets",
  ],
});

export const LEARNING_LOG = Object.freeze([
  {
    version: HARNESS_VERSION,
    added: "Security review with refute-then-confirm",
    meaning: "The security_review template reports auth/injection/secret findings with severity and CWE, then an independent verifier tries to refute each one; only survivors are confirmed.",
  },
  {
    version: HARNESS_VERSION,
    added: "Versioned transfer contract",
    meaning: "Workers must acknowledge the exact packet hash returned by the master.",
  },
  {
    version: HARNESS_VERSION,
    added: "Gap-only second pass",
    meaning: "A second worker receives missing points instead of repeating the full assignment.",
  },
  {
    version: HARNESS_VERSION,
    added: "Evidence before conclusions",
    meaning: "Every factual claim must name one or more source URLs; unsupported claims stay in gaps.",
  },
  {
    version: HARNESS_VERSION,
    added: "Master-only final output",
    meaning: "Small workers gather and verify; the master decides what is accepted or published.",
  },
]);

export const MEMORY_SCHEMA = Object.freeze({
  id: "amh.wt.memory.v1",
  sections: {
    keep_active: "Verified facts and decisions injected into relevant jobs",
    archive: "Completed or superseded compact facts retained for lookup",
    drop_from_prompt: "Duplicate, expired, or noisy context excluded from normal prompts",
    reload_if_needed: "Artifact and event IDs that can restore detail on demand",
    conflicts: "New and old statements that require master resolution",
    next_safe_step: "One concrete verified continuation point",
  },
  retention: {
    raw_sources_days: 4,
    detailed_results_days: 7,
    ordinary_events_days: 30,
    pressure_policy: "When detail bytes exceed the configured cap, compact the oldest completed records first.",
    never_prompt: ["OAuth tokens", "API keys", "cookies", "secret values", "client IPs"],
  },
});

export function templateList() {
  return Object.entries(TEMPLATES).map(([id, value]) => ({ id, ...value }));
}
