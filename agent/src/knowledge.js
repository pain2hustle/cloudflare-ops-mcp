function safeSegment(value, fallback = "unknown-site") {
  return String(value || fallback).toLowerCase().trim().replace(/^https?:\/\//, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || fallback;
}

export function knowledgeFilename(site, kind = "stash", date = new Date()) {
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, "Z").replace("T", "_").replace(/:/g, "-");
  return `${safeSegment(site)}/${stamp}_${safeSegment(kind, "stash")}.json`;
}

export function redactedKnowledgeExport(dashboard) {
  return {
    schema_version: "amh.wt.knowledge.v1",
    exported_at: new Date().toISOString(),
    memory: dashboard?.briefing?.memory || dashboard?.state?.memory || {},
    memory_hash: dashboard?.briefing?.memory_hash || null,
    agent_version: dashboard?.catalog?.capability_tree?.version || null,
    approved_revisions: (dashboard?.revisions || []).filter((item) => item.status === "approved").map((item) => ({ id: item.id, job_id: item.job_id, proposal: item.proposal, reviewed_at: item.reviewed_at })),
    recent_jobs: (dashboard?.jobs || []).slice(0, 25).map((job) => ({ id: job.id, status: job.status, packet_hash: job.packet_hash, template_id: job.packet?.template_id, objective: job.packet?.objective, updated_at: job.updated_at })),
    note: "Redacted compact export. No OAuth records, connector keys, secret values, raw source bodies, client IPs, or cookies.",
  };
}
