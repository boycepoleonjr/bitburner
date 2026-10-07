// Parse-checks the in-game code without running it: game/**/*.js as ES modules, and the page-context
// game/agent/*.txt libraries (eval'd in the page by bb js / checkin) as async function bodies.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const files = execFileSync("git", ["ls-files", "game"], { encoding: "utf8" }).split("\n").filter(Boolean);
const AsyncFunction = (async () => {}).constructor;
let bad = 0, checked = 0;
for (const f of files) {
  try {
    if (f.endsWith(".js")) execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
    else if (/^game\/agent\/[^/]+\.txt$/.test(f)) new AsyncFunction(fs.readFileSync(f, "utf8"));
    else continue;
    checked++;
  } catch (e) {
    bad++;
    console.error(`FAIL ${f}\n${String(e.stderr || e.message).trim()}\n`);
  }
}
console.log(bad ? `${bad} file(s) failed to parse` : `parsed ${checked} game files OK`);
process.exit(bad ? 1 : 0);
