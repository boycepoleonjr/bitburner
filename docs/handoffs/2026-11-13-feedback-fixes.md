# Handoff 2026-11-13: ledger fixes from the owner's 2026-11-02 decisions

Owner decisions (relayed by Aside) were turned into one PR per fix. None are merged by the agent; the game was not written to.

| PR | Ledger | What | After merge |
|---|---|---|---|
| #42 | F-001, F-003, F-004, F-006 | records decisions: F-001 and F-004 closed (fixed in #34 and #33, tests exist), F-003 and F-006 wontfix | nothing |
| #43 | F-005 | CI also runs the syntax check and `npm test` on Node 26 (same job `test`); `test/ci-node-versions.js` ties the Dockerfile's Node major to CI | nothing; the `claude.yml` missing-secret skip is still undecided |
| #44 | F-007 | `telemetry.txt` trimmed to `ui.telemetryRetentionDays` (default 7) at telemetry start and daily | `bb push agent/telemetry.js lib/telemetry-ring.js lib/settings-schema.js`, restart `agent/telemetry.js`, `bb note`; expect the predictor calibration to shift |
| #45 | F-010 (new) | server-side read-only token: `GET` status/drift/report/settings/plan/dashboard plus `POST /api/ro/read` and `/api/ro/query` | after the Railway deploy, owner stores `/data/state/readonly-token` (never printed) in the routine's environment; update `docs/feedback/routine-prompt.md` once approved |

Already done by others before this session: F-001 fix (#34, deployed, drift 0), checkout-pin test and deps split (#33), `node.order` now `[10,2,3,11]` (settings-log rev 6, by `aside:boyce-approved-2026-11-02`).

Still open: F-002 (predictor 80% band: 53% live coverage at 2415 scored, no decision yet), F-005 (claude.yml skip), F-007/F-010 until deployed and verified live, F-008 (noise items), F-009 (drift flag, now clear: `GET /api/drift` showed 0 files differ, so it can be closed with detector `flag`).

Resume: check each PR's CI and AI review, then verify the live signal for the entry you changed with the routine before setting it to `closed`. Do not change `docs/feedback/routine-prompt.md` until the owner approves the new wording.
