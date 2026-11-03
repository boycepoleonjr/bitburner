// Guard: claude-code-review.yml must keep actions/checkout on a full-SHA pin whose version comment is < v5.
// checkout v6+ persists the token via includeIf.gitdir and claude-code-action does not clear it (see the comment in the workflow).
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW = ".github/workflows/claude-code-review.yml";

// Returns a list of problems; empty means every actions/checkout use is SHA-pinned with a "# vN.x.y" comment, N < 5.
export function checkoutPinProblems(yaml) {
  const uses = yaml.split("\n").map((l) => l.match(/^\s*(?:-\s*)?uses:\s*actions\/checkout@(\S+)(?:\s*#\s*(\S+))?/)).filter(Boolean);
  if (!uses.length) return ["no actions/checkout step found"];
  const problems = [];
  for (const [, ref, comment] of uses) {
    if (!/^[0-9a-f]{40}$/.test(ref)) problems.push(`checkout@${ref} is not a full commit SHA`);
    const major = /^v(\d+)(?:\.\d+)*$/.exec(comment || "");
    if (!major) problems.push(`checkout@${ref} has no "# vN.x.y" version comment`);
    else if (Number(major[1]) >= 5) problems.push(`checkout ${comment} is >= v5`);
  }
  return problems;
}

const SHA = "11d5960a326750d5838078e36cf38b85af677262";
const step = (u) => `steps:\n  - name: Checkout\n    uses: ${u}\n    with:\n      fetch-depth: 1\n`;
const tests = [
  ["real claude-code-review.yml is pinned below v5", () => assert.deepEqual(checkoutPinProblems(fs.readFileSync(WORKFLOW, "utf8")), [])],
  ["accepts SHA with v4 comment", () => assert.deepEqual(checkoutPinProblems(step(`actions/checkout@${SHA} # v4.4.0`)), [])],
  ["rejects a floating tag", () => assert.equal(checkoutPinProblems(step("actions/checkout@v4")).length >= 1, true)],
  ["rejects a v7 tag", () => assert.match(checkoutPinProblems(step("actions/checkout@v7")).join(), /not a full commit SHA/)],
  ["rejects a SHA labelled v7.0.1", () => assert.match(checkoutPinProblems(step(`actions/checkout@${SHA} # v7.0.1`)).join(), />= v5/)],
  ["rejects a SHA labelled v5", () => assert.match(checkoutPinProblems(step(`actions/checkout@${SHA} # v5`)).join(), />= v5/)],
  ["rejects a SHA without a version comment", () => assert.match(checkoutPinProblems(step(`actions/checkout@${SHA}`)).join(), /version comment/)],
  ["fails when there is no checkout step", () => assert.deepEqual(checkoutPinProblems("steps:\n  - run: echo hi\n"), ["no actions/checkout step found"])],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e.message); }
}
process.exit(failed ? 1 : 0);
