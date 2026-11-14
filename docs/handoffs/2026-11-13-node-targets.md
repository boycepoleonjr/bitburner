# Handoff 2026-11-13: node.targets, BN12/BN15 handling, early warning, readiness specs

Branch `feat/node-targets`, PR boycepoleonjr/bitburner#51. Spec: `docs/specs/node-targets.md`. Ledger: F-003 (in-progress). No live game writes,
no `bb push`, no settings POST, no Railway change, no workflow edit.

## What changed (one commit per deliverable)
1. `node.targets` (setting type `intMap`, default `{}`): BitNode -> target Source-File level. Default target 3 for every node, **0 for BN12** (never
   auto-picked; explicit `{"12":N}` opts in, max 1000). `bnAvailable` / `firstAvailable` / `recommendNextBn` / `pickNextBn` respect it;
   `DEFAULT_BN_ORDER` keeps its order. Accepted input: JSON object, `12:5,3:0`, empty. Dashboard shows it as a text control with JSON.
2. BN15 selectable (range 1..15, `SF_MAX(15)=3` verified at v3.0.1, last in `DEFAULT_BN_ORDER`; `node.order` accepts 15). New state "every BitNode
   target is met": `ALL_MET`, `ALL_MET_FLAG`, node block `source: "all-targets-met"`, detail text, cancel of an open request, KPI "READY · every
   target met". It replaces the old "every Source-File is maxed" text (BN12 is not maxed) and never says "autoSelect off".
3. Early warning: `orderOutlook` / `orderWarning` in `lib/nodectl.js`, called every loop by `nodeOrderStep` in `agent/autopilot.js`. Flag
   `node.order running low (N left: BN7 x2) — ...` when `node.autoSelect` is on and 2 or fewer destroys are left (counted after the destroy in
   progress). Empty order warns only with `node.fallback=stop`. All three new flags are owner decisions (`OWNER_DECISION`, `OWNER_FLAG`,
   so the monitor workflow labels them `owner-decision`).
4. Docs: `docs/specs/bn8-readiness.md` (stock-trading module), `docs/specs/bn9-readiness.md` (hacknet hashes + no-cloud bootstrap),
   `docs/specs/node-readiness.md` (all 15 nodes, difficulty index, order). Nothing in `game/` implements them.

## Tests
`test/node-targets.js` (29), `test/ram-node-targets.js` (static RAM, 2), goldens generated from the code before the change
(`test/fixtures/node-targets-golden.json`: 143 Source-File states x 4 setting variants; `node-targets-ram-baseline.json`). Changed expectations,
all intended: BN12 default target 0 (`test/augplan.js`, `test/node-fallback.js`, the "SF12 never maxes" golden case now sets `{"12":100}`), BN15
(DEFAULT_BN_ORDER length 15, `node.order` max 15), the all-met wording. Results (Node 22.23): `npm ci` pass, `check-syntax` pass (85 files),
`npm test` pass (35 files), `npm audit --audit-level=high` pass (0 vulnerabilities). Node 26 runs in CI only.

## Findings worth knowing
- Every claim of the earlier research held against v3.0.1. Extra facts: BN8 `ScriptHackMoneyGain 0` (not only a multiplier) and
  `FavorToDonateToFaction 0` (rep is purchasable at once; `augs.donateAtFavor` default 150 still blocks that, fixed in the BN8 spec);
  BN15's Red Pill is `labyrinth.ts` after The Law (the code comment says "fourth lab"); BN13/14/15 challenge achievements ask us NOT to use
  Stanek's Gift / go.cheat / Heartbleed, which a bot that never uses them gets for free.
- Behavior change by design: with default settings BN12 is never picked or recommended; in the golden grid the 13 states where BN12 used to be
  picked now fall to the next node of the default order (6, 7, 8, ...).
- The BN2 `recommendNextBn` reason text is still the stale one (left untouched so the picks and texts stay byte-identical).
- The `hack` identifier in `lib/augplan.js` is a local variable the static RAM check already counts; the RAM test pins it.

## After merge (owner)
1. Merge, wait for the Railway deploy of that commit.
2. `bb push lib/augplan.js lib/nodectl.js lib/settings-schema.js lib/kpi.js lib/ui/settings-model.js lib/ui/views.js agent/autopilot.js`,
   restart `agent/autopilot.js` (sl-plan restarts with it) and `dashboard.js`, `bb note` what changed. The mirror of `AGENTS.txt` follows with
   `bb push AGENTS.txt`.
3. Nothing to set. BN12 stays out by default; to play it: `bb settings set node.targets='{"12":5}'`. To hold nodes the bot cannot play:
   `bb settings set node.targets='{"8":0,"9":0,"15":0}'` (not applied; the owner decides).
4. Check `GET /api/plan` (`node.source`) and the next check-in for `node.order running low`.

## Next
Decide which readiness spec to build first (recommendation: BN8, `docs/specs/bn8-readiness.md`; its first PR is a read-only spike).
Open questions are listed at the end of `docs/specs/node-readiness.md`.
