# 100% completion in Bitburner v3.0.x: Source-Files and achievements

Primary source: the game's own code, read on 2026-10-11 from a sparse clone of `bitburner-official/bitburner-src`, branch `dev`, at commit `9e7fd90` (2026-10-09). `package.json` there says **3.0.2**. Tags `v3.0.0`, `v3.0.1` and `v2.8.1` were compared through raw.githubusercontent.com. No `v3.0.2` tag exists yet (HTTP 404), so 3.0.2 is unreleased dev code. Abbreviations for sources below:
- [AD] https://github.com/bitburner-official/bitburner-src/blob/dev/src/Achievements/AchievementData.json
- [AT] https://github.com/bitburner-official/bitburner-src/blob/dev/src/Achievements/Achievements.ts
- [AT301] https://github.com/bitburner-official/bitburner-src/blob/v3.0.1/src/Achievements/Achievements.ts
- [BNU] https://github.com/bitburner-official/bitburner-src/blob/dev/src/BitNode/BitNodeUtils.ts
- [BNT] https://github.com/bitburner-official/bitburner-src/blob/dev/src/BitNode/BitNode.tsx
- [OPT] https://github.com/bitburner-official/bitburner-src/blob/dev/src/BitNode/ui/BitNodeAdvancedOptions.tsx
- [RP] https://github.com/bitburner-official/bitburner-src/blob/dev/src/RedPill.tsx
- [SFDOC] https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/advanced/sourcefiles.md
- [CL] https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/changelog.md
- [GUIDE] https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md

---

## Q1. Source-File max levels, v3 changes, and whether the game defines "100%"

### Takeaway
v3.0.x has **15 BitNodes and 15 Source-Files**. SF1–SF11 and SF13–SF15 cap at level 3. SF12 has no cap. The new BN15/SF15 ("The Secrets of the Dark Net") arrived with v3.0.0's Darknet. The game never defines "100% completion" in words. The closest built-in definitions are the **BN_DESTROYER** achievement ("Reach SF x.3 in each BitNode": every SF1–SF15 at level 3 or higher, 45 SF levels in all) and the in-game Achievements page, which shows "Acquired (x/109, y/98 for Steam)". So 100% here means **all 109 achievements on dev/3.0.2 (108 on the v3.0.1 release)**. That set already includes BN_DESTROYER, so it covers "all SFs at max".

### Cited Findings
- `validBitNodes = [1..15]`. — [Constants.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/BitNode/Constants.ts)
- "It can be upgraded to a maximum of level 3, with the exception of Source-File 12, which has no hard limit." — [SFDOC]
- `giveSourceFile` stops raising the level at 3 unless `bitNodeNumber === 12`. Destroying a maxed node again only shows "already at max level". — [RP]
- `getBitNodeLevel`: `Math.min(sfLevel + 1, bn === 12 ? Number.MAX_VALUE : 3)`. — [BNU]
- BN15 "The Secrets of the Dark Net": "In this BitNode, the Daedalus faction has not yet found and monopolized the fabled Red Pill augmentation. Legends say it can be found somewhere, out there in the dark..." SF15 rewards: L1 start with TOR and DarkscapeNavigator.exe and unlock the full dark web in all BitNodes. L2 charisma boosts job salary/rep and authentication speed +20%. L3 charisma boosts faction work rep, and .cache file xp/money +50%. — [BNT]
- v3.0.0 (1 May 2026) "MAJOR CHANGES: Added Darknet ... Purchase DarkscapeNavigator.exe in the terminal to unlock access (#2139)". The "darkweb" server became a darknet server. Spoiler changes added: an achievement for acquiring SF13.1 (#2107), an achievement for completing all BNs (#2128), achievements for BN14 (#2140), `ns.singularity.getUnlockedAchievements` (#2156), and an "improved challenge achievement for BN15" (#2479). v3.0.1 was released 17 May 2026. — [CL]
- BN_DESTROYER: `Condition: () => validBitNodes.every((bn) => Player.sourceFileLvl(bn) >= 3)`, `NotInSteam: true`. — [AT]
- The achievement list UI shows counts as `{title} ({n}/{all}, {steamCount}/...)`, where steamCount excludes `NotInSteam`. — [AchievementCategory.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Achievements/AchievementCategory.tsx)
- **Count by version:** dev (3.0.2) has 109 achievement IDs. v3.0.1 and v3.0.0 have 108, without THE_VOID. v2.8.1 had 98, without BN_DESTROYER, CHALLENGE_BN14, CHALLENGE_BN15, DARKNET_BACKDOOR, DARKNET_DEPTHS, IPVGO_ANTICHEAT, IPVGO_WINNING_STREAK, SF13.1, SF14.1, SF15.1 and THE_VOID. This comes from diffing AchievementData.json at the tags. — [AD]; [v3.0.1 AchievementData.json](https://github.com/bitburner-official/bitburner-src/blob/v3.0.1/src/Achievements/AchievementData.json); [v2.8.1 AchievementData.json](https://github.com/bitburner-official/bitburner-src/blob/v2.8.1/src/Achievements/AchievementData.json)
- 11 achievements are `NotInSteam`: SF13.1, SF14.1 and SF15.1 (rule `NotInSteam: bn >= 13`), plus BN_DESTROYER, IPVGO_ANTICHEAT, IPVGO_WINNING_STREAK, DARKNET_BACKDOOR, DARKNET_DEPTHS, CHALLENGE_BN14, CHALLENGE_BN15 and THE_VOID. That leaves **98 Steam achievements**. The code notes "Steam has a limit of 100 achievement". — [AT]
- The local repo's PLAYBOOK says "ACHIEVEMENT QUICK WINS (25/108 done)", which matches a v3.0.1 build (108). — /home/user/bitburner/game/agent/PLAYBOOK.txt (local repo)
- The repo's dashboard spec mentions extracting costs from "bitburner-src v3.0.1 `RamCostGenerator.ts`". — /home/user/bitburner/docs/specs/dashboard.md (local repo)
- `ns.singularity.getUnlockedAchievements()` returns `Player.achievements.map(a => a.ID)`. RAM cost is `SF4Cost(SingularityFn3)`. — [Singularity.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/NetscriptFunctions/Singularity.ts); [RamCostGenerator.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Netscript/RamCostGenerator.ts)
- Achievements are re-checked about once per second: engine `achievementsCounter = 5` engine cycles, and also after some Singularity calls. — [engine.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/engine.tsx)

### Inferences
- The hosted game is most likely on **v3.0.1 (108 achievements)**. THE_VOID (#109) only exists in dev/3.0.2. It only counts once the hosted build moves to 3.0.2+.
- Full SF completion needs 45 SF levels. Owned now: SF1.1, SF4.1, SF5.1 (3 levels). **42 BitNode destructions remain** just for BN_DESTROYER. CHALLENGE_BN12 adds BN12 up to SF12.50, which is **47 more BN12 runs beyond SF12.3**. That puts the floor at about 89 destructions in total.
- The automation can read our own achievement list directly with `ns.singularity.getUnlockedAchievements()` for the coordinator's comparison. SF4.1 is owned, so this is available.

### Gaps
- No official text says "100% = all achievements". That definition is inferred from the achievements UI counter and the Steam list.
- I could not confirm whether the hosted Railway build is 3.0.1 or a dev build. Check `ns.ui.getGameInfo()` or the version shown in the game.
- Our current 39 achievements are **unknown — to be compared**. The coordinator should pull them via `getUnlockedAchievements()`; this research did not contact the live game.

---

## Q2. Full achievement list (109 on dev), grouped by the BitNode, Source-File or mechanic each needs

### Takeaway
Of the 109, about **45 are reachable in any BitNode** with hacking + Singularity automation plus small add-ons (stock trading, gym, crime, hacknet). **15 are per-SF "first destruction"** achievements. **12 are BN challenges**. **19 need a specific mechanic** we don't automate: gang 4, corporation 5, Bladeburner 3, hacknet servers 5, sleeves 1, IPvGO 2, Darknet 2 (that sums to 22; INTELLIGENCE_255 also needs SF5 or BN5). **13 are secret exploit/meta achievements**, several of which need editing the save or developer tools. Everything below is verbatim from [AD] (name/description) and [AT] (condition) unless another source is given.

### Cited Findings

**A. Any BitNode, hacking/Singularity automation (factions & programs: 13)**
| ID | Name | Condition |
|---|---|---|
| CYBERSEC, NITESEC, THE_BLACK_HAND, BITRUNNERS, DAEDALUS, THE_COVENANT, ILLUMINATI | CyberSec, avmnite-02h, I.I.I.I, run4theh111z, fl1ght.exe, The Covenant, Illuminati | `Player.factions.includes(<faction>)`. Covenant and Illuminati also need combat stats (per PLAYBOOK: Illuminati needs all combat 1200, Covenant 850) |
| BRUTESSH.EXE, FTPCRACK.EXE, RELAYSMTP.EXE, HTTPWORM.EXE, SQLINJECT.EXE, FORMULAS.EXE | (same names) | the program is on home |

**B. Any BitNode, general (25)**
| ID | Name: description | Exact condition / note |
|---|---|---|
| MONEY_1Q | Here comes the money!: $1Q on home | `Player.money >= 1e18` |
| MONEY_M1B (secret) | Massive debt: Be $1b in debt | `Player.money <= -1e9` |
| INSTALL_1 | I never asked for this | ≥1 installed aug |
| INSTALL_100 | I asked for this | `Player.augmentations.length >= 100` |
| QUEUE_40 | It's time to install | `Player.queuedAugmentations.length >= 40` (PLAYBOOK: NFG levels count) |
| HACKING_100000 | Power Overwhelming | hacking skill ≥ 100,000 |
| COMBAT_3000 | One punch man | str, def, dex and agi all ≥ 3000 |
| NEUROFLUX_255 | Neuroflux is love… | NFG installed level ≥ 255 |
| NS2 | Maximum speed! | any non-legacy script on home |
| FROZE | while(true); | `location.href.includes("noScripts")`, i.e. reload via the "reload & kill all" recovery option |
| RUNNING_SCRIPTS_1000 | Need more real life ram | `workerScripts.size >= 1000` |
| DRAIN_SERVER | Big trouble | any server with moneyMax>0 at moneyAvailable===0 |
| MAX_RAM | Download more ram | home maxRam === 2^30 GB (`HomeComputerMaxRam: 1073741824`, [Server Constants](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Server/data/Constants.ts)) |
| MAX_CORES | Download more cores? | home cores === 8 |
| SCRIPTS_30 | Thank you folders! | ≥30 scripts on home |
| KARMA_1000000 (secret) | Wretched hive of scum and villainy | karma ≤ −1,000,000 (crimes) |
| STOCK_1q | Wolf of Wall Street: Make 1q on the stock market | `Player.moneySourceB.stock >= 1e15` |
| DISCOUNT | Discount! | powerhouse-fitness backdoored |
| SCRIPT_32GB | You'll need upgrade for this one | any home script with ramUsage ≥ 32 |
| REPUTATION_10M | Well liked | any faction rep ≥ 10m |
| DONATION | Donate! | any faction favor ≥ floor(150 × BN FavorToDonateToFaction) |
| TRAVEL | World explorer | city ≠ Sector-12 |
| WORKOUT | Gains! | currently doing gym class work |
| TOR | The Onion Network | has TOR |
| HOSPITALIZED | Ouch! | `moneySourceB.hospitalization !== 0` |
| 4S | 4S | `Player.has4SData` |

**C. Hacknet *Nodes* (4). Only obtainable when hacknet servers are NOT active**
| ID | Name | Condition |
|---|---|---|
| FIRST_HACKNET_NODE | Free money! | `!hasHacknetServers() && hacknetNodes.length > 0` |
| 30_HACKNET_NODE | Big network | `!hasHacknetServers() && ≥30 nodes` |
| MAX_HACKNET_NODE | That's the limit | a node at level 200, RAM 64, cores 16 ([Hacknet Constants](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Hacknet/data/Constants.ts)) |
| HACKNET_NODE_10M | The original hacker | `!hasHacknetServers() && moneySourceB.hacknet >= 10e6` |
- Hacknet servers replace nodes when `(activeSourceFileLvl(9) >= 3 || bitNodeN === 9) && !bitNodeOptions.disableHacknetServer`. — [Prestige.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Prestige.ts)
- Each hacknet-server achievement has `AdditionalUnlock` for its node counterpart: FIRST_HACKNET_SERVER→FIRST_HACKNET_NODE, ALL_HACKNET_SERVER→30_HACKNET_NODE, MAX_HACKNET_SERVER→MAX_HACKNET_NODE, HACKNET_SERVER_1B→HACKNET_NODE_10M. — [AT]

**D. Source-File acquisition (15)**: SF1.1 … SF15.1. Names: Source Genesis, Rise of the Underworld, Corporatocracy, The Singularity, Artificial Intelligence, Bladeburners, Bladeburners 2079, Ghost of Wall Street, Hacktocracy, Digital Carbon, The Big Crash, The Recursion, They're lunatics, IPvGO Subnet Takeover, The Secrets of the Dark Net. Condition: `Player.sourceFileLvl(bn) >= 1`. SF13–15 are not on Steam.

**E. BitVerse / meta (3)**
| ID | Name: description | Condition |
|---|---|---|
| INDECISIVE | Too many options: Spend 1h straight on the BitVerse | counter +1 every 60s while `Router.page() === Page.BitVerse`, reset otherwise. Unlocks at `c > 60`, i.e. about 61 continuous minutes on the BitVerse page |
| FAST_BN | Speed demon: Destroy a BitNode in under 2 days | `isBitNodeFinished() && Player.playtimeSinceLastBitnode < 2 days` |
| BN_DESTROYER | More BitNodes, please! | all SF1–SF15 ≥ 3 |

**F. Mechanic-specific (22)**
| Mechanic (unlocked by) | IDs: condition |
|---|---|
| Gang (BN2 / SF2) | GANG (form a gang); FULL_GANG (12 members, `MaximumGangMembers: 12`); GANG_TERRITORY (territory ≥ 0.999); GANG_MEMBER_POWER (a member with 10,000 in one stat) |
| Corporation (BN3 / SF3) | CORPORATION; CORPORATION_BRIBE (unlock GovernmentPartnership); CORPORATION_PROD_1000 (division productionMult ≥ 1000); CORPORATION_EMPLOYEE_3000; CORPORATION_REAL_ESTATE (Real Estate division) |
| Intelligence (BN5 / SF5) | INTELLIGENCE_255 (int ≥ 255; `Visible: canAccessBitNodeFeature(5)`) |
| Bladeburner (BN6/7 / SF6/7) | BLADEBURNER_DIVISION; BLADEBURNER_OVERCLOCK (Overclock skill at max); BLADEBURNER_UNSPENT_100000 (100k unspent skill points) |
| Hacknet servers (BN9 / SF9) | FIRST_HACKNET_SERVER; ALL_HACKNET_SERVER (20 = `MaxServers`); MAX_HACKNET_SERVER (level 300, RAM 8192, cores 128, cache 15); HACKNET_SERVER_1B (hacknet money ≥ 1e9); MAX_CACHE (hashes at capacity) |
| Sleeves (BN10 / SF10) | SLEEVE_8: `Player.sleeves.length === 8 && Player.sourceFileLvl(10) === 3` |
| IPvGO (BN14 / SF14) | IPVGO_WINNING_STREAK: given in scoring when `factionName === Illuminati && winStreak >= 10` ([scoring.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Go/boardAnalysis/scoring.ts)). IPVGO_ANTICHEAT: given when a cheat attempt fails with prior cheats and a 10% ejection roll hits ([netscriptGoImplementation.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Go/effects/netscriptGoImplementation.ts)) |
| Darknet (DarkscapeNavigator.exe; BN15 / SF15) | DARKNET_BACKDOOR: ≥50 movable darknet servers backdoored at once. DARKNET_DEPTHS: install the augmentation "The Sword" from the deepest server |
- [GUIDE]: "Each Source-File grants an additional sleeve and up to five additional sleeves may be purchased from a faction only in this BitNode" (BN10). That implies SLEEVE_8 = SF10.3 (3 sleeves) + 5 Covenant sleeves bought in BN10.
- [CL] v3.0.0: "Update description of 'You and what army?' achievement (#2703)".

**G. BitNode challenges (12).** See Q3.

**H. Secret / exploit / easter-egg (13).** See Q5.

### Inferences
- Count check: 13 + 25 + 4 + 15 + 3 + 22 + 12 + 13 + THE_VOID(1) = 108. The table splits differ by one from that sum because THE_VOID is listed in Q5. ID total = 109.
- **Repo bug spotted:** `game/tools/goals.js` checks Wolf of Wall Street at `stockNet >= 1e18`. The game condition is `moneySourceB.stock >= 1e15` ("1q" = quadrillion). The local check is 1000x too strict.
- **Hacknet-node trap:** after SF9.3, hacknet servers always replace hacknet nodes, unless the `disableHacknetServer` BitNode option is set. So get the four hacknet-*node* achievements before SF9.3, or in a node entered with that option. Achieving the server versions also grants them via AdditionalUnlock, which is the easier path once in BN9.
- Hacking-only automation already covers or can cheaply add: all of A; most of B (KARMA needs crime automation; COMBAT_3000 needs gym; STOCK_1q needs stock trading; MONEY_M1B needs a way into $1b of debt); C; D/E as nodes fall.

### Gaps
- How to legitimately reach −$1b money (MONEY_M1B) wasn't traced in code. Owner rule "Debt is OK early" suggests it is known to the team.
- Whether each NFG level counts separately in `Player.augmentations.length` (INSTALL_100) wasn't verified.
- Prerequisites of the IPvGO "Illuminati" opponent (e.g. faction membership, SF14 level) weren't traced.
- Whether Covenant-bought sleeves persist across BitNodes wasn't verified in code.

---

## Q3. Challenge achievements: exact restrictions; same run or separate run?

### Takeaway
All 12 challenges are checked **at destruction time, while the node's state is still live**. Each needs `Player.bitNodeN === N && isBitNodeFinished()` (w0r1d_d43m0n backdoored) plus a "never used X" flag. The exceptions are BN12 (SF12 ≥ 50) and BN1 (home ≤128GB and 1 core at the end). Because the automation never touches gangs, corps, Bladeburner, sleeves, Stanek or Go, **the BN2, BN3, BN6, BN7, BN10, BN13 and BN14 challenges should come free in the same first run that earns the SF**, as long as nothing in those nodes uses the forbidden mechanic. BN9 needs the hacknet hook turned off. BN1, BN8 and BN15 need deliberate strategy changes. BN12 needs 50 destructions.

### Cited Findings
| ID | Description ([AD]) | Exact condition ([AT]) |
|---|---|---|
| CHALLENGE_BN1 | Destroy BN1 with at most 128GB and 1 core | `bitNodeN===1 && finished && home.maxRam <= 128 && home.cpuCores === 1` |
| CHALLENGE_BN2 | Destroy BN2 without forming a gang | `bitNodeN===2 && finished && Player.gang === null` |
| CHALLENGE_BN3 | …without creating a corporation | `Player.corporation === null` |
| CHALLENGE_BN6 | …without joining the Bladeburner division | `Player.bladeburner === null` |
| CHALLENGE_BN7 | (same, BN7) | `Player.bladeburner === null` |
| CHALLENGE_BN8 | …without purchasing the 4S market data | `!Player.has4SData && !Player.has4SDataTixApi` (the TIX API version is also forbidden) |
| CHALLENGE_BN9 | …without converting hashes from hacknet servers into money or using hacknet nodes | `moneySourceB.hacknet === 0 && moneySourceB.hacknet_expenses === 0` (no hacknet purchases or upgrades at all) |
| CHALLENGE_BN10 | …without using sleeves | no sleeve with any augmentation or any exp > 0 |
| CHALLENGE_BN12 | Destroy BN12 50 times | `Player.sourceFileLvl(12) >= 50` (any node) |
| CHALLENGE_BN13 | Complete BN13 without Stanek's Gift | no installed Stanek's Gift – Genesis |
| CHALLENGE_BN14 | …without making a move or cheating via IPvGO APIs | `!Go.moveOrCheatViaApi`. The flag is set by any `ns.go` move/cheat call and reset on prestige ([Go.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Go/Go.ts)). Manual UI play is allowed. Not on Steam |
| CHALLENGE_BN15 | Complete BN15 without ever calling dnet.heartbleed | `!DarknetState.hasUsedHeartbleed` (saved in the darknet state). Not on Steam |
- After `finishBitNode()` sets `w0r1d_d43m0n.backdoorInstalled = true`, the UI goes to the BitVerse. Player state (bitNodeN, home RAM, gang…) stays as it is until a new node is entered via `enterBitNode`. So the roughly once-per-second check catches challenge conditions during the BitVerse wait. — [BNU]; [RP]; [engine.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/engine.tsx)
- In BN2, "The gang faction offers more augmentations than other factions, and in BitNode-2, it offers The Red Pill". Daedalus is unaffected (no BN2 Daedalus restriction in multipliers). — [bitnodes.md](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/advanced/bitnodes.md); [BNT]
- In BN15, Daedalus does not hold The Red Pill: "Legends say it can be found somewhere, out there in the dark". — [BNT]
- BN multipliers that matter for a hacking-only finish ([BNT] `getBitNodeMultipliers`):
  - BN8: `ScriptHackMoneyGain: 0` (hacking yields no money), `CompanyWorkMoney 0`, `FavorToDonateToFaction 0`, `HacknetNodeMoney 0`, `DarknetMoneyMultiplier 0`.
  - BN9: `ServerMaxMoney 0.01`, `HomeComputerRamCost 5`, `HackExpGain 0.05`.
  - BN11: `ServerMaxMoney 0.01`, `ServerGrowthRate 0.2`.
  - BN6/BN7: `DaedalusAugsRequirement 35`, `HackingLevelMultiplier 0.35`.
  - BN14: `WorldDaemonDifficulty 5`.
  - BN13: `HackingLevelMultiplier 0.25`, `WorldDaemonDifficulty 3`.
  - BN15: `DaedalusAugsRequirement 20`, `AugmentationMoneyCost 3`.
  - BN12: `inc = 1.02^lvl`, `dec = 1/inc`. Applied to most mults (WD difficulty × inc, ServerMaxMoney × dec², Daedalus aug requirement `min(30 + inc, 40)`).

### Inferences
- **Same run as the SF (free if automation stays as-is):** BN2, BN3, BN6, BN7, BN13, BN14. BN10 too: just never assign sleeves; the option below can enforce it.
- **BN9:** same run is possible if `lib/hooks.js` (hacknet ROI gate) and any hacknet buying are disabled for the whole node. Even one hacknet purchase sets `hacknet_expenses` above 0 and fails it permanently for that run.
- **BN1:** needs a dedicated BN1 run (BN1.2 or BN1.3 is a natural slot) with home capped at 128GB/1 core. Purchased servers stay allowed. The autopilot's home-RAM/core buying must be off (or use the restrictHomePCUpgrade option, which blocks upgrades past 128GB and 1 core). With SF4.1, Singularity functions cost 16x RAM. Running them from a purchased server (as pserv-sing does now) is a must.
- **BN8:** hacking can't make money, so any finish needs stock-market automation. The challenge additionally forbids 4S data and the 4S TIX API, so trading must use price history or manipulation via hack/grow. Doing BN8.1 without 4S gets both at once but is harder. Otherwise it's a second BN8 run.
- **BN15:** finishing at all needs Darknet automation to find The Red Pill. The challenge forbids `dnet.heartbleed`, so build the darknet crawler without it from the start and both come in one run.
- **BN12:** 50 destructions with steadily worse multipliers. At level 50, inc ≈ 2.69 (WD difficulty ×2.69, server money ×0.14). This is by far the longest item. Each run is "BN1, just a little bit harder each time" ([GUIDE]).

### Gaps
- Whether `Player.has4SDataTixApi` can be avoided while still trading profitably in BN8 wasn't assessed. That belongs to the strategy researchers.
- I could not confirm whether BN8's darknet or any other income source makes BN8 hacking-reachable. `DarknetMoneyMultiplier 0` suggests not.

---

## Q4. v3 "BitNode options" (advanced settings on entry): what they are and how they interact with rewards and achievements

### Takeaway
When entering a node from the BitVerse portal, an advanced-options panel offers SF-level overrides, an intelligence override and six restriction toggles. **None of them reduce or block the SF reward**: `giveSourceFile` ignores options. Achievements are judged on actual player state, so the toggles act as **enforcement aids for challenge runs** rather than separate challenge modes. They do not grant challenges on their own: the challenge still needs the right `bitNodeN`.

### Cited Findings
- Default options: `sourceFileOverrides` (empty), `intelligenceOverride` (undefined), `restrictHomePCUpgrade`, `disableGang`, `disableCorporation`, `disableBladeburner`, `disable4SData`, `disableHacknetServer`, `disableSleeveExpAndAugmentation` (all false). — [BNU]
- UI text: "Restrict max RAM and core of Home PC — The home computer's maximum RAM and number of cores are lower than normal. Max RAM: 128GB. Max core: 1."; "Disable Gang/Corporation/Bladeburner/4S Market Data, regardless of BitNode and SF level"; "Disable Hacknet Server … Hacknet Node is re-enabled in place of Hacknet Server."; "Disable Sleeves' experience and augmentation — Sleeves cannot gain experience or install augmentations". — [OPT]
- SF override note: "Changing the active level of a SF is temporary; you still permanently own that SF level. For example, if you enter BN 1.3 while having SF 1.2 but with the active level set to 0, you will not get the bonuses from SF 1.1 or SF 1.2, but you will still earn SF 1.3 when destroying the BN." — [OPT]
- Intelligence override: "Your intelligence and your Sleeves' intelligence will be temporarily set to this value if it is lower than their current values." — [OPT]
- `enterBitNode` → `giveSourceFile(destroyedBitNode)` with no reference to options, then `setBitNodeOptions(bitNodeOptions)` for the new node. Options reset to defaults otherwise. — [RP]
- RAM/core purchase is blocked at 128GB when `restrictHomePCUpgrade` is set (`homeComputer.maxRam >= 128`). — [RamButton.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Locations/ui/RamButton.tsx); [ServerPurchases.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Server/ServerPurchases.ts)
- `canAccessBitNodeFeature(n)` = `bitNodeN === n || activeSourceFileLvl(n) > 0`, and `activeSourceFileLvl` respects overrides. — [BNU]; [PlayerObjectGeneralMethods.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/PersonObjects/Player/PlayerObjectGeneralMethods.ts)
- v3.0.0 fix: "Sleeves can earn exp and purchase augmentations when enabling disableSleeveExpAndAugmentation (#2467)" was fixed. Also "Apply SF override to charisma calculations (#2642)" and "Ensure intelligence override is a positive integer (#2673)". — [CL]

### Inferences
- Useful pairings:
  - CHALLENGE_BN1: `restrictHomePCUpgrade`.
  - CHALLENGE_BN2/3/6/7: the matching `disable*` option, as a guardrail.
  - CHALLENGE_BN8: `disable4SData`.
  - CHALLENGE_BN10: `disableSleeveExpAndAugmentation`.
  - The hacknet-node achievements after SF9.3: `disableHacknetServer`.
  - None of these cost SF rewards.
- **Owner-rule question:** these are per-node choices on the BitVerse portal, not global game options (Options menu). Whether owner rule "never change game options" covers them is a policy call for Boyce. They are also currently a UI-only flow. I found no NS API for options in `singularity.destroyW0r1dD43m0n` within this research's scope.

### Gaps
- I did not verify whether `ns.singularity.destroyW0r1dD43m0n(nextBN, callback, options)` accepts BitNodeOptions in v3. `BitNodeOptions` does appear in `NetscriptFunctions/Singularity.ts` imports (grep hit) but the signature wasn't read. Worth checking for agent/sl-destroy.js.

---

## Q5. Secret / exploit achievements and conflicts with owner rules

### Takeaway
There are 15 `Secret` achievements: MONEY_M1B, KARMA_1000000, 11 "SF −1" exploits, UNACHIEVABLE and THE_VOID. Four exploits are trivial NS calls or UI clicks with no rule conflict: UNDOCUMENTEDFUNCTIONCALL, BYPASS, N00DLES and TRUE_RECURSION (the last is a mini-game). THE_VOID is a UI visit. **EDITSAVEFILE and UNACHIEVABLE need editing the save file** (or the dev menu), which conflicts with "never edit saves". DEVMENU, TIMECOMPRESSION, PROTOTYPETAMPERING, REALITYALTERATION and UNCLICKABLE need browser devtools/page tampering. Those are grey-zone for a 24/7 hosted run and risky to game stability.

### Cited Findings
- Code comment: "you're supposed to gain the EditSaveFile exploit by editing your real save file. TBH, you could gain them all the same way, but that is not our challenge to you." — [Exploit.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Exploits/Exploit.ts)
- UNACHIEVABLE: `Condition: () => false // Hey Players! Yes, you're supposed to modify this to get the achievement!`. It is in Steam (no NotInSteam). — [AT]
- How each exploit is granted (`Player.giveExploit`, toast "SF -1 acquired!"):

| Achievement | Trigger in code | Method | Rule conflict? |
|---|---|---|---|
| UNDOCUMENTEDFUNCTIONCALL | `ns.exploit()` | one script line | none |
| BYPASS | `ns.bypass(document)` from a script whose RAM is exactly base cost (1.6GB) | script; needs a real `document` reference past the RAM checker | none (script only) |
| RAINBOW | `ns.rainbow(guess)`, bcrypt-checked against a fixed hash | needs the secret word | none, if the word is known |
| REALITYALTERATION | `ns.alterReality()` gives it only if a provably-false variable becomes true | debugger breakpoint / JS tampering | devtools |
| N00DLES | "Eat noodles" at the New Tokyo noodle bar once you know about the BitVerse | UI click | none |
| TRUE_RECURSION | `message` event from origin `https://bitburner-official.github.io`, data `true`, `isTrusted`, while in the New Tokyo Arcade (Megabyteburner 2000): "Beat BN1 in megabyteburner 2000" | play the arcade mini-game | none (manual play) |
| UNCLICKABLE | a trusted (real, `event.isTrusted`) click on an element with `display:none` and `visibility:hidden` | DOM tampering + real click | devtools |
| PROTOTYPETAMPERING | every 15 min checks `(55).toExponential() !== "5.5e+1"` | override `Number.prototype.toExponential` | page tampering; may break number formatting |
| TIMECOMPRESSION | a 15-second `setTimeout` chain sees under 500ms elapsed via `performance.now()` | speed up page timers | page tampering; risky in a 24/7 run |
| DEVMENU | `DevMenuRoot` mount. The sidebar entry exists only when `NODE_ENV === "development"`. `ns.openDevMenu()` only emits an April-1 joke event and does not grant it | dev build or router tampering | devtools / dev build |
| EDITSAVEFILE | no code path; must add `"EditSaveFile"` to `exploits` in the save | **save editing** | **conflicts** |
| UNACHIEVABLE | none | save editing or dev menu | **conflicts** |

  Sources: [Extra.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/NetscriptFunctions/Extra.ts); [SpecialLocation.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Locations/ui/SpecialLocation.tsx); [BBCabinet.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Arcade/ui/BBCabinet.tsx); [Unclickable.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Exploits/Unclickable.tsx); [loops.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Exploits/loops.ts); [DevMenu.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/DevMenu.tsx); [SidebarRoot.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Sidebar/ui/SidebarRoot.tsx); [Apr1.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/ui/Apr1.tsx)
- THE_VOID (dev/3.0.2 only; secret; not Steam): visit the Ishima location "0x6C1" (`IshimaGlitch`). After about 25s (an Erlang-distributed random delay, mean 25s) you are silently warped to "The Void", which calls `giveAchievement("THE_VOID")`. UI only. — [SpecialLocation.tsx](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Locations/ui/SpecialLocation.tsx); [Locations/Enums.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Locations/Enums.ts)
- FROZE (not secret) needs the page loaded with `noScripts` in the URL ("reload & kill all"). That kills all running scripts once. — [AT]
- A SteamAH page claims all achievements in about 5 minutes by injecting achievement IDs via a script. That is a cheat that skips the conditions (EDITSAVEFILE-style). — [steamah.com](https://steamah.com/bitburner-how-to-get-100-achievement-unlocked/)
- A Steam discussion: a player who completed all BitNodes was told they were "still missing at least 1 achievement". This matches the exploit/secret set being separate from BN completion. — [steamcommunity.com](https://steamcommunity.com/app/1812820/discussions/0/3417685728351121119)

### Inferences
- **Strict owner-rule reading:** EDITSAVEFILE and UNACHIEVABLE are off-limits. 100% is then unreachable: best case **107/109** (or **106/108** on v3.0.1). If Boyce explicitly allows a one-off save edit (with a backup), both become a 5-minute job. Same for the devtools items.
- Low-risk now, any node: UNDOCUMENTEDFUNCTIONCALL and BYPASS (a tiny script), N00DLES and THE_VOID (UI clicks via the hosted noVNC GUI or a page-context `bb js`), TRUE_RECURSION (manual arcade game), FROZE (one planned reload, with the daemon restart that follows).
- RAINBOW's word isn't in the source (bcrypt hash only). Community lore would be needed.

### Gaps
- RAINBOW's password was not researched (by design it is hidden behind a hash).
- I didn't verify whether the hosted build's origin affects TRUE_RECURSION. The arcade iframe posts from `bitburner-official.github.io`, so it should work regardless of where the game page is hosted.

---

## Q6. Roadmap ranking implications (feasibility, wall-clock, SF value, diminishing returns)

### Takeaway
From the code facts above, rank nodes by "can hacking-only automation finish it, and does the challenge come free". BN2, BN3, BN6, BN7, BN10, BN13 and BN14 each give SF + challenge in one hacking-only run. BN9 is the same with the hacknet hook disabled. BN1 is a 128GB challenge run, ideally after SF4.3, so Singularity is cheap. BN11 is hacking-reachable but slow. BN8 needs stock automation, and BN15 needs darknet automation (plus no heartbleed). BN12 ×50 is the long tail. The mechanic achievements (22) need new automation for gang, corporation, Bladeburner, hacknet servers, sleeves, IPvGO and darknet.

### Cited Findings
- Official guidance: "BN1, BN2, and BN5 are great starters"; "Due to the RAM cost, it's strongly recommended to complete BN4.3 before using the Singularity API in other BitNodes"; "BN9, BN13, BN14, and BN15 are tough"; "BN3 has a very tough mechanic to automate but gives unparalleled power"; "BN8 and BN11 are tough but offer little benefit to new players"; "BN12 is easy to start but quickly ramps up in difficulty"; BN8 "there's no other way to make money" than stocks, and "Completing at least BN10.1 is highly recommended in order to have Grafting"; BN9.2 gives 128GiB starting home RAM. — [GUIDE]
- SF1 bonuses: all multipliers +16% / +24% / +28% at L1/L2/L3 (diminishing per level). — [bitnodes.md](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Documentation/doc/en/advanced/bitnodes.md)
- WD difficulty multipliers (hacking needed for w0r1d_d43m0n is base × this): BN2 5, BN3 2, BN4 3, BN5 1.5, BN6 2, BN7 2, BN9 2, BN10 2, BN11 1.5, BN13 3, BN14 5, BN15 2, BN12 1.02^lvl. — [BNT]; [ServerHelpers.ts](https://github.com/bitburner-official/bitburner-src/blob/dev/src/Server/ServerHelpers.ts)

### Inferences
- **Achievements bundled per first run.** First destruction of each new node gives SF{n}.1 (+1). Challenge-free nodes: BN2, BN3, BN6, BN7, BN9 (hook off), BN10, BN13, BN14 each give +2 achievements per hacking-only run. FAST_BN (< 2 days playtime since last BitNode) will come naturally on an easy node once multipliers stack, e.g. BN1.2/1.3. INDECISIVE comes if one destruction sits on the BitVerse for 61+ minutes. The node.destroyDelayMin veto window happens before destroying, so this needs an extra wait after it.
- **Total runs** for SF completion: 42 more SF levels (all nodes to 3, minus SF1.1, SF4.1, SF5.1 owned), plus 47 extra BN12 runs for CHALLENGE_BN12. Later SF levels add little to other runs (e.g. SF1 +16% → +24% → +28%). After about level 2 of the speed-relevant SFs (SF1, SF4, SF5, SF9.2 for 128GB start, SF10 for grafting/sleeves), 3rd levels are mostly "for completion".
- The mechanic achievements could mostly be gathered *inside the node that unlocks the mechanic*, but only on a **repeat** run (e.g. BN2.2) or after the SF, so the first run keeps the challenge. Note gang/corp/Bladeburner/hacknet-server/sleeve automation doesn't exist yet. These 19–22 achievements plus BN8/BN15 are where new engineering is needed.

### Gaps
- Wall-clock estimates per node were not derived here (depends on the predictor and other researchers' data).
- Covered by other researchers, not here: the per-SF speedup magnitudes for SF2–SF15 beyond what is quoted.
