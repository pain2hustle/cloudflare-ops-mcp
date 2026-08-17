import readline from "node:readline";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const jobs = new Map();
let lastOutput = [];
let dailyUsage = null;
const stages = {
  job_created: [5, "Packet created"], job_enqueued: [8, "Queued"], safety_preflight: [12, "Landing Guide"],
  job_started: [16, "Started"], crawl_start: [22, "Crawler"], crawl_complete: [36, "Sources landed"],
  primary_started: [45, "Primary worker"], primary_completed: [64, "Primary landed"],
  verifier_started: [74, "Verifier"], verifier_completed: [90, "Verifier landed"],
  revision_proposed: [94, "Revision filed"], job_completed: [100, "Done"],
  job_failed: [100, "Failed"], job_cancelled: [100, "Cancelled"],
  site_alert: [96, "OUTAGE"], site_recovered: [96, "Back online"], site_healthy: [96, "Healthy"],
  agent_profile_renamed: [0, "Renamed"],
};

// Operator credentials are optional: without them the watcher is a read-only
// viewer. They never live in Git — env vars or the ignored local-stashes file.
function operatorConfig() {
  const config = {
    url: process.env.HARNESS_URL || "",
    key: process.env.HARNESS_INTERNAL_KEY || "",
    actor: process.env.HARNESS_ACTOR || "private-admin",
  };
  if (!config.url || !config.key) {
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const stash = JSON.parse(readFileSync(path.join(here, "..", "local-stashes", "operator.json"), "utf8"));
      config.url = config.url || stash.url || "";
      config.key = config.key || stash.internal_key || "";
      config.actor = stash.actor || config.actor;
    } catch {}
  }
  return config;
}
const operator = operatorConfig();
const canWrite = !!(operator.url && operator.key);

async function api(method, apiPath, body) {
  const response = await fetch(new URL(apiPath, operator.url), {
    method,
    headers: { "content-type": "application/json", "x-amh-internal-key": operator.key, "x-amh-actor": operator.actor },
    body: body ? JSON.stringify(body) : method === "GET" ? undefined : "{}",
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function extract(line) {
  let envelope;
  try { envelope = JSON.parse(line); } catch { return null; }
  const candidates = [envelope, ...(envelope.logs || []), envelope.message, envelope.event];
  for (const item of candidates) {
    if (!item) continue;
    if (typeof item === "object" && item.service === "amh-wt-agent") return item;
    if (typeof item === "string") {
      try { const parsed = JSON.parse(item); if (parsed.service === "amh-wt-agent") return parsed; } catch {}
    }
  }
  return null;
}

function bar(percent, width = 28) {
  const filled = Math.round((percent / 100) * width);
  return `\x1b[32m${"█".repeat(filled)}\x1b[90m${"░".repeat(width - filled)}\x1b[0m`;
}

function render() {
  process.stdout.write("\x1b[2J\x1b[H");
  console.log("\x1b[1;32mAGENTS RUNNING\x1b[0m");
  console.log("\x1b[90mLive tasks · secrets/IPs are redacted\x1b[0m\n");
  if (dailyUsage) console.log(`\x1b[1;36mToday: ${dailyUsage.used} / ${dailyUsage.limit} AI calls\x1b[0m\n`);
  // Currents at top: running work first, finished/failed sink below.
  const done = new Set(["job_completed", "job_failed", "job_cancelled"]);
  const values = [...jobs.values()].sort((a, b) =>
    (done.has(a.kind) ? 1 : 0) - (done.has(b.kind) ? 1 : 0) || b.updated - a.updated);
  if (!values.length) console.log("\x1b[90mWaiting for agent events…\x1b[0m");
  for (const job of values.slice(0, 14)) {
    const color = job.kind === "job_failed" ? 31 : job.kind === "job_completed" ? 32 : job.kind === "job_cancelled" ? 33 : 36;
    console.log(`\x1b[1;${color}m${job.name}\x1b[0m  ${job.stage}`);
    console.log(`${bar(job.percent)} ${String(job.percent).padStart(3)}%  \x1b[90m${job.id}\x1b[0m`);
    const next = job.percent < 40 ? "Primary next" : job.percent < 70 ? "Verifier next" : job.percent < 100 ? "Master next" : "Landed";
    console.log(`  ${job.stage} → ${next} · ${new Date(job.updated).toLocaleTimeString()}\n`);
    if (job.detail) console.log(`  \x1b[31m${job.detail}\x1b[0m\n`);
  }
  if (lastOutput.length) {
    console.log("\x1b[1;33m──────────\x1b[0m");
    for (const line of lastOutput.slice(0, 24)) console.log(line);
    console.log("");
  }
  if (interactive) {
    const mode = canWrite ? "commands: agents · job <id> · name <agent_id> <new name> · clear · quit" : "read-only (set HARNESS_URL + HARNESS_INTERNAL_KEY or local-stashes/operator.json to enable commands)";
    console.log(`\x1b[90m${mode}\x1b[0m`);
    process.stdout.write("> ");
  } else {
    console.log("\x1b[90mCtrl+C closes this local view; Cloudflare jobs continue unless cancelled.\x1b[0m");
  }
}

function ingest(line) {
  const event = extract(line);
  if (!event?.job_id && event?.kind !== "agent_profile_renamed") return;
  if (event.kind === "agent_profile_renamed") {
    lastOutput = [`\x1b[33mRenamed:\x1b[0m ${event.data?.old_name || "?"} → ${event.data?.agent_name || "?"}`];
    return render();
  }
  if (!stages[event.kind]) return;
  const [percent, stage] = stages[event.kind];
  const current = jobs.get(event.job_id) || {};
  jobs.set(event.job_id, {
    id: event.job_id,
    name: event.data?.agent_name || event.data?.template_id || current.name || "Agent task",
    actor: event.actor || current.actor || "agent",
    detail: event.kind === "site_alert" ? `${event.data?.url || ""} · ${event.data?.detail || "site failed"}` : current.detail,
    percent, stage, kind: event.kind, updated: Date.now(),
  });
  if (event.kind === "job_completed" && Number.isFinite(Number(event.data?.daily_calls))) {
    dailyUsage = { used: Number(event.data.daily_calls), limit: Number(event.data.daily_limit || 0) };
  }
  render();
}

async function runCommand(input) {
  const [command, ...rest] = input.trim().split(/\s+/);
  if (!command) return;
  if (command === "quit" || command === "exit") process.exit(0);
  if (command === "clear") { lastOutput = []; return; }
  if (!canWrite) { lastOutput = ["\x1b[31mNo operator credentials configured — read-only.\x1b[0m"]; return; }
  try {
    if (command === "agents") {
      const dashboard = await api("GET", "/internal/dashboard");
      lastOutput = (dashboard.agent_profiles || []).map((profile) =>
        `\x1b[1m${profile.name}\x1b[0m  \x1b[90m${profile.id}\x1b[0m\n  role: ${profile.role_title || profile.template_id || "?"} · template: ${profile.template_id || "-"} · ${profile.system ? "office manager (permanent, renameable)" : "specialist"}`);
      if (!lastOutput.length) lastOutput = ["No agent profiles yet."];
    } else if (command === "job" && rest[0]) {
      const job = await api("GET", `/internal/jobs/${encodeURIComponent(rest[0])}`);
      const packet = job.packet || {};
      lastOutput = [
        `\x1b[1m${packet.agent_name || "Agent task"}\x1b[0m  ${job.status || "?"}  \x1b[90m${job.id || rest[0]}\x1b[0m`,
        `  template: ${packet.template_id || "?"} · created: ${packet.created_at || "?"}`,
        `  objective: ${(packet.objective || "").slice(0, 140)}`,
        `  domains: ${(packet.allowed_domains || []).join(", ") || "-"} · urls: ${(packet.urls || []).length}`,
        `  limits: ${JSON.stringify(packet.limits || {})}`,
        `  hashes: packet ${String(job.packet_hash || "?").slice(0, 12)}… memory ${String(job.memory_hash || "?").slice(0, 12)}…`,
        `  confidence: ${job.result?.confidence ?? "-"} · claims: ${job.result?.claims?.length ?? 0} · gaps: ${job.result?.gaps?.length ?? 0}`,
      ];
    } else if (command === "name" && rest.length >= 2) {
      const [id, ...nameParts] = rest;
      const result = await api("PATCH", `/internal/agents/${encodeURIComponent(id)}`, { name: nameParts.join(" ") });
      lastOutput = [`\x1b[32mApplied:\x1b[0m now "${result.name || nameParts.join(" ")}" \x1b[90m(logged as agent_profile_renamed)\x1b[0m`];
    } else {
      lastOutput = ["Commands: agents · job <id> · name <agent_id> <new name> · clear · quit"];
    }
  } catch (error) {
    lastOutput = [`\x1b[31m${String(error.message || error).slice(0, 200)}\x1b[0m`];
  }
}

const interactive = process.stdin.isTTY === true;

if (interactive) {
  // Spawn the tail ourselves so the keyboard keeps stdin.
  const tail = spawn("npx", ["wrangler", "tail", "amh-wt-agent-harness", "--format", "json"], {
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  readline.createInterface({ input: tail.stdout, crlfDelay: Infinity }).on("line", ingest);
  tail.on("exit", (code) => { lastOutput = [`\x1b[31mwrangler tail exited (${code}); events stopped, commands still work.\x1b[0m`]; render(); });
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  prompt.on("line", async (line) => { await runCommand(line); render(); });
  prompt.on("close", () => process.exit(0));
} else {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", ingest);
  rl.on("close", () => process.exit(0));
}
render();
