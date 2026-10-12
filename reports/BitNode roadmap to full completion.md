# Run BN1.2 next, then build Bladeburner

**Take BN1.2 next with `node.autoDestroy` on, then BN4.2 and BN4.3 back to back.** These three runs need no new code. They also buy the two largest per-run speedups this stack can get: SF1.2 adds about 6.9% to every multiplier, and SF4.2 cuts Singularity RAM from 16x to 4x. BN1 is also the safest place to test the RAM manager, aug planner and destroy handshake, which barely ran in-game during BN5.

The bigger finding is about the shape of the goal. 100% completion needs **89 more BitNode destructions**: 42 Source-File levels to bring every node to x.3, plus 47 extra BN12 runs for CHALLENGE_BN12. Every node gets finished eventually. So the Value rule decides *order* and *which subsystem to build next*, not *whether* to play a node.

Today's hacking-only stack can finish BN1, BN4 and BN5 (proven) and, slowly, BN3, BN10, BN11 and early BN12. Two nodes are hard blocks: BN8 (script hacking pays $0) and BN15 (Daedalus does not sell The Red Pill). BN2, BN6, BN7, BN9, BN13 and BN14 are impractical with hacking alone.

**Bladeburner is the single most valuable build.** It wins a node without money or hacking skill, and it is compatible with seven of the twelve challenge achievements. The largest measured loss is not a game mechanic at all: **BN5 sat about 133 h idle after w0r1d_d43m0n was ready, 70% of its 191 h.** Auto-destroy plus READY escalation is worth more than any Source-File.

Under the owner's rules, **107 of 109 achievements** can be earned on v3.0.2 (106 of 108 on v3.0.1). EDITSAVEFILE and UNACHIEVABLE need a save edit. The whole programme is on the order of a year of wall-clock time (low confidence), with BN12 as the long pole. No reliable community timing data exists, so every hour figure below marked "est." is my extrapolation from our three measured runs. Anything marked as a fact comes from the v3 game source or our own logs.

## 89 destructions remain, so the Value rule picks an order, not a node

The count comes straight from the game code:
- Every Source-File caps at level 3 except SF12, which has no cap ([BitNodeUtils.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNodeUtils.ts)).
- BN_DESTROYER requires every SF1–SF15 at level 3 or higher ([Achievements.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Achievements/Achievements.ts)).
- CHALLENGE_BN12 requires `sourceFileLvl(12) >= 50` (same source).

We own SF1.1, SF4.1 and SF5.1. That leaves **42 SF levels plus 47 further BN12 runs**. For BN1–BN7 the multipliers do not change with level (`getBitNodeMultipliers` ignores the level for these nodes). A repeat run is exactly as hard as the first; only our SF bonuses grow. BN12 is the exception: it scales by 1.02^level with no ceiling ([BitNode.tsx](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNode.tsx)).

That changes how to read the owner's rule, Value = (hours saved per future run × runs left) − (hours to finish + hours to build). The "hours to finish" term is paid for every node sooner or later, so the useful question is which run to do *next*. The answer is the run with the most savings per hour invested, S ÷ (H + B). With roughly 85 runs still to benefit, even a 1 h/run saving is worth about 85 h. Per-run speedups should therefore come first, and cheap ones are a bargain.

Build hours mostly overlap game time. The game runs 24/7 on Railway while the agent writes code, so a build costs wall-clock only if its node is waiting for it ([AGENTS.md](https://github.com/boycepoleonjr/bitburner/blob/main/AGENTS.md)).

Three measured runs anchor every estimate:
- **BN4.1** took **about 158 h**, including a ~57 h tail after The Red Pill while hacking climbed to 9,000.
- **BN5.1** reached READY at **about 58 h**, including **about 14.5 h of bootstrap** under 16x Singularity RAM.
- **BN5.1 then idled to 191 h** before destruction (live `data/agent-log.txt`, `data/install-log.txt`; [aug-planner spec](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md)).

The table applies the Value rule to the candidate runs. R = 85 later runs. Every figure in it is an estimate except the "fact" column.

| Candidate run | Fact behind the saving | Hours to finish H (est.) | Build B | Saved per later run S (est.) | Value (est.) | S ÷ (H+B) |
|---|---|---|---|---|---|---|
| BN1.2 | SF1: 1.16 → 1.24 on every multiplier (+6.9% relative) | 36 | 0 | 3.5 h | **+262 h** | **0.097** |
| BN4.2 | Singularity RAM 16x → 4x outside BN4; destroy script 512 → 128 GB | 90 | 0 | 6 h (bootstrap) | **+420 h** | 0.067 |
| BN2.1 with gang | Gang faction sells most augs and, in BN2, The Red Pill | 36 | 16 | 3 h (once karma is farmed) | +203 h | 0.058 |
| BN5.2 | SF5: +8% → +12% on hacking mults (+3.7% relative) | 40 | 0 | 1.5 h | +88 h | 0.038 |
| BN4.3 | Singularity 4x → 1x; destroy script 32 GB | 85 | 0 | 2 h | +85 h | 0.024 |
| BN1.3 (challenge run) | SF1: 1.24 → 1.28 (+3.2% relative) | 55 | 4 | 1.5 h | +69 h | 0.025 |
| BN10.1, then sleeve code | +1 sleeve per SF10 level; sleeves/grafting API | 180 | 24 | 4 h (sleeves on faction work) | +136 h | 0.020 |
| BN12.1 (early) | +1 free NeuroFlux level at every BitNode start | 40 | 0 | ~0.6 h | ~+15 h | 0.015 |
| BN11.1 | Aug price ramp 1.9 → 1.824 | 150 | 0 | 1.5 h | ~−20 h | 0.010 |
| BN9.1 | 128 GB starting home comes only at SF9.2 | ~200 | 8+ | ~0.5 h after SF4.3 | negative | — |

Sources for the facts: [applySourceFile.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/SourceFile/applySourceFile.ts), [RamCostGenerator.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts), [AugmentationHelpers.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Augmentation/AugmentationHelpers.ts), [Prestige.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Prestige.ts).

Three conclusions survive even large errors in these estimates. **SF1.2, SF4.2 and a gang-assisted BN2 are clearly worth doing early.** **SF4 does not diminish for us:** each level divides Singularity RAM by 4, unlike every other SF, which follows the +base, +base/2, +base/4 series. **BN11, BN9 and most BN12 levels are completion costs, not investments,** so they belong late.

## Six runs need no new code; the rest need a subsystem first

The table ranks every remaining node by roadmap priority under the four criteria. The facts come from the v3 `getBitNodeMultipliers` switch ([BitNode.tsx](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNode.tsx)):
- w0r1d_d43m0n needs hacking 3,000 × WorldDaemonDifficulty ([ServerHelpers.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Server/ServerHelpers.ts)).
- "Effective" means that level divided by the node's HackingLevelMultiplier. It is a derived difficulty index, not a game stat.

Wall-clock figures are my estimates. The only exceptions are the two community anecdotes, which are labelled.

| # | Node (runs left) | (1) Finishable by today's stack? | w0r1d req → effective | (2) Wall-clock per run (est.) | (3) SF payoff for this automation | (4) Per-level returns | Build first |
|---|---|---|---|---|---|---|---|
| 1 | BN1 (2) | Yes, done once | 3,000 → 3,000 | 1–2 days | +16/24/28% to every multiplier | L2 +6.9%, L3 +3.2% | none |
| 2 | BN4 (2) | Yes, 158 h first time | 9,000 → 9,000 | 3–5 days | Singularity RAM 16x→4x→1x outside BN4 | **no diminishing** (÷4 each) | install-freeze fix |
| 3 | BN5 (2) | Yes, 58 h to READY | 4,500 → 4,500 | 1.5–2.5 days | +8/12/14% hacking mults (INT, Formulas at L1) | L2 +3.7%, L3 +1.8% | none |
| 4 | BN2 (3) | Theoretical only: money ×0.08, faction rep ×0.5, passive rep 0 | 15,000 → 18,750 | <2 days with a gang (anecdote); weeks without | Gangs elsewhere (karma −54k); crime/charisma | ~0 without a gang | gang (M) |
| 5 | BN10 (3) | Likely, slow: aug money ×5, rep ×2, 15 cloud servers | 6,000 → 17,143 | 5–10 days | +1 sleeve per level; sleeve and grafting API | non-diminishing (one sleeve each) | sleeves + grafting (M) |
| 6 | BN6 (3) | No in practice: hack exp ×0.25, Daedalus 35 augs | 6,000 → 17,143 | 4–10 days via Bladeburner | Bladeburner elsewhere; combat +8/12/14% | diminishing | Bladeburner (M–L) |
| 7 | BN7 (3) | No in practice; harder than BN6 (aug ×3, BB rank ×0.6) | 6,000 → 17,143 | 5–12 days via BB | BB mults; L3 Blade's Simulacrum | L3 is the prize | Bladeburner |
| 8 | BN13 (3) | Theoretical only: level ×0.25, exp ×0.1, $200k start | 9,000 → 36,000 | 1–2 weeks via BB | Larger Stanek's Gift elsewhere | small | Bladeburner; CotMG guard |
| 9 | BN9 (3) | No in practice: 0 cloud servers, home RAM ×5, server money 1% | 6,000 → 12,000 | 1–2 weeks | Hacknet servers; L2 128 GB start; L3 free server | steps at L2/L3 | hash manager (S) + BB |
| 10 | BN14 (3) | Theoretical only: hack speed ×0.3, faction rep ×0.2 | 15,000 → 37,500 | unknown | Go multipliers ×2; `go.cheat` at L2 | small | IPvGO bot (S–M) or BB |
| 11 | BN3 (3) | Likely, slow: income ~0.008 of BN1, augs ×3/×3, donate at 75 favor | 6,000 → 7,500 | 5–10 days | Charisma/salary: ~0 for us | — | none (corp only for achievements) |
| 12 | BN11 (3) | Likely, slow: server money 1%, growth 0.2, augs ×2 | 4,500 → 7,500 | 4–8 days | 10th aug 31/43/48% cheaper | diminishing | none |
| 13 | BN12 (50) | Yes early; at L50 w0r1d ×2.69, money ×0.14, levels ×0.37 | 3,060 → ~3,120 (L1); 8,075 → ~21,700 (L50) | ~1.5 days early, rising to many days | +1 free NeuroFlux per level, uncapped | linear gain, compounding cost | none (Stanek optional) |
| 14 | BN15 (3) | **Blocked**: Red Pill only from darknet EternalLab (depth 29, charisma ≥3,000) | 6,000 → 10,000 | unknown | Permanent TOR + Darkscape; darknet Red Pill route | small | darknet (M–L) or BB (rank ×0.2) |
| 15 | BN8 (3) | **Blocked**: `ScriptHackMoneyGain 0`; stocks are the only income | 3,000 → 3,000 | "a long time even with good scripts" | +12/18/21% grow; permanent TIX; shorts; orders | diminishing | pre-4S stock engine (L) + grafting |

Sources for the less obvious entries:
- **BN15:** the Red Pill was removed from Daedalus ([FactionHelpers.tsx](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Faction/FactionHelpers.tsx)), and the lab requirements are in [labyrinth.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/DarkNet/effects/labyrinth.ts).
- **BN13:** the $200k start is in [Prestige.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Prestige.ts).
- **BN2:** the gang anecdote is a search-engine summary of a [Steam thread](https://steamcommunity.com/app/1812820/discussions/0/3975051032846139530/) that could not be opened directly.
- **BN8:** the quoted phrase is from the official [comprehensive guide](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md).

The ranking tracks the project's own `DEFAULT_BN_ORDER` (1, 4, 2, 5, 10, 9, 3, 11, 12, 6, 7, 8, 13, 14) ([augplan.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/lib/augplan.js)) through the first five nodes. It departs in three places:
- **Bladeburner moves forward**, because it unlocks most of the hard nodes.
- **BN9 moves back**, because without Bladeburner its hacking-only path is impractical and SF9.2's 128 GB start is worth little once SF4.3 removes the bootstrap wall.
- **BN11 goes immediately before the BN12 grind**, so its cheaper aug ramp pays out across those 50 runs.

The most mature community autopilot, alainbryden's, follows a similar shape: 4.3, 1.2, 5.1, 1.3, 2.1, 10.1, then the hard nodes, with BN12 "forever". It wins without ever building a corporation ([AB autopilot.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/autopilot.js)).

## BN1.2 beats BN4.2 on tie-breakers, not on hours

On total hours the two orders are a wash. With the central estimates:
- **BN1 first:** BN1.2 takes about 36 h, and SF1.2 then trims about 4% off BN4.2's ~90 h. Total ≈ 122 h.
- **BN4 first:** BN4.2 takes about 90 h, and SF4.2 then removes about 6 h of bootstrap from BN1.2. Total ≈ 120 h.

The two-hour gap is far inside the estimate error. SF4 gives no speedup inside BN4 itself, because Singularity is already 1x RAM there ([RamCostGenerator.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts)). So the choice turns on four tie-breakers, and all of them favour BN1:
1. **Fast feedback on untested systems.** The planner, RAM manager and node control "had never been pushed" to the game until 2026-10-10 (live `data/agent-log.txt`). BN1 has no penalties and the lowest w0r1d requirement (3,000), so it is the cheapest place to find their bugs. BN4's 9,000 requirement is where our worst tail happened.
2. **A first test of the autoDestroy handshake** within about a day and a half, instead of five days.
3. **The FAST_BN achievement** ("destroy a BitNode in under 2 days" of playtime). It is likely in BN1.2 (est.) and unlikely anywhere else soon. BN5, with harsher multipliers (ScriptHackMoney 0.15, aug cost ×2, w0r1d 4,500), still reached READY in 58 h.
4. **Agreement with the spec's recommended order** ([aug-planner spec](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md)) and the official guide's "BN1.2 and BN1.3 are natural first choices" ([short guide](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md)).

**Every other candidate loses:**
- **BN12.1** is about as easy as BN1, but one free NeuroFlux level is worth far less than SF1.2.
- **BN2** needs a gang module that does not exist yet.
- **BN11 and BN3** are multi-day slogs with weak payoffs.

**Hold CHALLENGE_BN1 for BN1.3, not BN1.2.** The challenge needs home ≤128 GB and 1 core at destruction ([Achievements.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Achievements/Achievements.ts)). After SF4.3 the ~75 GB autopilot fits on such a home. Before SF4.3 it needs about 1 TB and must live on a cloud server, which slows the run and puts FAST_BN at risk.

**Concrete settings for this transition:**
- `node.autoDestroy=true` and `node.autoSelect=true`.
- `node.order` continuing BN4, BN4, BN1, BN5, BN5 after the BN1.2 entry.
- Keep the 10-minute `node.destroyDelayMin` veto window as the owner's brake.

## Bladeburner is the key that opens most of the remaining nodes

Bladeburner moves to the front of the build queue because of how the challenges are written. Each challenge forbids one mechanic in its own node ([Achievements.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Achievements/Achievements.ts)):

| Node | Challenge forbids |
|---|---|
| BN2 | a gang |
| BN3 | a corporation |
| BN6 / BN7 | Bladeburner |
| BN8 | 4S data and the 4S TIX API |
| BN9 | any hacknet income or spending |
| BN10 | sleeves |
| BN13 | Stanek's Gift |
| BN14 | IPvGO API moves |
| BN15 | `dnet.heartbleed` |

Often the forbidden mechanic is exactly the one that makes the node easy. A Bladeburner win, though, is "an alternative method to beat BitNodes which doesn't rely on money or hacking skill" ([short guide](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md)). Completing the final BlackOp (Operation Daedalus, rank 400k) ends the node ([BlackOperations.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Bladeburner/data/BlackOperations.ts)). After SF6 or SF7 the API works in every node, and none of its calls carry the SF4 RAM multiplier ([Bladeburner.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/NetscriptFunctions/Bladeburner.ts)).

One automated Bladeburner win path therefore delivers SF *and* challenge together in BN2 (no gang), BN3, BN9 (no hacknet), BN10, BN13 (no Stanek) and BN14 (no Go API). It also reaches BN15 without darknet code, though BN15's rank ×0.2 makes that slow. Bladeburner is disabled only in BN8 (rank 0).

The cost is speed: Bladeburner is "time-gated by the slow generation speed of contracts/operations. Sleeves speed it up a lot" ([comprehensive guide](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)). That argues for building sleeves first.

Two challenges can't use this route. CHALLENGE_BN6 and CHALLENGE_BN7 forbid Bladeburner itself, so they need a hacking-only finish at about 17,000 effective levels with hack exp ×0.25. Those runs go last, after the BN12 grind has stacked about 50 free NeuroFlux levels into every start.

The phased roadmap below interleaves each build with the runs that come before it. Builds use the effort sizes from the research notes: S under 1 day, M 1–3 days, L over 3 days. Those sizes are judgement, not measurement. The run counts per phase add up to 89.

| Phase | Runs, in order | Build while the previous runs play | Achievements folded in | Wall-clock (est.) |
|---|---|---|---|---|
| 0 · Now | none | autoDestroy + READY escalation; post-Red-Pill install freeze; deploy-drift check; BitNode-aware constants; achievement sync | INDECISIVE; script/UI one-liners (below) | 1–2 agent-days, no node time |
| 1 · Harvest the current stack (6) | BN1.2 → BN4.2 → BN4.3 → BN1.3 → BN5.2 → BN5.3 | home-RAM cap setting (before BN1.3); basic IPvGO bot; gang module | FAST_BN, CHALLENGE_BN1, hacknet-node ×4, IPVGO_WINNING_STREAK; MAX_RAM / MONEY_1Q if they come | 15–22 days |
| 2 · Gang and sleeves (5) | BN2.1 (gang) → BN2.2 (gang) → BN10.1 (no sleeves) → BN10.2 → BN10.3 | sleeves + grafting + combat-stat training (during BN10.1); Bladeburner (during BN10.2–3) | SF2.1, GANG ×4, SF10.1, CHALLENGE_BN10, SLEEVE_8, THE_COVENANT / ILLUMINATI via combat stats | 25–45 days |
| 3 · Bladeburner sweep (14) | BN6.1 → BN6.2 → BN7.1 → BN7.2 → BN13.1–13.3 → BN9.1 (zero hacknet) → BN9.2 → BN9.3 → BN14.1–14.3 → BN2.3 (no gang) | hash-spend manager (before BN9.2); CotMG guard | SF6.1, SF7.1, SF13.1, SF9.1, SF14.1; BLADEBURNER ×3; CHALLENGE_BN13 / BN9 / BN14 / BN2; hacknet-server ×5; IPVGO_ANTICHEAT | 70–120 days |
| 4 · Specialist mechanics (9) | BN3.1 (no corp) → BN15.1–15.3 (never heartbleed) → BN8.1 (no 4S) → BN8.2–8.3 → BN3.2–3.3 (corp) | darknet crawler; pre-4S stock engine with hack/grow price pushing; minimal corp | SF3.1, SF15.1, SF8.1; CHALLENGE_BN3 / BN15 / BN8; DARKNET ×2; CORPORATION ×5 | 60–100 days |
| 5 · Long tail (53) | BN11.1–11.3 → BN12.1 … BN12.50 | Stanek charger, only if high BN12 levels stall | SF11.1, SF12.1, CHALLENGE_BN12 | 100–250 days |
| 6 · Hacking-only challenges (2) | BN6.3 (no Bladeburner) → BN7.3 (no Bladeburner) | none | CHALLENGE_BN6, CHALLENGE_BN7, BN_DESTROYER | 15–30 days |

**How the order was chosen:**
- **Gang before sleeves.** Gang is the cheaper build (M, about 600 lines in the reference [gangs.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/gangs.js)) and pays off quickly: BN2's gang faction sells The Red Pill. It also turns every later aug grind into a single-faction grind once karma is farmed.
- **Sleeves before Bladeburner.** Sleeves are the strongest cross-node lever. They do faction work, karma crime and Bladeburner support in parallel. The first BN10 run is naturally sleeve-free, so CHALLENGE_BN10 comes with SF10.1.
- **BN8 waits for grafting.** The official guide recommends at least BN10.1 before BN8, because "losing capital after each reset sets you back a lot" ([comprehensive guide](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)). BN8 resets money to $250M on every install ([Prestige.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Prestige.ts)).
- **Corporation comes last and smallest.** It is the costliest build: about 960 GB of RAM if one script references the whole API, and "days or weeks" to write well. It is needed only for five achievements, so build a minimal module aimed at those five rather than a money engine.

**Code paths that break as soon as we leave BN1/4/5:**
- `daemon-lite.js` hard-codes $55,000/GB and 25 purchased servers ([daemon-lite.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/daemon-lite.js)). BN9 allows 0 cloud servers and BN10 allows 15.
- The cloud-server softcap ranges from 1.1 to 4 across nodes. In BN8 it makes a 1 PB server cost about 2.7×10^8 times its linear price.
- `lib/cloud.js` must read those multipliers.
- The donate-at-150-favor rule must read the BitNode threshold: 0 in BN8, 75 in BN3, 150 × 1.02^level in BN12.
- The Daedalus fallback of 30 augs ([ramplan.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/lib/ramplan.js)) is wrong for BN6/7 (35), BN15 (20) and BN12 (31+).
- In BN13, installing any non-NeuroFlux aug before joining the Church of the Machine God bans that faction permanently ([AugmentationHelpers.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Augmentation/AugmentationHelpers.ts)). That is harmless for CHALLENGE_BN13, but the guard is needed if Stanek is ever wanted.

## Challenge achievements fold into specific runs; two can never be earned

**What "100%" means.** The game never defines 100% in words. The Achievements page shows x/109 on dev 3.0.2 and x/108 on the 3.0.1 release; 3.0.2 adds THE_VOID ([AchievementData.json](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Achievements/AchievementData.json)). Our PLAYBOOK's "25/108" places the hosted build on 3.0.1 ([PLAYBOOK.txt](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/PLAYBOOK.txt)). We have 39.

**Two achievements are out of bounds under the owner's rules.** EDITSAVEFILE has no code path except editing the save. The source says outright that "you're supposed to gain the EditSaveFile exploit by editing your real save file" ([Exploit.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Exploits/Exploit.ts)). UNACHIEVABLE's condition is literally `() => false` ([Achievements.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Achievements/Achievements.ts)). The ceiling is therefore **107/109 (106/108)**.

**Five more need the owner's explicit decision:** DEVMENU, TIMECOMPRESSION, PROTOTYPETAMPERING, REALITYALTERATION and UNCLICKABLE. They need browser-devtools tampering. That breaks none of the three written rules, but it is risky for a 24/7 hosted page. RAINBOW needs a secret word that exists in the source only as a bcrypt hash.

| Achievement(s) | Fold into | Exact condition and how to meet it |
|---|---|---|
| INDECISIVE | **Right now**, before entering BN1.2 | About 61 continuous minutes on the BitVerse page; the counter resets if you leave. If the game has sat on the BitVerse since the 00:44Z BN5 backdoor, check whether it has already unlocked before choosing BN1. |
| UNDOCUMENTEDFUNCTIONCALL, BYPASS, N00DLES, THE_VOID (3.0.2 only), TRUE_RECURSION, FROZE | Phase 0, any node | `ns.exploit()`; `ns.bypass(document)` from a standalone script at exactly 1.6 GB (not a module the daemon imports); New Tokyo noodle bar via noVNC; Ishima "0x6C1" visit; owner plays the arcade game; one planned "reload & kill all" followed by a daemon restart ([Exploit.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Exploits/Exploit.ts)) |
| FAST_BN | BN1.2 | `playtimeSinceLastBitnode < 2 days` at destruction |
| CHALLENGE_BN1 | BN1.3, after SF4.3 | home ≤128 GB and 1 core when destroyed; cloud servers stay allowed |
| FIRST/30/MAX_HACKNET_NODE, HACKNET_NODE_10M | Phase 1 (before SF9) | Granted only while hacknet servers are inactive. The server versions grant them later through `AdditionalUnlock`, so this is a convenience, not a trap. |
| STOCK_1q | Probably already met | Condition is `moneySourceB.stock >= 1e15`. BN5 telemetry shows +$2.22q from stocks. `tools/goals.js` checks 1e18, 1000× too strict ([goals.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/tools/goals.js)). |
| GANG, FULL_GANG, GANG_TERRITORY, GANG_MEMBER_POWER | BN2.1–2.2 | 12 members, territory ≥0.999, one member with a stat of 10,000 |
| CHALLENGE_BN10, SLEEVE_8 | BN10.1; BN10.2–10.3 | No sleeve exp or augs in BN10.1. Buy 5 Covenant sleeves in a BN10 run (the last costs 100q); SLEEVE_8 unlocks once SF10.3 is owned. |
| BLADEBURNER_DIVISION / OVERCLOCK / UNSPENT_100000 | BN6.1–6.2 | Join; max the Overclock skill; hold 100k unspent skill points |
| CHALLENGE_BN13, BN9, BN14, BN2 | Bladeburner runs in Phase 3 | No Stanek; `hacknet` and `hacknet_expenses` both 0 (turn off the `lib/hooks.js` hacknet gate for the whole node); no `ns.go` move or cheat calls; no gang |
| Hacknet-server ×5 | BN9.2–9.3 | 20 servers; a maxed server; $1b hacknet money; hashes at capacity |
| CHALLENGE_BN15, DARKNET_BACKDOOR, DARKNET_DEPTHS | BN15.1; darknet achievements in any node | Crawler built without `heartbleed` from day one. The darknet exists in every node with DarkscapeNavigator.exe, so it can be built and tested before BN15. |
| CHALLENGE_BN8 | BN8.1 | Neither 4S data nor the 4S TIX API, ever, in that node |
| CHALLENGE_BN3; CORPORATION ×5 | BN3.1; BN3.2–3.3 | No corp in BN3.1. Then a minimal corp using BN3 seed money. |
| CHALLENGE_BN12 | end of Phase 5 | SF12 ≥50 |
| CHALLENGE_BN6, CHALLENGE_BN7 | BN6.3, BN7.3 | Hacking-only (gang, sleeves and IPvGO allowed), after the BN12 grind |
| HACKING_100000, NEUROFLUX_255, INSTALL_100, QUEUE_40, INTELLIGENCE_255, MAX_RAM, MONEY_1Q, KARMA_1000000, COMBAT_3000, MONEY_M1B | Opportunistic, mostly late | Hack 13,354, home 2^27 GB and $164.9q were reached in BN5; MAX_RAM needs 2^30 GB and MONEY_1Q needs $1e18. Karma and combat need the crime and gym loops built for gang and sleeves. How to legitimately reach −$1b was not traced. |

**One policy decision unblocks several rows.** v3 offers per-node "advanced options" on the BitVerse portal: `restrictHomePCUpgrade`, `disableGang`, `disable4SData`, `disableHacknetServer`, `disableSleeveExpAndAugmentation`, and others. None of them reduces the Source-File reward ([BitNodeAdvancedOptions.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/BitNode/ui/BitNodeAdvancedOptions.tsx); [RedPill.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/RedPill.tsx)). They make ideal guardrails for challenge runs. Whether they count as "game options" under the owner's rule is Boyce's call, and it should be made once, now. Without them, every guardrail has to be enforced through our own settings instead.

## The 133-hour wait cost more than every bug combined

Our own history ranks the process fixes more clearly than any game data does. The table orders them by measured or bounded cost.

| Rank | Failure | Measured cost | Fix | Deadline |
|---|---|---|---|---|
| 1 | READY never acted on: the autopilot raised "w0r1d_d43m0n READY — agent decides", and `server/checkin.js` treats owner decisions as non-escalating | **~133 h of BN5's ~191 h (70%)** | `node.autoDestroy=true` with `node.order`. Also escalate READY whenever autoDestroy is off and the gap passes 2 h. | before BN1.2's READY |
| 2 | Installs reset hacking near the w0r1d requirement | BN4: ~57 h tail after the Red Pill; nfgHold shipped about 1 h before the destroy. BN5: 6 non-NeuroFlux installs after READY. | After the Red Pill, freeze *all* installs while the predicted time to the requirement is shorter than an install's recovery time | before BN4.2 |
| 3 | Bootstrap under 16x Singularity RAM | ~14.5 h in BN5, with ~2.5 h of $0 income (an HGW bug) and hours with home stuck at 128 GB while cash went to idle pserv upgrades | Regression tests for the daemon-lite purchase ladder (home RAM before idle pservs); SF4.2/4.3 remove it | before BN1.2 |
| 4 | Repo/game drift: PRs 9–13 reached the game only on 2026-10-10 | Planner, RAM manager and node control idle for most of BN5. RAM use before the RAM manager was 74 TB of 64 PB (0.11%). | Check-in attention item when repo HEAD ≠ the pushed manifest | Phase 0 |
| 5 | Stale cross-node state: BN4 status files raised false READY alarms | ~2.5 h of escalations | Already fixed (3-minute staleness rule) | done |
| 6 | Hard-coded single-node constants (favor 150, $55k/GB, 25 servers, Daedalus 30, stock 1e18) | None yet; each breaks a later node | Read BitNode multipliers via SF5's `getBitNodeMultipliers` | before Phase 2 |
| 7 | Prediction quality | Money MAPE 60, level MAPE 23 (rep MAPE 10) | Record wall-clock per run and per phase; add BitNode-multiplier features to predictor v2 | ongoing |

Sources: live `data/agent-log.txt` and `data/install-log.txt`; [aug-planner spec](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md); [ram-manager spec](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/ram-manager.md); [PLAYBOOK.txt](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/PLAYBOOK.txt).

**The scale of fix #1 is the point.** Across 89 runs, an average decision delay of just one day adds about three months to the programme. That is more than the entire Phase 1 harvest. BN5's actual delay, repeated, would add more than a year.

## Estimates rest on three measured runs and no community timings

**The game facts are solid.** Multipliers, Source-File effects, RAM costs and achievement conditions are read from the v3 source (dev 3.0.2, unchanged from 3.0.1 for these values). Our run timings come from our own logs.

**The hour figures are not.** Every per-run wall-clock figure and every "hours saved" figure in this report is an extrapolation from three runs. Those runs had different SFs, different code maturity and, in BN4, a mid-run hosting migration. Community timings could not be verified: Reddit, Steam and readthedocs were unreachable from the research sandbox. The only data points are unverified search-snippet anecdotes ("<2 days" for BN2 with a gang, "a little over 3 days" for BN3), mostly from before v3. BN1.1's own duration is unknown because the agent log starts mid-run.

**Six mechanics should be verified in source before committing to the later phases:**
1. **Whether `ns.singularity.destroyW0r1dD43m0n` accepts BitNode options.** If it doesn't, every guardrailed challenge run needs a noVNC click.
2. **Whether the Go API flag resets on each aug install** or only on BitNode entry. If it resets per install, the IPvGO bot can run in BN14 until the final cycle.
3. **Whether the five Covenant sleeves persist across BitNodes** (SLEEVE_8).
4. **Whether BN15's first two labs (`manual: true`) need UI navigation.**
5. **Whether BN8 stock holdings survive an install.**
6. **Whether BN12's difficulty reads the *active*, overridable SF12 level.** The code passes `activeSourceFileLvl+1` to the BN12 multipliers, and the override UI says you still earn the next level. If both hold, entering BN12 with SF12 overridden to 0 would keep every run at level-1 difficulty. That would cut the 50-run grind from many multi-day runs to about 1.5-day runs, at the price of the free NeuroFlux levels. This is the single largest lever on the whole timeline, and it is subject to the same owner policy call as the other portal options.

## Conclusion

Completion is a scheduling problem with a known job list. The game fixes the 89 destructions. We control three things: the order (cheap per-run speedups first, BN11 and BN12 last), the build pipeline (write each subsystem while the previous node plays, so builds cost little wall-clock), and the dead time between READY and destroy, which so far has been our largest single cost. On that framing, the plan is BN1.2 now with autoDestroy on, then BN4 twice, then gang, sleeves and Bladeburner in that order. Bladeburner matters because it turns seven blocked or impractical nodes into SF-plus-challenge runs.

The open questions that would change the timeline most are no longer about game balance. They are two owner policy calls (BitVerse portal options and devtools achievements) and one source-code check (the BN12 override). Each could move the finish date by months, and all three can be settled before BN1.2 ends.
