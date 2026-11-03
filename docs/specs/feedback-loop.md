# Feedback loop (2026-11-02)

## Goal

Make the run improve itself. Every problem found by an audit, an incident or a supervisor routine becomes a ledger entry with
a **detector signal**, so the same problem is caught earlier next time, and nothing is closed on a promise.

Source: the 2026-11-02 health and correctness audit of the hosted run (findings F-001..F-009 in `docs/feedback/ledger.md`).

## Non-goals

- No change to game code, settings, `node.order`, Dependabot, PR #27 or `.github/workflows` in the PR that adds this loop.
  Every proposed fix in the ledger is a proposal; each needs its own PR and, where it spends in-game resources or changes a
  setting, the owner's approval.
- No new service, database or dependency. The ledger is a Markdown file in the repo; the validator is plain Node.
- The routine does not replace the container's own 45 min check-in (`server/checkin.js`, `BB_CHECKIN_AUTO=1`). It checks
  what that check-in does not.

## The loop

```
Detect -> Record -> Triage -> Fix -> Verify -> Learn
```

| Step | What happens | Where |
|---|---|---|
| Detect | A detector (attention flag, CI test, routine check) sees a condition. A human or agent audit can also find one by hand. | check-in `attention`, CI, routine |
| Record | An entry is added to the ledger with the fields below, including the signal that should have caught it. | `docs/feedback/ledger.md` |
| Triage | Severity is set (HIGH stalls progress or risks saves, MED degrades silently, LOW is noise or hygiene). Entries that need the owner carry the question in `owner_decision`. | ledger, owner |
| Fix | A separate PR, one per finding, with the normal rules in AGENTS.md (plan in `docs/specs/` for non-trivial work, regression tests for every path). | branch `<type>/<slug>` |
| Verify | The fix PR adds a regression test or a live detector, and the routine checks the signal against live data after the deploy. | `test/`, routine report |
| Learn | The entry moves to `closed` only when its `detector` is `test` or `flag`. The signal stays in the check for good, and the lesson goes into the handoff or `agent/PLAYBOOK.txt`. | ledger, handoff |

## Rules

1. **Every finding needs a detector signal.** Each entry names: the condition that should have flagged it earlier (`signal`),
   where that condition is recorded (`recorded_in`: a `data/` file, a check-in attention flag or a CI check), and who reads it
   (`consumer`). A finding without those three is not recorded.
2. **A finding is not closed without a regression test or a live detector.** `status: closed` requires `detector: test` or
   `detector: flag`. `wontfix` is the only way out without a detector, and it needs the owner's reason in `owner_decision`.
3. **Detectors fail loudly.** A detector that cannot run or cannot reach its data produces a red check or an attention flag
   saying so. It never skips, returns empty or reports "ok" without evidence. A routine reply says `UNKNOWN (reason)` for any
   check it could not complete.
4. **The hourly supervisor routine reads the ledger first.** For each entry whose status is `open` or `in-progress` it checks
   the `signal` against live data and answers "still true?" with evidence (field and value). It then adds any new findings in
   the ledger format. Procedure: `docs/feedback/routine-prompt.md`.
5. **The routine is read-only** unless a ledger entry's `owner_decision` records that the owner approved a specific action
   (who, when, which action). It never edits settings, writes game files, pushes, commits or merges on its own. New findings
   are reported in its reply for a human or a build session to add to the ledger.
6. **Severity rules.** A HIGH entry that is `open` or `in-progress` must have a real signal (not blank, `none` or `tbd`). Ledger
   ids are unique and never reused.
7. **Owner standing rules win.** A fix that touches aug buying order, NeuroFlux last, saves, game options or BitNode
   destruction follows AGENTS.md; the loop only records and verifies.

## Ledger format

`docs/feedback/ledger.md` holds one fenced `yaml` block per entry, with one-line `key: value` fields and double-quoted JSON
strings for text (full description in the ledger header). Fields: `id`, `title`, `found`, `severity` (HIGH, MED, LOW),
`evidence`, `root_cause`, `signal`, `detector` (none, flag, test), `recorded_in`, `consumer`, `proposed_fix`, `owner_decision`,
`status` (open, in-progress, closed, wontfix).

`detector` records how much of rule 1 exists today: `none` (nothing detects it), `flag` (a live attention flag), `test` (a CI
test). The routine can be the consumer of a signal while `detector` is still `none`; the field is about automatic detection.

## Acceptance criteria

- `docs/feedback/ledger.md` contains F-001..F-009, all valid.
- `npm test` runs `test/feedback-ledger.js`, which fails on: a missing required field, an unknown severity, status or detector,
  a duplicate id, a bad date or id, an unquoted text value, a HIGH open entry without a real signal, and a closed entry whose
  detector is `none`.
- `docs/feedback/routine-prompt.md` is a complete, read-only prompt that uses proxy auth only and produces the reply format
  below.
- AGENTS.md points to this spec outside the conventions markers.

## Routine reply format

1. `value.report` from `GET /api/report`, verbatim.
2. A **Ledger** table: `id | still true? | evidence`.
3. A **New findings** block in the ledger yaml format (or "none").
4. One `**Notes:**` line.

## Detectors still to build

These are the follow-up fixes in the ledger, each its own PR; this spec only makes them trackable:

| Ledger | Detector to add | Type |
|---|---|---|
| F-001 | `hackNeed && alloc.xp == 0 && alloc.share > 90%` for 1 h | attention flag |
| F-002 | live band coverage per kind and bucket below 70% | `pred-calib.txt` field + flag |
| F-003 | next-three-destroys chain contains BN12 or is empty | `aug-plan.txt` field + flag |
| F-004 | checkout pin in `claude-code-review.yml` unchanged | CI test |
| F-005 | Dockerfile Node major equals a tested CI Node major | CI test |
| F-006 | Monitor last successful run older than 90 min | routine report |
| F-007 | `telemetry.txt` above 100 MB | check-in warn |
| F-008 | `lastBackupAgeMin` in `/healthz` above 120 | `/healthz` field |
| F-009 | drift flag older than 24 h | attention flag (exists) |

## Risks

- A ledger that is never read becomes noise. Mitigation: the routine reads it every run and the validator keeps it parseable.
- A routine that "verifies" by inference could report entries as fixed. Mitigation: it must quote the field and value it
  checked, and say `UNKNOWN` when it cannot.
- Prompt injection through game files or GitHub text. Mitigation: the routine treats all fetched content as data and has no
  write path.

## Test plan

`test/feedback-ledger.js` (plain Node, auto-discovered by `test/run-all.js`; parser in `test/helpers/ledger.js`): one test
per failure mode with inline fixtures, plus a test that the real ledger is valid and holds F-001..F-009.
