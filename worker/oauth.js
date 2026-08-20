// Cloudflare OAuth for the hosted connector. Cloudflare tokens stay server-side
// in KV; each user's opaque key maps to exactly one OAuth connection.
const AUTH_URL = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
// offline_access requests a refresh token so the 1-hour access token can be
// auto-renewed (refreshConnection) instead of the connection dying hourly and
// forcing a manual reconnect. Without it Cloudflare returns no refresh_token.
// 2026-08-19: added the Workers scopes. Without them the connector could read
// DNS but every Workers/Pages call returned "Authentication error" (code 10000),
// so who_serves_domain reported "Nothing claims this domain" for domains that
// are plainly served by a Worker. Verified against the Cloudflare OAuth client
// API — Pages has NO valid OAuth scope, so Pages work still needs wrangler.
const DEFAULT_SCOPES = ["zone.read", "dns.write", "email-routing-address.write", "email-routing-rule.write", "cache.purge", "challenge-widgets.write", "workers-scripts.write", "workers-routes.write", "workers-tail.read", "account-settings.read", "offline_access"];
const STATE_TTL_SECONDS = 600;
const REFRESH_SKEW_MS = 60_000;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extraHeaders },
  });
}

function requireOAuthEnv(env) {
  const missing = [];
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID) missing.push("CLOUDFLARE_OAUTH_CLIENT_ID");
  if (!env.CLOUDFLARE_OAUTH_CLIENT_SECRET) missing.push("CLOUDFLARE_OAUTH_CLIENT_SECRET");
  if (!env.CLOUDFLARE_OAUTH_REDIRECT_URI) missing.push("CLOUDFLARE_OAUTH_REDIRECT_URI");
  if (!env.CLOUDFLARE_OPS_OAUTH) missing.push("CLOUDFLARE_OPS_OAUTH KV binding");
  return missing;
}

function cleanTenant(value) {
  return String(value || "default").trim().replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120) || "default";
}

function b64url(bytes) {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function timingSafeEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right))),
  ]);
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(leftHash, rightHash);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function bearerFromRequest(request) {
  const auth = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  return bearer || (request.headers.get("x-mcp-key") || "").trim();
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function renderConnectedHtmlExact(origin, connectorKey, env) {
  if (!env.ASSETS) throw new Error("WT Connected UI asset binding is unavailable.");
  const assetResponse = await env.ASSETS.fetch(new Request(new URL("/WT-Connected.html", origin)));
  if (!assetResponse.ok) throw new Error("WT Connected UI asset could not be loaded.");
  let bundle = await assetResponse.text();
  const templatePattern = /(<script type="__bundler\/template">)([\s\S]*?)(<\/script>)/;
  if (!templatePattern.test(bundle)) throw new Error("WT Connected UI template payload is missing.");

  bundle = bundle.replace(templatePattern, (_match, open, encoded, close) => {
    let page = JSON.parse(encoded);
    page = page
      .replace(/\s*<a\s+href="https:\/\/cfops\.nothingunseen\.com"[\s\S]*?<\/a>/gi, "")
      .replace(/\s*<a\s+href="https:\/\/nothingunseen\.com"[\s\S]*?<\/a>/gi, "")
      .replaceAll('href="WT Landing.dc.html"', 'href="https://artificialmindhive.com/WalrusTooth"')
      .replaceAll('href="WT Docs.dc.html"', 'href="https://artificialmindhive.com/wtdocs"')
      .replaceAll('href="WT Agents.dc.html"', 'href="https://console.artificialmindhive.com/console"')
      .replaceAll('href="WT FAQ.dc.html"', 'href="https://artificialmindhive.com/wtfaq"')
      .replaceAll('href="AMH Agent Console.dc.html"', 'href="https://console.artificialmindhive.com/console"')
      .replaceAll('href="WT Console Unlock.dc.html"', 'href="https://console.artificialmindhive.com/console"')
      .replaceAll('href="/docs"', 'href="https://artificialmindhive.com/wtdocs"')
      .replaceAll('href="/agents"', 'href="https://console.artificialmindhive.com/console"')
      .replaceAll('href="/faq"', 'href="https://artificialmindhive.com/wtfaq"')
      .replaceAll('href="/console"', 'href="https://console.artificialmindhive.com/console"')
      .replaceAll('href="/"', 'href="https://artificialmindhive.com/WalrusTooth"')
      .replace(/https:\/\/mcp\.artificialmindhive\.com\/mcp/gi, `${origin}/mcp`)
      .replace(/https:\/\/cfops\.nothingunseen\.com\/mcp/gi, `${origin}/mcp`)
      .replace(/https:\/\/cfops\.nothingunseen\.com/gi, origin)
      .replace(/cfops_[A-Za-z0-9_-]+/g, connectorKey);
    return open + JSON.stringify(page).replace(/</g, "\\u003c") + close;
  });

  return bundle
    .replace(/https:\/\/mcp\.artificialmindhive\.com\/mcp/gi, `${origin}/mcp`)
    .replace(/https:\/\/cfops\.nothingunseen\.com\/mcp/gi, `${origin}/mcp`)
    .replace(/https:\/\/cfops\.nothingunseen\.com/gi, origin)
    .replace(/https:\/\/nothingunseen\.com/gi, "https://artificialmindhive.com")
    .replace(/cfops_[A-Za-z0-9_-]+/g, connectorKey);
}

function renderConnectedHtml(origin, connectorKey) {
  const claudeConfig = JSON.stringify({
    mcpServers: { cloudflareOps: { url: `${origin}/mcp`, headers: { Authorization: `Bearer ${connectorKey}` } } },
  }, null, 2);
  const codexConfig = `codex mcp add cloudflare-ops --url ${origin}/mcp --bearer-token-env-var CFOPS_CONNECTOR_KEY\n\n# Set CFOPS_CONNECTOR_KEY to the one-time key shown above.`;
  const cursorConfig = JSON.stringify({
    mcpServers: { cloudflareOps: { url: `${origin}/mcp`, headers: { Authorization: `Bearer ${connectorKey}` } } },
  }, null, 2);
  const safeOrigin = escapeHtml(origin);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>Cloudflare connected · Walrus Tusk</title><style>
  :root{color-scheme:dark;--bg:#06100c;--panel:#091711;--panel2:#0c1e16;--line:#1c3a2c;--line2:#2b5541;--green:#4cdc82;--green2:#8df0b4;--cream:#f3ead6;--muted:#9db3a6;--orange:#f0b46a;--danger:#ff806d;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Consolas,monospace;--display:Impact,"Arial Black",sans-serif}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-height:100vh;background:var(--bg);color:var(--cream);font:15px/1.65 Inter,system-ui,-apple-system,Segoe UI,sans-serif;background-image:linear-gradient(rgba(76,220,130,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(76,220,130,.025) 1px,transparent 1px),radial-gradient(circle at 15% 0%,#123c28 0,transparent 34%);background-size:34px 34px,34px 34px,auto}.shell{width:min(1180px,calc(100% - 28px));margin:auto}.top{position:sticky;top:0;z-index:4;border-bottom:1px solid var(--line);background:rgba(6,16,12,.94);backdrop-filter:blur(16px)}.nav{min-height:66px;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--cream)}.mark{width:38px;height:38px;border:1px solid var(--green);display:grid;place-items:center;color:var(--green);font:900 12px var(--mono);clip-path:polygon(0 0,76% 0,100% 24%,100% 100%,0 100%)}.wordmark{font:900 13px var(--mono);letter-spacing:.14em;text-transform:uppercase}.navlinks{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.navlinks a,.linkbtn{color:var(--muted);text-decoration:none;font:800 10px var(--mono);letter-spacing:.13em;text-transform:uppercase;border:1px solid var(--line);padding:9px 12px}.navlinks a:hover,.linkbtn:hover{color:var(--green);border-color:var(--green)}.connected{display:inline-flex;align-items:center;gap:8px;color:var(--green);border:1px solid var(--line2);padding:9px 12px;font:800 10px var(--mono);letter-spacing:.13em;text-transform:uppercase}.dot{width:7px;height:7px;background:var(--green);box-shadow:0 0 12px var(--green);animation:pulse 2s infinite}@keyframes pulse{50%{opacity:.4}}main{padding:clamp(34px,6vw,78px) 0 70px}.hero{display:grid;grid-template-columns:1.35fr .65fr;gap:24px;align-items:stretch}.eyebrow{color:var(--green);font:900 11px var(--mono);letter-spacing:.2em;text-transform:uppercase}.hero h1{margin:16px 0 18px;font:900 clamp(44px,8vw,92px)/.9 var(--display);letter-spacing:-.025em;text-transform:uppercase;max-width:830px}.hero h1 span{color:var(--green)}.lead{max-width:740px;color:#c3d4c9;font-size:16px}.statuscard{border:1px solid var(--line2);background:linear-gradient(145deg,rgba(76,220,130,.08),rgba(9,23,17,.95));padding:24px;clip-path:polygon(0 0,calc(100% - 24px) 0,100% 24px,100% 100%,0 100%)}.statuscard strong{display:block;font:900 24px var(--display);text-transform:uppercase}.statuscard ul{padding:0;margin:20px 0 0;list-style:none}.statuscard li{border-top:1px solid var(--line);padding:11px 0;color:var(--muted);font:700 11px var(--mono)}.statuscard li:before{content:"✓";color:var(--green);margin-right:10px}.section{margin-top:28px;border:1px solid var(--line);background:rgba(9,23,17,.92);padding:clamp(20px,4vw,36px)}.sectionhead{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:20px}.kicker{color:var(--orange);font:900 10px var(--mono);letter-spacing:.2em;text-transform:uppercase}.section h2{margin:4px 0 0;font:900 clamp(25px,4vw,42px)/1 var(--display);text-transform:uppercase}.keybox{display:grid;grid-template-columns:1fr auto;border:1px solid var(--line2);background:#020906}.key{padding:18px;color:var(--green2);font:800 13px var(--mono);word-break:break-all;overflow:auto}.copy{border:0;border-left:1px solid var(--line2);background:var(--green);color:#041009;padding:0 22px;min-height:58px;cursor:pointer;font:900 11px var(--mono);letter-spacing:.1em;text-transform:uppercase}.copy:hover{background:var(--green2)}.warning{margin:15px 0 0;border-left:3px solid var(--orange);padding:10px 14px;color:var(--muted);font-size:13px}.roles{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.role{border:1px solid var(--line);background:var(--panel2);padding:20px}.role b{display:block;color:var(--green);font:900 11px var(--mono);letter-spacing:.16em;text-transform:uppercase}.role h3{margin:9px 0;font:900 23px var(--display);text-transform:uppercase}.role p{margin:0;color:var(--muted);font-size:13px}.configs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.config{display:flex;flex-direction:column;min-width:0;border:1px solid var(--line);background:#020906}.confighead{display:flex;align-items:center;justify-content:space-between;padding:14px;border-bottom:1px solid var(--line)}.confighead strong{font:900 12px var(--mono);letter-spacing:.12em;text-transform:uppercase}.config pre{margin:0;padding:16px;min-height:230px;max-height:300px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:#b9d8c6;font:11px/1.6 var(--mono)}.config .copy{border:0;border-top:1px solid var(--line2);min-height:45px;width:100%}.next{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;counter-reset:step}.step{counter-increment:step;border-top:2px solid var(--green);background:var(--panel2);padding:20px}.step:before{content:"0" counter(step);display:block;color:var(--orange);font:900 12px var(--mono)}.step h3{margin:8px 0;font:900 19px var(--display);text-transform:uppercase}.step p{margin:0;color:var(--muted);font-size:13px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.primary{background:var(--green);color:#041009;border-color:var(--green)}.footer{border-top:1px solid var(--line);padding:28px 0;color:#60786a;font:11px var(--mono)}.footerrow{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.footer a{color:var(--muted);text-decoration:none}.footer a:hover{color:var(--green)}#toast{position:fixed;right:18px;bottom:18px;z-index:10;background:var(--green);color:#041009;padding:12px 16px;font:900 11px var(--mono);text-transform:uppercase;transform:translateY(100px);opacity:0;transition:.2s}#toast.on{transform:none;opacity:1}@media(max-width:860px){.hero,.roles,.configs,.next{grid-template-columns:1fr}.navlinks a{display:none}.hero h1{font-size:clamp(42px,15vw,72px)}.config pre{min-height:150px}.sectionhead{align-items:start;flex-direction:column}}@media(max-width:520px){.shell{width:min(100% - 18px,1180px)}.wordmark{font-size:10px}.connected{padding:7px;font-size:8px}.section{padding:18px}.keybox{grid-template-columns:1fr}.keybox .copy{border-left:0;border-top:1px solid var(--line2);min-height:46px}.hero h1{font-size:42px}}
  </style></head><body><header class="top"><div class="shell nav"><a class="brand" href="https://artificialmindhive.com/WalrusTooth"><span class="mark">WT</span><span class="wordmark">Walrus Tusk // AMH</span></a><nav class="navlinks" aria-label="Connected page navigation"><a href="https://artificialmindhive.com/wtdocs">Docs</a><a href="https://console.artificialmindhive.com/console">Console</a><span class="connected"><span class="dot"></span>OAuth connected</span></nav></div></header><main class="shell"><section class="hero"><div><div class="eyebrow">Cloudflare Ops MCP // Connection complete</div><h1>Your cloud.<br><span>Your control.</span></h1><p class="lead">Your Cloudflare account is connected to Walrus Tusk. The private Cloudflare credential stays server-side. You receive a separate one-user connector key for your AI client.</p></div><aside class="statuscard"><span class="eyebrow">Connection status</span><strong>Secure lane ready</strong><ul><li>Per-user Cloudflare OAuth</li><li>Owner API key never shared</li><li>Writes remain approval-gated</li><li>Connector can be revoked</li></ul></aside></section><section class="section" aria-labelledby="key-title"><div class="sectionhead"><div><div class="kicker">01 // Save this now</div><h2 id="key-title">Your connector key</h2></div><span class="eyebrow">Shown once</span></div><div class="keybox"><div class="key" id="connector-key">${escapeHtml(connectorKey)}</div><button class="copy" type="button" data-copy="connector-key">Copy key</button></div><p class="warning"><strong>This is for the user to save.</strong> It is not a Cloudflare API token. Treat it like a password and do not paste it into public Git, screenshots, or support posts.</p></section><section class="section" aria-labelledby="roles-title"><div class="sectionhead"><div><div class="kicker">02 // Who does what</div><h2 id="roles-title">You, your AI, and WT</h2></div></div><div class="roles"><article class="role"><b>You // Owner</b><h3>Choose and approve</h3><p>Save the connector key, add one configuration below, and approve any real Cloudflare write before it happens.</p></article><article class="role"><b>Your AI // Operator</b><h3>Ask and explain</h3><p>Claude, Codex, Cursor, or another MCP client calls the tools, reads results, shows the plan, and asks before guarded changes.</p></article><article class="role"><b>Walrus Tusk // Safety</b><h3>Protect and verify</h3><p>WT keeps Cloudflare credentials server-side, hashes connector keys, refreshes OAuth, blocks unsafe defaults, and returns evidence.</p></article></div></section><section class="section" aria-labelledby="config-title"><div class="sectionhead"><div><div class="kicker">03 // Pick your AI client</div><h2 id="config-title">Copy one setup</h2></div><span class="eyebrow">MCP endpoint: ${safeOrigin}/mcp</span></div><div class="configs"><article class="config"><div class="confighead"><strong>Claude Desktop</strong></div><pre id="claude-config">${escapeHtml(claudeConfig)}</pre><button class="copy" type="button" data-copy="claude-config">Copy Claude config</button></article><article class="config"><div class="confighead"><strong>Codex CLI</strong></div><pre id="codex-config">${escapeHtml(codexConfig)}</pre><button class="copy" type="button" data-copy="codex-config">Copy Codex command</button></article><article class="config"><div class="confighead"><strong>Cursor</strong></div><pre id="cursor-config">${escapeHtml(cursorConfig)}</pre><button class="copy" type="button" data-copy="cursor-config">Copy Cursor config</button></article></div></section><section class="section" aria-labelledby="next-title"><div class="sectionhead"><div><div class="kicker">04 // Finish the connection</div><h2 id="next-title">What happens next</h2></div></div><div class="next"><article class="step"><h3>Copy</h3><p>Save the connector key and copy the configuration for the AI app you actually use.</p></article><article class="step"><h3>Add and restart</h3><p>Place the configuration in that app's MCP settings, then restart or reload its MCP connections.</p></article><article class="step"><h3>Ask naturally</h3><p>Try: “Use Cloudflare Ops to scan my zone. Do not change anything. Show me the plan first.”</p></article></div><div class="actions"><a class="linkbtn primary" href="https://console.artificialmindhive.com/console">Open Agent Console</a><a class="linkbtn" href="https://artificialmindhive.com/wtdocs">Read WT Docs</a><a class="linkbtn" href="https://github.com/pain2hustle/cloudflare-ops-mcp">View source</a></div></section></main><footer class="footer"><div class="shell footerrow"><span>-/\\-\\ M H // WALRUS TUSK · Service Pricer LLC</span><span><a href="https://artificialmindhive.com/privacy">Privacy</a> · <a href="https://artificialmindhive.com/terms">Terms</a> · <a href="https://github.com/pain2hustle/cloudflare-ops-mcp/blob/main/SECURITY.md">Security</a></span></div></footer><div id="toast" role="status" aria-live="polite">Copied</div><script>
  (function(){var toast=document.getElementById('toast');var timer;async function copyText(text){if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return}var area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove()}document.addEventListener('click',async function(event){var button=event.target.closest('[data-copy]');if(!button)return;var target=document.getElementById(button.getAttribute('data-copy'));if(!target)return;try{await copyText(target.textContent);var old=button.textContent;button.textContent='Copied ✓';toast.classList.add('on');clearTimeout(timer);timer=setTimeout(function(){toast.classList.remove('on');button.textContent=old},1800)}catch(error){toast.textContent='Copy failed — select it manually';toast.classList.add('on')}})})();
  </script></body></html>`;
}

export function getOAuthScopes(env) {
  return String(env.CLOUDFLARE_OAUTH_SCOPES || DEFAULT_SCOPES.join(" ")).split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean);
}

export async function authorizeConnector(env, provided) {
  if (!provided) return { ok: false, reason: "missing_connector_key" };
  if (env.MCP_ACCESS_KEY && await timingSafeEqual(provided, env.MCP_ACCESS_KEY)) {
    return { ok: true, mode: "admin", connectionId: null };
  }
  if (!env.CLOUDFLARE_OPS_OAUTH) return { ok: false, reason: "oauth_storage_unavailable" };
  const keyHash = await sha256Hex(provided);
  const raw = await env.CLOUDFLARE_OPS_OAUTH.get(`session:${keyHash}`);
  if (!raw) return { ok: false, reason: "invalid_connector_key" };
  const session = JSON.parse(raw);
  if (!session.connection_id) return { ok: false, reason: "invalid_connector_session" };
  const connection = await env.CLOUDFLARE_OPS_OAUTH.get(`connection:${session.connection_id}`);
  if (!connection) return { ok: false, reason: "connection_revoked" };
  return { ok: true, mode: "oauth", connectionId: session.connection_id, keyHash };
}

export async function handleOAuthStart(request, env) {
  const missing = requireOAuthEnv(env);
  if (missing.length) return json({ ok: false, error: "oauth_not_configured", missing }, 503);
  const state = randomToken();
  const connectionId = randomToken(18);
  await env.CLOUDFLARE_OPS_OAUTH.put(`state:${state}`, JSON.stringify({
    connection_id: connectionId,
    created_at: Date.now(),
  }), { expirationTtl: STATE_TTL_SECONDS });

  const auth = new URL(AUTH_URL);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", env.CLOUDFLARE_OAUTH_CLIENT_ID);
  auth.searchParams.set("redirect_uri", env.CLOUDFLARE_OAUTH_REDIRECT_URI);
  auth.searchParams.set("scope", getOAuthScopes(env).join(" "));
  auth.searchParams.set("state", state);
  return Response.redirect(auth.toString(), 302);
}

export async function handleOAuthCallback(request, env) {
  const missing = requireOAuthEnv(env);
  if (missing.length) return json({ ok: false, error: "oauth_not_configured", missing }, 503);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) return json({ ok: false, error: "cloudflare_oauth_error", detail: oauthError }, 400);
  if (!code || !state) return json({ ok: false, error: "missing_code_or_state" }, 400);

  const raw = await env.CLOUDFLARE_OPS_OAUTH.get(`state:${state}`);
  if (!raw) return json({ ok: false, error: "bad_or_expired_state" }, 400);
  await env.CLOUDFLARE_OPS_OAUTH.delete(`state:${state}`);
  const pending = JSON.parse(raw);
  if (!pending.connection_id) return json({ ok: false, error: "invalid_oauth_state" }, 400);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.CLOUDFLARE_OAUTH_REDIRECT_URI,
    client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID,
    client_secret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET,
  });
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenJson = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenJson.access_token) {
    return json({
      ok: false,
      error: "token_exchange_failed",
      status: tokenResponse.status,
      detail: tokenJson.error || tokenJson.error_description || "unknown",
    }, 502);
  }

  const now = Date.now();
  const record = {
    provider: "cloudflare",
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token || null,
    token_type: tokenJson.token_type || "bearer",
    scope: tokenJson.scope || getOAuthScopes(env).join(" "),
    expires_at: tokenJson.expires_in ? now + Number(tokenJson.expires_in) * 1000 : null,
    connected_at: now,
    updated_at: now,
  };
  await env.CLOUDFLARE_OPS_OAUTH.put(`connection:${pending.connection_id}`, JSON.stringify(record));

  const connectorKey = `cfops_${randomToken()}`;
  const keyHash = await sha256Hex(connectorKey);
  await env.CLOUDFLARE_OPS_OAUTH.put(`session:${keyHash}`, JSON.stringify({
    connection_id: pending.connection_id,
    provider: "cloudflare",
    created_at: now,
  }));
  return new Response(await renderConnectedHtmlExact(url.origin, connectorKey, env), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, private",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com blob:; script-src 'unsafe-inline' blob:; img-src data: blob:; font-src data: blob: https://fonts.gstatic.com; frame-src blob:; worker-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    },
  });
}

async function refreshConnection(env, connectionId, record) {
  if (!record.refresh_token) throw new Error("Cloudflare OAuth connection expired. Reconnect Cloudflare to continue.");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: record.refresh_token,
    client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID,
    client_secret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET,
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error("Cloudflare OAuth refresh failed. Reconnect Cloudflare to continue.");
  }
  const now = Date.now();
  const updated = {
    ...record,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || record.refresh_token,
    token_type: payload.token_type || record.token_type || "bearer",
    scope: payload.scope || record.scope,
    expires_at: payload.expires_in ? now + Number(payload.expires_in) * 1000 : null,
    updated_at: now,
  };
  await env.CLOUDFLARE_OPS_OAUTH.put(`connection:${connectionId}`, JSON.stringify(updated));
  return updated;
}

export async function getOAuthAccessToken(env, authContext, legacyTenant = "default") {
  if (!authContext?.ok) return null;
  if (authContext.mode === "admin") {
    if (env.CLOUDFLARE_OPS_OAUTH) {
      const legacy = await env.CLOUDFLARE_OPS_OAUTH.get(`token:${cleanTenant(legacyTenant)}`);
      if (legacy) return JSON.parse(legacy).access_token || env.CLOUDFLARE_API_TOKEN || null;
    }
    return env.CLOUDFLARE_API_TOKEN || null;
  }
  if (!env.CLOUDFLARE_OPS_OAUTH || !authContext.connectionId) return null;
  const raw = await env.CLOUDFLARE_OPS_OAUTH.get(`connection:${authContext.connectionId}`);
  if (!raw) return null;
  let record = JSON.parse(raw);
  if (record.expires_at && record.expires_at <= Date.now() + REFRESH_SKEW_MS) {
    record = await refreshConnection(env, authContext.connectionId, record);
  }
  return record.access_token || null;
}

export async function handleOAuthStatus(request, env) {
  const authContext = await authorizeConnector(env, bearerFromRequest(request));
  if (!authContext.ok) {
    return json({ ok: false, connected: false, error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
  }
  if (authContext.mode === "admin") {
    return json({ ok: true, connected: !!env.CLOUDFLARE_API_TOKEN, mode: "admin" });
  }
  const raw = await env.CLOUDFLARE_OPS_OAUTH.get(`connection:${authContext.connectionId}`);
  if (!raw) return json({ ok: true, connected: false });
  const record = JSON.parse(raw);
  return json({
    ok: true,
    connected: true,
    provider: "cloudflare",
    scope: record.scope,
    expires_at: record.expires_at,
    connected_at: record.connected_at,
  });
}

export async function handleOAuthRevoke(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const authContext = await authorizeConnector(env, bearerFromRequest(request));
  if (!authContext.ok || authContext.mode !== "oauth") {
    return json({ ok: false, error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
  }
  await Promise.all([
    env.CLOUDFLARE_OPS_OAUTH.delete(`session:${authContext.keyHash}`),
    env.CLOUDFLARE_OPS_OAUTH.delete(`connection:${authContext.connectionId}`),
  ]);
  return json({ ok: true, disconnected: true });
}

export function getOAuthConfigStatus(env, origin = "") {
  const missing = requireOAuthEnv(env);
  return {
    configured: missing.length === 0,
    missing,
    scopes: getOAuthScopes(env),
    routes: {
      start: `${origin}/oauth/cloudflare/start`,
      callback: `${origin}/oauth/cloudflare/callback`,
      status: `${origin}/oauth/cloudflare/status`,
      revoke: `${origin}/oauth/cloudflare/revoke`,
      mcp: `${origin}/mcp`,
    },
  };
}
