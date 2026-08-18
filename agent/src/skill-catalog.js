export const PROCESS_SKILLS = Object.freeze([
  { id: "cfops-safe-deploy", title: "Safe Cloudflare Deploy", purpose: "Preflight, checkpoint, deploy, and prove the public release before calling it live.", folder: "skills/cfops-safe-deploy", lane: "deterministic + operator approval", automatic_for: ["cloudflare_diagnose", "config_compare"] },
  { id: "cfops-live-verify", title: "Live Site Verifier", purpose: "Catch 404s, wrong-app 200s, redirects, broken navigation, and phone/desktop regressions.", folder: "skills/cfops-live-verify", lane: "deterministic; browser when UI matters", automatic_for: ["ui_playwright", "site_health"] },
  { id: "cfops-email-loopback", title: "Email Loopback Verifier", purpose: "Prove outbound send, public MX routing, Worker receipt, and one-use challenge matching.", folder: "skills/cfops-email-loopback", lane: "deterministic", automatic_for: ["mail acceptance test"] },
  { id: "cfops-context-handoff", title: "Context Handoff Keeper", purpose: "Keep compact restorable facts, expire noise, and file reviewed instruction revisions.", folder: "skills/cfops-context-handoff", lane: "all jobs", automatic_for: ["all templates"] },
  { id: "cfops-security-review", title: "Refute-First Security Review", purpose: "Find exploitable flaws and confirm only findings that survive an independent challenge.", folder: "skills/cfops-security-review", lane: "strong model + independent verifier", automatic_for: ["security_review", "data_query_review"] },
  { id: "cfops-mcp-access", title: "Private MCP Access", purpose: "Use fixed Cloudflare connectors and per-user OAuth without sharing an owner token.", folder: "skills/cfops-mcp-access", lane: "OAuth + SafeTry", automatic_for: ["cloudflare_diagnose", "cloudflare_inventory", "data_query_review"] },
  { id: "cfops-google-research", title: "Google Source Research", purpose: "Trace current claims to opened primary sources and run a bounded contrary-evidence dive.", folder: "skills/cfops-google-research", lane: "search/browser + verifier", automatic_for: ["web_research", "secondary_dive", "citation_verify"] },
  { id: "cfops-claude-verifier", title: "Claude Second Opinion", purpose: "Use an operator-configured Claude lane for hard independent verification without exporting hidden context.", folder: "skills/cfops-claude-verifier", lane: "optional user-configured paid provider", automatic_for: ["secondary_dive", "citation_verify", "missed_items", "security_review"] },
]);

const BY_TEMPLATE = Object.freeze({
  web_research: ["cfops-google-research"],
  secondary_dive: ["cfops-google-research", "cfops-claude-verifier"],
  citation_verify: ["cfops-google-research", "cfops-claude-verifier"],
  ui_playwright: ["cfops-live-verify"],
  site_health: ["cfops-live-verify"],
  cloudflare_diagnose: ["cfops-mcp-access", "cfops-safe-deploy"],
  cloudflare_inventory: ["cfops-mcp-access"],
  data_query_review: ["cfops-mcp-access", "cfops-security-review"],
  config_compare: ["cfops-safe-deploy"],
  missed_items: ["cfops-claude-verifier"],
  revision_proposal: ["cfops-context-handoff"],
  security_review: ["cfops-security-review", "cfops-claude-verifier"],
});

export function skillList() {
  return PROCESS_SKILLS.map((skill) => ({ ...skill, automatic_for: [...skill.automatic_for] }));
}

export function skillsForTemplate(templateId) {
  return [...new Set([...(BY_TEMPLATE[templateId] || []), "cfops-context-handoff"])];
}
