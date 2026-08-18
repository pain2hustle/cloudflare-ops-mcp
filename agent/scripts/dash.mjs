// Local operator dashboard — opens on localhost, NO login (it's local, not on the
// internet). Reads the operator key from local-stashes/operator.json (or env),
// proxies to the harness internal API server-side so the key never touches the
// browser, and shows the live crew: agents, jobs (newest-first, running pinned,
// done drops below), skills, templates, and how to use them.
//
// Run:  npm run dash   (in agent/)   — then it prints/open a localhost URL.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DASH_PORT || 8787);

function operator() {
  const cfg = { url: process.env.HARNESS_URL || "", key: process.env.HARNESS_INTERNAL_KEY || "", actor: process.env.HARNESS_ACTOR || "private-admin" };
  if (!cfg.url || !cfg.key) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(HERE, "..", "local-stashes", "operator.json"), "utf8"));
      cfg.url = cfg.url || s.url || "";
      cfg.key = cfg.key || s.internal_key || "";
      cfg.actor = s.actor || cfg.actor;
    } catch {}
  }
  return cfg;
}
const OP = operator();
if (!OP.url || !OP.key) {
  console.error("No operator credentials. Set HARNESS_URL + HARNESS_INTERNAL_KEY, or create agent/local-stashes/operator.json { url, internal_key }.");
  process.exit(1);
}

async function proxy(apiPath, method = "GET", body) {
  const res = await fetch(new URL(apiPath, OP.url), {
    method,
    headers: { "content-type": "application/json", "x-amh-internal-key": OP.key, "x-amh-actor": OP.actor },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  return { status: res.status, text };
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AMH WT · Local Agent Dashboard</title>
<style>
:root{--bg:#07130d;--bg2:#0d2015;--ink:#eaf7ee;--muted:#a9c4b2;--line:#244b33;--green:#6ee7a3;--gold:#c8911a;--red:#ff7a7a;--blue:#6fa8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:20px}
.top{display:flex;align-items:center;gap:14px;margin-bottom:6px}
.amh{width:46px;height:46px;border-radius:13px;flex:0 0 auto}
.wt{height:40px;width:auto;margin-left:auto;border-radius:8px}
.mark{display:inline-grid;place-items:center;width:38px;height:38px;border-radius:11px;background:var(--green);color:#062013;font-weight:900}
h1{font-size:1.15rem;margin:0}.byline{color:var(--muted);font-size:.72rem;letter-spacing:.06em;margin-top:2px}
.sub{color:var(--muted);font-size:.82rem;margin:2px 0 16px}
.foot{margin-top:26px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:.8rem;text-align:center}
.foot a{color:var(--green);text-decoration:none}
.foot .nu{display:inline-flex;align-items:center;gap:8px;font-weight:800;margin-bottom:10px}
.foot .nu svg{width:26px;height:26px;border-radius:7px}
.foot .legal{margin:8px 0}.foot .legal a{color:var(--muted);margin:0 6px}
.amhmark{margin-top:10px;font-family:ui-monospace,Consolas,monospace;font-weight:800;letter-spacing:.08em;color:var(--gold)}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.tab{background:var(--bg2);border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:8px 14px;font-weight:700;cursor:pointer}
.tab.active{background:var(--green);color:#062013}
.pane{display:none}.pane.active{display:block}
.card{background:var(--bg2);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:14px}
h2{font-size:.95rem;margin:0 0 10px}h3{font-size:.8rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:16px 0 8px}
.job{padding:10px 0;border-bottom:1px solid var(--line)}.job:last-child{border:0}
.jobname{font-weight:800}.jobmeta{color:var(--muted);font-size:.8rem}
.bar{height:8px;background:#051008;border-radius:99px;overflow:hidden;margin:6px 0}
.fill{height:100%;background:var(--green);transition:width .5s}
.pill{display:inline-block;font-size:.7rem;font-weight:800;padding:2px 8px;border-radius:99px;background:#123;color:var(--blue);margin-left:6px}
.pill.run{background:#0c2a1a;color:var(--green)}.pill.fail{background:#2a1414;color:var(--red)}.pill.done{background:#1a2233;color:var(--muted)}
.agent{padding:10px 0;border-bottom:1px solid var(--line)}.agent:last-child{border:0}
.agent .role{color:var(--muted);font-size:.82rem}
.how{color:var(--muted);font-size:.85rem}.how code{background:#051008;padding:1px 6px;border-radius:6px;color:var(--green)}
.empty{color:var(--muted)}
</style></head><body><div class="wrap">
<div class="top">
<svg class="amh" viewBox="0 0 512 512" role="img" aria-label="Artificial Mind Hive"><defs><linearGradient id="abg" x1="64" y1="48" x2="448" y2="464" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f8fffb"/><stop offset=".45" stop-color="#8fffe0"/><stop offset="1" stop-color="#60a5fa"/></linearGradient><linearGradient id="aedge" x1="96" y1="80" x2="416" y2="432" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#3ef2a2"/></linearGradient><filter id="aglow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="12" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="512" height="512" rx="108" fill="url(#abg)"/><rect x="44" y="44" width="424" height="424" rx="84" fill="none" stroke="url(#aedge)" stroke-width="10"/><g fill="#06110d"><g transform="translate(0,57) scale(0.78)"><path d="M105 356 164 152h48l59 204h-44l-13-52h-55l-13 52h-41Zm64-91h35l-17-70h-1l-17 70Zm122 91V152h44l40 83 40-83h44v204h-42V232l-30 62h-25l-30-62v124h-41Z"/></g><path d="M338 176h30v64h37v-64h30v159h-30v-66h-37v66h-30V176Z"/></g><path d="M92 102h328M92 410h328" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity="0.55" filter="url(#aglow)"/><circle cx="413" cy="104" r="16" fill="#fff" opacity="0.9" filter="url(#aglow)"/></svg>
<div><h1>AMH · MCP Agent Console</h1><div class="byline">Artificial Mind Hive &middot; by Service Pricer LLC&trade;</div></div>
<img class="wt" src="/wt.png" alt="WT walrus">
</div>
<div class="sub" id="sub">connecting…</div>
<div class="tabs"><button class="tab active" data-t="jobs">Live jobs</button><button class="tab" data-t="agents">Agents</button><button class="tab" data-t="skills">Skills &amp; templates</button></div>
<div class="pane active" data-p="jobs"><div class="card"><h2>What the crew is doing</h2><div id="jobs"><span class="empty">Loading…</span></div></div></div>
<div class="pane" data-p="agents"><div class="card"><h2>The crew</h2><div id="agents"><span class="empty">Loading…</span></div></div></div>
<div class="pane" data-p="skills"><div class="card"><h2>Skills &amp; templates — what they do and how to use them</h2><div id="skills"><span class="empty">Loading…</span></div></div></div>
<div class="foot">
<a class="nu" href="https://nothingunseen.com" target="_blank" rel="noopener"><svg viewBox="0 0 512 512"><defs><linearGradient id="ng" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="512" height="512" rx="96" fill="#0a0a0f"/><rect x="150" y="120" width="150" height="272" rx="10" fill="none" stroke="url(#ng)" stroke-width="14"/><circle cx="278" cy="262" r="11" fill="url(#ng)"/><text x="330" y="300" font-family="Arial" font-weight="800" font-size="150" fill="url(#ng)">&#957;</text></svg> Nothing Unseen</a>
<div class="legal">
<a href="https://github.com/pain2hustle/cloudflare-ops-mcp" target="_blank" rel="noopener"><svg viewBox="0 0 16 16" width="14" height="14" style="vertical-align:-2px" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg> GitHub / code</a>
<a href="https://artificialmindhive.com/privacy.html" target="_blank" rel="noopener">Privacy</a>
<a href="https://artificialmindhive.com/terms.html" target="_blank" rel="noopener">Terms</a>
<a href="https://artificialmindhive.com/security.html" target="_blank" rel="noopener">Security</a>
<a href="https://artificialmindhive.com/accessibility.html" target="_blank" rel="noopener">Accessibility</a>
</div>
<div>AMH &mdash; Artificial Mind Hive &middot; Service Pricer LLC&trade;</div>
<div class="amhmark">-/\\-\\ M H // WT</div>
</div>
</div>
<script>
const STAGE={job_created:5,job_enqueued:8,safety_preflight:12,job_started:16,crawl_start:22,crawl_complete:38,primary_started:48,primary_completed:66,verifier_started:76,verifier_completed:90,revision_proposed:94,site_healthy:96,site_alert:96,site_recovered:96,job_completed:100,job_failed:100,job_cancelled:100};
const $=id=>document.getElementById(id);
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('active',p.dataset.p===b.dataset.t))});
function pct(job,events){const evs=(events||[]).filter(e=>e.job_id===job.id);for(const e of evs){if(STAGE[e.kind]!=null)return STAGE[e.kind]}if(job.status==='completed')return 100;if(job.status==='failed')return 100;return 5}
function stageName(job,events){const evs=(events||[]).filter(e=>e.job_id===job.id);return evs.length?evs[evs.length-1].kind.replace(/_/g,' '):(job.status||'queued')}
function tnum(j){return Date.parse(j.updated_at||j.created_at||0)||0}
async function load(){
  let d;try{const r=await fetch('/d/dashboard');d=await r.json()}catch(e){$('sub').textContent='cannot reach harness: '+e.message;return}
  $('sub').textContent='live · '+(d.usage?('today '+ (d.usage.daily_calls??0) +'/'+(d.usage.daily_limit??8)+' AI calls · '):'')+'auto-refresh 3s · local, no login';
  // jobs
  const jobs=(d.jobs||[]).slice();const run=jobs.filter(j=>['queued','running'].includes(j.status)).sort((a,b)=>tnum(b)-tnum(a));const done=jobs.filter(j=>!['queued','running'].includes(j.status)).sort((a,b)=>tnum(b)-tnum(a));
  const box=$('jobs');box.innerHTML='';
  const sec=(title,arr)=>{if(!arr.length)return;const h=document.createElement('h3');h.textContent=title;box.appendChild(h);arr.forEach(j=>{const p=pct(j,d.events);const cls=j.status==='failed'?'fail':(j.status==='completed'||j.status==='cancelled'?'done':'run');const el=document.createElement('div');el.className='job';el.innerHTML='<div class="jobname">'+(j.packet&&j.packet.agent_name||j.packet&&j.packet.template_id||'Agent task')+'<span class="pill '+cls+'">'+j.status+'</span></div><div class="bar"><div class="fill" style="width:'+p+'%"></div></div><div class="jobmeta">'+stageName(j,d.events)+' · '+p+'% · '+(j.packet&&j.packet.template_id||'')+'</div>';box.appendChild(el)})};
  sec('Running',run);sec('Done',done);if(!jobs.length)box.innerHTML='<span class="empty">No jobs yet. Kick one off and it shows here live.</span>';
  // agents
  const ab=$('agents');ab.innerHTML='';(d.agent_profiles||[]).forEach(a=>{const el=document.createElement('div');el.className='agent';el.innerHTML='<div class="jobname">'+a.name+(a.system?'<span class="pill">office manager</span>':'')+'</div><div class="role">'+(a.role_title||a.template_id||'')+' · '+(a.description||'')+'</div>';ab.appendChild(el)});if(!(d.agent_profiles||[]).length)ab.innerHTML='<span class="empty">No agents yet.</span>';
  // skills + templates
  const sb=$('skills');sb.innerHTML='';const tpls=(d.catalog&&d.catalog.templates)||[];tpls.forEach(t=>{const calls=t.deterministic?0:(t.verifier?2:1);const el=document.createElement('div');el.className='agent';el.innerHTML='<div class="jobname">'+t.title+' <span class="pill">'+t.id+'</span></div><div class="role">'+t.purpose+'</div><div class="how">how: run this template · '+calls+' AI call'+(calls===1?'':'s')+'/job · tools: '+(t.tools||[]).join(', ')+'</div>';sb.appendChild(el)});const sk=(d.catalog&&d.catalog.skills)||[];if(sk.length){const h=document.createElement('h3');h.textContent='Process skills (auto-selected)';sb.appendChild(h);sk.forEach(s=>{const el=document.createElement('div');el.className='agent';el.innerHTML='<div class="jobname">'+s.title+'</div><div class="role">'+s.purpose+'</div><div class="how">'+s.lane+' · auto for: '+(s.automatic_for||[]).join(', ')+'</div>';sb.appendChild(el)})}
}
load();setInterval(load,3000);
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/" || req.url.startsWith("/?")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(PAGE);
    }
    if (req.url.startsWith("/d/")) {
      const sub = req.url.slice(3).split("?")[0]; // e.g. "dashboard"
      const map = { dashboard: "/internal/dashboard", jobs: "/internal/jobs", briefing: "/internal/briefing", revisions: "/internal/revisions" };
      const target = map[sub];
      if (!target) { res.writeHead(404); return res.end("{}"); }
      const out = await proxy(target);
      res.writeHead(out.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      return res.end(out.text);
    }
    if (req.url === "/wt.png") {
      try {
        const png = fs.readFileSync(path.join(HERE, "..", "..", "assets", "wt-walrus.png"));
        res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=86400" });
        return res.end(png);
      } catch { res.writeHead(404); return res.end(""); }
    }
    res.writeHead(404); res.end("not found");
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(error?.message || error) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`\n  AMH WT local dashboard → ${url}`);
  console.log(`  harness: ${OP.url}  ·  no login (local)  ·  Ctrl+C to stop\n`);
  // best-effort open the browser
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(opener[0], opener[1], { stdio: "ignore", detached: true, windowsHide: true }).unref(); } catch {}
});
