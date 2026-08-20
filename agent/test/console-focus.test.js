import test from "node:test";
import assert from "node:assert/strict";
import { renderConsole } from "../src/ui.js";
import { WT_CONSOLE_HTML } from "../src/wt-console.js";

function inlineScript(html) {
  const scripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g));
  assert.ok(scripts.length, "expected an inline script");
  return scripts.at(-1)[1];
}

test("both generated browser scripts compile", () => {
  assert.doesNotThrow(() => new Function(inlineScript(renderConsole())));
  assert.doesNotThrow(() => new Function(inlineScript(WT_CONSOLE_HTML)));
});

test("creating a job opens the live terminal and focuses the returned job", () => {
  const html = renderConsole();
  assert.match(html, /window\.open\("about:blank","amhWtTerminal"/);
  assert.match(html, /const created=await api\("\/api\/jobs"/);
  assert.match(html, /focusJob\(created\.id\)/);
  assert.match(html, /\/console\?job=/);
  assert.match(html, /node\.dataset\.jobId=job\.id/);
  assert.match(html, /scrollIntoView/);
});

test("terminal console keeps the requested job highlighted without repeated scrolling", () => {
  assert.match(WT_CONSOLE_HTML, /URLSearchParams\(location\.search\)\.get\('job'\)/);
  assert.match(WT_CONSOLE_HTML, /data-job-id=/);
  assert.match(WT_CONSOLE_HTML, /classList\.add\('focused'\)/);
  assert.match(WT_CONSOLE_HTML, /if\(focusPending\).*scrollIntoView/);
  assert.match(WT_CONSOLE_HTML, /focusPending=false/);
});

test("both running and completed terminal jobs remain newest-first", () => {
  assert.match(WT_CONSOLE_HTML, /filter\(j=>RUN\.includes\(j\.status\)\)\.sort\(\(a,b\)=>tnum\(b\)-tnum\(a\)\)/);
  assert.match(WT_CONSOLE_HTML, /filter\(j=>!RUN\.includes\(j\.status\)\)\.sort\(\(a,b\)=>tnum\(b\)-tnum\(a\)\)/);
});
