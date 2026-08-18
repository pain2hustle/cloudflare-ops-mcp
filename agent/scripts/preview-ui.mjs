import http from "node:http";
import { renderConsole } from "../src/ui.js";
import { CAPABILITY_TREE, LEARNING_LOG, MEMORY_SCHEMA, templateList } from "../src/templates.js";
import { capabilitySummary, SAFETRY_FLOW } from "../src/safetry.js";

const port = Number(process.env.PREVIEW_PORT || 8791);
const now = new Date().toISOString();
const dashboard = {
  state: { status: "ready", paused: false, readonly_mode: true, memory: { current_goal: "Land with a verified public handshake", current_blocker: "Correct Cloudflare account login required", next_safe_step: "Deploy preview, scan public URL, then promote" } },
  briefing: { instruction: "Keep active facts; reload detail only when relevant.", memory_hash: "preview-memory-hash" },
  jobs: [
    { id: "preview-health", status: "running", packet_hash: "preview", packet: { agent_name: "Lookout", template_id: "site_health", template_title: "Site health watch", objective: "Verify Bee World landing returns the intended page" }, created_at: now, updated_at: now },
    { id: "preview-done", status: "completed", packet_hash: "preview", packet: { agent_name: "FieldScan", template_id: "missed_items", template_title: "Find what the first pass missed", objective: "Check the release packet for skipped acceptance steps" }, created_at: now, updated_at: now },
  ],
  events: [
    { seq: 2, job_id: "preview-health", kind: "crawl_start", actor: "Lookout", ts: now, data: { url: "https://example.com" } },
    { seq: 1, job_id: "preview-done", kind: "job_completed", actor: "coordinator", ts: now, data: { ai_calls: 2, daily_calls: 3, daily_limit: 8 } },
  ],
  agent_profiles: [
    { id: "office-manager", name: "Jack", kind: "assistant", role_title: "Personal Assistant / Office Manager", description: "Keeps the briefing, watches limits, and delegates bounded work.", system: true },
    { id: "preview-fieldscan", name: "FieldScan", kind: "specialist", role_title: "Find what the first pass missed", description: "Returns only missing, unsupported, contradictory, or stale items.", system: false },
  ],
  revisions: [], schedules: [],
  usage: { model_profile: "free", harness_calls: 3, harness_call_limit: 8, harness_calls_remaining: 5, zero_ai_jobs: 24, resets_at_utc: new Date(Date.now() + 3600000).toISOString() },
  cloudflare_mcp: { servers: [], tools: [] },
  catalog: { templates: templateList(), capability_tree: CAPABILITY_TREE, learning_log: LEARNING_LOG, memory_schema: MEMORY_SCHEMA, capabilities: capabilitySummary(), safety_flow: SAFETRY_FLOW, cloudflare_mcp: [
    { id: "cloudflare_api", name: "Cloudflare API", purpose: "Account configuration and scoped Cloudflare API operations." },
    { id: "workers_builds", name: "Workers Builds", purpose: "Build status, previews, and deployment diagnostics." },
    { id: "observability", name: "Observability", purpose: "Read Worker logs and analytics." },
  ] },
};

function json(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(renderConsole({}));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/session") return json(response, { ok: true, csrf: "preview-csrf", key_window: "local preview" });
  if (request.method === "GET" && url.pathname === "/api/dashboard") return json(response, dashboard);
  if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) return json(response, dashboard.jobs.find((job) => job.id === url.pathname.split("/").pop()) || { error: "Not found" });
  if (request.method === "PATCH" && url.pathname.startsWith("/api/agents/")) return json(response, { ok: true, name: "Preview Rename" });
  if (request.method === "DELETE" && url.pathname.startsWith("/api/agents/")) return json(response, { ok: true, removed: true });
  if (request.method === "POST" && url.pathname === "/api/jobs") return json(response, { ok: true, id: "preview-new" }, 202);
  if (request.method === "POST" && url.pathname.endsWith("/connect") && url.pathname.startsWith("/api/cloudflare-mcp/")) return json(response, { id: "preview", state: "ready", auth_url: null });
  if (request.method === "DELETE" && url.pathname.startsWith("/api/cloudflare-mcp/")) return json(response, { removed: true });
  if (request.method === "POST" && url.pathname === "/api/alerts/test") return json(response, { id: "preview-mail", status: "pending", expires_at: new Date(Date.now() + 600000).toISOString() }, 202);
  if (request.method === "GET" && url.pathname === "/api/alerts/test/preview-mail") return json(response, { id: "preview-mail", status: "confirmed", confirmed_at: new Date().toISOString() });
  return json(response, { error: "Preview route not found" }, 404);
}).listen(port, "127.0.0.1", () => console.log(`AMH WT UI preview: http://127.0.0.1:${port}`));
