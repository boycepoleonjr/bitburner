# Feedback ledger

The ledger of findings for the hosted Bitburner run. The loop it belongs to is in `docs/specs/feedback-loop.md`; the hourly
supervisor routine reads this file first (`docs/feedback/routine-prompt.md`). `test/feedback-ledger.js` checks the format.

## Entry format

One fenced `yaml` block per entry. Every field is one line, `key: value`. Free-text values are double-quoted JSON strings
(escape `"` as `\"`); `id`, `found`, `severity`, `detector` and `status` are bare tokens. No nesting, no lists, no multi-line
values. Do not put any other `yaml` block in this file: the test treats each one as an entry.

```text
id: F-NNN                      # unique, never reused
title: "short name"
found: YYYY-MM-DD
severity: HIGH | MED | LOW
evidence: "file:line or API field, with the observed value"
root_cause: "why it happens"
signal: "what should have flagged it earlier (a measurable condition)"
detector: none | flag | test  # none = nothing detects it yet; flag = a live attention flag; test = a CI test
recorded_in: "where the signal is written (a data/ file, check-in attention, CI check)"
consumer: "who reads it and what they do with it"
proposed_fix: "file + change (NOT applied by the ledger)"
owner_decision: "what the owner must decide, or none"
status: open | in-progress | closed | wontfix
```

Rules (details in the spec): a HIGH entry that is open must name a real signal; an entry is not `closed` while `detector` is
`none`; fixes are never applied by the routine unless `owner_decision` records an approval.

## Entries

```yaml
id: F-001
title: "RAM manager sends all spare RAM to share while hacking level is the bottleneck"
found: 2026-11-02
severity: HIGH
evidence: "data/ram-status.txt alloc {money:0, share:74.97M GB, xp:0} with hackNeed:true; game/lib/ramplan.js:37 (share = w * usable) runs before the xp branch at :45; hack level 5750 -> 5759 in 7.6 h against 6000 needed (about 50 min per level)"
root_cause: "In phase late the strategy weight is 1, so allocate() gives share 100% of usable RAM whenever faction work is active. Nothing left to buy needs rep (aug-plan: nothing left to buy, NeuroFlux held), so xp gets 0."
signal: "ram-status hackNeed=true AND alloc.xp=0 AND alloc.share>90% of usable for more than 1 h, or the hack-level slope from telemetry-ring is below what the pred2 ETA assumes"
detector: none
recorded_in: "data/ram-status.txt reasons (new line) and a check-in attention flag; routine computes the hack-level slope from data/telemetry-ring.txt"
consumer: "hourly supervisor routine (reports; read-only); owner decides the change"
proposed_fix: "game/lib/ramplan.js allocate(): when hackNeed and the aug plan has no rep-gated step left, use share weight 0 (or let xp win over share). No-code option: bb settings set strategy.late=0 (owner's call). Add a regression test in test/ramplan.js."
owner_decision: "Approve strategy.late=0 or the allocate() change? Not approved yet."
status: open
```

```yaml
id: F-002
title: "Predictor 80% band covers far less than 80% of live outcomes"
found: 2026-11-02
severity: HIGH
evidence: "GET /api/report: 1732 scored, 55% in 80% band; data/pred-calib.txt policy q80 level=0.014, rep=0.002, money=0.062; last 200 resolved live predictions 46.5% in band; rep >3h with model quad 23% and money >3h planned 15%; game/agent/predictor.txt:140 (w = pol ? pol.q80 : Z80 * pick.sd) and :150 (q80 from the backtest, last 300 errors)"
root_cause: "q80 is one value per metric kind, sized from about 93k autocorrelated backtest samples (1.7k live) and applied to every horizon bucket, so long-horizon bands are far too tight."
signal: "live band coverage over the last 200 resolved predictions below 70%, per kind and horizon bucket"
detector: none
recorded_in: "data/pred-calib.txt field liveCoverage (new), shown in the check-in Predictions row as a warning"
consumer: "predictor calibrate(): widens the band by target/observed coverage; supervisor routine reports it"
proposed_fix: "game/agent/predictor.txt:140 minimal: w = Math.max(pol?.q80 ?? 0, Z80 * pick.sd, 0.15). Proper: compute q80 per kind and bucket from live-resolved errors at :150."
owner_decision: "none (calibration only, no game-side spending). Needs bb push and a predictor restart."
status: open
```

```yaml
id: F-003
title: "node.order tail: stale BN5, BN12 never maxes, BN15 and the all-maxed case are not handled"
found: 2026-11-02
severity: MED
evidence: "game/lib/nodectl.js:35-36 (first available of node.order, else recommendation); game/lib/augplan.js:19 DEFAULT_BN_ORDER has 12 before 6,7,8,13,14; :20 SF_MAX(12)=Infinity; :286 bnAvailable requires n <= 14; nodectl.js:63 reports 'autoSelect off' when nextBn is null because every Source-File is maxed; GET /api/settings node.order=[5,10] with SF5 already 3"
root_cause: "BN5 is dead in node.order. After SF10 reaches 3 the list falls through to the default order, where BN12 repeats forever and starves BN6, 7, 8, 13 and 14. BN15 is rejected. The dead-end message names the wrong cause. The recommendation text for BN2 is stale (the gang module shipped)."
signal: "planned node chain (next three destroys) contains BN12, is empty, or starts with a maxed Source-File; node.order contains a maxed BitNode"
detector: none
recorded_in: "data/aug-plan.txt node.pendingChain (new) and a check-in attention flag"
consumer: "supervisor routine; owner edits node.order"
proposed_fix: "Owner removes 5 from node.order. game/lib/augplan.js: move 12 to the end of DEFAULT_BN_ORDER or cap it; add an all-maxed message in nodectl.js:63; update the BN2 reason. Tests in test/augplan.js."
owner_decision: "Remove 5 from node.order? Cap or reorder BN12? Is BN15 in scope?"
status: open
```

```yaml
id: F-004
title: "Dependabot PR #27 would undo the checkout pin in claude-code-review.yml"
found: 2026-11-02
severity: MED
evidence: ".github/workflows/claude-code-review.yml:41 comment: held at checkout v4.4.0 because v6+ persists the token through includeIf.gitdir; PR #27 moves it to v7.0.1 (the file is synced from conventions v1.3.0, so it should also be edited upstream); the PR's test check last ran 2026-10-26, before the 2026-11-02 update"
root_cause: "Dependabot groups all workflow files and ignores the intentional pin. The pin is only a comment, so nothing fails when it is removed."
signal: "any open or merged diff that changes the checkout ref in claude-code-review.yml away from the pinned SHA"
detector: none
recorded_in: "CI test (new) that greps claude-code-review.yml for the pinned SHA; open Dependabot PR age in the routine report"
consumer: "CI (red check blocks the PR); supervisor routine lists stale Dependabot PRs"
proposed_fix: ".github/dependabot.yml: ignore actions/checkout in the two Claude workflows, or split the group. Then merge the rest of #27. Not touched by this ledger."
owner_decision: "Split PR #27 so the Claude workflows keep the pinned checkout? Not approved yet."
status: open
```

```yaml
id: F-005
title: "Silent-skip workflow paths and CI Node 22 against Dockerfile Node 26"
found: 2026-11-02
severity: MED
evidence: ".github/workflows/claude.yml:40 'Skip (no Claude secret configured)' only writes a notice and the job ends green; claude-code-review.yml:20-22 skips drafts, forks and bot authors (PR #27 claude-review check = skipped); .github/workflows/ci.yml:26 node-version 22 against Dockerfile:6 FROM node:26-bookworm-slim"
root_cause: "Skips are deliberate but unrecorded, and production runs a Node major that CI never tests."
signal: "a required or expected job concluding skipped, or a Dockerfile Node major different from the CI node-version"
detector: none
recorded_in: "CI test (new) comparing the Dockerfile FROM major with ci.yml node-version; skipped-job count in the routine report"
consumer: "CI (red on mismatch); supervisor routine"
proposed_fix: "claude.yml: fail with exit 1 when the secret is missing, like claude-code-review.yml. ci.yml: test the Dockerfile's Node major (add a matrix entry). Not applied."
owner_decision: "Run CI on Node 26 as well as 22, or pin the Dockerfile back to 22?"
status: open
```

```yaml
id: F-006
title: "Monitor workflow runs every 6-10 hours, not every 30 minutes"
found: 2026-11-02
severity: MED
evidence: ".github/workflows/monitor.yml:9 cron '7,37 * * * *'; the last six scheduled runs started 2026-11-01 18:32, 22:22, 11-02 01:47, 09:22, 19:44, 11-03 02:13 (gaps up to 10 h)"
root_cause: "GitHub throttles scheduled workflows; the monitor issues are not a reliable alarm."
signal: "time since the last successful Monitor run above 90 minutes"
detector: none
recorded_in: "supervisor routine report (Monitor last-run age); optionally a check-in attention flag from the container"
consumer: "owner (knows Monitor is best-effort); routine treats the container check-in as the primary alarm"
proposed_fix: "Have the container (server/checkin.js) raise the incident and attention flags itself and treat Monitor as a backup. No schedule change can fix GitHub's throttling."
owner_decision: "Accept Monitor as best-effort?"
status: open
```

```yaml
id: F-007
title: "data/telemetry.txt grows without bound (67 MB)"
found: 2026-11-02
severity: LOW
evidence: "ns.read length of data/telemetry.txt = 67446704 bytes (AGENTS.md and game/lib/data-sources.js:24 say about 19-20 MB); no rotation in game/agent/telemetry.js; the predictor re-parses it at every check-in (game/agent/predictor.txt resolve())"
root_cause: "Append-only history for the predictor with no retention."
signal: "telemetry.txt above 100 MB, or check-in duration rising"
detector: none
recorded_in: "data/ram-status or check-in warn line with the file size"
consumer: "supervisor routine; owner approves rotation"
proposed_fix: "Rotate per install or keep the last N days; keep a compact history for the backtest. Not applied."
owner_decision: "How much history should the predictor keep?"
status: open
```

```yaml
id: F-008
title: "Log noise and visibility gaps (stale gang status, duplicate start lines, backup age)"
found: 2026-11-02
severity: LOW
evidence: "data/gang-status.txt t=1792675271164 (11 days old, enabled:true); data/events.txt '04:46:30 [daemon] started' with daemon uptime 143 h; 98 cityBlocked audit lines; in-browser backup lands about every 90 min (game/agent/checkin-lib.txt:13 gates on 60 min, check-ins run every 45); server backup age is not exposed by any GET endpoint (server/index.js:171-173)"
root_cause: "Idle modules leave their last status behind; start attempts log even when the process is already running; backup age is only visible on disk."
signal: "gang-status older than 24 h while gang.js is not running; a 'started' line for a script that is already running; backup age above 2 h"
detector: none
recorded_in: "/healthz field lastBackupAgeMin (new) and the routine report"
consumer: "supervisor routine"
proposed_fix: "gang.js writes a final {disabled} status on exit; dedupe the start log; add lastBackupAgeMin to /healthz in server/index.js."
owner_decision: "none"
status: open
```

```yaml
id: F-009
title: "AGENTS.txt in the game differs from the deployed repo copy (permanent drift flag)"
found: 2026-11-02
severity: LOW
evidence: "GET /api/drift: differ [AGENTS.txt], 85 files checked, sha 25e5fdd; the same attention item sits in every check-in report"
root_cause: "The mirror is only refreshed by bb push; nobody has pushed AGENTS.txt since the repo copy changed."
signal: "drift attention item present for more than 24 h"
detector: flag
recorded_in: "check-in attention (server/drift.js) and GET /api/drift"
consumer: "supervisor routine; whoever runs bb push"
proposed_fix: "bb push AGENTS.txt (after this PR merges and deploys). A permanent flag trains readers to ignore attention items."
owner_decision: "none"
status: open
```
