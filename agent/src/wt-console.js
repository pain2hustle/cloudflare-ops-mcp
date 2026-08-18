// Walrus Tooth operator console — served same-origin on the harness so it reads the
// live /api/dashboard feed with the session cookie. Design = Austin's AMH Agent Console
// (Archivo Black + JetBrains Mono, dark-green), data + progress logic ported from the
// local dash. Progress bars move off real event stages; params shown per agent + per day.
export const WT_CONSOLE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Walrus Tooth · Operator Console</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#06100c;--ink:#f3ead6;--muted:#9db3a6;--line:#163024;--green:#4cdc82;--gold:#e8b84b;--red:#ff7a7a}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:'JetBrains Mono',monospace}
a{color:var(--green);text-decoration:none}
.hd{display:block;background:var(--bg)}
.hd,.wrap{max-width:1180px;margin:0 auto;padding:0 clamp(20px,4vw,56px)}
.htop{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:30px 0 0}
.brand{display:flex;align-items:center;gap:18px;min-width:0}
.amh{width:88px;height:auto;flex:none;filter:drop-shadow(0 0 22px rgba(232,184,75,.45))}
.htitle{font-family:'Archivo Black';font-size:clamp(20px,2.4vw,30px);line-height:1;text-transform:uppercase;letter-spacing:-.02em}
.hby{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin-top:10px}
.wt{display:flex;align-items:center;gap:14px;flex:none}
.wtl{text-align:right}.wtl b{font-family:'Archivo Black';font-size:20px;color:var(--green);letter-spacing:.06em}
.wtl span{display:block;font-size:9px;letter-spacing:.28em;text-transform:uppercase;color:var(--muted);margin-top:5px}
.wtimg{width:120px;height:auto;filter:drop-shadow(0 0 2px rgba(76,220,130,.85)) drop-shadow(0 0 24px rgba(76,220,130,.3))}
.status{display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:24px 0 0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.status .dot{width:8px;height:8px;background:var(--green);box-shadow:0 0 12px var(--green);animation:wt 2s ease-in-out infinite;display:inline-block}
@keyframes wt{0%,100%{opacity:.35}50%{opacity:1}}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1px;background:var(--line);margin-top:28px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.tile{background:#0b1a13;padding:22px clamp(18px,3vw,26px)}
.tile .n{font-family:'Archivo Black';font-size:36px;line-height:1;color:var(--green)}
.tile .l{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--muted);margin-top:11px}
.tabs{display:flex;flex-wrap:wrap;gap:2px;padding:26px 0 0}
.tab{font-weight:700;font-size:12.5px;letter-spacing:.14em;text-transform:uppercase;padding:14px 20px;cursor:pointer;border:1px solid #1c3a2c;background:transparent;color:var(--muted);font-family:'JetBrains Mono'}
.tab.on{border-color:var(--green);background:var(--green);color:var(--bg);box-shadow:0 0 26px rgba(76,220,130,.35)}
.wrap{padding-bottom:60px}
.panel{border:1px solid #1c3a2c;background:#0a170f;margin-top:24px}
.ph{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px 24px;border-bottom:1px solid var(--line)}
.ph b{font-family:'Archivo Black';font-size:15px;text-transform:uppercase}.ph span{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted)}
.pane{display:none}.pane.on{display:block}
.proj{padding:16px 24px 4px;font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:var(--green)}
.job{padding:20px 24px;border-top:1px solid #12281d}
.jt{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.jn{font-family:'Archivo Black';font-size:20px;text-transform:uppercase}
.badge{font-size:10px;letter-spacing:.2em;text-transform:uppercase;padding:6px 11px;border:1px solid #2b5541;color:var(--green);background:rgba(76,220,130,.08)}
.badge.fail{border-color:#5c2a2a;color:var(--red);background:rgba(255,122,122,.08)}
.badge.done{border-color:#33513f;color:var(--muted);background:transparent}
.ai{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--green)}
.bar{height:6px;background:#12281d;margin-top:14px;overflow:hidden}
.fill{height:100%;background:var(--green);box-shadow:0 0 16px rgba(76,220,130,.6);transition:width .6s ease}
.fill.fail{background:var(--red);box-shadow:0 0 14px rgba(255,122,122,.5)}
.fill.run{background:linear-gradient(90deg,var(--green),#b9ffcf,var(--green));background-size:200% 100%;animation:flow 1.3s linear infinite}
@keyframes flow{0%{background-position:0 0}100%{background-position:200% 0}}
.meta{font-size:12px;color:var(--muted);margin-top:12px}.meta b{color:var(--ink)}
.params{background:var(--bg);border:1px solid var(--line);border-left:2px solid var(--green);padding:16px 18px;margin-top:14px;font-size:12.5px;line-height:1.8;color:var(--muted);cursor:pointer}
.params b{color:var(--green);font-weight:700}.params .more{display:none}.params.open .more{display:block}
.crew{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1px;background:var(--line)}
.mem{background:#0a170f;padding:22px 24px}
.mn{display:flex;align-items:center;justify-content:space-between;gap:10px}.mn b{font-family:'Archivo Black';font-size:18px;text-transform:uppercase}
.mn .amt{font-size:11px;color:var(--green);letter-spacing:.08em}
.mr{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-top:10px}
.md{font-size:12.5px;line-height:1.7;color:var(--muted);margin-top:12px}
.row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px;border-top:1px solid #12281d}
.rid{font-weight:700;font-size:14px;color:var(--ink)}.rd{font-size:12.5px;color:var(--muted);margin-top:7px}
.lane{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--green);border:1px solid #2b5541;padding:7px 13px;flex:none}
.days{display:flex;gap:1px;background:var(--line);flex-wrap:wrap}
.day{background:#0a170f;padding:16px 20px;min-width:120px;flex:1}
.day .d{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.day .v{font-family:'Archivo Black';font-size:22px;color:var(--green);margin-top:8px}.day .s{font-size:11px;color:var(--muted);margin-top:4px}
ul.cap{margin:0;padding:20px 24px 20px 42px}ul.cap li{margin:7px 0}ul.cap.no li{color:var(--red)}
.gate{padding:60px 24px;text-align:center;color:var(--muted)}
.gate a{display:inline-block;margin-top:18px;background:var(--green);color:var(--bg);font-family:'Archivo Black';text-transform:uppercase;letter-spacing:.06em;padding:15px 28px}
.foot{border-top:1px solid var(--line);margin-top:36px;padding:36px 0 48px;text-align:center;color:var(--muted);font-size:12px}
.foot .links{display:flex;flex-wrap:wrap;justify-content:center;gap:22px;margin-bottom:20px}
.foot .mark{font-family:'JetBrains Mono';font-weight:700;letter-spacing:.3em;color:var(--gold);margin-top:16px}
</style></head><body>
<div class="hd">
  <div class="htop">
    <div class="brand">
      <svg class="amh" viewBox="0 0 56 64" aria-label="Artificial Mind Hive"><defs><linearGradient id="ah" x1="0" y1="0" x2="56" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffd24d"/><stop offset="55%" stop-color="#f5b800"/><stop offset="100%" stop-color="#a87a0c"/></linearGradient></defs><polygon points="28,2 54,17 54,47 28,62 2,47 2,17" fill="url(#ah)" stroke="#7c5908" stroke-width="1.25"/><path d="M18 46 L28 18 L38 46 M22 38 L34 38" stroke="#0e1411" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="28" cy="11" r="2.6" fill="#0e1411"/></svg>
      <div><div class="htitle">MCP Agent Console</div><div class="hby">Artificial Mind Hive · by Service Pricer LLC™</div></div>
    </div>
    <div class="wt"><div class="wtl"><b>WT</b><span>Walrus Tooth</span></div><img class="wtimg" src="https://wt-console.pages.dev/walrus.png" alt="Walrus Tooth"></div>
  </div>
  <div class="status"><span><span class="dot"></span> live</span><span>/</span><span>auto-refresh 3s</span><span>/</span><span id="lane">model lane: —</span></div>
  <div id="tiles" class="tiles"></div>
</div>
<div class="wrap">
  <div class="tabs">
    <button class="tab on" data-t="jobs">Live jobs</button>
    <button class="tab" data-t="crew">Crew</button>
    <button class="tab" data-t="skills">Skills &amp; templates</button>
    <button class="tab" data-t="how">How it works</button>
  </div>
  <div class="panel">
    <div class="ph"><b id="ptitle">What the crew is doing</b><span id="pmeta"></span></div>
    <div class="pane on" data-p="jobs"><div id="jobs"><div class="gate">Loading…</div></div></div>
    <div class="pane" data-p="crew"><div class="days" id="days"></div><div class="crew" id="crew"></div></div>
    <div class="pane" data-p="skills"><div id="skills"></div><div class="ph" style="border-top:1px solid var(--line)"><b>Templates</b><span>the job types the crew can run</span></div><div id="templates"></div></div>
    <div class="pane" data-p="how"><div id="how"></div></div>
  </div>
  <div class="foot">
    <div class="links">
      <a href="https://github.com/pain2hustle/cloudflare-ops-mcp" target="_blank" rel="noopener">GitHub / code</a>
      <a href="https://artificialmindhive.com/privacy.html" target="_blank" rel="noopener">Privacy</a>
      <a href="https://artificialmindhive.com/terms.html" target="_blank" rel="noopener">Terms</a>
      <a href="https://artificialmindhive.com/security.html" target="_blank" rel="noopener">Security</a>
      <a href="https://nothingunseen.com" target="_blank" rel="noopener">Nothing Unseen</a>
    </div>
    <div><a href="https://artificialmindhive.com" target="_blank" rel="noopener">AMH — Artificial Mind Hive · Service Pricer LLC™</a></div>
    <div class="mark">-/\\-\\ M H // WT</div>
  </div>
</div>
<script>
const STAGE={job_created:5,job_enqueued:8,safety_preflight:12,job_started:16,crawl_start:22,crawl_complete:38,primary_started:48,primary_completed:66,verifier_started:76,verifier_completed:90,revision_proposed:94,site_healthy:96,site_alert:96,site_recovered:96,job_completed:100,job_failed:100,job_cancelled:100};
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'})[c]);
const RUN=['queued','running'];
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===b));document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.dataset.p===b.dataset.t));const T={jobs:'What the crew is doing',crew:'The crew',skills:'Skills & templates',how:'How it works'};$('ptitle').textContent=T[b.dataset.t]});
function pct(job,events){const evs=(events||[]).filter(e=>e.job_id===job.id);let best=5;for(const e of evs){if(STAGE[e.kind]!=null)best=STAGE[e.kind]}if(!RUN.includes(job.status))return 100;return best}
function stageName(job,events){const evs=(events||[]).filter(e=>e.job_id===job.id);return evs.length?evs[evs.length-1].kind.replace(/_/g,' '):(job.status||'queued')}
function tnum(j){return Date.parse(j.updated_at||j.created_at||0)||0}
function project(j){const p=j.packet||{};return (p.allowed_domains||[])[0]||(p.template_id==='cloudflare_diagnose'?'Cloudflare':'General')}
function aiCalls(j,events){return (events||[]).filter(e=>e.job_id===j.id&&e.kind==='job_completed').reduce((n,e)=>n+Number(e.data&&e.data.ai_calls||0),0)}
function dayKey(t){return new Date(t).toISOString().slice(0,10)}
async function load(){
  let d,st;try{const r=await fetch('/api/console',{credentials:'include'});st=r.status;if(r.status===401){gate();return}d=await r.json()}catch(e){$('jobs').innerHTML='<div class="gate">cannot reach harness: '+esc(e.message)+'</div>';return}
  const u=d.usage||{};const used=u.daily_calls??u.calls??((u.primary_calls||0)+(u.verifier_calls||0));const lim=u.daily_limit??u.limit??8;
  $('lane').textContent='model lane: '+(u.profile||'free');
  const jobs=(d.jobs||[]).slice();const ev=d.events||[];
  $('tiles').innerHTML=[[used+' / '+lim,'AI calls today'],[(u.zero_ai_jobs??jobs.filter(j=>!RUN.includes(j.status)&&!aiCalls(j,ev)).length),'Zero-AI jobs'],[jobs.length,'Jobs total'],[(d.agent_profiles||[]).length,'Agents'],[(d.schedules||[]).length,'Schedules']].map(t=>'<div class="tile"><div class="n">'+esc(t[0])+'</div><div class="l">'+t[1]+'</div></div>').join('');
  // jobs grouped by project, running pinned
  const run=jobs.filter(j=>RUN.includes(j.status)).sort((a,b)=>tnum(b)-tnum(a));const done=jobs.filter(j=>!RUN.includes(j.status)).sort((a,b)=>tnum(b)-tnum(a));
  $('pmeta').textContent=jobs.length+' jobs · '+run.length+' running';
  const card=j=>{const p=pct(j,ev),pk=j.packet||{},run_=RUN.includes(j.status);const cls=j.status==='failed'?'fail':(run_?'run':'done');const bcls=j.status==='failed'?'fail':(['completed','cancelled'].includes(j.status)?'done':'');const calls=aiCalls(j,ev);const r=j.primary||j.compact;let res='';if(j.compact&&j.compact.checks)res=j.compact.checks.map(c=>(c.healthy?'✓':'✗')+' '+esc(c.url)+' — '+esc(c.detail)).join('<br>');else if(r&&r.summary)res=esc(r.summary).slice(0,240);
    return '<div class="job"><div class="jt"><div style="display:flex;align-items:center;gap:12px"><span class="jn">'+esc(pk.agent_name||pk.template_id||'Agent task')+'</span><span class="badge '+bcls+'">'+esc(j.status)+'</span></div><span class="ai">'+(calls||0)+' AI</span></div>'+
      '<div class="bar"><div class="fill '+(cls==='run'?'run':cls==='fail'?'fail':'')+'" style="width:'+p+'%"></div></div>'+
      '<div class="meta">'+esc(stageName(j,ev))+' · '+p+'% · template: <b>'+esc(pk.template_id||'')+'</b></div>'+
      '<div class="params" onclick="this.classList.toggle(&quot;open&quot;)"><div><b>objective:</b> '+esc((pk.objective||'').slice(0,160))+'</div><div class="more"><b>domains:</b> '+esc((pk.allowed_domains||[]).join(', ')||'—')+' · <b>urls:</b> '+((pk.urls||[]).length)+' · <b>limits:</b> '+esc(JSON.stringify(pk.limits||{}))+'<br><b>hashes:</b> packet '+esc(String(j.packet_hash||'').slice(0,12))+'… memory '+esc(String(j.memory_hash||'').slice(0,12))+'…'+(res?'<br><b>result:</b> '+res:'')+'</div></div></div>';};
  const grp=(arr)=>{if(!arr.length)return'';const byP={};arr.forEach(j=>{(byP[project(j)]=byP[project(j)]||[]).push(j)});return Object.keys(byP).sort().map(pr=>'<div class="proj">'+esc(pr)+' · '+byP[pr].length+'</div>'+byP[pr].map(card).join('')).join('')};
  $('jobs').innerHTML=(run.length?'<div class="proj" style="color:var(--gold)">Running now</div>'+run.map(card).join(''):'')+(done.length?grp(done):'')||'<div class="gate">No jobs yet. Kick one off and it shows here live.</div>';
  // per-day (params logged per day)
  const byDay={};jobs.forEach(j=>{const k=dayKey(j.created_at);byDay[k]=byDay[k]||{jobs:0,ai:0};byDay[k].jobs++;byDay[k].ai+=aiCalls(j,ev)});
  const days=Object.keys(byDay).sort().reverse().slice(0,7);
  $('days').innerHTML=days.map(k=>'<div class="day"><div class="d">'+k.slice(5)+'</div><div class="v">'+byDay[k].jobs+'</div><div class="s">jobs · '+byDay[k].ai+' AI</div></div>').join('')||'';
  // per-agent
  const per={};jobs.forEach(j=>{const n=(j.packet&&j.packet.agent_name)||'—';per[n]=per[n]||{jobs:0,calls:0};per[n].jobs++;per[n].calls+=aiCalls(j,ev)});
  $('crew').innerHTML=((d.agent_profiles||[]).map(a=>{const s=per[a.name]||{jobs:0,calls:0};return '<div class="mem"><div class="mn"><b>'+esc(a.name)+'</b><span class="amt">'+s.jobs+' job'+(s.jobs===1?'':'s')+' · '+s.calls+' AI</span></div><div class="mr">'+esc(a.role_title||a.template_id||(a.system?'office manager':''))+'</div><div class="md">'+esc(a.description||'')+'</div></div>'}).join(''))||'<div class="gate">No agents yet.</div>';
  // skills + templates
  const cat=d.catalog||{};
  $('skills').innerHTML=(cat.skills||[]).map(s=>'<div class="row"><div style="min-width:0"><div class="rid">'+esc(s.title)+'</div><div class="rd">'+esc(s.purpose)+'</div><div class="rd" style="color:var(--muted);opacity:.8">'+esc(s.folder||'')+' · auto: '+esc((s.automatic_for||[]).join(', ')||'—')+'</div></div><span class="lane">'+esc(s.lane||'')+'</span></div>').join('')||'<div class="gate">No skills.</div>';
  $('templates').innerHTML=(cat.templates||[]).map(t=>{const c=t.deterministic?0:(t.verifier?2:1);return '<div class="row"><div style="min-width:0"><div class="rid">'+esc(t.title)+' <span style="color:var(--muted)">'+esc(t.id)+'</span></div><div class="rd">'+esc(t.purpose)+'</div></div><span class="lane">'+(c?c+' AI':'0 AI')+'</span></div>'}).join('');
  // how it works
  const ct=cat.capability_tree||{};const li=a=>(a||[]).map(x=>'<li>'+esc(x)+'</li>').join('')||'<li style="color:var(--muted)">—</li>';
  $('how').innerHTML='<div class="ph" style="border:0"><b>What every worker CAN do</b></div><ul class="cap">'+li(ct.can)+'</ul>'+
    '<div class="ph" style="border-top:1px solid var(--line)"><b>What it can NEVER do</b></div><ul class="cap no">'+li(ct.cannot)+'</ul>'+
    '<div class="ph" style="border-top:1px solid var(--line)"><b>Escalates to a human when…</b></div><ul class="cap">'+li(ct.escalates_when)+'</ul>'+
    '<div class="ph" style="border-top:1px solid var(--line)"><b>What the crew has learned</b><span>versioned, reviewed lessons</span></div>'+((cat.learning_log||[]).map(l=>'<div class="row"><div><div class="rid">'+esc(l.added)+'</div><div class="rd">'+esc(l.meaning)+'</div></div><span class="lane">v'+esc(l.version||'')+'</span></div>').join('')||'<div class="gate">No lessons yet.</div>');
}
function gate(){$('jobs').innerHTML='<div class="gate">This console needs an operator session.<br>Unlock it, then reload.<br><a href="/">Unlock the console →</a></div>';$('pmeta').textContent='locked';}
load();setInterval(load,3000);
</script></body></html>`;
