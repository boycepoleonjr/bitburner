# Spec: node.targets — per-BitNode target levels, BN12/BN15 handling, early warning

Status: planned 2026-11-14. Owner request ("handle it"): the long-run BitNode sequence, aiming at 100% game completion.
Follows `docs/specs/node-fallback.md` (F-011) and closes the tail of ledger entry F-003.

## Problem
1. Every BitNode has the same implicit target: `SF_MAX(n)` = 3, except BN12 = `Infinity` (`game/lib/augplan.js`). With BN12 in the
   default order (`DEFAULT_BN_ORDER`, position 9) and in `recommendNextBn`, a BN12 that never maxes keeps being picked: once BN1,
   4, 2, 5, 10, 9, 3, 11 are maxed the bot repeats BN12 forever and BN6, 7, 8, 13, 14 never come. BN12 is also the node
   whose difficulty grows with every completion (1.02^level on almost everything).
2. BN15 exists in v3 (BN1 to BN15) but `bnAvailable` rejects `n > 14`.
3. When every target is met the dead end is reported as "autoSelect off" (fixed in text by #49 only for `autoDestroy on`) and
   there is no flag of its own.
4. `node.order` running out is only noticed when w0r1d_d43m0n is READY, which can be hours before the destroy. There is no early
   warning that the list is nearly used up.
5. The bot cannot play BN8, BN9 (and only partly BN6/7/13/14/15). That knowledge lives in research notes, not in a spec that the
   next build PR can start from.

## Verified facts (bitburner-official/bitburner-src, tag v3.0.1, read 2026-11-14 with curl on raw.githubusercontent.com)
All numbers below are read from the source, not from the earlier research pass. Files: `BN` =
[src/BitNode/BitNode.tsx](https://raw.githubusercontent.com/bitburner-official/bitburner-src/v3.0.1/src/BitNode/BitNode.tsx),
`ACH` = [src/Achievements/Achievements.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/v3.0.1/src/Achievements/Achievements.ts),
`LAB` = [src/DarkNet/effects/labyrinth.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/v3.0.1/src/DarkNet/effects/labyrinth.ts),
`FAC` = [src/Faction/FactionHelpers.tsx](https://raw.githubusercontent.com/bitburner-official/bitburner-src/v3.0.1/src/Faction/FactionHelpers.tsx),
`MULT` = [src/BitNode/BitNodeMultipliers.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/v3.0.1/src/BitNode/BitNodeMultipliers.ts).

| Fact | Source | Verified |
|---|---|---|
| BN1 to BN15 exist; each description of BN1-11, 13, 14, 15 says "upgrade its level up to a maximum of 3" | BN (descriptions) | yes |
| BN12: "There is no maximum level for Source-File 12" | BN (BN12 description) | yes |
| BN12 multipliers are `inc = 1.02^lvl`, `dec = 1/inc` with `lvl = SF12 + 1` | BN `case 12` | yes |
| Achievement `CHALLENGE_BN12` needs `Player.sourceFileLvl(12) >= 50` | ACH `CHALLENGE_BN12` | yes |
| BN13/14/15 challenge achievements need the node finished without Stanek's Gift / go.cheat via API / Heartbleed; 14 and 15 are `NotInSteam` | ACH | yes |
| BN6 and BN7: hacking level x0.35, hack XP x0.25, ServerMaxMoney x0.2, WorldDaemonDifficulty 2, Daedalus needs 35 augs; ScriptHackMoney 0.75 (BN6) / 0.5 (BN7) | BN `case 6`, `case 7` | yes (research said "level x0.35, XP x0.25": correct) |
| BN8: `ScriptHackMoney 0.3` **and `ScriptHackMoneyGain 0`**, ManualHackMoney 0, Hacknet/Crime/Company/Contract money 0, `FavorToDonateToFaction 0`, `DarknetLabyrinthRewardsTheRedPill 0`, CloudServerSoftcap 4; WorldDaemonDifficulty unset (1, needs hack 3000) | BN `case 8` | yes |
| BN9: hack level x0.5, ServerMaxMoney x0.01, `HomeComputerRamCost 5`, `CloudServerLimit 0` (no purchased servers), ScriptHackMoney 0.1, `HackExpGain 0.05`, 4S data cost x5 / API x4, WorldDaemonDifficulty 2 | BN `case 9` | yes |
| BN13: hack level x0.25, `HackExpGain 0.1`, ServerStartingSecurity 3, ScriptHackMoney 0.2, `WorldDaemonDifficulty 3` (3000 x 3 = 9000), FactionWorkRepGain 0.6 | BN `case 13` | yes (the 9,000 follows from difficulty 3) |
| BN14: hack level x0.4, hack speed x0.3, FactionWorkRepGain 0.2, ScriptHackMoney 0.3, WorldDaemonDifficulty 5 (15000), GoPower 4 | BN `case 14` | yes |
| BN15: hack level x0.6, hack speed x0.6, AugmentationMoneyCost 3, `DaedalusAugsRequirement 20`, WorldDaemonDifficulty 2 (6000), CharismaLevelMultiplier 1.1 | BN `case 15` | yes |
| **BN15: Daedalus does not offer The Red Pill** ("Remove TRP from daedalus in BN15"); it is a darknet labyrinth reward (`nextAug === TheLaw` then `TheRedPill` on BN15; the comment says "fourth lab", the code gives it after The Law) | FAC lines 204-207, LAB lines 404-426 | yes |
| Labs 1 and 2 are `manual: true` in the lab table | LAB lines 33-107 | yes (what "manual" means for a script is not verified: unresolved, see `docs/specs/node-readiness.md`) |

Verdict on the earlier research: every claim in the task context holds against v3.0.1. Corrections that matter for the build:
BN8's income problem is `ScriptHackMoneyGain 0` (not just a multiplier), the same node removes the donation favor threshold
(`FavorToDonateToFaction 0`, so rep can be bought immediately) and the darknet Red Pill, and BN15 needs the darknet route for The
Red Pill. BN12 also sets `DarknetLabyrinthRewardsTheRedPill 0`, which is irrelevant because the bot uses Daedalus there.

## Goals
1. Setting `node.targets`: a map BitNode -> target Source-File level. Empty (default) means every node targets `SF_MAX(n)` = 3,
   except BN12 whose default target is 0. A BitNode is "available" while its Source-File level (after the destroy in progress)
   is below its target. `bnAvailable`, `firstAvailable` and `recommendNextBn` respect targets.
2. BN12 is never auto-picked unless the owner gives it an explicit target (`bb settings set node.targets='{"12":5}'`). This
   removes the BN12 trap from the default order and from `recommend`. `DEFAULT_BN_ORDER` keeps its order.
3. BN15 is selectable: range 1 to 15, `SF_MAX(15)` = 3 (verified above).
4. "Every target met" (no BitNode left to choose, in the planner recommendation) is its own state with its own text and attention
   flag, `every BitNode target is met`, no longer "autoSelect off" and no longer "every Source-File is maxed" (BN12 is not maxed).
5. Early warning: an attention flag `node.order running low ...`, raised from the autopilot loop (not only when READY) once 2 or
   fewer destroys are left in `node.order`. It says what is left and what the planner would recommend next.
6. Docs only: `docs/specs/bn8-readiness.md`, `docs/specs/bn9-readiness.md` and `docs/specs/node-readiness.md` (all 15 nodes). They
   are the input for later build PRs; nothing in `game/` implements them here.

## Non-goals
- No change to which node the owner's live `node.order` visits: with default `node.targets` the picks for BN2/3/11/6/7 are
  byte-identical to today (golden test, below).
- No automation for BN8, BN9, BN13, BN14, BN15 (readiness specs only). `node.targets` can switch a node off (`{"8":0}`) so the
  owner can keep the bot out of nodes it cannot play, but the defaults are not changed for them (decision for the owner).
- No change to `node.fallback`, the destroy handshake or the aug planner.

## Design

### Setting
`game/lib/settings-schema.js`, group `node`:
`{ key: "node.targets", type: "intMap", default: {}, ui: "text", owner: "autopilot", label: "Target Source-File level per BitNode", help: ... }`.
New field type `intMap` (JSON object, keys `"1"` to `"15"`, integer values):
- accepted inputs: an object, a JSON object string, `""` (= `{}`), or the short form `12:5,3:0` (CLI convenience);
- rejected (never clamped): unknown keys (not an integer 1..15), non-integer / negative values, values above the node's cap
  (`3` for every node except BN12, `1000` for BN12), non-object input, duplicate keys in the short form;
- an entry equal to the node's default is accepted and kept (explicit is explicit); `{}` is the default.
- `defaults()` / `effective()` return fresh copies of object defaults like they do for lists.
- Stored invalid values follow the existing path: ignored with a warning, the default applies.
Dashboard: `ui: "text"`; `lib/ui/settings-model.js` shows an object value as its JSON text, the commit goes through `coerce`.

### Targets in the planner (`game/lib/augplan.js`, PURE)
```
BN_MAX = 15
SF_MAX(n) = n === 12 ? Infinity : 3            (unchanged: the hard cap; BN15 = 3 verified)
defaultTarget(n) = n === 12 ? 0 : SF_MAX(n)
targetOf(n, targets) = explicit integer >= 0 in targets[n], capped at SF_MAX(n)   else defaultTarget(n)     (bad entries are ignored)
bnAvailable(n, lv, targets) = integer 1..15 && (lv[n] || 0) < targetOf(n, targets)
firstAvailable(order, lv, targets)                        first available entry
recommendNextBn(snap, s) uses s["node.targets"]; DEFAULT_BN_ORDER = [1,4,2,5,10,9,3,11,12,6,7,8,13,14,15]
```
`targets` is optional everywhere (undefined = defaults), so every existing caller keeps working. With defaults BN12 is skipped
(target 0), and BN15 is the last resort of the default order. The `why` texts of existing nodes are not touched (golden).

### pickNextBn / decideNode (`game/lib/nodectl.js`)
- `pickNextBn` passes `s["node.targets"]` to `firstAvailable` and `recommendNextBn`; the rest is unchanged.
- "All targets met" = `recommended.bn == null`. `ALL_MET = "every BitNode target is met"`.
  `recommended.why` becomes `ALL_MET` instead of "every Source-File is maxed", and `orderExhaustedFlag` uses it too.
- `decideNode`, only when ready and `recommended.bn == null`: the node block gets `source: "all-targets-met"`, attention gets
  `ALL_MET_FLAG` = `every BitNode target is met — nothing left to select; owner raises node.targets (for example {"12":5}) or stops here`
  next to READY (replacing `node.order exhausted ...` in `stop` mode, which would only repeat it), the pending detail says
  `every BitNode target is met`, never "autoSelect off", and an open request is cancelled. In every other state the output is
  byte-identical to today.
- Flag texts are built from SF levels only, so they are stable across loops and dedupe like READY.

### Early warning (`game/lib/nodectl.js`: `orderOutlook`, `orderWarning`; called from `agent/autopilot.js`)
`orderOutlook({bn, sourceFiles}, s)`:
```
lv        = sfLevels(sourceFiles, bn)                  levels after the destroy in progress
left      = for each unique valid entry n of node.order:  max(0, targetOf(n) - lv[n])  -> [{bn: n, levels: k}] with k > 0
remaining = sum of left
after     = lv with every order entry raised to its target
next      = firstAvailable(DEFAULT_BN_ORDER, after, targets)  -> the planner's recommendation once the order is used up
```
`orderWarning(st, s)` returns a string or null. It is non-null when `node.autoSelect` is on, `remaining <= 2`, and the order is not
a deliberate "use the planner" (an empty `node.order` with `node.fallback=recommend`); an empty order with `stop` warns
(`remaining` 0). The text (prefix `node.order running low`, constant `ORDER_LOW`):
`node.order running low (2 left: BN6 x1, BN7 x1) — node.fallback=stop will then stop and flag the owner; the planner would recommend BN9: <why>`
(`recommend`: `— then the planner's recommendation takes over: BN9: <why>`; nothing recommended: `— every BitNode target is met`).
`autoSelect` off: no warning (the owner chooses by hand and the order is not consulted).
The autopilot pushes it into `flags` every loop; `checkin-lib` already merges autopilot flags into attention, so it dedupes
like READY (stable text). `server/checkin.js` `OWNER_DECISION` and `lib/kpi.js` `OWNER_FLAG` match `node.order running low` and
`every BitNode target is met` (owner decisions: shown in Discord, held back for `BB_READY_ESCALATE_MIN`, then escalated).

### Not in this change
Dashboard BitNode view rows beyond the existing `next-node source` row: it also shows `all-targets-met`.

## RAM
All new code is pure functions in lib files; no new `ns.*` call. `autopilot.js` already calls `ns.getResetInfo()` and
`readSettings`. A static test (same model as `test/ram-xp-static.js`) compares the RAM-costing Netscript names reachable from
autopilot.js, sl-plan.js, sl-destroy.js, post-install.js, daemon.js, dashboard.js and daemon-lite.js with a baseline measured on
main before the change (`test/fixtures/node-targets-ram-baseline.json`).

## Risk
Low for defaults: golden test over 143 Source-File states x 4 setting variants (live `node.order=[2,3,11,6,7]`, with and
without `node.fallback=stop`, an empty order, autoSelect off) shows identical `pickNextBn` output wherever BN12 was not
involved; where BN12 was picked or recommended the new result skips it by design (tested separately). Worst case of a bug:
a wrong node picked, or a spurious/missing owner flag. `node.targets` can only reduce what the bot picks (except BN12 and the new
BN15 at the end of the default order, which the owner already controls through `node.order` and `node.fallback=stop`).

## Tests (plain Node)
`test/node-targets.js`, plus `test/ram-node-targets.js` (static RAM) and golden fixtures generated from the code before the change.
1. golden: with default settings and the live order the picks equal the pre-change output, for the whole state grid; BN12 cases differ as specified.
2. schema: default `{}`, `coerce` accepts object / JSON string / short form / empty; rejects unknown keys, bad values, over-cap values, arrays, junk; round trip through `applyPatch` / `serialize` / `parse`; fresh default copies.
3. targets: default BN12 is never picked or recommended; explicit `{"12":5}` makes BN12 available until SF12 = 5; `{"3":0}` skips BN3; `{"12":0}` equals the default; targets above the cap are capped; invalid stored entries are ignored.
4. BN15: available with SF15 < 3, last in the default order, rejected at 16 and 0.
5. all-met: `recommended.bn` null with the explicit message, flag, `source`, no request, open request cancelled, in `recommend` and `stop`, autoSelect on and off; never says "autoSelect off".
6. early warning: thresholds (3 left: none; 2, 1, 0 left: flag), autoSelect off: none, empty order (recommend: none, stop: flag), duplicates in the order, entries at target 0, stable text, `stop` vs `recommend` wording, names the recommendation; `OWNER_DECISION` and `OWNER_FLAG` match.
7. autopilot integration with a fake ns: the warning reaches `flags`.
8. static RAM: no new RAM-costing names reachable from the listed scripts.

## Rollout (owner)
Merge, Railway deploy, `bb push` of the changed game files (`lib/augplan.js lib/nodectl.js lib/settings-schema.js lib/kpi.js lib/ui/settings-model.js lib/ui/views.js agent/autopilot.js`), restart `agent/autopilot.js` (sl-plan restarts with it) and `dashboard.js`, `bb note`. Nothing to set: the defaults already keep BN12 out. To play BN12 later: `bb settings set node.targets='{"12":5}'`. Rollback: `bb settings unset node.targets` (restores the defaults; the only behavior that cannot be switched back is the removal of BN12 from the default order, which is the point).
