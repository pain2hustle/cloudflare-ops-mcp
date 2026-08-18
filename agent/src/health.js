export function evaluateHealthSource(source, expectedText = "") {
  const status = Number(source?.status);
  const statusOk = Number.isInteger(status) && status >= 200 && status < 300;
  const marker = String(expectedText || "").trim();
  const textMatch = !marker || String(source?.text || "").toLowerCase().includes(marker.toLowerCase());
  const healthy = statusOk && textMatch;
  const detail = healthy
    ? "HTTP reachable"
    : (!statusOk
        ? (source?.error || `Unexpected status ${source?.status || "unknown"}`)
        : `Expected text not found: ${marker}`);
  return { healthy, status: Number.isInteger(status) ? status : null, textMatch, detail };
}
