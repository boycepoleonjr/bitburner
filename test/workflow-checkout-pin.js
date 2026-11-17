// Guard: claude-code-review.yml must pin actions/checkout to the exact reviewed SHA with its "# v7.0.1" comment
// and keep persist-credentials: false (claude-code-action does not clear a persisted checkout token; see the comment in the workflow).
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW = ".github/workflows/claude-code-review.yml";
const PINNED_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const PINNED_VERSION = "v7.0.1";

// Returns a list of problems; empty means every actions/checkout use is the exact pinned SHA with "# v7.0.1"
// and its step sets persist-credentials: false.
export function checkoutPinProblems(yaml) {
  const lines = yaml.split("\n");
  const problems = [];
  let found = 0;
  lines.forEach((l, i) => {
    const m = l.match(/^(\s*)(?:-\s*)?uses:\s*actions\/checkout@(\S+)(?:\s*#\s*(\S+))?/);
    if (!m) return;
    found++;
    const [, , ref, comment] = m;
    if (ref !== PINNED_SHA) problems.push(`checkout@${ref} is not the pinned SHA ${PINNED_SHA}`);
    if (comment !== PINNED_VERSION) problems.push(`checkout@${ref} version comment is ${comment ? `"# ${comment}"` : "missing"}, expected "# ${PINNED_VERSION}"`);
    // The step's "with:" block runs until the next step ("- ") or a less-indented line.
    let persist = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*-\s/.test(lines[j]) || /^\S/.test(lines[j])) break;
      if (/^\s*persist-credentials:\s*false\s*$/.test(lines[j])) persist = true;
    }
    if (!persist) problems.push(`checkout@${ref} does not set persist-credentials: false`);
  });
  if (!found) return ["no actions/checkout step found"];
  return problems;
}

const SHA = PINNED_SHA;
const OTHER = "11d5960a326750d5838078e36cf38b85af677262";
const step = (u, persist = "      persist-credentials: false\n") => `steps:\n  - name: Checkout\n    uses: ${u}\n    with:\n      fetch-depth: 1\n${persist}`;
const tests = [
  ["real claude-code-review.yml pins checkout to the v7.0.1 SHA with persist-credentials: false", () => assert.deepEqual(checkoutPinProblems(fs.readFileSync(WORKFLOW, "utf8")), [])],
  ["accepts the pinned SHA with # v7.0.1 and persist-credentials: false", () => assert.deepEqual(checkoutPinProblems(step(`actions/checkout@${SHA} # ${PINNED_VERSION}`)), [])],
  ["rejects a floating tag", () => assert.match(checkoutPinProblems(step("actions/checkout@v7")).join(), /not the pinned SHA/)],
  ["rejects a different SHA", () => assert.match(checkoutPinProblems(step(`actions/checkout@${OTHER} # ${PINNED_VERSION}`)).join(), /not the pinned SHA/)],
  ["rejects the pinned SHA with a different version comment", () => assert.match(checkoutPinProblems(step(`actions/checkout@${SHA} # v4.4.0`)).join(), /expected "# v7\.0\.1"/)],
  ["rejects the pinned SHA without a version comment", () => assert.match(checkoutPinProblems(step(`actions/checkout@${SHA}`)).join(), /missing/)],
  ["rejects a checkout without persist-credentials", () => assert.match(checkoutPinProblems(step(`actions/checkout@${SHA} # ${PINNED_VERSION}`, "")).join(), /persist-credentials: false/)],
  ["rejects persist-credentials: true", () => assert.match(checkoutPinProblems(step(`actions/checkout@${SHA} # ${PINNED_VERSION}`, "      persist-credentials: true\n")).join(), /persist-credentials: false/)],
  ["does not borrow persist-credentials from the next step", () => assert.match(checkoutPinProblems(`${step(`actions/checkout@${SHA} # ${PINNED_VERSION}`, "")}  - name: Other\n    uses: x/y@z\n    with:\n      persist-credentials: false\n`).join(), /persist-credentials: false/)],
  ["fails when there is no checkout step", () => assert.deepEqual(checkoutPinProblems("steps:\n  - run: echo hi\n"), ["no actions/checkout step found"])],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e.message); }
}
process.exit(failed ? 1 : 0);
