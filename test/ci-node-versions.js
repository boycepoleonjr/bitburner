// Guard (ledger F-005): the Node major in the Dockerfile must also be tested by CI (.github/workflows/ci.yml).
import assert from "node:assert/strict";
import fs from "node:fs";

/** Node major from the first `FROM node:<major>...` line, or null. */
export function dockerNodeMajor(dockerfile) {
  const m = /^\s*FROM\s+(?:--platform=\S+\s+)?node:(\d+)/im.exec(dockerfile);
  return m ? Number(m[1]) : null;
}
/** Every `node-version:` value in a workflow, as numbers (non-numeric values like lts/* are ignored). */
export function ciNodeMajors(workflow) {
  return [...workflow.matchAll(/^\s*node-version:\s*["']?(\d+)(?:\.[\d.x]*)?["']?\s*(?:#.*)?$/gm)].map((m) => Number(m[1]));
}
/** Problems found; empty means the Dockerfile's Node major is tested in CI. */
export function nodeVersionProblems(dockerfile, workflow) {
  const docker = dockerNodeMajor(dockerfile), ci = ciNodeMajors(workflow);
  if (docker == null) return ["no `FROM node:<major>` line found in the Dockerfile"];
  if (!ci.length) return ["no numeric node-version found in ci.yml"];
  return ci.includes(docker) ? [] : [`Dockerfile runs Node ${docker} but ci.yml only tests ${[...new Set(ci)].join(", ")}`];
}

const df = (tag) => `# base\nFROM node:${tag}\nWORKDIR /app\n`;
const wf = (...v) => v.map((n) => `      - uses: actions/setup-node@v7\n        with:\n          node-version: ${n}\n`).join("");
const tests = [
  ["the real Dockerfile's Node major is tested by the real ci.yml", () => assert.deepEqual(nodeVersionProblems(fs.readFileSync("Dockerfile", "utf8"), fs.readFileSync(".github/workflows/ci.yml", "utf8")), [])],
  ["ci.yml tests Node 22 and 26", () => assert.deepEqual(ciNodeMajors(fs.readFileSync(".github/workflows/ci.yml", "utf8")).sort(), [22, 26])],
  ["parses the Dockerfile major", () => { assert.equal(dockerNodeMajor(df("26-bookworm-slim")), 26); assert.equal(dockerNodeMajor(df("22.4.1-alpine")), 22); }],
  ["accepts a matching major", () => assert.deepEqual(nodeVersionProblems(df("26-bookworm-slim"), wf(22, 26)), [])],
  ["accepts quoted and dotted versions", () => assert.deepEqual(nodeVersionProblems(df("26-slim"), wf('"26"', "26.1.0")), [])],
  ["rejects a Dockerfile major CI does not test", () => assert.match(nodeVersionProblems(df("26-slim"), wf(22)).join(), /Dockerfile runs Node 26 but ci.yml only tests 22/)],
  ["rejects when the Dockerfile moves ahead (27)", () => assert.match(nodeVersionProblems(df("27-slim"), wf(22, 26)).join(), /Node 27/)],
  ["fails when the Dockerfile has no node base", () => assert.deepEqual(nodeVersionProblems("FROM ubuntu:24.04\n", wf(26)), ["no `FROM node:<major>` line found in the Dockerfile"])],
  ["fails when ci.yml has no numeric node-version", () => assert.deepEqual(nodeVersionProblems(df("26-slim"), "node-version: lts/*\n"), ["no numeric node-version found in ci.yml"])],
];

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e.message); }
}
process.exit(failed ? 1 : 0);
