# Readiness table: BitNodes 1 to 15 (docs/specs/node-readiness.md)

Status: docs only (2026-11-14). Companion of `docs/specs/node-targets.md` (which makes the bot able to *select* BN15 and to hold
back nodes with `node.targets`) and the build specs `docs/specs/bn8-readiness.md`, `docs/specs/bn9-readiness.md`. Goal: 100% game
completion over many BitNodes; this file says for each node what the bot can do today, what blocks it, the least automation that
unblocks it, a rough effort, and the order to build and play.

No live access was used. Source-File levels, the live `node.order` and the remaining-destroy count (about 81 with BN12 counted
separately, from the task context) are not recomputed here: that needs `bb status`/`GET /api/plan` on the live game.

## 1. Verified facts used (bitburner-src tag v3.0.1, read 2026-11-14)
`BitNode.tsx` (`getBitNodeMultipliers`, descriptions), `Achievements.ts`, `FactionHelpers.tsx`, `labyrinth.ts`
(`https://raw.githubusercontent.com/bitburner-official/bitburner-src/v3.0.1/src/...`). Links and the verification table are in
`docs/specs/node-targets.md`. Anything marked "notes" below comes from the earlier research pass (`research_notes/`, branch `dev`)
and is **not** re-verified at v3.0.1: re-check it before a build PR relies on it.

### Effective hacking difficulty
`index = 3000 x WorldDaemonDifficulty / HackingLevelMultiplier`: the base hack level a run must reach, relative to BN1 (3000). It is
crude (it ignores xp-gain multipliers, server money and hack speed) but ranks the nodes.

| BN | Name | WD difficulty (hack level needed) | Hack level mult | Hack xp | Server max money | Index |
|---|---|---|---|---|---|---|
| 1 | Source Genesis | 1 (3000) | 1 | 1 | 1 | 3,000 |
| 2 | Rise of the Underworld | 5 (15000) | 0.8 | 1 | 0.08 | 18,750 |
| 3 | Corporatocracy | 2 (6000) | 0.8 | 1 | 0.04 | 7,500 |
| 4 | The Singularity | 3 (9000) | 1 | 0.4 | 0.1125 | 9,000 |
| 5 | Artificial Intelligence | 1.5 (4500) | 1 | 0.5 | 1 | 4,500 |
| 6 | Bladeburners | 2 (6000) | 0.35 | 0.25 | 0.2 | 17,143 |
| 7 | Bladeburners 2079 | 2 (6000) | 0.35 | 0.25 | 0.2 | 17,143 |
| 8 | Ghost of Wall Street | 1 (3000) | 1 | 1 | 1 (but hack money gain 0) | 3,000 |
| 9 | Hacktocracy | 2 (6000) | 0.5 | 0.05 | 0.01 | 12,000 |
| 10 | Digital Carbon | 2 (6000) | 0.35 | 1 | 1 | 17,143 |
| 11 | The Big Crash | 1.5 (4500) | 0.6 | 0.5 | 0.01 | 7,500 |
| 12 | The Recursion | 1.02^L (3000 x 1.02^L) | 1/1.02^L | 1/1.02^L | 1/1.02^2L | 3,000 x 1.02^(2L), L = SF12 + 1: 3,121 at L=1, 8,100 at L=25, 21,700 at L=50 |
| 13 | They're lunatics | 3 (9000) | 0.25 | 0.1 | 0.3375 | 36,000 |
| 14 | IPvGO Subnet Takeover | 5 (15000) | 0.4 (hack speed 0.3) | 1 | 0.7 | 37,500 |
| 15 | The Secrets of the Dark Net | 2 (6000) | 0.6 (hack speed 0.6) | 1 | 0.8 | 10,000 |

## 2. Per node
Columns: what the bot does today / what blocks it (with code references) / minimum automation / effort (in build PRs, one PR is about
one agent session) / achievement challenge (`Achievements.ts`).

| BN | Today | Blocked by | Minimum automation | Effort | Challenge achievement |
|---|---|---|---|---|---|
| 1 | Played to completion (BN1 destroyed 2026-09-26). Hacking loop, autopilot, planner all assume it. | nothing | none | 0 | none |
| 2 | Gang module ships (`agent/gang.js`, docs/specs/gang.md); Red Pill from the gang faction (`lib/augplan.js:69-71`). | index 18,750 (hack 15,000) is slow even with gang money | none | 0 | none |
| 3 | Hacking only; `ServerMaxMoney` 0.04, aug cost x3. Works, slowly. No corporation module. | income, not mechanics | none (a corporation module would be large and optional) | 0 | none |
| 4 | Played (BN4 destroyed 2026-10-03). Singularity at normal RAM. | nothing | none | 0 | none |
| 5 | Played (BN5 finished 2026-10-05). | nothing | none | 0 | none |
| 6 | Hacking route works (`Daedalus` needs 35 augs: `DaedalusAugsRequirement 35`); hack x0.35, xp x0.25. Bladeburner shortcut not automated. | hack 6000 at index 17,143: slow; nothing breaks | none to play; Bladeburner automation (large) only to be faster | 0 (playable) | none |
| 7 | Same as BN6; aug cost x3, `BladeburnerRank` 0.6. | slow | none | 0 | none |
| 8 | Cannot finish. `ScriptHackMoneyGain 0`: the daemon earns $0; the existing `tools/stocks.js` (long-only, `hooks.stocksHook`) has no sizing/shorting/risk model and no income feed. | **stock trading** (docs/specs/bn8-readiness.md) | `lib/stockplan.js` + `tools/stocks.js` rewrite, BN8 bootstrap (no hacking income, no cloud ladder, donate threshold) | 5 PRs | none |
| 9 | Starts but stalls. `daemon-lite.js:148` runs `sl-*` on home when the cloud limit is 0, `daemon-lite.js:212` skips `pserv-sing`; nothing uses hacknet servers or hashes (`grep spendHashes game/` = none); hacking income about 0 (`ServerMaxMoney 0.01`, xp x0.05). | **no `pserv-sing`** (the reserved Singularity host) and **no hash module**; home RAM x5 | `lib/hashplan.js` + `agent/hacknet-hash.js`; SF4.3 or SF9.2 guard (docs/specs/bn9-readiness.md) | 5 PRs | none |
| 10 | Hacking route works: cloud servers x5 cost, limit x0.6, max RAM x0.5 (`lib/cloud.js` reads the limits from `ns.cloud`); aug cost x5. Sleeves and grafting are not used. | slow, expensive | none | 0 | none |
| 11 | Hacking only; `ServerMaxMoney 0.01`, `ServerGrowthRate 0.2`: income tiny; crime money x3 (`sl-crime.js` exists for the gang bootstrap). In the live `node.order`. | income | none (crime/infiltration income would help; not required) | 0 | none |
| 12 | Works as a slightly harder BN1 at low levels (Daedalus needs `floor(min(30 + 1.02^L, 40))` augs); autopilot, planner unchanged. Default target 0 since `node.targets`: never auto-picked. | difficulty grows 1.02^L per completion (index 21,700 at L=50) | none; the owner opts in with `node.targets={"12":N}` | 0 | **SF12 level >= 50** (`Player.sourceFileLvl(12) >= 50`): about 50 destroys |
| 13 | Hacking route works in principle (notes: starts with $200k, Stanek's Gift not needed for victory). Index 36,000: the slowest node for a hacking-only run. | WD 9000 at hack x0.25, xp x0.1; notes: installing any non-NeuroFlux aug before joining Church of the Machine God bans the faction (Stanek) | none to play; a "do not accept Stanek" decision is already our behavior | 0 (playable); a time bound is the real limit | finish BN13 **without Stanek's Gift** (`AugmentationName.StaneksGift1` not owned): free for a bot that never accepts it |
| 14 | Hacking route works in principle; faction work rep x0.2 (hurts the faction-contract rep source), hack speed x0.3, WD 15000. | rep and time; notes: IPvGO makes it cheaper | none to play; an IPvGO player is optional and large | 0 (playable); +2 PRs for a Go bot | finish BN14 **without using the go.cheat API** (`!Go.moveOrCheatViaApi`): free; `NotInSteam` |
| 15 | Selectable since `node.targets` (BN15 range 1 to 15). Cannot finish: **Daedalus does not offer The Red Pill in BN15** (`FactionHelpers.tsx:204-207`), so `lib/augplan.js:216-221` shows The Red Pill as "needs the Daedalus invite" forever. | the Red Pill is a darknet labyrinth reward (`labyrinth.ts:404-426`: after the lab augs, on BN15 the reward after The Law is The Red Pill); notes: the lab needs charisma ~3000, labs 1 and 2 are `manual: true` (`labyrinth.ts:44,53`: unresolved whether a script can do them) | darknet crawler + password solvers + lab runner + charisma plan; a planner branch "Red Pill from the darknet" | 6+ PRs, uncertain | finish BN15 **without Heartbleed** (`!DarknetState.hasUsedHeartbleed`); `NotInSteam` |

## 3. The penalty nodes (BN6, BN7, BN13, BN14) in one place
They work with the existing hacking stack; what changes is time. The aug planner already reads `DaedalusAugsRequirement` and
`WorldDaemonDifficulty` from `getBitNodeMultipliers` (`lib/augplan.js` `requirements()`), the predictor self-calibrates, and none of
the four disables a mechanic the bot uses. Risks to watch (all existing detectors):
- BN6/BN7: Daedalus needs 35 augs instead of 30; aug-count planning in `plan()` already uses `augsReq`.
- BN13/BN14: faction work rep (x0.6 / x0.2) is the bottleneck; `augs.donateAtFavor` and donations (`donateThreshold`) cover part of it.
- BN13: the notes' CotMG ban only matters if the owner wants Stanek's Gift, which also forfeits the BN13 challenge achievement.
Policy proposal for the owner: treat a node as "playable" when the predictor projects it under 14 days of wall clock; otherwise keep it
out with `node.targets={"N":0}` until automation lowers the time. The 14-day figure is a proposal, not a measurement (no wall-clock
data for these nodes exists yet).

## 4. Recommended order
**Build order (readiness specs):**
1. **BN8 stock module** (docs/specs/bn8-readiness.md). Highest value per PR: the trader also earns in every other node (shorts with
   SF8.2), unblocks one whole node, and its income feed fixes a planner blind spot.
2. **BN9 hash module** (docs/specs/bn9-readiness.md). Unblocks BN9 and its SF9.2/9.3 reward (128 GB home start, a free server) helps every
   later bootstrap.
3. **BN15 spike** (read-only): can labs 1 and 2 be passed by script, what does the Red Pill lab need (charisma). Decide build or skip.
4. **BN15 build** only if the spike is positive (large).
5. **BN14 Go bot** (optional, speeds one slow node).

**Play order** (what `node.order` can hold today, no new code): continue the live order `[2,3,11,6,7]`; then the nodes with no Source-File
at 3 among BN1, 4, 5, 10 (all playable); BN12 only with an explicit target; BN13 and BN14 last among the playable ones (indexes 36-37k);
BN8, BN9, BN15 only after their modules land. `node.targets={"8":0,"9":0,"15":0}` expresses the hold (BN15 is last in the default
order, BN8 is after BN6 and BN7, BN9 is sixth): the defaults are unchanged in `node-targets` and the choice is the owner's (listed in the PR).

## 5. Open questions
1. Do labs 1 and 2 in `labyrinth.ts` (`manual: true`) block scripts? (decides BN15)
2. Is the SF9.2 128 GB start enough to make the BN9 bootstrap bearable at SF4.1? (measure in the first BN9 run with the dry-run module)
3. Do stock positions survive an install in BN8? (docs/specs/bn8-readiness.md §7)
4. Live Source-File levels and the exact remaining destroys: read `GET /api/plan` after merge.
