import { Agent } from "agents";
import { crawlSources } from "./crawler.js";
import { cleanText, normalizePacket, sha256 } from "./contracts.js";
import { runModel } from "./model.js";
import { PERSONAL_ASSISTANT, TEMPLATES, suggestAgentName } from "./templates.js";
import { landingGuide } from "./safetry.js";
import { auditDigest } from "./crypto.js";

const DEFAULT_MEMORY = Object.freeze({
  active_platform: "Cloudflare Workers",
  repository: "pain2hustle/cloudflare-ops-mcp",
  branch: "main",
  live_target: "cfops.nothingunseen.com",
  current_goal: "Deploy the OAuth-first MCP and guarded agent harness",
  current_blocker: "Authenticate Wrangler to the Cloudflare account that owns nothingunseen.com",
  last_verified: null,
  keep_active: ["Cloudflare is the active deployment platform", "Writes remain approval-gated"],
  archive: [],
  drop_from_prompt: [],
  reload_if_needed: [],
  conflicts: [],
  next_safe_step: "Verify the correct Cloudflare account, then deploy and smoke test",
  updated_at: null,
});

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function redact(value) {
  const secretKey = /token|secret|password|authorization|cookie|api[_-]?key/i;
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? "[REDACTED]" : redact(item)]));
}

function rowList(cursor) {
  return [...cursor].map((row) => ({ ...row }));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export class Coordinator extends Agent {
  initialState = {
    status: "ready",
    paused: false,
    readonly_mode: true,
    active_job_id: null,
    stop_requested_jobs: [],
    job_count: 0,
    last_event_at: null,
    memory: { ...DEFAULT_MEMORY },
  };

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      packet_json TEXT NOT NULL,
      packet_hash TEXT NOT NULL,
      memory_hash TEXT NOT NULL,
      sources_json TEXT,
      primary_json TEXT,
      verifier_json TEXT,
      compact_json TEXT,
      primary_model TEXT,
      verifier_model TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      ts INTEGER NOT NULL,
      actor TEXT NOT NULL,
      kind TEXT NOT NULL,
      data_json TEXT NOT NULL,
      prev_hash TEXT,
      event_hash TEXT NOT NULL
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS revisions (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      proposal_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS template_schedules (
      id TEXT PRIMARY KEY,
      agent_schedule_id TEXT NOT NULL,
      every_minutes INTEGER NOT NULL,
      packet_json TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      last_run_at INTEGER,
      created_at INTEGER NOT NULL
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS agent_versions (
      version TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      total_jobs INTEGER NOT NULL DEFAULT 0,
      completed_jobs INTEGER NOT NULL DEFAULT 0,
      failed_jobs INTEGER NOT NULL DEFAULT 0,
      verifier_runs INTEGER NOT NULL DEFAULT 0,
      confidence_sum REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS agent_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      template_id TEXT,
      role_title TEXT NOT NULL,
      description TEXT,
      system INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS monitor_states (
      url TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      status_code INTEGER,
      detail TEXT,
      first_seen_at INTEGER NOT NULL,
      changed_at INTEGER NOT NULL,
      checked_at INTEGER NOT NULL,
      last_alert_at INTEGER
    )`;
    const manifest = {
      version: "0.1.0",
      primary_model: this.env.PRIMARY_MODEL,
      fallback_model: this.env.FALLBACK_MODEL,
      model_profile: this.env.MODEL_PROFILE || "free",
      free_primary_model: this.env.FREE_PRIMARY_MODEL,
      free_verifier_model: this.env.FREE_VERIFIER_MODEL,
      max_urls: Number(this.env.MAX_URLS || 4),
      max_source_chars: Number(this.env.MAX_SOURCE_CHARS || 6000),
      max_auto_followups: Number(this.env.MAX_AUTO_FOLLOWUPS || 1),
      retention: { source_days: Number(this.env.RETAIN_SOURCE_DAYS || 4), detail_days: Number(this.env.RETAIN_DETAIL_DAYS || 7), event_days: Number(this.env.RETAIN_EVENT_DAYS || 30), max_detail_bytes: Number(this.env.MAX_DETAIL_BYTES || 5242880) },
      safety: "SafeTry named adapters; read-only default; no generic shell; hashed approvals required for future mutations",
    };
    this.sql`INSERT OR IGNORE INTO agent_versions (version,status,manifest_json,created_at) VALUES (${"0.1.0"},${"active"},${JSON.stringify(manifest)},${Date.now()})`;
    this.sql`INSERT OR IGNORE INTO agent_profiles (id,name,kind,template_id,role_title,description,system,active,created_at,updated_at)
      VALUES (${PERSONAL_ASSISTANT.id},${PERSONAL_ASSISTANT.name},${PERSONAL_ASSISTANT.kind},${null},${PERSONAL_ASSISTANT.role_title},${PERSONAL_ASSISTANT.description},${1},${1},${Date.now()},${Date.now()})`;
    if (!this.state.memory.updated_at) {
      this.setState({ ...this.state, memory: { ...DEFAULT_MEMORY, updated_at: new Date().toISOString() } });
    }
    await this.scheduleEvery(86400, "retentionSweep", {});
  }

  async log(jobId, kind, data = {}, actor = "coordinator") {
    const ts = Date.now();
    const safeObject = redact(data);
    const safe = JSON.stringify(safeObject).slice(0, 24000);
    const previous = rowList(this.sql`SELECT event_hash FROM events ORDER BY seq DESC LIMIT 1`)[0]?.event_hash || null;
    const eventHash = await auditDigest(this.env.AUDIT_HMAC_KEY, JSON.stringify({ job_id: jobId || null, ts, actor, kind, data: safeObject, prev_hash: previous }));
    this.sql`INSERT INTO events (job_id, ts, actor, kind, data_json, prev_hash, event_hash) VALUES (${jobId || null}, ${ts}, ${actor}, ${kind}, ${safe}, ${previous}, ${eventHash})`;
    console.log(JSON.stringify({ service: "amh-wt-agent", job_id: jobId || null, actor, kind, data: safeObject, event_hash: eventHash }));
    this.setState({ ...this.state, last_event_at: new Date(ts).toISOString() });
  }

  async updateMemory(patch, actor = "master") {
    const allowed = ["active_platform", "repository", "branch", "live_target", "current_goal", "current_blocker", "last_verified", "keep_active", "archive", "drop_from_prompt", "reload_if_needed", "conflicts", "next_safe_step"];
    const next = { ...this.state.memory };
    for (const key of allowed) {
      if (!(key in (patch || {}))) continue;
      const value = patch[key];
      next[key] = Array.isArray(value) ? value.map((item) => cleanText(item, 600)).slice(0, 30) : cleanText(value, 1200) || null;
    }
    next.updated_at = new Date().toISOString();
    this.setState({ ...this.state, memory: next });
    await this.log(null, "memory_compacted", { changed_fields: Object.keys(patch || {}).filter((key) => allowed.includes(key)) }, actor);
    return { memory: next, memory_hash: await sha256(next) };
  }

  async getBriefing() {
    const memory = this.state.memory;
    return {
      memory,
      memory_hash: await sha256(memory),
      instruction: "Keep active facts in the prompt. Archive completed detail. Reload artifact IDs only when relevant. Newer facts supersede conflicts.",
    };
  }

  async resolveAgentProfile(input = {}) {
    const templateId = cleanText(input.template_id, 60) || "web_research";
    const requested = cleanText(input.agent_name, 80);
    if (!requested) {
      const existing = rowList(this.sql`SELECT * FROM agent_profiles WHERE active=1 AND kind=${"specialist"} AND template_id=${templateId} ORDER BY updated_at DESC LIMIT 1`)[0];
      if (existing) return this.profileRow(existing);
    }
    const name = requested || suggestAgentName(templateId, this.state.job_count);
    if (requested) {
      const existing = rowList(this.sql`SELECT * FROM agent_profiles WHERE active=1 AND kind=${"specialist"} AND template_id=${templateId} AND lower(name)=lower(${name}) LIMIT 1`)[0];
      if (existing) return this.profileRow(existing);
    }
    const template = TEMPLATES[templateId];
    if (!template) throw new Error(`Unknown template: ${templateId}`);
    const id = crypto.randomUUID();
    const now = Date.now();
    this.sql`INSERT INTO agent_profiles (id,name,kind,template_id,role_title,description,system,active,created_at,updated_at)
      VALUES (${id},${name},${"specialist"},${templateId},${template.title},${template.purpose},${0},${1},${now},${now})`;
    await this.log(null, "agent_profile_created", { agent_profile_id: id, agent_name: name, template_id: templateId, role_title: template.title }, "office_manager");
    return { id, name, kind: "specialist", template_id: templateId, role_title: template.title, description: template.purpose, system: false, active: true };
  }

  profileRow(row) {
    return {
      id: row.id, name: row.name, kind: row.kind, template_id: row.template_id,
      role_title: row.role_title, description: row.description, system: !!row.system, active: !!row.active,
      created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString(),
    };
  }

  async listAgentProfiles() {
    return rowList(this.sql`SELECT * FROM agent_profiles WHERE active=1 ORDER BY system DESC, updated_at DESC`).map((row) => this.profileRow(row));
  }

  async renameAgentProfile(id, name, actor = "console") {
    const nextName = cleanText(name, 80);
    if (nextName.length < 2) throw new Error("Agent name must be at least 2 characters");
    const row = rowList(this.sql`SELECT * FROM agent_profiles WHERE id=${id} AND active=1 LIMIT 1`)[0];
    if (!row) throw new Error("Agent profile not found");
    this.sql`UPDATE agent_profiles SET name=${nextName}, updated_at=${Date.now()} WHERE id=${id}`;
    await this.log(null, "agent_profile_renamed", { agent_profile_id: id, old_name: row.name, agent_name: nextName, role_title: row.role_title }, actor);
    return { ...this.profileRow({ ...row, name: nextName, updated_at: Date.now() }), history_note: "Existing job packets and audit events keep the name used when they ran." };
  }

  async removeAgentProfile(id, actor = "console") {
    const row = rowList(this.sql`SELECT * FROM agent_profiles WHERE id=${id} AND active=1 LIMIT 1`)[0];
    if (!row) return { id, removed: false };
    if (row.system) throw new Error("The office-manager profile is permanent, but you can rename it");
    this.sql`UPDATE agent_profiles SET active=${0}, updated_at=${Date.now()} WHERE id=${id}`;
    await this.log(null, "agent_profile_removed", { agent_profile_id: id, agent_name: row.name, role_title: row.role_title }, actor);
    return { id, removed: true };
  }

  async createJob(input, actor = "master") {
    const profile = await this.resolveAgentProfile(input);
    const packet = normalizePacket({ ...input, agent_name: profile.name }, this.env);
    packet.agent_profile_id = profile.id;
    const packetHash = await sha256(packet);
    const memoryHash = await sha256(this.state.memory);
    const id = crypto.randomUUID();
    const now = Date.now();
    this.sql`INSERT INTO jobs (id,status,packet_json,packet_hash,memory_hash,created_at,updated_at)
      VALUES (${id}, ${"queued"}, ${JSON.stringify(packet)}, ${packetHash}, ${memoryHash}, ${now}, ${now})`;
    this.sql`UPDATE agent_versions SET total_jobs=total_jobs+1 WHERE version=${"0.1.0"}`;
    await this.log(id, "job_created", { packet_hash: packetHash, memory_hash: memoryHash, template_id: packet.template_id, template_title: packet.template_title, agent_profile_id: profile.id, agent_name: packet.agent_name }, actor);
    this.setState({ ...this.state, job_count: this.state.job_count + 1 });
    if (packet.schedule.enabled) await this.putSchedule({ packet, every_minutes: packet.schedule.every_minutes }, actor);
    return { id, status: "queued", packet_hash: packetHash, memory_hash: memoryHash };
  }

  async enqueueJob(input, actor = "master") {
    if (this.state.paused) throw new Error("The coordinator is paused");
    const job = await this.createJob(input, actor);
    await this.schedule(0, "runQueuedJob", { job_id: job.id });
    await this.log(job.id, "job_enqueued", { automatic: true }, actor);
    return { ...job, automatic: true };
  }

  async runQueuedJob(payload) {
    return this.runJob(payload.job_id, "scheduler");
  }

  async runJob(id, actor = "master") {
    if (this.state.paused) throw new Error("The coordinator is paused");
    if (this.state.active_job_id && this.state.active_job_id !== id) throw new Error(`Another job is active: ${this.state.active_job_id}`);
    const rows = rowList(this.sql`SELECT * FROM jobs WHERE id = ${id} LIMIT 1`);
    if (!rows.length) throw new Error("Job not found");
    if (["running", "completed"].includes(rows[0].status)) return this.getJob(id);
    const packet = parseJson(rows[0].packet_json, {});
    const utcStart = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const modelCalls = Number(rowList(this.sql`SELECT COUNT(*) AS count FROM events WHERE ts>=${utcStart} AND kind IN (${"primary_started"},${"verifier_started"})`)[0]?.count || 0);
    const neededCalls = TEMPLATES[packet.template_id]?.deterministic ? 0 : (TEMPLATES[packet.template_id]?.verifier ? 2 : 1);
    const dailyLimit = Math.max(1, Math.min(Number(this.env.MAX_DAILY_MODEL_CALLS || 8), 100));
    if (modelCalls + neededCalls > dailyLimit) throw new Error(`Daily model-call safety budget reached (${modelCalls}/${dailyLimit})`);
    const memory = this.state.memory;
    const memoryHash = await sha256(memory);
    const guide = landingGuide({ packet, packetHash: rows[0].packet_hash, memory, memoryHash });
    const now = Date.now();
    this.sql`UPDATE jobs SET status=${"running"}, memory_hash=${memoryHash}, updated_at=${now}, error=${null} WHERE id=${id}`;
    this.setState({ ...this.state, status: "running", active_job_id: id });
    await this.log(id, "safety_preflight", guide, "landing_guide");
    await this.log(id, "job_started", { packet_hash: rows[0].packet_hash, memory_hash: memoryHash }, actor);
    try {
      return await this.keepAliveWhile(async () => {
        this.assertNotStopped(id);
        const sources = await crawlSources(this.env, packet, (kind, data) => this.log(id, kind, data, "crawler"));
        this.assertNotStopped(id);
        this.sql`UPDATE jobs SET sources_json=${JSON.stringify(sources)}, updated_at=${Date.now()} WHERE id=${id}`;
        if (TEMPLATES[packet.template_id]?.deterministic) return this.completeHealthJob(id, packet, sources);
        await this.log(id, "primary_started", { model_profile: this.env.MODEL_PROFILE || "free" }, "primary");
        const primary = await runModel(this.env, { packet, packetHash: rows[0].packet_hash, memoryHash, memory, sources, mode: "primary" });
        this.sql`UPDATE jobs SET primary_json=${JSON.stringify(primary.result)}, primary_model=${primary.model}, updated_at=${Date.now()} WHERE id=${id}`;
        await this.log(id, "primary_completed", { model: primary.model, claims: primary.result.claims.length, gaps: primary.result.gaps.length }, "primary");
        let verifier = null;
        if (TEMPLATES[packet.template_id]?.verifier) {
          this.assertNotStopped(id);
          await this.log(id, "verifier_started", { independent: true }, "verifier");
          verifier = await runModel(this.env, { packet, packetHash: rows[0].packet_hash, memoryHash, memory, sources, mode: "verify" });
          this.sql`UPDATE jobs SET verifier_json=${JSON.stringify(verifier.result)}, verifier_model=${verifier.model}, updated_at=${Date.now()} WHERE id=${id}`;
          await this.log(id, "verifier_completed", { model: verifier.model, claims: verifier.result.claims.length, gaps: verifier.result.gaps.length }, "verifier");
        }
        for (const proposal of [...(primary.result.proposed_revisions || []), ...(verifier?.result?.proposed_revisions || [])]) {
          const revisionId = crypto.randomUUID();
          this.sql`INSERT INTO revisions (id,job_id,status,proposal_json,created_at) VALUES (${revisionId},${id},${"proposed"},${JSON.stringify(proposal)},${Date.now()})`;
          await this.log(id, "revision_proposed", { revision_id: revisionId, title: proposal.title }, "worker");
        }
        const compact = {
          objective: packet.objective,
          template_id: packet.template_id,
          source_urls: sources.map((source) => source.url),
          primary: { summary: primary.result.summary, claims: primary.result.claims, gaps: primary.result.gaps, contradictions: primary.result.contradictions, confidence: primary.result.confidence },
          verifier: verifier ? { summary: verifier.result.summary, claims: verifier.result.claims, gaps: verifier.result.gaps, contradictions: verifier.result.contradictions, confidence: verifier.result.confidence } : null,
        };
        this.sql`UPDATE jobs SET status=${"completed"}, compact_json=${JSON.stringify(compact)}, updated_at=${Date.now()} WHERE id=${id}`;
        this.sql`UPDATE agent_versions SET completed_jobs=completed_jobs+1, verifier_runs=verifier_runs+${verifier ? 1 : 0}, confidence_sum=confidence_sum+${Number(primary.result.confidence || 0)} WHERE version=${"0.1.0"}`;
        await this.log(id, "job_completed", { verifier: !!verifier }, "coordinator");
        this.setState({ ...this.state, status: "ready", active_job_id: null });
        return this.getJob(id);
      });
    } catch (error) {
      const safe = cleanText(error?.message || error, 1200);
      const stopped = safe === "STOP_REQUESTED";
      this.sql`UPDATE jobs SET status=${stopped ? "cancelled" : "failed"}, error=${stopped ? null : safe}, updated_at=${Date.now()} WHERE id=${id}`;
      if (!stopped) this.sql`UPDATE agent_versions SET failed_jobs=failed_jobs+1 WHERE version=${"0.1.0"}`;
      await this.log(id, stopped ? "job_cancelled" : "job_failed", stopped ? {} : { error: safe }, "coordinator");
      this.setState({ ...this.state, status: "ready", active_job_id: null, stop_requested_jobs: this.state.stop_requested_jobs.filter((item) => item !== id) });
      if (stopped) return this.getJob(id);
      throw new Error(safe);
    }
  }

  async getJob(id) {
    const rows = rowList(this.sql`SELECT * FROM jobs WHERE id = ${id} LIMIT 1`);
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: row.id, status: row.status, packet_hash: row.packet_hash, memory_hash: row.memory_hash,
      packet: parseJson(row.packet_json, {}), sources: parseJson(row.sources_json, []),
      primary: parseJson(row.primary_json), verifier: parseJson(row.verifier_json),
      compact: parseJson(row.compact_json),
      primary_model: row.primary_model, verifier_model: row.verifier_model, error: row.error,
      created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString(),
      events: await this.getEvents(id),
    };
  }

  async completeHealthJob(id, packet, sources) {
    const now = Date.now();
    const checks = [];
    for (const source of sources) {
      const textMatch = !packet.expected_text || String(source.text || "").toLowerCase().includes(packet.expected_text.toLowerCase());
      const healthy = !!source.ok && Number(source.status) >= 200 && Number(source.status) < 300 && textMatch;
      const detail = healthy ? "HTTP reachable" : (source.error || (!textMatch ? `Expected text not found: ${packet.expected_text}` : `Unexpected status ${source.status || "unknown"}`));
      const previous = rowList(this.sql`SELECT * FROM monitor_states WHERE url=${source.url} LIMIT 1`)[0];
      const nextState = healthy ? "up" : "down";
      const changed = !previous || previous.state !== nextState;
      const reminderDue = !healthy && previous && now - Number(previous.last_alert_at || 0) >= 86400000;
      const firstSeen = changed ? now : Number(previous?.first_seen_at || now);
      if (previous) {
        this.sql`UPDATE monitor_states SET state=${nextState}, status_code=${source.status || null}, detail=${detail}, first_seen_at=${firstSeen}, changed_at=${changed ? now : previous.changed_at}, checked_at=${now}, last_alert_at=${(changed || reminderDue) ? now : previous.last_alert_at} WHERE url=${source.url}`;
      } else {
        this.sql`INSERT INTO monitor_states (url,state,status_code,detail,first_seen_at,changed_at,checked_at,last_alert_at)
          VALUES (${source.url},${nextState},${source.status || null},${detail},${now},${now},${now},${healthy ? null : now})`;
      }
      const event = healthy ? (previous?.state === "down" ? "site_recovered" : "site_healthy") : "site_alert";
      if (changed || reminderDue || !previous) {
        const alert = { url: source.url, state: nextState, status: source.status || null, detail, first_seen_at: new Date(firstSeen).toISOString(), agent_name: packet.agent_name, template_title: packet.template_title };
        await this.log(id, event, alert, packet.agent_name);
        if (event !== "site_healthy") await this.sendAlert(event, alert, id);
      }
      checks.push({ url: source.url, healthy, status: source.status || null, detail, changed });
    }
    const compact = { objective: packet.objective, template_id: packet.template_id, agent_name: packet.agent_name, ai_calls: 0, checks };
    this.sql`UPDATE jobs SET status=${"completed"}, compact_json=${JSON.stringify(compact)}, updated_at=${now} WHERE id=${id}`;
    this.sql`UPDATE agent_versions SET completed_jobs=completed_jobs+1 WHERE version=${"0.1.0"}`;
    await this.log(id, "job_completed", { verifier: false, ai_calls: 0, health_checks: checks.length, failed_checks: checks.filter((item) => !item.healthy).length, agent_name: packet.agent_name }, "coordinator");
    this.setState({ ...this.state, status: "ready", active_job_id: null });
    return this.getJob(id);
  }

  async sendAlert(kind, alert, jobId) {
    const subject = kind === "site_recovered" ? `BACK ONLINE · ${alert.url}` : `SITE ALERT · ${alert.status || "FAILED"} · ${alert.url}`;
    const text = [subject, alert.detail, `First seen: ${alert.first_seen_at}`, `Agent: ${alert.agent_name}`, `Job: ${jobId}`].join("\n");
    const deliveries = [];
    if (this.env.EMAIL && this.env.ALERT_TO && this.env.ALERT_FROM) {
      try {
        await this.env.EMAIL.send({
          to: this.env.ALERT_TO,
          from: { email: this.env.ALERT_FROM, name: "AMH WT Site Watch" },
          subject,
          text,
          html: `<div style="font-family:system-ui;max-width:620px"><h1>${kind === "site_recovered" ? "Back online" : "Site alert"}</h1><p><strong>${escapeHtml(alert.url)}</strong></p><p>${escapeHtml(alert.detail)}</p><p>Status: ${escapeHtml(alert.status || "unavailable")}<br>First seen: ${escapeHtml(alert.first_seen_at)}<br>Agent: ${escapeHtml(alert.agent_name)}</p></div>`,
        });
        deliveries.push({ channel: "email", ok: true });
      } catch (error) {
        deliveries.push({ channel: "email", ok: false, error: cleanText(error?.message || error, 300) });
      }
    }
    if (this.env.ALERT_WEBHOOK_URL) {
      try {
        const target = new URL(this.env.ALERT_WEBHOOK_URL);
        if (target.protocol !== "https:") throw new Error("Alert webhook must use HTTPS");
        const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, subject, text, alert, job_id: jobId }), signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        deliveries.push({ channel: "webhook", ok: true });
      } catch (error) {
        deliveries.push({ channel: "webhook", ok: false, error: cleanText(error?.message || error, 300) });
      }
    }
    await this.log(jobId, "alert_delivery", { subject, external_configured: deliveries.length > 0, deliveries }, "office_manager");
    return { subject, external_configured: deliveries.length > 0, deliveries };
  }

  async testAlert(actor = "console") {
    const result = await this.sendAlert("site_alert", {
      url: this.state.memory.live_target || "configured site",
      state: "test",
      status: 200,
      detail: "This is the required AMH WT notification acceptance test. No outage occurred.",
      first_seen_at: new Date().toISOString(),
      agent_name: "Jack",
      template_title: "Notification acceptance",
    }, null);
    const passed = result.external_configured && result.deliveries.some((item) => item.ok);
    await this.log(null, "alert_acceptance_test", { passed, deliveries: result.deliveries }, actor);
    if (!passed) throw new Error("No external alert channel delivered the test");
    return { passed: true, ...result };
  }

  async listJobs(limit = 50) {
    const capped = Math.max(1, Math.min(Number(limit || 50), 100));
    return rowList(this.sql`SELECT id,status,packet_hash,packet_json,error,created_at,updated_at FROM jobs ORDER BY created_at DESC LIMIT ${capped}`)
      .map((row) => ({ ...row, packet: parseJson(row.packet_json, {}), packet_json: undefined, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() }));
  }

  async getEvents(jobId = null, after = 0) {
    const rows = jobId
      ? rowList(this.sql`SELECT * FROM events WHERE job_id=${jobId} AND seq>${Number(after || 0)} ORDER BY seq ASC LIMIT 500`)
      : rowList(this.sql`SELECT * FROM events WHERE seq>${Number(after || 0)} ORDER BY seq DESC LIMIT 500`);
    return rows.map((row) => ({ ...row, data: parseJson(row.data_json, {}), data_json: undefined, ts: new Date(row.ts).toISOString() }));
  }

  async verifyAuditChain() {
    const rows = rowList(this.sql`SELECT * FROM events ORDER BY seq ASC`);
    let previous = null;
    for (const row of rows) {
      if (row.prev_hash !== previous) return { ok: false, broken_at: row.seq, reason: "previous hash mismatch" };
      const data = parseJson(row.data_json, {});
      const expected = await auditDigest(this.env.AUDIT_HMAC_KEY, JSON.stringify({ job_id: row.job_id || null, ts: row.ts, actor: row.actor, kind: row.kind, data, prev_hash: previous }));
      if (expected !== row.event_hash) return { ok: false, broken_at: row.seq, reason: "event hash mismatch" };
      previous = row.event_hash;
    }
    return { ok: true, events: rows.length, head: previous, signed: !!this.env.AUDIT_HMAC_KEY };
  }

  async listRevisions() {
    return rowList(this.sql`SELECT * FROM revisions ORDER BY created_at DESC LIMIT 200`).map((row) => ({ ...row, proposal: parseJson(row.proposal_json, {}), proposal_json: undefined, created_at: new Date(row.created_at).toISOString(), reviewed_at: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null }));
  }

  async reviewRevision(id, decision, actor = "master") {
    if (!['approved','rejected'].includes(decision)) throw new Error("decision must be approved or rejected");
    const found = rowList(this.sql`SELECT id,job_id FROM revisions WHERE id=${id} LIMIT 1`)[0];
    if (!found) throw new Error("Revision not found");
    this.sql`UPDATE revisions SET status=${decision}, reviewed_at=${Date.now()} WHERE id=${id}`;
    await this.log(found.job_id, "revision_reviewed", { revision_id: id, decision, note: "Approval records the candidate; code/template promotion remains a separate tested release." }, actor);
    return { id, status: decision };
  }

  async putSchedule(input, actor = "master") {
    const packet = input.packet?.schema_version ? input.packet : normalizePacket(input.packet || input, this.env);
    const currentSchedules = rowList(this.sql`SELECT COUNT(*) AS count FROM template_schedules WHERE enabled=1`)[0]?.count || 0;
    const maxSchedules = Math.max(1, Math.min(Number(this.env.MAX_SCHEDULES || 3), 25));
    if (Number(currentSchedules) >= maxSchedules) throw new Error(`Schedule limit reached (${maxSchedules})`);
    const minMinutes = Math.max(5, Math.min(Number(this.env.MIN_SCHEDULE_MINUTES || 60), 1440));
    const every = Math.max(minMinutes, Math.min(Number(input.every_minutes || packet.schedule?.every_minutes || minMinutes), 10080));
    const schedule = await this.scheduleEvery(every * 60, "runScheduledTemplate", { packet });
    const id = crypto.randomUUID();
    this.sql`INSERT INTO template_schedules (id,agent_schedule_id,every_minutes,packet_json,enabled,created_at)
      VALUES (${id},${schedule.id},${every},${JSON.stringify(packet)},${1},${Date.now()})`;
    await this.log(null, "schedule_created", { id, every_minutes: every, template_id: packet.template_id }, actor);
    return { id, agent_schedule_id: schedule.id, every_minutes: every, enabled: true };
  }

  async runScheduledTemplate(payload) {
    if (this.state.active_job_id) {
      await this.log(null, "schedule_skipped_overlap", { active_job_id: this.state.active_job_id }, "scheduler");
      return;
    }
    const job = await this.createJob({ ...payload.packet, schedule: { enabled: false } }, "scheduler");
    await this.runJob(job.id, "scheduler");
    this.sql`UPDATE template_schedules SET last_run_at=${Date.now()} WHERE agent_schedule_id IN (SELECT agent_schedule_id FROM template_schedules WHERE enabled=1)`;
  }

  async listTemplateSchedules() {
    return rowList(this.sql`SELECT * FROM template_schedules ORDER BY created_at DESC`).map((row) => ({ ...row, packet: parseJson(row.packet_json, {}), packet_json: undefined, enabled: !!row.enabled, created_at: new Date(row.created_at).toISOString(), last_run_at: row.last_run_at ? new Date(row.last_run_at).toISOString() : null }));
  }

  async deleteTemplateSchedule(id, actor = "master") {
    const row = rowList(this.sql`SELECT * FROM template_schedules WHERE id=${id} LIMIT 1`)[0];
    if (!row) return { id, deleted: false };
    await this.cancelSchedule(row.agent_schedule_id);
    this.sql`DELETE FROM template_schedules WHERE id=${id}`;
    await this.log(null, "schedule_deleted", { id }, actor);
    return { id, deleted: true };
  }

  assertNotStopped(id) {
    if (this.state.stop_requested_jobs.includes(id)) throw new Error("STOP_REQUESTED");
  }

  async control(action, options = {}, actor = "master") {
    if (action === "pause") {
      this.setState({ ...this.state, paused: true });
    } else if (action === "resume") {
      this.setState({ ...this.state, paused: false });
    } else if (action === "readonly_on") {
      this.setState({ ...this.state, readonly_mode: true });
    } else if (action === "readonly_off") {
      if (actor !== "console" && actor !== "oauth-console") throw new Error("Only the human console may disable read-only mode");
      this.setState({ ...this.state, readonly_mode: false });
    } else if (action === "cancel_job") {
      const id = cleanText(options.job_id, 80);
      if (!id) throw new Error("job_id is required");
      const row = rowList(this.sql`SELECT status FROM jobs WHERE id=${id} LIMIT 1`)[0];
      if (!row) throw new Error("Job not found");
      if (row.status === "queued") this.sql`UPDATE jobs SET status=${"cancelled"}, updated_at=${Date.now()} WHERE id=${id}`;
      else if (row.status === "running") this.setState({ ...this.state, stop_requested_jobs: [...new Set([...this.state.stop_requested_jobs, id])] });
      else return { action, job_id: id, status: row.status, changed: false };
    } else if (action === "retention_sweep") {
      return this.retentionSweep();
    } else {
      throw new Error("Unknown control action");
    }
    await this.log(options.job_id || null, "control_changed", { action }, actor);
    return { action, state: this.state };
  }

  async retentionSweep() {
    const now = Date.now();
    const sourceDays = Math.max(1, Math.min(Number(this.env.RETAIN_SOURCE_DAYS || 4), 30));
    const detailDays = Math.max(sourceDays, Math.min(Number(this.env.RETAIN_DETAIL_DAYS || 7), 90));
    const eventDays = Math.max(detailDays, Math.min(Number(this.env.RETAIN_EVENT_DAYS || 30), 365));
    const sourceBefore = now - sourceDays * 86400000;
    const detailBefore = now - detailDays * 86400000;
    const eventBefore = now - eventDays * 86400000;
    const maxDetailBytes = Math.max(1048576, Math.min(Number(this.env.MAX_DETAIL_BYTES || 5242880), 104857600));
    this.sql`UPDATE jobs SET sources_json=${"[]"} WHERE updated_at < ${sourceBefore} AND sources_json IS NOT NULL AND sources_json != ${"[]"}`;
    this.sql`UPDATE jobs SET primary_json=${null}, verifier_json=${null} WHERE updated_at < ${detailBefore} AND compact_json IS NOT NULL`;
    const usage = rowList(this.sql`SELECT COALESCE(SUM(LENGTH(COALESCE(sources_json,''))+LENGTH(COALESCE(primary_json,''))+LENGTH(COALESCE(verifier_json,''))),0) AS bytes FROM jobs`)[0]?.bytes || 0;
    if (Number(usage) > maxDetailBytes) {
      this.sql`UPDATE jobs SET sources_json=${"[]"}, primary_json=${null}, verifier_json=${null}
        WHERE id IN (SELECT id FROM jobs WHERE status=${"completed"} AND compact_json IS NOT NULL ORDER BY updated_at ASC LIMIT 50)`;
    }
    this.sql`DELETE FROM events WHERE ts < ${eventBefore} AND kind NOT IN (${"revision_reviewed"},${"memory_compacted"},${"approval_recorded"},${"deployment_receipt"})`;
    await this.log(null, "retention_sweep", { source_days: sourceDays, detail_days: detailDays, event_days: eventDays, detail_bytes_before: Number(usage), max_detail_bytes: maxDetailBytes, pressure_compaction: Number(usage) > maxDetailBytes }, "continuity_keeper");
    return { ok: true, source_days: sourceDays, detail_days: detailDays, event_days: eventDays, detail_bytes_before: Number(usage), max_detail_bytes: maxDetailBytes };
  }

  async storageStats() {
    return rowList(this.sql`SELECT COUNT(*) AS jobs, COALESCE(SUM(LENGTH(COALESCE(sources_json,''))+LENGTH(COALESCE(primary_json,''))+LENGTH(COALESCE(verifier_json,''))),0) AS detail_bytes FROM jobs`)[0] || { jobs: 0, detail_bytes: 0 };
  }

  async usageSummary() {
    const start = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
    const counts = rowList(this.sql`SELECT
      SUM(CASE WHEN kind=${"primary_started"} THEN 1 ELSE 0 END) AS primary_calls,
      SUM(CASE WHEN kind=${"verifier_started"} THEN 1 ELSE 0 END) AS verifier_calls,
      SUM(CASE WHEN kind=${"job_completed"} AND json_extract(data_json,'$.ai_calls')=0 THEN 1 ELSE 0 END) AS zero_ai_jobs
      FROM events WHERE ts>=${start}`)[0] || {};
    const calls = Number(counts.primary_calls || 0) + Number(counts.verifier_calls || 0);
    const limit = Math.max(1, Math.min(Number(this.env.MAX_DAILY_MODEL_CALLS || 8), 100));
    const profile = String(this.env.MODEL_PROFILE || "free").toLowerCase();
    return {
      date_utc: new Date(start).toISOString().slice(0, 10),
      model_profile: profile,
      primary_model: profile === "paid-k2" ? (this.env.PRIMARY_MODEL || "@cf/moonshotai/kimi-k2.6") : (this.env.FREE_PRIMARY_MODEL || "@cf/zai-org/glm-4.7-flash"),
      verifier_model: profile === "paid-k2" ? (this.env.PRIMARY_MODEL || "@cf/moonshotai/kimi-k2.6") : (this.env.FREE_VERIFIER_MODEL || "@cf/google/gemma-4-26b-a4b-it"),
      harness_calls: calls,
      harness_call_limit: limit,
      harness_calls_remaining: Math.max(0, limit - calls),
      primary_calls: Number(counts.primary_calls || 0),
      verifier_calls: Number(counts.verifier_calls || 0),
      zero_ai_jobs: Number(counts.zero_ai_jobs || 0),
      resets_at_utc: new Date(start + 86400000).toISOString(),
      provider_free_allocation_neurons: 10000,
      provider_neurons_used: null,
      provider_note: "Exact neuron use is available in Cloudflare Workers AI analytics. This harness shows exact call activity and never guesses spend.",
    };
  }

  async listAgentVersions() {
    return rowList(this.sql`SELECT * FROM agent_versions ORDER BY created_at DESC`).map((row) => ({
      version: row.version,
      status: row.status,
      manifest: parseJson(row.manifest_json, {}),
      scorecard: {
        total_jobs: row.total_jobs,
        completed_jobs: row.completed_jobs,
        failed_jobs: row.failed_jobs,
        completion_rate: row.total_jobs ? row.completed_jobs / row.total_jobs : null,
        verifier_runs: row.verifier_runs,
        average_primary_confidence: row.completed_jobs ? row.confidence_sum / row.completed_jobs : null,
        schema_policy: "Every accepted result passed amh.wt evidence schema validation",
      },
      created_at: new Date(row.created_at).toISOString(),
    }));
  }

  async dashboard() {
    return {
      state: this.state,
      briefing: await this.getBriefing(),
      jobs: await this.listJobs(50),
      revisions: await this.listRevisions(),
      schedules: await this.listTemplateSchedules(),
      events: await this.getEvents(null, 0),
      storage: await this.storageStats(),
      usage: await this.usageSummary(),
      agent_profiles: await this.listAgentProfiles(),
      agent_versions: await this.listAgentVersions(),
      audit_chain: await this.verifyAuditChain(),
    };
  }
}
