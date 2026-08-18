import { spawn } from "node:child_process";
import path from "node:path";
import { verifyLive } from "./verify-live.mjs";

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const args = process.argv.slice(2);
const relativeDir = option(args, "--dir");
let publicUrl = option(args, "--url", "auto");
const publicPath = option(args, "--path", "/");
const expect = option(args, "--expect", "");
if (!relativeDir) {
  console.error("Usage: node scripts/deploy-verified.mjs --dir worker --url https://example.com/?format=json --expect 0.4.1");
  process.exit(2);
}
const cwd = path.resolve(process.cwd(), relativeDir);
const launcher = process.platform === "win32"
  ? {
      executable: process.execPath,
      args: [
        path.join(path.dirname(process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")), "npx-cli.js"),
        "wrangler",
        "deploy",
      ],
    }
  : { executable: "npx", args: ["wrangler", "deploy"] };
const childEnv = { ...process.env };
delete childEnv.CLOUDFLARE_API_TOKEN;
let output = "";
const child = spawn(launcher.executable, launcher.args, { cwd, env: childEnv, stdio: ["inherit", "pipe", "pipe"], windowsHide: true });
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    const value = chunk.toString();
    output += value;
    (stream === child.stdout ? process.stdout : process.stderr).write(value);
  });
}
const exitCode = await new Promise((resolve) => child.on("close", resolve));
if (exitCode !== 0) process.exit(exitCode || 1);
if (publicUrl === "auto") {
  const match = output.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev/);
  if (!match) {
    console.error("LAND FAILED: Wrangler deployed but no workers.dev URL was found. Pass --url explicitly.");
    process.exit(1);
  }
  publicUrl = match[0].replace(/\/$/, "") + (publicPath.startsWith("/") ? publicPath : `/${publicPath}`);
}
try {
  const receipt = await verifyLive({ url: publicUrl, expect, attempts: 12, intervalMs: 2500 });
  console.log("\nLAND VERIFIED");
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  console.error("\n" + JSON.stringify(error.receipt || { accepted: false, error: error.message }, null, 2));
  process.exit(1);
}
