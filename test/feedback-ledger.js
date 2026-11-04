// Checks docs/feedback/ledger.md against the rules in docs/specs/feedback-loop.md, plus the validator's own failure modes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLedger, validateLedger, FIELDS } from "./helpers/ledger.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("ok  " + name); } catch (e) { console.error("FAIL " + name + "\n  " + (e.message || e).split("\n").join("\n  ")); process.exitCode = 1; } };

const base = {
  id: "F-001", title: '"t"', found: "2026-11-02", severity: "MED", evidence: '"file.js:1"', root_cause: '"r"', signal: '"s"', detector: "flag",
  recorded_in: '"data/x.txt"', consumer: '"routine"', proposed_fix: '"f"', owner_decision: '"none"', status: "open",
};
const entry = (over = {}, drop = []) => {
  const o = { ...base, ...over };
  return "```yaml\n" + FIELDS.filter((f) => !drop.includes(f)).map((f) => `${f}: ${o[f]}`).join("\n") + "\n```\n";
};
const doc = (...entries) => "# ledger\n\n" + entries.join("\n");
const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected an error matching ${re}, got: ${JSON.stringify(errs)}`);

test("a valid entry passes", () => assert.deepEqual(validateLedger(doc(entry())), []));
test("several valid entries pass", () => assert.deepEqual(validateLedger(doc(entry(), entry({ id: "F-002", severity: "HIGH" }), entry({ id: "F-003", status: "closed", detector: "test" }))), []));
test("comments and blank lines inside a block are ignored", () => assert.deepEqual(validateLedger(doc(entry().replace("title:", "# note\n\ntitle:"))), []));
test("text outside yaml blocks is not an entry", () => assert.equal(parseLedger("```text\nid: F-9\n```\n" + entry()).entries.length, 1));
test("an empty ledger fails", () => has(validateLedger("# nothing here"), /no entries/));

for (const f of FIELDS) test(`missing field ${f} fails`, () => has(validateLedger(doc(entry({}, [f]))), new RegExp(`missing required field "${f}"`)));
test("an empty value fails", () => has(validateLedger(doc(entry({ evidence: '""' }))), /missing required field "evidence"/));
test("unknown field fails", () => has(validateLedger(doc(entry().replace("```\n", 'extra: "x"\n```\n'))), /unknown field "extra"/));
test("duplicate field fails", () => has(validateLedger(doc(entry().replace("```\n", 'title: "again"\n```\n'))), /duplicate field "title"/));
test("bad line fails", () => has(validateLedger(doc(entry().replace("```\n", "no colon here\n```\n"))), /not "key: value"/));
test("unquoted free text fails", () => has(validateLedger(doc(entry({ evidence: "plain text" }))), /evidence must be a double-quoted string/));
test("broken JSON string fails", () => has(validateLedger(doc(entry({ evidence: '"unterminated' }))), /not a valid double-quoted JSON string/));
test("quoted enum fails", () => has(validateLedger(doc(entry({ severity: '"HIGH"' }))), /severity must be a bare token/));
test("values may contain colons and escaped quotes", () => {
  const { entries } = parseLedger(doc(entry({ evidence: '"a: b \\"q\\" c"' })));
  assert.equal(entries[0].evidence, 'a: b "q" c');
});

test("unknown severity fails", () => has(validateLedger(doc(entry({ severity: "CRITICAL" }))), /unknown severity "CRITICAL"/));
test("unknown status fails", () => has(validateLedger(doc(entry({ status: "done" }))), /unknown status "done"/));
test("unknown detector fails", () => has(validateLedger(doc(entry({ detector: "alert" }))), /unknown detector "alert"/));
test("bad id fails", () => has(validateLedger(doc(entry({ id: "X-1" }))), /id must look like F-001/));
test("bad date fails", () => { has(validateLedger(doc(entry({ found: "2026-13-40" }))), /real YYYY-MM-DD/); has(validateLedger(doc(entry({ found: "11/02/2026" }))), /real YYYY-MM-DD/); });
test("duplicate id fails", () => has(validateLedger(doc(entry(), entry())), /F-001: duplicate id/));

test("HIGH and open without a signal fails", () => has(validateLedger(doc(entry({ severity: "HIGH", signal: '""' }))), /missing required field "signal"/));
test("HIGH and open with a placeholder signal fails", () => {
  for (const s of ["none", "TBD", "n/a", "-"]) has(validateLedger(doc(entry({ severity: "HIGH", signal: `"${s}"` }))), /HIGH and open needs a real signal/);
});
test("HIGH and in-progress with a placeholder signal fails", () => has(validateLedger(doc(entry({ severity: "HIGH", status: "in-progress", signal: '"tbd"' }))), /HIGH and in-progress needs a real signal/));
test("HIGH open with detector none passes when the signal is real", () => assert.deepEqual(validateLedger(doc(entry({ severity: "HIGH", detector: "none" }))), []));
test("a LOW open entry may have a placeholder signal", () => assert.deepEqual(validateLedger(doc(entry({ severity: "LOW", signal: '"none"' }))), []));
test("closed with detector none fails", () => has(validateLedger(doc(entry({ status: "closed", detector: "none" }))), /cannot be closed while detector is none/));
test("closed with a flag or test passes", () => { for (const d of ["flag", "test"]) assert.deepEqual(validateLedger(doc(entry({ status: "closed", detector: d }))), []); });
test("wontfix with detector none passes", () => assert.deepEqual(validateLedger(doc(entry({ status: "wontfix", detector: "none" }))), []));

test("docs/feedback/ledger.md is valid", () => {
  const errs = validateLedger(fs.readFileSync(path.join(root, "docs/feedback/ledger.md"), "utf8"));
  assert.deepEqual(errs, []);
});
test("the ledger keeps the seeded F-001..F-009 as its first entries (later findings may be appended)", () => {
  const { entries } = parseLedger(fs.readFileSync(path.join(root, "docs/feedback/ledger.md"), "utf8"));
  assert.deepEqual(entries.slice(0, 9).map((e) => e.id), Array.from({ length: 9 }, (_, i) => `F-00${i + 1}`));
});
test("appending a new finding (F-010) to the real ledger keeps it valid", () => {
  const md = fs.readFileSync(path.join(root, "docs/feedback/ledger.md"), "utf8");
  assert.deepEqual(validateLedger(md + "\n" + entry({ id: "F-010" })), []);
  assert.deepEqual(parseLedger(md + "\n" + entry({ id: "F-010" })).entries.length, parseLedger(md).entries.length + 1);
});

console.log(`\n${passed} feedback-ledger checks passed${process.exitCode ? " (with failures)" : ""}`);
