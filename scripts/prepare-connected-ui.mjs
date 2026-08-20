import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const input = path.resolve(process.argv[2] || "worker/public/WT-Connected.html");
const output = path.resolve(process.argv[3] || input);
let bundle = await readFile(input, "utf8");
const templatePattern = /(<script type="__bundler\/template">)([\s\S]*?)(<\/script>)/;

if (!templatePattern.test(bundle)) {
  throw new Error("WT Connected UI template payload is missing.");
}

bundle = bundle.replace(templatePattern, (_match, open, encoded, close) => {
  let page = JSON.parse(encoded);
  page = page
    .replace("<html><head>", '<html lang="en"><head>\n<title>Connected — Walrus Tusk // AMH</title>')
    .replace(/\s*<a\s+href="https:\/\/cfops\.nothingunseen\.com"[\s\S]*?<\/a>/gi, "")
    .replace(/\s*<a\s+href="https:\/\/nothingunseen\.com"[\s\S]*?<\/a>/gi, "")
    .replaceAll('href="WT Landing.dc.html"', 'href="https://artificialmindhive.com/WalrusTooth"')
    .replaceAll('href="WT Docs.dc.html"', 'href="https://artificialmindhive.com/wtdocs"')
    .replaceAll('href="WT Agents.dc.html"', 'href="https://console.artificialmindhive.com/console"')
    .replaceAll('href="WT FAQ.dc.html"', 'href="https://artificialmindhive.com/wtfaq"')
    .replaceAll('href="AMH Agent Console.dc.html"', 'href="https://console.artificialmindhive.com/console"')
    .replaceAll('href="WT Console Unlock.dc.html"', 'href="https://console.artificialmindhive.com/console"')
    .replace(/https:\/\/cfops\.nothingunseen\.com\/mcp/gi, "https://mcp.artificialmindhive.com/mcp")
    .replace(/https:\/\/cfops\.nothingunseen\.com/gi, "https://mcp.artificialmindhive.com")
    .replace(/cfops_[A-Za-z0-9_-]+/g, "cfops_YOUR_CONNECTOR_KEY");
  return open + JSON.stringify(page).replace(/</g, "\\u003c") + close;
});

bundle = bundle
  .replace(/https:\/\/cfops\.nothingunseen\.com\/mcp/gi, "https://mcp.artificialmindhive.com/mcp")
  .replace(/https:\/\/cfops\.nothingunseen\.com/gi, "https://mcp.artificialmindhive.com")
  .replace(/https:\/\/nothingunseen\.com/gi, "https://artificialmindhive.com")
  .replace(/cfops_[A-Za-z0-9_-]+/g, "cfops_YOUR_CONNECTOR_KEY")
  .replace(/[ \t]+$/gm, "");

await writeFile(output, bundle, "utf8");
console.log(`Prepared sanitized WT Connected UI: ${output}`);
