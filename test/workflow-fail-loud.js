// Guard (ledger F-005): .github/workflows/claude.yml must fail, not skip with a notice, when no Claude secret is set.
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW = ".github/workflows/claude.yml";

/** Problems found in the missing-secret guard step; empty means there is a step guarded by HAS_CLAUDE_AUTH != 'true' that errors and exits 1. */
export function missingSecretProblems(yaml) {
  const steps = yaml.split(/^\s*- (?=name:|uses:|run:)/m).slice(1);
  const guards = steps.filter((st) => /^\s*if:\s*env\.HAS_CLAUDE_AUTH\s*!=\s*'true'\s*$/m.test(st));
  if (!guards.length) return ["no step guarded by `env.HAS_CLAUDE_AUTH != 'true'` (a missing secret would skip silently)"];
  const problems = [];
  for (const g of guards) {
    if (!/::error::/.test(g)) problems.push("the missing-secret step does not emit ::error::");
    if (!/^\s*exit 1\s*$/m.test(g)) problems.push("the missing-secret step does not `exit 1`");
    if (/::notice::/.test(g)) problems.push("the missing-secret step still emits ::notice::");
  }
  return problems;
}

const wf = (guard) => `jobs:\n  claude:\n    steps:\n      - uses: actions/checkout@abc\n        if: env.HAS_CLAUDE_AUTH == 'true'\n${guard}      - uses: x/y@v1\n        if: env.HAS_CLAUDE_AUTH == 'true'\n`;
const GOOD = `      - name: Require a Claude secret\n        if: env.HAS_CLAUDE_AUTH != 'true'\n        run: |\n          echo "::error::no secret"\n          exit 1\n`;
const NOTICE = `      - name: Skip\n        if: env.HAS_CLAUDE_AUTH != 'true'\n        run: echo "::notice::Set a secret."\n`;
const tests = [
  ["the real claude.yml fails loudly without a secret", () => assert.deepEqual(missingSecretProblems(fs.readFileSync(WORKFLOW, "utf8")), [])],
  ["accepts an error plus exit 1", () => assert.deepEqual(missingSecretProblems(wf(GOOD)), [])],
  ["rejects the old notice-only skip", () => { const p = missingSecretProblems(wf(NOTICE)).join(); assert.match(p, /::error::/); assert.match(p, /exit 1/); assert.match(p, /::notice::/); }],
  ["rejects an error without exit 1", () => assert.match(missingSecretProblems(wf(GOOD.replace("          exit 1\n", ""))).join(), /exit 1/)],
  ["rejects an exit 1 without an error annotation", () => assert.match(missingSecretProblems(wf(GOOD.replace('echo "::error::no secret"', 'echo "no secret"'))).join(), /::error::/)],
  ["rejects a workflow with no guard step at all", () => assert.match(missingSecretProblems(wf("")).join(), /no step guarded/)],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e.message); }
}
process.exit(failed ? 1 : 0);
