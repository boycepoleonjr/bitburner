# Handoff 2026-11-02: feedback loop (docs + test only)

- **What:** the self-improving loop from the 2026-11-02 audit. `docs/specs/feedback-loop.md` (Detect -> Record -> Triage -> Fix ->
  Verify -> Learn and its rules), `docs/feedback/ledger.md` (F-001..F-009, one yaml block each), `docs/feedback/routine-prompt.md`
  (proposed read-only hourly supervisor prompt), `test/feedback-ledger.js` + `test/helpers/ledger.js` (validator), and a short
  "Feedback loop" section in AGENTS.md.
- **Not done on purpose:** no fixes. Every ledger `proposed_fix` is unapplied: nothing in `game/`, `server/`, settings,
  `node.order`, Dependabot, PR #27 or `.github/workflows` was touched. No live-game writes.
- **State:** all ledger entries are `open`. Detectors: F-009 has a flag (drift); the rest are `none` until their fix PRs land.
- **Owner decisions pending** (also in each entry's `owner_decision`): F-001 `strategy.late=0` or an `allocate()` change; F-003
  remove BN5 from `node.order`, cap or reorder BN12, BN15 scope; F-004 split Dependabot PR #27 so the Claude workflows keep the
  pinned checkout; F-005 test Node 26 in CI or pin the Dockerfile to 22; F-006 accept Monitor as best-effort; F-007 telemetry
  retention; whether the routine may ever apply approved actions.
- **After merge:** paste `docs/feedback/routine-prompt.md` into the claude.ai routine "Bitburner hourly check-in (hosted)" (not
  done from the repo). Optionally `bb push AGENTS.txt` to clear the F-009 drift flag once the deploy includes this merge.
- **Resume:** one fix PR per finding, each adding a regression test or a flag, then set the entry to `closed` in the same PR
  (the validator refuses `closed` with `detector: none`). Check the ledger alone with `node test/feedback-ledger.js`.
