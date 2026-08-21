import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { chromium } from "playwright";
import { renderConnectedHtmlExact } from "../worker/oauth.js";

const expectedTitle = "Connected — Walrus Tusk // AMH";
const connectorKey = "cfops_RELEASE_GATE_CONNECTOR_KEY";
const csp = "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com blob:; script-src 'unsafe-inline' 'unsafe-eval' blob:; img-src data: blob:; font-src data: blob: https://fonts.gstatic.com; frame-src blob:; worker-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const bundle = await readFile(new URL("../worker/public/WT-Connected.html", import.meta.url), "utf8");
let rendered = "";

const server = http.createServer((_request, response) => {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-security-policy": csp,
    "content-type": "text/html; charset=utf-8",
  });
  response.end(rendered);
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
assert(address && typeof address === "object");
const origin = "http://127.0.0.1:" + address.port;
let browser;

try {
  rendered = await renderConnectedHtmlExact(origin, connectorKey, {
    ASSETS: { fetch: async () => new Response(bundle, { headers: { "content-type": "text/html" } }) },
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const response = await page.goto(origin, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200);
  await page.waitForFunction(
    () => document.body.innerText.toLowerCase().includes("your cloud."),
    null,
    { timeout: 20_000 },
  );

  assert.equal(await page.title(), expectedTitle);
  const bodyText = await page.locator("body").innerText();
  for (const text of [
    "Your cloud.",
    "Your control.",
    "You, your AI, and WT",
    "You // Owner",
    "Your AI // Operator",
    "Walrus Tusk // Safety",
    "Claude Desktop",
    "Codex CLI",
    "Cursor",
    "Artificial Mind Hive",
  ]) assert(bodyText.toLowerCase().includes(text.toLowerCase()), "Missing UI text: " + text);

  assert.equal(await page.locator('img[alt="Walrus Tusk"]').count(), 1, "WT logo must be present");
  assert.equal(await page.locator("img").count(), 4, "Expected WT/AMH image set changed");
  assert.equal(await page.locator("button").count(), 4, "Expected four copy controls");
  const brokenImages = await page.locator("img").evaluateAll((images) => images
    .filter((image) => !image.complete || image.naturalWidth === 0)
    .map((image) => image.alt || image.src));
  assert.deepEqual(brokenImages, []);

  const hrefs = await page.locator("a").evaluateAll((links) => links.map((link) => link.href));
  assert.equal(hrefs.some((href) => /nothingunseen|\.dc\.html/i.test(href)), false, "Legacy/dead links returned");
  assert(hrefs.includes("https://console.artificialmindhive.com/console"), "AMH console link missing");
  assert(bodyText.includes(origin + "/mcp"), "Rendered MCP endpoint missing");
  assert(bodyText.includes(connectorKey), "Rendered one-time connector key missing");

  const copyCases = [
    ["Copy key", connectorKey],
    ["Copy Claude config", "Bearer " + connectorKey],
    ["Copy Codex command", "codex mcp add cloudflare-ops"],
    ["Copy Cursor config", "Bearer " + connectorKey],
  ];
  for (const [buttonIndex, [label, expectedClipboardText]] of copyCases.entries()) {
    const button = page.locator("button").nth(buttonIndex);
    assert.equal((await button.innerText()).trim().toLowerCase(), label.toLowerCase());
    await button.click();
    assert.match((await button.innerText()).toLowerCase(), /copied/);
    await page.waitForFunction(
      (expected) => navigator.clipboard.readText().then((value) => value.includes(expected)),
      expectedClipboardText,
    );
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    assert(clipboardText.includes(expectedClipboardText), "Clipboard mismatch for " + label);
  }

  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(layout.scroll <= layout.viewport, "Mobile horizontal overflow detected");
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);

  console.log(JSON.stringify({
    status: "passed",
    title: expectedTitle,
    viewport: layout.viewport,
    buttons: 4,
    images: 4,
    brokenImages: 0,
    pageErrors: 0,
    legacyLinks: 0,
  }));
} finally {
  if (browser) await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
