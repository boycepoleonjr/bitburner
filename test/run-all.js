// Runs every test/*.js file (except this one) in its own node process; smoke.js last because it starts a server.
// New test files are picked up automatically, so feature PRs never need to edit package.json.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "run-all.js")
  .sort((a, b) => (a === "smoke.js") - (b === "smoke.js") || a.localeCompare(b));
const only = process.argv.slice(2);
let failed = [];
for (const f of files) {
  if (only.length && !only.some((o) => f.includes(o))) continue;
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: "inherit", cwd: path.join(dir, "..") });
  if (r.status !== 0) failed.push(f);
}
console.log(failed.length ? `\nFAILED: ${failed.join(", ")}` : `\nall ${files.length} test files passed`);
process.exit(failed.length ? 1 : 0);
