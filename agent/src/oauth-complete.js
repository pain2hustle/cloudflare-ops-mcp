const MESSAGE_TYPE = "amh-mcp-oauth";

// Escape a value for safe embedding inside an inline <script>. Covers the HTML
// script-breakers (< > &) plus the two Unicode line separators U+2028/U+2029,
// which are valid in JSON but illegal as raw JS source. Everything here uses
// \u escapes — a raw separator character in the regex literal would break it.
function jsonForScript(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    const code = char.charCodeAt(0);
    return "\\u" + code.toString(16).padStart(4, "0");
  });
}

export function mcpOAuthCompletionResponse(result) {
  const ok = result?.authSuccess === true;
  const serverId = ok && typeof result.serverId === "string" ? result.serverId.slice(0, 80) : null;
  const payload = jsonForScript({
    type: MESSAGE_TYPE,
    ok,
    serverId,
    error: ok ? null : "Cloudflare authorization did not complete.",
  });
  const state = ok ? "connected" : "error";
  const title = ok ? "Cloudflare connected" : "Cloudflare connection needs attention";
  const detail = ok
    ? "Authorization is complete. The harness is discovering the connector tools now."
    : "Authorization was not completed. Return to the console and try the guided connection again.";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${title}</title>
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07140d;color:#eaf7ee;font:16px/1.5 system-ui,sans-serif}.card{max-width:540px;margin:20px;padding:28px;border:1px solid #244b33;border-radius:18px;background:#0d2015;box-shadow:0 20px 70px #0007}.mark{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:13px;background:#6ee7a3;color:#062013;font-weight:900}h1{margin:15px 0 8px}p{color:#a9c4b2}a{display:inline-block;margin-top:10px;padding:11px 15px;border-radius:10px;background:#6ee7a3;color:#062013;font-weight:850;text-decoration:none}</style></head>
<body><main class="card"><span class="mark">WT</span><h1>${title}</h1><p>${detail}</p><p id="closeNote">This window will return to the console automatically.</p><a href="/?oauth=${state}">Return to console</a></main>
<script>const message=${payload};try{if(window.opener&&!window.opener.closed){window.opener.postMessage(message,window.location.origin);document.getElementById("closeNote").textContent="Done, closing this window";setTimeout(()=>window.close(),700)}else{setTimeout(()=>window.location.replace("/?oauth="+(message.ok?"connected":"error")),1000)}}catch(_){setTimeout(()=>window.location.replace("/?oauth="+(message.ok?"connected":"error")),1000)}</script></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
