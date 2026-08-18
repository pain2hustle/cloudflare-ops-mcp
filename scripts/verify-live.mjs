import { createHash } from "node:crypto";

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

export async function verifyLive({ url, expect = "", attempts = 10, intervalMs = 3000, allowRedirect = false }) {
  if (!/^https:\/\//i.test(url)) throw new Error("Live verification URL must use HTTPS");
  const startedAt = new Date().toISOString();
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15000), headers: { "user-agent": "AMH-WT-Land-Gate/1.0", accept: "application/json,text/html;q=0.9,*/*;q=0.1" } });
      const body = await response.text();
      const redirected = response.status >= 300 && response.status < 400;
      const statusOk = response.status >= 200 && response.status < 300;
      const markerOk = !expect || body.includes(expect);
      const redirectOk = !redirected || allowRedirect;
      last = { attempt, status: response.status, status_ok: statusOk, marker_ok: markerOk, redirect_ok: redirectOk, location: response.headers.get("location"), body_bytes: new TextEncoder().encode(body).length, body_sha256: createHash("sha256").update(body).digest("hex") };
      if (statusOk && markerOk && redirectOk) return { accepted: true, url, expected_marker: expect || null, started_at: startedAt, verified_at: new Date().toISOString(), ...last };
    } catch (error) {
      last = { attempt, error: String(error?.message || error).slice(0, 400) };
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const error = new Error(`LAND FAILED: public acceptance check did not pass after ${attempts} attempts`);
  error.receipt = { accepted: false, url, expected_marker: expect || null, started_at: startedAt, failed_at: new Date().toISOString(), last };
  throw error;
}

const invokedPath = process.argv[1] ? new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href : "";
if (import.meta.url === invokedPath) {
  const url = option(process.argv, "--url");
  const expect = option(process.argv, "--expect", "");
  if (!url) {
    console.error("Usage: node scripts/verify-live.mjs --url https://example.com --expect expected-marker");
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(await verifyLive({ url, expect, attempts: Number(option(process.argv, "--attempts", "10")), intervalMs: Number(option(process.argv, "--interval-ms", "3000")), allowRedirect: process.argv.includes("--allow-redirect") }), null, 2));
  } catch (error) {
    console.error(JSON.stringify(error.receipt || { accepted: false, error: error.message }, null, 2));
    process.exit(1);
  }
}
