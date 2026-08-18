import { launch } from "@cloudflare/playwright";
import { cleanText, validateUrl } from "./contracts.js";

function stripHtml(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}

async function fetchPage(url, maxChars) {
  const response = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": "AMH-WT-Research/0.1 (+https://github.com/pain2hustle/cloudflare-ops-mcp)" },
  });
  if (response.status >= 300 && response.status < 400) return { ok: false, status: response.status, needsBrowser: true, error: `redirect ${response.status}`, location: response.headers.get("location") || null };
  if (!response.ok) return { ok: false, status: response.status, needsBrowser: response.status === 403, error: `HTTP ${response.status}` };
  const type = response.headers.get("content-type") || "";
  if (!/text|json|xml|html/i.test(type)) return { ok: false, status: response.status, needsBrowser: false, error: `unsupported content-type ${type}` };
  const raw = (await response.text()).slice(0, maxChars * 4);
  const text = /<body|<main|<article|<!doctype/i.test(raw) ? stripHtml(raw) : raw.replace(/\s+/g, " ").trim();
  return { ok: text.length > 180, status: response.status, needsBrowser: text.length <= 180, title: "", text: cleanText(text, maxChars), method: "fetch" };
}

async function browserPage(binding, url, maxChars, allowedDomains) {
  const browser = await launch(binding);
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => {
      const request = route.request();
      if (["image", "media", "font", "websocket"].includes(request.resourceType())) return route.abort();
      try { validateUrl(request.url(), allowedDomains); } catch { return route.abort(); }
      return ["GET", "HEAD"].includes(request.method()) ? route.continue() : route.abort();
    });
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    validateUrl(page.url(), allowedDomains);
    return {
      ok: true,
      status: response?.status() || 200,
      title: cleanText(await page.title(), 300),
      text: cleanText(await page.locator("body").innerText(), maxChars),
      method: "playwright",
    };
  } finally {
    await browser.close();
  }
}

export async function crawlSources(env, packet, onEvent = async () => {}) {
  const output = [];
  let browserCalls = 0;
  const maxBrowserCalls = Math.max(0, Math.min(Number(env.MAX_BROWSER_CALLS || 1), 4));
  const perSource = Math.max(1000, Math.floor(packet.limits.max_source_chars / Math.max(packet.urls.length, 1)));
  for (const raw of packet.urls) {
    const url = validateUrl(raw, packet.allowed_domains);
    await onEvent("crawl_start", { url });
    let item;
    try {
      item = await fetchPage(url, perSource);
      if (packet.template_id !== "site_health" && (!item.ok || item.needsBrowser) && env.BROWSER && browserCalls < maxBrowserCalls) {
        browserCalls += 1;
        item = await browserPage(env.BROWSER, url, perSource, packet.allowed_domains);
      }
    } catch (error) {
      item = { ok: false, error: cleanText(error?.message || error, 500), method: "failed" };
    }
    output.push({ url, ...item });
    await onEvent("crawl_complete", { url, ok: !!item.ok, status: item.status || null, method: item.method, chars: item.text?.length || 0, error: item.error || null });
  }
  return output;
}
