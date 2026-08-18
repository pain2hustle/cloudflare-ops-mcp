export const PROCESS_SKILLS = Object.freeze([
  { id: "cfops-safe-deploy", title: "Safe Cloudflare Deploy", purpose: "Preflight, checkpoint, deploy, and prove the public release before calling it live.", folder: "skills/cfops-safe-deploy", lane: "deterministic + operator approval", automatic_for: ["cloudflare_diagnose", "config_compare"] },
  { id: "cfops-live-verify", title: "Live Site Verifier", purpose: "Catch 404s, wrong-app 200s, redirects, broken navigation, and phone/desktop regressions.", folder: "skills/cfops-live-verify", lane: "deterministic; browser when UI matters", automatic_for: ["ui_playwright", "site_health"] },
  { id: "cfops-email-loopback", title: "Email Loopback Verifier", purpose: "Prove outbound send, public MX routing, Worker receipt, and one-use challenge matching.", folder: "skills/cfops-email-loopback", lane: "deterministic", automatic_for: ["mail acceptance test"] },
  { id: "cfops-context-handoff", title: "Context Handoff Keeper", purpose: "Keep compact restorable facts, expire noise, and file reviewed instruction revisions.", folder: "skills/cfops-context-handoff", lane: "all jobs", automatic_for: ["all templates"] },
  { id: "cfops-security-review", title: "Refute-First Security Review", purpose: "Find exploitable flaws and confirm only findings that survive an independent challenge.", folder: "skills/cfops-security-review", lane: "strong model + independent verifier", automatic_for: ["security_review", "data_query_review"] },
  { id: "cfops-mcp-access", title: "Private MCP Access", purpose: "Use fixed Cloudflare connectors and per-user OAuth without sharing an owner token.", folder: "skills/cfops-mcp-access", lane: "OAuth + SafeTry", automatic_for: ["cloudflare_diagnose", "cloudflare_inventory", "data_query_review"] },
  { id: "cfops-google-research", title: "Google Source Research", purpose: "Trace current claims to opened primary sources and run a bounded contrary-evidence dive.", folder: "skills/cfops-google-research", lane: "search/browser + verifier", automatic_for: ["web_research", "secondary_dive", "citation_verify"] },
  { id: "cfops-claude-verifier", title: "Claude Second Opinion", purpose: "Use an operator-configured Claude lane for hard independent verification without exporting hidden context.", folder: "skills/cfops-claude-verifier", lane: "optional user-configured paid provider", automatic_for: ["secondary_dive", "citation_verify", "missed_items", "security_review"] },
  { id: "cfops-pages-deploy", title: "Two-Account Pages Deploy", purpose: "Deploy to Cloudflare Pages across both accounts without the account wall, the wrong-branch preview trap, or a false-green deploy.", folder: "skills/cfops-pages-deploy", lane: "deterministic + operator approval", automatic_for: ["config_compare", "cloudflare_diagnose"] },
  { id: "cfops-landing-guard", title: "Landing Guard & One-Click Restore", purpose: "Stash, log, and one-click-restore live landings so a stray or wrong-project deploy never permanently swipes a site; read canonical_deployment, not latest.", folder: "skills/cfops-landing-guard", lane: "deterministic; canonical_deployment truth", automatic_for: ["site_health", "config_compare"] },
  { id: "cfops-nu-publish", title: "NU Article Publish", purpose: "Publish a genuinely distinct, quality-gated NU article with cross-links, sitemap + IndexNow, and no duplicates.", folder: "skills/cfops-nu-publish", lane: "deterministic + operator approval", automatic_for: ["web_research"] },
  { id: "cfops-mail-send-verify", title: "Mail Send + Self-Verify", purpose: "Send through the mail gateway and self-verify delivery via a Gmail loopback without asking the human to check their inbox.", folder: "skills/cfops-mail-send-verify", lane: "deterministic", automatic_for: ["mail acceptance test"] },
  { id: "cfops-operator-context", title: "Operator Context Map", purpose: "Orient fast on the operator's projects and stack so no job re-hunts already-known facts.", folder: "skills/cfops-operator-context", lane: "all jobs", automatic_for: ["all templates"] },
  { id: "cfops-error-sentinel", title: "Error Sentinel", purpose: "Backstop that periodically looks across the operator's surfaces, informs + investigates on suspicion, and writes the finding + logs into the next-run briefing so the master AI arrives already aware.", folder: "skills/cfops-error-sentinel", lane: "deterministic look; dive when suspicious", automatic_for: ["site_health", "security_review", "mail acceptance test"] },
]);

const BY_TEMPLATE = Object.freeze({
  web_research: ["cfops-google-research", "cfops-nu-publish"],
  secondary_dive: ["cfops-google-research", "cfops-claude-verifier"],
  citation_verify: ["cfops-google-research", "cfops-claude-verifier"],
  ui_playwright: ["cfops-live-verify"],
  site_health: ["cfops-live-verify", "cfops-landing-guard", "cfops-error-sentinel"],
  cloudflare_diagnose: ["cfops-mcp-access", "cfops-safe-deploy", "cfops-pages-deploy"],
  cloudflare_inventory: ["cfops-mcp-access"],
  data_query_review: ["cfops-mcp-access", "cfops-security-review"],
  config_compare: ["cfops-safe-deploy", "cfops-pages-deploy", "cfops-landing-guard"],
  missed_items: ["cfops-claude-verifier"],
  revision_proposal: ["cfops-context-handoff"],
  security_review: ["cfops-security-review", "cfops-claude-verifier"],
  mail_acceptance: ["cfops-mail-send-verify"],
});

export function skillList() {
  return PROCESS_SKILLS.map((skill) => ({ ...skill, automatic_for: [...skill.automatic_for] }));
}

export function skillsForTemplate(templateId) {
  return [...new Set([...(BY_TEMPLATE[templateId] || []), "cfops-context-handoff", "cfops-operator-context"])];
}
