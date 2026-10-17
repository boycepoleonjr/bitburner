# Spec: gang module (docs/specs/gang.md)

Status: spec only, nothing implemented. Target run: BN2.1, entered 2026-10-17 12:44 ET with SF1.3, SF4.3 and SF5.1, so Singularity costs 1x RAM. Settings at entry: `node.autoSelect=true`, `node.autoDestroy=true`, `node.order=[5,10]`.

## 1. Problem
We are in BN2 with hacking-only automation. In BN2 that path is very weak:
- server max money ×0.08, faction work rep ×0.5, passive faction rep 0
- w0r1d_d43m0n needs hack 15,000

The roadmap rates BN2 as "<2 days with a gang, weeks without" (reports/BitNode roadmap to full completion.md, row BN2). A gang is the BN2 mechanic:
- its faction sells almost every aug, including The Red Pill, so we skip Daedalus entirely
- its respect turns into rep for those augs
- its money pays for augs and NeuroFlux

No gang code exists, and the existing stack interferes with a gang in three ways:
- autopilot and sl-work would try to do faction work for the gang faction, which the game refuses
- augplan assumes The Red Pill comes from Daedalus
- sl-plan snapshots a fixed faction list

## 2. BN2 and gang facts (bitburner-src `dev`; verified, not from memory)

| Fact | Source |
|---|---|
| BN2 multipliers: HackingLevel 0.8, ServerMaxMoney 0.08, ServerGrowthRate 0.8, ServerStartingMoney 0.4, CrimeMoney 3, FactionPassiveRepGain 0, FactionWorkRepGain 0.5, InfiltrationMoney 3, WorldDaemonDifficulty 5. Hack 15,000 for w0r1d_d43m0n = 3,000 × 5; this matches our BN4 run, which needed 9,000 at difficulty 3. | [BitNode.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/BitNode/BitNode.tsx) `case 2` |
| BN2 needs no karma to create a gang. Anywhere else: SF2 plus karma ≤ −54,000. BitVerse `disableGang` blocks it, but owner rule says never set it. | [PlayerObjectGangMethods.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/PersonObjects/Player/PlayerObjectGangMethods.ts) `canAccessGang` |
| `createGang(f)` needs `f` ∈ {Slum Snakes, Tetrads, The Syndicate, The Dark Army, Speakers for the Dead, NiteSec, The Black Hand} **and** already joined. NiteSec and Black Hand create a hacking gang; the others create a combat gang. Creating resets that faction's rep to 0 and ends work for it. | [Gang/helpers.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Gang/helpers.ts), [NetscriptFunctions/Gang.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/NetscriptFunctions/Gang.ts) |
| Slum Snakes invite: combat stats ≥ 30 each, $1m, karma ≤ −9. | [FactionInfo.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Faction/FactionInfo.tsx) |
| The gang faction's aug list is every non-special aug except Congruity Implant, plus some faction-unique augs, plus **The Red Pill in BN2 only**. NeuroFlux is included. | [FactionHelpers.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Faction/FactionHelpers.tsx) `getFactionAugmentationsFiltered` |
| Gang faction rep += faction_rep_mult × respectGain × (1 + favor/100) / 75. It gets no passive rep, can't be worked for, and **can't receive donations** (`donateToFaction` refuses: "managing a gang"). | [Gang.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Gang/Gang.ts) `processGains`; Singularity.ts `donateToFaction` |
| Recruiting: 3 free members, then respect ≥ 5^(n−2) where n = current members. Max 12. | Gang.ts `respectForNextRecruit` |
| Wanted penalty = respect / (respect + wanted), multiplying respect and money gain. Each member on a negative-wanted task also cuts wanted by 0.1% per cycle. | [formulas.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Gang/formulas/formulas.ts), Gang.ts |
| Respect, money and wanted gain come from task weights × stats − k × difficulty (k = 4, 3.2 and 3.5) and a territory term. Exact formulas are in formulas.ts. | formulas.ts |
| Ascension: points = max(0, exp − 1000) per stat; mult = max(1, √(points/2000)). Ascending removes equipment (gang augmentations stay) and the member's earned respect. | formulas.ts, [GangMember.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Gang/GangMember.ts) |
| Installing player augs keeps the gang, re-joins its faction and multiplies each member's ascension points by 0.95. Member exp and equipment stay. | [Prestige.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Prestige.ts) |
| Territory updates every 100 cycles (~20 s). Power gain = 0.015 × max(0.002, territory) × Σ over Territory Warfare members of (sum of 6 stats / 95). Win chance = myPower / (myPower + theirs). | Gang.ts `processTerritoryAndPowerGains`, [AllGangs.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Gang/AllGangs.ts) |
| Clashes only run while warfare is engaged; after disengaging, the clash chance decays 0.01 per tick. Only Territory Warfare members can die, with chance (1% won / 2% lost) / def^0.6 in 35% of clashes. A death costs 5% of total respect plus that member's earned respect. | Gang.ts `clash`, `killMember` |
| Equipment discount grows with respect and power. Cost is paid from player money. | Gang.ts `getDiscount` |
| RAM: GangApiBase = 4 GB. getters 1–2 GB, `purchaseEquipment` / `ascendMember` / `getChanceToWinClash` 4 GB each; `getTaskNames`, `getEquipmentNames`, `inGang`, `getBonusTime` 0. `nextUpdate()` exists. | [RamCostGenerator.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Netscript/RamCostGenerator.ts) |
| `ns.formulas.gang` needs Formulas.exe ($5b), so the math is ported instead (§4.1). | — |

Reference heuristics from [alainbryden gangs.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/gangs.js):
- engage warfare at an average win chance ≥ 0.60
- ascend when a primary mult would grow ≥ 1.05 + (11 − i) × 0.05
- keep the wanted penalty near 1
- spend up to 20% of cash per tick on member augmentations and 0.2% on equipment
- order gangs by power: Speakers > Dark Army > Syndicate > Tetrads > Slum Snakes > Black Hand; NiteSec last ("not fun")

## 3. Decisions
1. **Combat gang by default.** `gang.faction="auto"` picks in this order:
   - a joined combat gang faction, in power order (Speakers > Dark Army > Syndicate > Tetrads > Slum Snakes)
   - otherwise Slum Snakes, reached through a crime/gym bootstrap (§4.4)
   - NiteSec or The Black Hand only if the bootstrap hasn't produced Slum Snakes within `gang.bootstrapTimeoutMin` (60), or if `gang.faction` names one

   Why combat: territory power uses all 6 stats, and combat gangs scale further.
2. **Ascension ignores installs.** An install only costs 5% of points, so there's no need to align the two.
3. **Money sharing.** `reserve` = the aug planner's next planned purchase cost while the autopilot is saving for it, else 0. `spendable` = max(0, money − reserve). Per shop run, member augmentations get ≤ `gang.augSpendFraction` × spendable, then equipment gets ≤ `gang.equipmentSpendFraction` × spendable. The gang never spends the reserve.
4. **Money vs respect follows the strategy weight.** The weight comes from the phase setting (`strategy.*` via lib/progress.js). It applies only once there are 12 members; while growing, everyone does respect.
   - Members are ranked by index; members with idx/n < weight do respect, the rest do money.
   - Deterministic, so no thrash.
5. **Hosting.** The repo rule says pserv-sing runs only the one-shot `sl-*` scripts.
   - `agent/gang.js` runs on **home**. daemon-lite and the RAM manager reserve its RAM; the target is ≤ 16 GB.
   - Purchases and ascensions (4 GB calls) go in a one-shot `agent/gang-shop.js` on home.
   - `agent/sl-crime.js` is a normal sl-* script on pserv-sing.
6. **Challenge safety.** `gang.enabled=false` means `gang.js` exits within one loop and nothing calls `createGang`. Needed for the later BN2.3 no-gang challenge run.
7. **Rollout safety.** `gang.dryRun=true` logs decisions without any mutating calls.

## 4. Design

### 4.1 `game/lib/gangformulas.js` (pure)
An exact port of formulas.ts: `wantedPenalty`, `respectGain`, `wantedGain`, `moneyGain`, `ascensionMult`, `ascensionPointsGain`. It takes the BitNode `GangSoftcap` as a parameter (default 1; BN2 = 1). Tests use values worked out by hand from the source.

### 4.2 `game/lib/gangplan.js` (pure; every function takes `(snap, s)` and returns data + `reasons[]`)
- **`phaseOf(snap)`:** `disabled` (not enabled or not accessible) → `bootstrap` (no gang) → `grow` (members < 12) → `territory` (territory < 0.999) → `done`.
- **`chooseFaction(snap, s)`:** returns `{faction, action}`, where action ∈ `create | crime | gym | wait | fallbackHacking`, applying decision 1.
- **`recruitNames(snap)`:** recruits while `members < 12 && respect ≥ threshold(n)`. Names `g01`–`g12`, filling gaps left by dead members.
- **`taskFor(member, ctx)`**, in priority order:
  1. **Wanted cleanup.** Enter when penalty < 1 − `gang.wantedPenaltyMax`; exit at penalty ≥ 0.99 or wanted ≤ 1. While active, move the weakest members to Vigilante Justice (Ethical Hacking for a hacking gang) until projected total wanted gain ≤ 0.
  2. **Train.** Train Combat / Train Hacking while the average primary stat < `gang.trainUntil`, or while no task gives positive respect. Also train for 10 loops after an ascension or recruit.
  3. **Territory.** In phase `territory`, the top `gang.warfareShare` of members with def ≥ `gang.minDefForWar` do Territory Warfare.
  4. **Work.** The task with the highest expected gain from gangformulas, using objective respect or money per decision 4.
- **`warfareDecision(snap, s)`:** compute the min win chance over gangs with territory > 0. Engage at ≥ `gang.clashEngage`; disengage below `gang.clashDisengage`, or in phase `done`. Win chance comes from `getOtherGangInformation` power, not `getChanceToWinClash` (that costs 4 GB).
- **`shouldAscend(members, ascResults, ctx)`:** a member qualifies when its primary-stat ratio ≥ `gang.ascendMult` + (11 − i) × 0.05, with i = rank by earned respect. Never when the member's earnedRespect > `gang.ascendMaxRespectShare` × respect. At most one per shop run, and recruiting comes first.
- **`equipmentPurchases(snap, s, spendable)`:** member augmentations first (cheapest first), then equipment that raises a primary stat. Off-stat items are skipped. Each budget in decision 3 is a hard cap.
- **`buildStatus(...)`:** produces the §6 contract.

### 4.3 `game/agent/gang.js` (single instance, guarded with `ns.getRunningScript`)
Each loop:
1. `await ns.gang.nextUpdate()`
2. read settings (`readSettings`) and build the snapshot. Task stats are read once and cached in `data/gang-tasks.txt`.
3. ask gangplan for decisions
4. apply them: recruit, `setMemberTask` only when the task changes, `setTerritoryWarfare` only when it changes
5. every 15 loops, `ns.run("agent/gang-shop.js", 1, JSON)` with the purchase and ascend list
6. write `data/gang-status.txt`

Every ns call is wrapped: an error goes into `reasons/errors` and the loop continues.
- **Bootstrap phase:** in BN2 it calls `createGang` once a chosen faction is joined. Joining is done by autopilot/sl-work, which already join every non-city invite.
- **RAM gate:** `mem agent/gang.js` ≤ 16 GB and `mem agent/gang-shop.js` ≤ 12 GB. Record both in the PR.

### 4.4 Bootstrap to Slum Snakes: `game/agent/sl-crime.js` (one-shot sl-* script)
- If combat stats are under 30, run `singularity.gymWorkout` (Powerhouse Gym, Sector-12) on the lowest stat.
- Otherwise commit Mug (karma −0.25 each, so about 36 for −9; crime money is ×3 in BN2) until karma ≤ −9.
- Report on port 21 with `op:"crime"`, matching the existing daemon-lite protocol.
- Add it to `SL` in daemon-lite.js so pserv-sing is sized for it.
- While `gangplan.chooseFaction` returns `crime`/`gym`, daemon-lite (bootstrap) and autopilot (after handoff) run sl-crime instead of faction work. Before the gang exists, faction rep is only ×0.5 in BN2, so little is lost.

### 4.5 Integration (current main)
- **`game/lib/augplan.js`:**
  - `redSrc` = the joined faction whose `augs` include The Red Pill, preferring the gang faction; replaces `snap.factions?.Daedalus` (line ~206). The blocked-Red-Pill step (line ~184) names the real source.
  - Skip the "Daedalus needs N installed augs" step (line ~129) when `src.has(RED_PILL)` from a non-Daedalus faction.
  - `donateThreshold` / `canDonate` is false for the gang faction.
  - Expose `nextPurchaseCost`.
- **`game/agent/sl-plan.js`:** factions = `FACTIONS ∪ ns.getPlayer().factions`, de-duplicated (the gang list is already inside FACTIONS; this keeps it future-proof). Add `gangFaction: ns.gang.inGang() ? ns.gang.getGangInformation().faction : null`, at 2 GB, only if inGang.
- **`game/agent/autopilot.js`** (work selection ~lines 294–320, donation ~line 188/310) and **`game/agent/sl-work.js`:**
  - exclude the gang faction from work and donation candidates
  - keep buying augs from it (the faction loops already cover it via `ns.getPlayer().factions`)
  - autopilot restarts `agent/gang.js` if missing
- **`game/agent/post-install.js`:** start `agent/gang.js` after rpc.js when `gang.enabled`.
- **`game/agent/daemon-lite.js`:** reserve gang.js RAM on home before sizing workers when gangs are accessible; start gang.js; schedule sl-crime per §4.4.
- **RAM manager (`lib/rammgr.js`):** no logic change; gang.js and gang-shop.js count as non-managed scripts and are already excluded from usable RAM.
- **Settings (`lib/settings-schema.js`):** new group `{ id: "gang", label: "Gang" }` (§5).
- **Dashboard (small, in scope):**
  - `lib/data-sources.js` adds `data/gang-status.txt` to the hot/raw lists
  - `lib/kpi.js` adds `gangTerritory`, `gangRespectPerSec`, `gangMoneyPerSec`
- **Follow-up PR:** a full Gang view in `lib/ui/views.js` with a member list and details.

## 5. Settings (group `gang`, owner = gang)
| Key | Type | Default | Meaning |
|---|---|---|---|
| gang.enabled | bool | true | Off: never create or run a gang (challenge runs) |
| gang.dryRun | bool | false | Log decisions only |
| gang.faction | enum | auto | auto or one of the 7 gang factions |
| gang.bootstrapTimeoutMin | int | 60 | Fall back to a hacking gang after this |
| gang.trainUntil | int | 150 | Average primary stat before working |
| gang.ascendMult | number | 1.5 | Base ascension ratio (minus spacing per rank) |
| gang.ascendMaxRespectShare | number | 0.1 | Don't ascend a member holding more respect than this share |
| gang.clashEngage / gang.clashDisengage | number | 0.6 / 0.5 | Warfare hysteresis on min win chance |
| gang.warfareShare | number | 0.5 | Share of eligible members on Territory Warfare |
| gang.minDefForWar | int | 300 | Death guard |
| gang.wantedPenaltyMax | number | 0.05 | Start cleanup below 1 − this |
| gang.augSpendFraction / gang.equipmentSpendFraction | number | 0.2 / 0.1 | Per shop run, of spendable cash |

The money vs respect split follows `strategy.*`, so there's no separate slider.

## 6. Data contract: `data/gang-status.txt` (overwritten each loop)
```
{"t":ms,"enabled":bool,"dryRun":bool,"accessible":bool,"inGang":bool,"faction":s|null,"isHacking":bool,
 "phase":"disabled|bootstrap|grow|territory|done","bootstrapAction":s,"karma":n,
 "members":n,"respect":n,"wanted":n,"wantedPenalty":n,"cleanupMode":bool,
 "respectRate":n,"moneyRate":n,"repRate":n,"territory":n,"power":n,"clashChance":n,"warfare":bool,
 "minWinChance":n,"recruitNext":n,"reserve":n,"spentThisLoop":n,"lastAscend":{name,t}|null,"deaths":n,
 "memberList":[{"name","task","hack","str","def","dex","agi","cha","ascMult":{...},"upgrades":n,"earnedRespect":n}],
 "reasons":[s],"errors":[s]}
```

## 7. Tests (Node; `test/gang*.js`, auto-discovered; fake `ns.gang` in `test/helpers/fake-gang.js`)
- **gangformulas:** matches hand-computed values from formulas.ts.
- **gangplan:**
  - phase transitions
  - recruit thresholds at n = 2, 3, 11, 12
  - name gap-filling
  - wanted cleanup enter and exit hysteresis
  - ascension spacing and the respect-share guard
  - warfare hysteresis ignoring zero-territory gangs
  - budgets never exceed spendable or touch the reserve
  - deterministic respect/money split at weights 0, 0.5 and 1
  - chooseFaction order and timeout fallback
- **gang.js loop (fake ns):**
  - creates the gang when Slum Snakes is joined
  - recruits to 12
  - `enabled=false` makes no gang calls
  - `dryRun` makes no mutating calls
  - survives a throwing call
  - single instance
- **Integration:**
  - augplan takes The Red Pill from the gang faction and drops the Daedalus step; this uses the BN5 fixture with an added gang faction
  - autopilot/sl-work never work for or donate to the gang faction
  - the sl-plan faction union has no duplicates
  - post-install starts gang.js only when enabled
  - kpi gang KPIs, plus empty state when the file is missing
- `npm test` is fully green.

## 8. Rollout and acceptance (BN2.1)
- **Rollout:**
  1. merge (the server auto-deploys)
  2. `bb push` game files
  3. `bb settings set gang.dryRun=true`
  4. watch status for 10 min
  5. `gang.dryRun=false`
- **Acceptance**, measured from `data/gang-status.txt`, `data/aug-plan.txt` and audit:
  - gang created ≤ 2 h after rollout
  - 12 members ≤ 12 h
  - territory ≥ 0.999 ≤ 48 h
  - The Red Pill bought from the gang faction
  - ≤ 2 member deaths
  - wanted penalty ≥ 0.95 in ≥ 90% of samples
  - gang.js running in ≥ 99% of autopilot checks
  - BN2 READY reached faster than the hacking-only baseline estimate ("weeks")
- **Rollback:**
  - `bb settings set gang.enabled=false`; gang.js exits and the existing stack is unaffected
  - full revert: revert the PR. The gang keeps existing in-game, but nothing manages it.

## 9. Risks
- **Hack 15,000 is the long pole, not The Red Pill.** The gang shortens the aug grind, but reaching w0r1d_d43m0n still needs heavy hacking multipliers. Gang money funds NeuroFlux, but bought NeuroFlux levels need gang-faction rep (respect/75), so the respect share matters late. Watch `strategy.late`.
- **16 GB on a 32 GB home** early in BN2 squeezes daemon-lite. Mitigation: start gang.js only once home ≥ 64 GB, or when free RAM covers it. That's an open question.
- **Combat bootstrap could stall** if gym money is short. The timeout falls back to a hacking gang (NiteSec, which the existing CSEC backdoor path already joins).
- **Territory Warfare deaths** with low defense are covered by the `minDefForWar` guard and only engaging at 60%.

## 10. Plan improvement log
- **v1** (agent, full context): tmp/plan-gang-v1.md.
- **Round 1, Perplexity (Computer mode):** https://www.perplexity.ai/computer/tasks/5da5dfb7-b583-4a6b-a810-0227593d5e33. v2 is saved as tmp/plan-gang-v2-px.md.
- **Accepted:**
  - settled defaults for the open questions
  - crime bootstrap for Slum Snakes
  - porting the formulas instead of using Formulas.exe
  - RAM budget and the gang-shop one-shot
  - win chance from power instead of `getChanceToWinClash`
  - hysteresis on wanted and warfare
  - dryRun and kill switch
  - deterministic respect/money split
  - money reserve rule
  - ordered commits and expanded tests
  - two-stage acceptance
- **Verified its three "verify-first" items against source:**
  - an install multiplies ascension points by 0.95 and keeps exp (Prestige.ts)
  - `donateToFaction` refuses the gang faction (Singularity.ts)
  - `ns.gang.nextUpdate` exists (NetscriptFunctions/Gang.ts)
- **Changed:**
  - "run gang.js on pserv-sing when home is full" is rejected; repo rule: pserv-sing is for sl-* scripts only. gang.js stays on home with a reservation.
  - "Homicide if success ≥ 0.5" became gym training to 30 combat, then Mug. Mug also trains combat, and karma −9 needs only ~36 crimes.
  - Dashboard reduced to KPIs + data source in scope; the full view is a follow-up.
- **Stopped after 1 round:** v2 plus the source checks left no ambiguous step or unverified API.

## 11. Implementation notes (added with the code; the sections above are unchanged)
Deviations from the text above, each forced by RAM, an API rename or a game rule found while building it:
- **`getOtherGangInformation` is `ns.gang.getAllGangInformation()` in v3** (bitburner-src `dev` typings). It includes our own faction; `lib/gangplan.js` drops it by name before taking the minimum win chance.
- **gang.js is read-only; two more one-shots.** `createGang` (1), `recruitMember` (2), `setMemberTask` (2) and `setTerritoryWarfare` (2) put `gang.js` at ~19 GB, above the 16 GB gate, so they live in `agent/gang-act.js` (8.6 GB), which `gang.js` runs only when something changed (the §4.3 "only when the task changes" rule is unchanged). `agent/gang-info.js` (8.6 GB, run once) caches `getTaskStats` / `getEquipmentType` / `getEquipmentStats` in `data/gang-tasks.txt`. Static RAM (test/gang-static.js, costs from RamCostGenerator.ts): gang.js 13.6 GB, gang-shop.js 9.6 GB, gang-act.js 8.6 GB, gang-info.js 8.6 GB.
- **No `getAscensionResult` call (2 GB).** The ratio is computed from `getMemberInformation` with `ascensionPointsGain` / `ascensionMult`, which is what the game's `getAscensionResults` does.
- **Wanted cleanup also requires wanted > 1 to enter** (wanted is floored at 1, so cleanup could not help at 1 and a fresh gang, with penalty 0.5, would otherwise start in cleanup).
- **Territory Warfare share** = floor(share × eligible), but at least one eligible member when the share is > 0.
- **`reserve`** skips free steps (The Red Pill costs $0): it is the price of the first buyable or needMoney step that costs something.
- **`dryRun`** still runs `gang-info.js` (it only reads and writes the cache) and also suppresses the gym / crime bootstrap, because that changes what the player is doing.
- **Daemon-lite passes the gang faction to `sl-work.js` in its JSON args**: `sl-work.js` runs on pserv-sing, which has no `data/` files and no `lib/`. `sl-crime.js` also joins pending non-city invites, since `sl-work` is skipped while the bootstrap runs; the backdoor runs continue so the NiteSec fallback invite still arrives.
- **`repRate` ignores the faction favor bonus** (reading favor needs Singularity, which gang.js does not have).
- **Training time:** at 5.3 exp/s (Train Combat) a stat of 50 takes ~6 min, 100 ~36 min and 150 ~2.9 h from zero, so `gang.trainUntil` (default 150) is the main knob for how fast the first members start earning respect.
