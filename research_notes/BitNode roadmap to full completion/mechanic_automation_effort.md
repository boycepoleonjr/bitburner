# Engineering effort and feasibility of automating each non-hacking Bitburner mechanic (v3.0.x)

Scope note: primary sources are the `dev` branch of bitburner-src (package.json `"version": "3.0.2"`, Constants `VersionString: "3.0.2"`, changelog head "v3.0.1: 17 May 2026", "v3.0.0: 1 May 2026") and alainbryden/bitburner-scripts `main`, both fetched 2026-10-11 via raw.githubusercontent.com. Line counts are from `wc -l` on those raw files. github.com HTML, the GitHub API, Reddit mirrors (redlib), steamcommunity.com and kosgames.com could not be fetched from this sandbox, so community wall-clock reports are thin (see Gaps).

Abbreviations: RCG = [RamCostGenerator.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts); NSD = [NetscriptDefinitions.d.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/ScriptEditor/NetscriptDefinitions.d.ts); CG = official [BitNode recommendation, comprehensive guide](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md); SG = official [short guide](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md); BNT = [src/BitNode/BitNode.tsx](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNode.tsx) (BitNode text and multipliers); AB = [alainbryden/bitburner-scripts](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/README.md).

## Q1. Netscript namespace, v3 RAM costs, and the SF/BitNode needed to use each API outside its home node

### Takeaway
Every mechanic has its own namespace. **Only `ns.singularity` carries the SF4 16x/4x/1x multiplier.** gang, bladeburner, sleeve, corporation, stanek, go, stock, hacknet and grafting cost the same in every node, so our SF4.1 penalty does not inflate them (grafting needs one Singularity travel call). Corporation is by far the most RAM-hungry API: 20 GB per action function and 10 GB per info function, about 960 GB if one script references every function. Access gates are: SF2 + karma ≤ −54,000 (gang), SF6 or SF7 + joining the division (Bladeburner), SF3 + $150b self-funding, with SF3.3 needed for a free full API (corp), SF10 (sleeves/grafting, though buying sleeves only works inside BN10), SF13 + accepting the Gift (Stanek), SF9 (hacknet servers), none (IPvGO, with cheats at SF14.2), and money for WSE/TIX/4S (stocks, permanent with SF8.1).

### Cited Findings
**RAM constants (v3 dev)**
- Base script cost is 1.6 GB, with `CorporationInfo: 10`, `CorporationAction: 20`, `GangApiBase: 4`, `BladeburnerApiBase: 4`, `SleeveBase: 4`, `GetStock: 2.0`, `BuySellStock: 2.5`, `Hacknet: 0.5`. — [RCG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts)
- `SF4Cost()` (16x at SF4.1, 4x at SF4.2, 1x at SF4.3 or inside BN4) wraps only the `singularity` table. The gang, go, bladeburner, sleeve, stanek, grafting, corporation, stock and hacknet tables use plain constants. — [RCG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts)

**Per-namespace costs**, computed by summing each RCG table (that sum is the cost if one script statically references every function in the namespace):

| Namespace | # fns | Sum of all fns | Notable per-fn costs |
|---|---|---|---|
| `ns.corporation` | 58 (+ free ones) | 38 action fns × 20 GB + 20 info fns × 10 GB ≈ **960 GB** | `createCorporation` 20, `getCorporation` 10, `hasCorporation`/`canCreateCorporation` 0 |
| `ns.bladeburner` | 41 | **123 GB** | most fns 4 GB; `inBladeburner` 0; `getNextBlackOp`/`getBlackOpRank` 2 |
| `ns.go` (incl. `analysis`, `cheat`) | 25 | **102 GB** | `makeMove` 4, `getBoardState` 4, `analysis.getValidMoves` 8, `getChains`/`getLiberties`/`getControlledEmptyNodes` 16 each, cheat fns 8 |
| `ns.sleeve` | 22 | **88 GB** | every fn 4 GB (incl. new `purchaseSleeve`, `upgradeMemory`, `getSleeveCost`, `getMemoryUpgradeCost`) |
| `ns.stock` | 29 | **50.7 GB** | getters 2 GB; buy/sell/orders/`getForecast`/`getVolatility`/4S purchase 2.5 GB; `has*` 0.05 |
| `ns.gang` | 26 | **40 GB** | `purchaseEquipment`, `ascendMember`, `getChanceToWinClash` 4; `setMemberTask`, `getMemberInformation` 2; `createGang` 1 |
| `ns.grafting` | 5 | **20 GB** | `graftAugmentation` 7.5, `getGraftableAugmentations` 5, price/time 3.75 |
| `ns.stanek` | 11 | **15.85 GB** | `chargeFragment` 0.4 (charge power scales with **threads**), `placeFragment` 5, `activeFragments` 5, `acceptGift` 2 |
| `ns.hacknet` | 21 | **10.5 GB** | every fn 0.5 GB (v3 dropped the namespace-level cost: "Remove RAM cost of hacknet namespace and set RAM cost of each hacknet API (#2502)") |
| `ns.infiltration` | 2 | 15 GB | `getInfiltration` 15, `getPossibleLocations` 0 (read-only API) |
| `ns.dnet` (darknet, new in v3) | 25 | — | `setStasisLink` 12, `authenticate` 0.4, `heartbleed` 0.6, `phishingAttack` 2, `promoteStock` 2 |

Sources: [RCG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts), [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md)

**Access gates (source code)**
- **Gang:** `canAccessGang()` returns success in BN2; elsewhere it fails "You do not have Source-File 2" unless `activeSourceFileLvl(2) > 0`, and it also needs `karma <= GangKarmaRequirement`, which is −54000. Every API call except `inGang` and `createGang` requires an existing gang ("Must have joined gang"). — [PlayerObjectGangMethods.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/PersonObjects/Player/PlayerObjectGangMethods.ts), [Gang/data/Constants.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Gang/data/Constants.ts), [NetscriptFunctions/Gang.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/NetscriptFunctions/Gang.ts)
- **Bladeburner:** `apiAccess = canAccessBitNodeFeature(7) || canAccessBitNodeFeature(6)`, and the player must be "a member of the Bladeburner division". `canAccessBitNodeFeature(n)` is true when `bitNodeN === n || activeSourceFileLvl(n) > 0`. So in v3 either SF6 or SF7 unlocks the API. — [NetscriptFunctions/Bladeburner.ts L35-41](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/NetscriptFunctions/Bladeburner.ts), [BitNodeUtils.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNodeUtils.ts). The NSD says the same: "be in BitNode 6/7 or have Source-File 6/7". **Version note:** AB's autopilot still says "SF7 (bladeburner API) or being in BN6" (autopilot.js L390), which reflects the older rule. — [AB autopilot.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/autopilot.js)
- **Corporation:**
  - `canCreateCorporation` fails with `NoSf3OrDisabled` without SF3. Outside BN3 you must self-fund (seed money is BN3-only), and creation is blocked when the BitNode's `CorporationSoftcap < 0.15`. Creation costs `150e9`, or `50e9` on a restart that was not seed-funded. — [Corporation/helpers.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Corporation/helpers.ts)
  - The Warehouse API and Office API are unlocks costing `50e9` each. They are granted free when `bitNodeN === 3 || activeSourceFileLvl(3) === 3`. — [CorporationUnlocks.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Corporation/data/CorporationUnlocks.ts), [PlayerObjectCorporationMethods.ts L21-23](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/PersonObjects/Player/PlayerObjectCorporationMethods.ts)
  - BN8's `CorporationSoftcap` is `0` and BN13's is `0.4`, so corp is impossible in BN8. — [BNT](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNode.tsx)
- **Sleeves:**
  - The API needs `canAccessBitNodeFeature(10)`.
  - `purchaseSleeve` and `upgradeMemory` call `checkBitNodeRequirement`: "You must be in BitNode 10 to use this API." These were added in v3 ("Add sleeve commands to purchase sleeves and memory via the API (#2443)").
  - Each SF10 level grants one sleeve, and up to 5 more can be bought from The Covenant, only in BN10.

  Sources: [NetscriptFunctions/Sleeve.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/NetscriptFunctions/Sleeve.ts), [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md), [SG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md)
- **Grafting:** `canAccessGrafting()` is `canAccessBitNodeFeature(10)`, and `graftAugmentation` throws "You must be in New Tokyo to begin grafting an Augmentation." — [PlayerObjectGeneralMethods.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/PersonObjects/Player/PlayerObjectGeneralMethods.ts), [NetscriptFunctions/Grafting.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/NetscriptFunctions/Grafting.ts)
- **Stanek:**
  - Every function except `acceptGift` requires the augmentation "Stanek's Gift - Genesis" to be installed.
  - `acceptGift` joins Church of the Machine God, which needs `canAccessCotMG()` = `canAccessBitNodeFeature(13)`, and it must be called before buying any augmentation other than NFG.
  - With SF7.3, the Gift must also be accepted before joining Bladeburner.

  Sources: [NetscriptFunctions/Stanek.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/NetscriptFunctions/Stanek.ts), [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- **Hacknet servers:** `hasHacknetServers()` is `canAccessBitNodeFeature(9) && !disableHacknetServer`. Without SF9 you get plain hacknet nodes, which produce money rather than hashes. — [HacknetHelpers.tsx](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Hacknet/HacknetHelpers.tsx)
- **IPvGO:** the API is available everywhere from the start. `ns.go.cheat` "Requires Source-File 14.2". — [NSD L5480](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/ScriptEditor/NetscriptDefinitions.d.ts); "IPvGO is _not_ locked behind this BitNode. It's available at the start of the game." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- **Stock:** SF8 grants "Level 1: Permanent access to WSE and TIX API; Level 2: Ability to short stocks in other BitNodes; Level 3: limit/stop orders". In BN8 you start with $250m, a WSE membership and TIX API access. Elsewhere you buy them with `purchaseWseAccount`, `purchaseTixApi` and `purchase4SMarketData[TixApi]` (2.5 GB each). — [BNT](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNode.tsx), [RCG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts)
- **Infiltration:** `ns.infiltration` exposes only `getPossibleLocations` and `getInfiltration` (difficulty and rewards). Nothing starts or plays an infiltration. — [NetscriptFunctions/Infiltration.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/NetscriptFunctions/Infiltration.ts), [RCG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts)
- **New in v3, not in the brief:** BN15 "The Secrets of the Dark Net" and the `ns.dnet` darknet API, unlocked anywhere by buying DarkscapeNavigator.exe. In BN15, "the Daedalus faction has not yet found and monopolized the fabled Red Pill"; it must be found in the darknet. SF15.1 "allows the use of the dark net to get The Red Pill from the final lab in all BitNodes (except for BN8)". The changelog also says "Move and rename purchased server functions to cloud API (#2367)". — [BNT](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNode.tsx), [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md), [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md)

### Inferences
- With SF4.1, only Singularity calls are expensive for us. A gang, sleeve or Bladeburner controller costs tens of GB and fits easily once home has 1–2 TB.
- A corp controller must split calls into many small temp scripts, as AB does with `getNsDataThroughFile`, or keep about 1 TB free for one monolithic script.
- Stanek's charge power scales with threads, so Stanek competes directly with the batcher for home RAM. AB's autopilot reserves all home RAM for `stanek.js` while it charges.
- The gang gate outside BN2 is karma (−54k), which takes a long crime grind via `ns.singularity.commitCrime`. Each such call costs 16x RAM at SF4.1, but the loop is small.

### Gaps
- I did not find the exact v3 cost formula for Covenant sleeve and memory purchases; the source file path I guessed returned 404. CG says "The last Sleeve costs 100e15 (100q)".
- I did not read the full `ns.go` and `ns.dnet` parameter semantics.

## Q2. Is each API complete enough for zero-human-input automation? Which steps need UI clicks?

### Takeaway
In v3.0.x the following are fully scriptable end to end, including the BitNode-ending step: **gang, Bladeburner, sleeves (including purchase in BN10), grafting, Stanek, IPvGO, stocks, hacknet servers/hashes and corporation**. Bladeburner's win condition is the final BlackOp; afterwards `ns.singularity.destroyW0r1dD43m0n` works. **Infiltration has no action API**, so automating it means DOM/keyboard injection, which the leading script author refuses to support. Casino save-scumming (AB `casino.js`) is also UI automation.

### Cited Findings
- **Gang:** the API covers every gang action: `createGang`, `recruitMember`, `setMemberTask`, `purchaseEquipment`, `ascendMember`, `getAscensionResult`, `setTerritoryWarfare`, `getChanceToWinClash`, `getAllGangInformation` and `nextUpdate`. In BN2, the gang faction "offers The Red Pill". — [RCG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts), [BNT](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNode.tsx)
  - v3 renamed `ns.gang.getOtherGangInformation` to `getAllGangInformation` (#2635). Scripts written for v2 break on this. — [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md)
  - The main pitfall is strategic, not missing API: "Enabling territory clashes when your gang is still too weak is a serious mistake. You may lose all territory." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- **Bladeburner:**
  - The API covers start/stop action, success chances, skills, team size, city switching, stamina, `joinBladeburnerDivision`/`Faction`, `getNextBlackOp` and `getBlackOpRank`. — [RCG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts)
  - There are 21 BlackOps, and the last, Operation Daedalus, has `reqdRank: 400e3`. — [Bladeburner/data/BlackOperations.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Bladeburner/data/BlackOperations.ts)
  - "You must complete all the BlackOps in order to destroy the World Daemon." — [bladeburners.md](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bladeburners.md)
  - AB autopilot detects the win with `ns.bladeburner.getActionCountRemaining('Black Operations', 'Operation Daedalus') === 0` and then calls `ns.singularity.destroyW0r1dD43m0n(nextBn, ...)`, so no UI is needed. — [AB autopilot.js L393-L463](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/autopilot.js)
  - v3 fix: "Prevent ending BNs through reuse of Bladeburner UI event handler (#2574)". — [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md)
- **Sleeves:**
  - The full task API covers shock recovery, synchronize, crime, university, gym, company, faction, Bladeburner, travel and sleeve augmentations.
  - New in v3: `purchaseSleeve()` and `upgradeMemory()`, BN10 only. AB autopilot still carries an old TODO, "Buying / upgrading sleeve mem has no API, requires manual interaction", which **v3 has resolved**.

  Sources: [NSD](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/ScriptEditor/NetscriptDefinitions.d.ts), [AB autopilot.js L53](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/autopilot.js), [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md)
- **Grafting:** the API has `getGraftableAugmentations`, `getAugmentationGraftPrice/Time`, `graftAugmentation` and `waitForOngoingGrafting`. You must be in New Tokyo (`singularity.travelToCity`). — [RCG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts), [Grafting.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/NetscriptFunctions/Grafting.ts)
- **Stanek:** `acceptGift`, `placeFragment`, `canPlaceFragment`, `chargeFragment`, `activeFragments` and `clearGift` are all available. v3 added "API: Expose charged effects of Stanek's Gift active fragments (#2638)". — [RCG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts), [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md)
- **IPvGO:** `makeMove`, `passTurn`, `opponentNextTurn`, `resetBoardState` and the analysis helpers are enough to play games in a loop. The official tutorial script plays random valid moves in a loop. — [go_algorithms.md](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/programming/go_algorithms.md)
- **Stocks:**
  - The full API covers buy/sell, short (SF8.2 or BN8), orders (SF8.3 or BN8), forecast and volatility (4S) and buying 4S/TIX. v3 renamed the stock APIs: "Standardize names of Stock APIs (#2173)", "Rename 'TIX' interface to 'Stock' (#2351)". — [RCG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts), [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md)
  - In BN8, "Hacking does not give you money, but hacking and growing a server that has a corresponding stock still influence that stock's price." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- **Hacknet servers:** the API covers purchase/upgrade (level, RAM, cores, cache), `spendHashes`, `hashCost` and `getHashUpgrades`. v3: "Enforce stricter param check on ... ns.hacknet.spendHashes (#2085)". — [RCG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Netscript/RamCostGenerator.ts), [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md)
- **Corporation:** office, warehouse, product, research, investment, `goPublic`, dividends, shares and `bribe` are all in the API. The official docs call corp "extremely complex and opaque", with 19 sub-chapters including a Lagrange-multiplier optimizer for boost materials, a Market-TA2 pricing derivation and an optional "Ceres Solver". — [corporations.md](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/corporations.md)
- **Infiltration:**
  - The minigames are keyboard-only ("None of the challenges uses the mouse"). — [infiltration.md](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/basic/infiltration.md)
  - AB declined automating it (issue #238, wontfix, Apr 2023). He said infiltration "wasn't designed/balanced to be automated", that "There's no cap (yet) on automated infiltration earnings", and that UI automation "has been perilous and fragile in the past". — [AB issue #238](https://github.com/alainbryden/bitburner-scripts/issues/238)
  - A Steam thread reportedly says one auto-infiltrator works by hooking Bitburner's React UI and that commenters call it an exploit. This comes from a search-engine summary only; I could not fetch the thread. — [Steam discussion](https://steamcommunity.com/app/1812820/discussions/0/3783625016031272612)
  - v3 "Rebalance rewards, add min stat requirement, add market demand (#2210)". — [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md)
- **Darknet (BN15):** solving auth puzzles with `dnet.authenticate`/`heartbleed`, sessions, offline servers and stasis links is all done through the API. CG says "You _can_ complete BN15 with a simple script that only solves a few of the basic server puzzle types". — [darknet.md](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/programming/darknet.md), [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)

### Inferences
- No mechanic needed for a BitNode win requires UI clicks in v3. Infiltration and the casino are optional accelerators. Given the owner's rule "never change game options / be safe" and the fragility of DOM hooks, both should be skipped.
- The project already uses page-context JS (bridge-lite), so DOM automation is technically possible. It is still high-risk and low-necessity.

### Gaps
- I could not open the infiltration UI source (`src/Infiltration/ui/*.tsx` paths returned 404), so I cannot confirm whether v3 rejects synthetic (`isTrusted=false`) key events.

## Q3. Known community/open-source automation: size, v3 maintenance, and whether it finishes the node unattended

### Takeaway
alainbryden/bitburner-scripts ("Insight's scripts") is the reference suite. It has v3 updates (its daemon references `ns.cloud`) and modules for **gang, Bladeburner, sleeves, stocks (pre-4S and 4S), Stanek, IPvGO (with cheats), hacknet/hashes and casino**. It has **no corporation and no infiltration script**. Its autopilot can end a node through either the w0r1d_d43m0n hack or the Bladeburner BlackOps condition. No widely-used open-source corp autopilot surfaced. cyguin/bitburner-scripts is a v3 fork with in-progress BN15 darknet work.

### Cited Findings
**alainbryden/bitburner-scripts (main), raw file line counts on 2026-10-11:**

| File | Lines | Purpose / notes |
|---|---|---|
| `autopilot.js` | 1160 | Orchestrator, with a default BN order list. Detects the BB win and calls `destroyW0r1dD43m0n`. |
| `daemon.js` | 2364 | Batcher. Launches `go.js` (needs 64 GB home RAM), `stockmaster.js`, `hacknet-upgrade-manager.js`, `spend-hacknet-hashes.js` (SF9). Comment: "beats wasting 1.05 GB on ns.cloud.getServerNames()", which is v3 API evidence. |
| `gangs.js` | 604 | Full gang manager: territory tick timing, a "territoryEngageThreshold = 0.60" win-chance before engaging, equipment/aug budgets, ascension. |
| `bladeburner.js` | 457 | Contracts/ops/BlackOps in rank order, skills, stamina, city chaos. |
| `sleeve.js` | 446 | Shock recovery, crime for karma ("sleeves will do homicide to farm Karma until we're in a gang"), Bladeburner support, sleeve augs. Does **not** use v3's `purchaseSleeve`/`upgradeMemory`. |
| `stockmaster.js` | 643 | Pre-4S forecast heuristics plus a 4S strategy; shorts when SF8.2. |
| `stanek.js` | 201 | Charging loop with `max-charges` 120. |
| `stanek.js.create.js` | 276 | Picks a saved best-fit fragment layout for the grid size. |
| `go.js` | 1570 | IPvGO player, with cheats on by default if SF14.2. |
| `casino.js` | 604 | Blackjack save-scum via UI automation. |
| `hacknet-upgrade-manager.js` | 149 | |
| `spend-hacknet-hashes.js` | 235 | |
| `work-for-factions.js` | 1302 | |
| `faction-manager.js` | 1009 | |
| `ascend.js` | 208 | |
| `crime.js` | 37 | |
| `helpers.js` | 961 | Shared helpers. |

`corporation.js` and `infiltrate.js` return 404. Sources: [AB autopilot.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/autopilot.js), [daemon.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/daemon.js), [gangs.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/gangs.js), [bladeburner.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/bladeburner.js), [sleeve.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/sleeve.js), [stockmaster.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/stockmaster.js), [stanek.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/stanek.js), [go.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/go.js), [casino.js](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/casino.js)

**alainbryden autopilot notes:**
- The autopilot comment on corp reads: "3.3, // Hard. Corporations. I have no corp scripts, maybe one day I will... Autopilot will win normally while ignoring corps." — [AB autopilot.js L78](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/autopilot.js)
- AB's default BN order: 4.3, 1.2, 5.1, 1.3, 2.1, 10.1, 8.2, 13.1, 7.1, 9.1, 14.2, then 2.3, 5.3, 11.3, 14.3, 13.3, 9.2, 9.3, 10.3, 6.3, 7.3, 8.3, 3.3, and 12 "forever". Its comments rate 10/8/13/7/9/14 "Hard". — [AB autopilot.js L46-L81](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/autopilot.js)
- AB says SF4 "is not required, but is highly-recommended to get the full benefit of this script". — [AB README](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/README.md)

**Other repos and claims:**
- **cyguin/bitburner-scripts:**
  - Described as mostly unmodified upstream AB code with a rewritten `autopilot.js` and new BN15 files. It references "Modern 3.x".
  - Its README says: "Daemon gates bladeburner, hacknet, and corp internally"; "BN15 is not complete"; "Do not expect a clean hands-off BN15 run yet"; darknet solvers take "5-10 seconds per server"; in BN13 "bladeburner is slow (0.45x rank)", "Corporation is dead (0.001x valuation)" and "gang is weak (0.3x softcap)".

  These come from a WebFetch summary of the README. — [cyguin/bitburner-scripts](https://github.com/cyguin/bitburner-scripts)
- **Combat gang script (kosgames):** a search snippet says the author claims it "takes less than a day to win the BN2 node". The author's claim is unverified and the page could not be fetched. — [kosgames](https://kosgames.com/bitburner-combat-gang-management-script-fully-automatic-14545/)
- **No v3 corp repo:** searches for a maintained v3 corp automation repo found none. The official CG says "Writing that 'good script' may take days or weeks". — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md); search results: [willurd index](https://github.com/willurd/bitburner-scripts), [FakeMatty](https://github.com/FakeMatty/BitBurner)

### Inferences
- **Port vs reference.** AB's modules can't be dropped in as-is: they rely on `helpers.js`, the temp-script RAM-dodging pattern and AB's daemon/autopilot conventions, which overlap with our own daemon/autopilot. Porting means using them as design references or adapting each module, roughly 450–650 lines per mechanic, against our settings/logging conventions.
- **Unattended-finish evidence.** For Bladeburner (BB win plus destroy) and gang (BN2 Red Pill via the gang faction) the AB stack is designed to finish unattended. The stock market supplies money in BN8, but an "unattended BN8 finish" is not documented anywhere I could reach.

### Gaps
- No commit dates. The GitHub API is blocked, so I can't show when each AB file was last touched. The v3 signal is indirect (`ns.cloud` reference).
- I could not verify whether AB `gangs.js` already uses `getAllGangInformation` rather than `getOtherGangInformation`. Worth grepping before reuse.

## Q4. Rough effort (S <1 day, M 1–3 days, L >3 days) and risk (API churn)

### Takeaway
- **Small:** hacknet servers/hashes and IPvGO (basic).
- **Medium:** gang, sleeves, grafting, Stanek, Bladeburner, stocks with 4S, BN15 darknet basics.
- **Large:** pre-4S BN8 stock trading tuned to finish BN8, and Corporation (days to weeks per the official guide).
- **Highest API-churn risk:** corporation (many functions, opaque math) and darknet (brand-new in v3.0.0 with balance patches in v3.0.1).

### Cited Findings
- **Corporation:** "Writing that 'good script' may take days or weeks, assuming that you read the documentation carefully and have good advice from other experienced players... If you try to do it blindly, Corporation is the worst mechanic." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
  - "BN3 has a very tough mechanic to automate but gives unparalleled power." — [SG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md)
  - v3 changes include "Specify param type of many Corporation APIs (#2190)". — [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md)
- **IPvGO:** "Automating the mechanic is challenging, but it provides a wide variety of bonuses." — [SG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md); "IPvGO is tuned so that it still gives adequate benefits even if your script is only a slightly improved version of the tutorial script." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- **BN8:** "The hardest part is to write a good (or at least usable) pre-4S stock market script. Even with good scripts, it still takes a long time to complete this BitNode." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- **Gang:** "Gang is a simple and useful mechanic." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- **Bladeburner:** "Relatively simple, slow"; "You must be careful with chaos and Synthoid population." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- **BN15:** "the complexity of dealing with the deep dark net and the number of different puzzles to solve make BN15 not a simple BitNode to approach". — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
  - v3.0.1 still had darknet fixes: "Prevent generating malformed darknet server hostname (#2744)", "Temporarily remove darknet servers with unusual hostnames (#2757)", "Lower darknet BN money mults on hard nodes (#2743)". — [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md)
- **v3.0.0 API breaks that touch these mechanics:**
  - stock API names standardized (#2173);
  - `getOtherGangInformation` renamed (#2635);
  - `bladeburner.getActionRepGain` semantics changed (#2186);
  - `sleeve.travel` now cancels the current task (#2559);
  - hacknet RAM costs changed (#2502);
  - purchased-server functions moved to `ns.cloud` (#2367);
  - Bladeburner action difficulty no longer randomized (#2491).

  — [changelog](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/changelog.md)

### Inferences
Effort and risk estimates. These are my judgment, built from the facts above plus our existing settings/telemetry/autopilot framework:

| Mechanic | Build or port effort | Risk | Rationale |
|---|---|---|---|
| Hacknet servers + hash spending (BN9/SF9) | **S** (½–1 day) | Low | Small API (10.5 GB total). Reference code is 149 + 235 lines. Main work is a hash-spend policy (money vs. "Increase Maximum Money"/"Reduce Minimum Security" vs. corp/BB). |
| IPvGO basic player | **S–M** (1 day basic, 2–3 days to approach AB `go.js` at 1570 lines) | Low–Med | The tutorial-level script already yields "adequate benefits". RAM is the constraint (analysis fns are 16 GB each). |
| Gang | **M** (1–2 days) | Low | API is 40 GB total. Main logic: wanted-penalty control, ascension thresholds, equipment ROI, territory-clash timing (reference `gangs.js`, 604 lines). Outside BN2 it also needs a karma-farming crime loop, Singularity-priced at SF4.1. |
| Sleeves | **M** (1–2 days; +½ day for BN10 purchase/memory) | Low | 88 GB if monolithic. Policy: shock to 0, then sync, then karma crime / faction work / BB support (reference `sleeve.js`, 446 lines). |
| Grafting | **S–M** (≤1 day) | Low | 5 functions. Needs a choice of augs to graft and handling of the Entropy debuff. |
| Stanek | **M** (1–2 days) | Med | Layout packing (reference 276 lines) plus a charge loop (201 lines) that must coordinate home RAM with the batcher. Must accept the Gift before any aug purchase, which interacts with our aug planner. |
| Bladeburner | **M–L** (2–4 days) | Med | 123 GB API. Needs chaos/population management, stamina, skill-point allocation, a BlackOps sequence to rank 400k, sleeve support, and a win-detection hook into `sl-destroy.js` / node-control. |
| Stocks with 4S (outside BN8) | **S–M** (1 day) | Low | 4S forecasts make the logic straightforward. |
| Stocks pre-4S for BN8 | **L** (3+ days incl. tuning) | Med–High | The official guide calls it "the hardest part". Needs forecast estimation and hack/grow price manipulation, which our daemon would have to support specifically. Losing capital on install argues for SF10 grafting first. |
| BN15 darknet | **M–L** (2–5 days for basic puzzles + propagation; more for the deep lab / Red Pill) | **High** | New in v3.0.0 with balance/hostname patches in 3.0.1. cyguin's port is "not complete". |
| Corporation | **L** (days to weeks) | **High** | ~960 GB monolithic API, opaque multi-chapter math, round-based investor strategy. No maintained open-source v3 reference found. |
| Infiltration | n/a (DOM hacking) | **High** | No action API. Not recommended. |

### Gaps
- No primary source gives person-day estimates. The table is inference.
- I could not compare our codebase size against AB modules beyond the line counts above.

## Q5. Typical wall-clock time to finish each node with good automation

### Takeaway
Hard numbers are scarce in sources reachable from here. The best available are anecdotal: under a day to two days for BN2 with a gang script, from a search snippet only. Qualitative official guidance: Bladeburner is "slow" and "time-gated by the slow generation speed of contracts/operations"; BN8 "still takes a long time" even with good scripts; BN9 and BN13 are "extremely harsh"; BN11 is "very difficult for not much in return"; BN12 is easy at low levels and ramps without limit. BitNode multipliers explain which nodes hacking-only automation will struggle in.

### Cited Findings
**Community timings:**
- BN2 with an automated gang: search snippets say "less than a day" (kosgames author claim) and "less than 2 days each time" (Steam user with self-written scripts). Both are unverified because the pages could not be fetched. — [kosgames](https://kosgames.com/bitburner-combat-gang-management-script-fully-automatic-14545/), [Steam thread](https://steamcommunity.com/app/1812820/discussions/0/3975051032846139530)
- cyguin README on BN13: "Expect a slow run - the crippled multipliers make even a maxed-SF pass a genuine grind." — [cyguin/bitburner-scripts](https://github.com/cyguin/bitburner-scripts)

**Official guidance:**
- Bladeburner "is time-gated by the slow generation speed of contracts/operations. Sleeves speed it up a lot." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- BN9 "disables private servers and significantly raises the RAM cost of your home computer. It also heavily nerfs hacking-related multipliers"; "Inside this BitNode, you get the effect of Source-File 9.3 even before getting that Source-File". — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- BN10: "The last Sleeve costs 100e15 (100q). You will need a batcher or a corporation." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)

**BitNode multipliers relevant to "can hacking-only finish it"** (v3 dev, from [BNT](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNode.tsx)):

| BN | Key multipliers |
|---|---|
| 2 | ServerMaxMoney 0.08, WorldDaemonDifficulty 5 |
| 3 | ServerMaxMoney 0.04, ScriptHackMoney 0.2, AugmentationMoneyCost 3, AugmentationRepCost 3, WDDifficulty 2 |
| 6 | ScriptHackMoney 0.75, ServerMaxMoney 0.2, DaedalusAugsRequirement 35, WD 2 |
| 7 | ScriptHackMoney 0.5, ServerMaxMoney 0.2, AugMoneyCost 3, BladeburnerRank 0.6, Daedalus 35, WD 2 |
| 8 | **ScriptHackMoneyGain 0**, ManualHackMoney 0, CompanyWorkMoney 0, HacknetNodeMoney 0, CorporationSoftcap 0, GangSoftcap 0, BladeburnerRank 0 |
| 9 | ServerMaxMoney 0.01, ScriptHackMoney 0.1, 4S cost 5, WD 2 |
| 10 | ScriptHackMoney 0.5, AugMoneyCost 5, AugRepCost 2, WD 2 |
| 11 | ServerMaxMoney 0.01, AugMoneyCost 2, InfiltrationRep 2.5, WD 1.5 |
| 12 | All income/stat multipliers × `1/1.02^lvl`, costs and WD × `1.02^lvl`, Daedalus requirement rising to ≤40 |
| 13 | ScriptHackMoney 0.2, ServerMaxMoney 0.3375, StanekPower 2, CorporationValuation 0.001, GangSoftcap 0.3, BladeburnerRank 0.45, WD 3 |
| 14 | ScriptHackMoney 0.3, ServerMaxMoney 0.7, GoPower 4, **WD 5** |
| 15 | HackingLevelMultiplier 0.6, HackingSpeed 0.6, AugMoneyCost 3, DaedalusAugsRequirement 20, BladeburnerRank 0.2, StaneksGiftExtraSize −2, WD 2; Red Pill not in Daedalus |

### Inferences
**Feasibility of the hacking-only stack, by node** (inference from the multipliers and official text):
- **Should finish with hacking only, just slower:** BN2 (WD 5 means a high hack requirement), BN3, BN6, BN7, BN10, BN11 (ServerMaxMoney 0.01 is very painful), BN12 (low levels), BN14 (WD 5).
- **Effectively blocked:** BN8. Hack money is 0, so stocks are mandatory.
- **Likely blocked or very slow without new work:**
  - BN9: cloud servers are disabled, so our RAM manager's cloud buying fails. Hacknet servers must provide RAM and money.
  - BN13: Stanek's Gift is needed to offset the harsh multipliers; Bladeburner is the standard alternative.
  - BN15: the Red Pill comes only via the darknet unless an alternate win is used. Bladeburner is an alternate win (BladeburnerRank 0.2 there, so slow).
- **Wall-clock ranking guess** (fast to slow) with good automation and our current SFs: BN2 ≈ BN6 < BN7 ≈ BN10 ≈ BN3 (hacking/gang path) ≈ BN14 < BN11 < BN15 < BN9 ≈ BN13 < BN8. Every timing in this guess is an inference. I found no reliable published hours for v3.

### Gaps
- No reliable v3 hours or days for any BitNode. Reddit mirrors and Steam were unreachable. The owner's own predictor data from BN1/BN4/BN5 runs would be a better calibration source than community anecdotes.
- Whether "hacking WD just sends you to the BitVerse - no Red Pill involved" in "Modern 3.x" (a cyguin README claim) is true was not verified. It conflicts with the official docs, which still describe The Red Pill requirement.

## Q6. Once automated, does each mechanic speed up other nodes?

### Takeaway
Ranked by cross-node leverage:
- **Sleeves** are the strongest (they speed up gang karma, Bladeburner, faction/company rep and stat training everywhere, and SF10 adds a sleeve per level).
- **Gang** is next (a near-universal aug source and income in most nodes once karma is farmed, with no reset on install). Its value collapses where GangSoftcap is low (BN8 0, BN13 0.3).
- **Bladeburner** is an alternate win path that is rarely nerfed hard, and the standard route for BN9/BN13 (and BN15).
- **IPvGO** gives always-on stat multipliers and favor in every node from BN1.
- **Corporation** is "unparalleled" money and rep but is disabled or nerfed in many nodes and needs $150b outside BN3.
- **Hacknet servers** (SF9) give hash boosts to hacking/corp/BB, and SF9.2 starts home at 128 GB.
- **Stanek** gives versatile buffs, but it is RAM-hungry and must be accepted before any aug purchase.
- **Grafting** gives aug installs without resets, which is key for BN8.
- **Stocks** add modest supplementary income outside BN8.
- **Infiltration** brings no automatable benefit.

### Cited Findings
- **Gang:** "Its benefits do not reset when you install augmentations or soft reset... Give you access to most augmentations... Farming reputation with factions to get access to their augmentations is the most time-consuming thing of a run. With Gang, you have access to most augmentations, so you only need to join 1 more faction to get NFG." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- **Sleeves:**
  - "Farming karma is very slow, and Sleeves (BitNode 10) speed it up tremendously... their action also reduces your karma as if you do it yourself." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
  - "Sleeves synergize well with many mechanics, especially Gang and Bladeburner. Grafting is useful in all BitNodes." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
  - Sleeves "can perform tasks like studying, training, committing crime and working for factions independently of the player". — [SG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md)
- **Bladeburner:** "Bladeburner is an alternative method to beat BitNodes which doesn't rely on money or hacking skill." — [SG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md); "it's rarely nerfed in other BitNodes... a good choice in extremely hard BitNodes (e.g., BitNode 9, BitNode 13)". — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
  - AB's opposing view: Bladeburner is "Mostly not used to beat other BNs, because for much of the BN this can't be done concurrently with player actions like crime/faction work". — [AB autopilot.js L75](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/autopilot.js)
  - SF7.3 gives "The Blade's Simulacrum", which allows BB plus other actions concurrently. — [BNT](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNode.tsx)
- **Corporation:** "If you have a good corporation script, you can ignore all other mechanics and speedrun most BitNodes." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
  - It is disabled where CorporationSoftcap < 0.15 (BN8 = 0) and heavily nerfed in BN13 (valuation 0.001). Outside BN3 it needs $150b to self-fund. — [Corporation/helpers.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Corporation/helpers.ts), [BNT](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNode.tsx)
  - SF3.3 is needed for the free full API; otherwise each API unlock costs $50b. — [CorporationUnlocks.ts](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Corporation/data/CorporationUnlocks.ts)
- **IPvGO:** gives stat multipliers from "Node Power" plus faction favor. SF14.1 doubles those multipliers, SF14.2 unlocks cheats, and winstreak favor caps rise with SF14. The guide notes winstreaks can "cut down the time to reach 150 favor points with IPvGO factions". — [BNT](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNode.tsx), [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- **Hacknet servers:**
  - "HackNet Servers generate `hash`. You can sell `hash` for money or a variety of upgrades that boost other mechanics"; SF9.2 gives a 128 GB starting home; SF9.3 gives an upgraded hacknet server on entering a new BitNode (not after installs). — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
  - AB aliases show hash sinks for Bladeburner rank/SP, corp funds/research, and server max-money/min-security. — [AB README](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/README.md)
- **Stanek:**
  - "Stanek's Gift decreases many multipliers by 10%... You must accept Stanek's Gift before purchasing any augmentations." — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
  - Its "bonuses are versatile but not enough to offset the challenge of the BitNode itself". — [SG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md)
  - AB's BN12 comment: "Only stanek scales very well here". — [AB autopilot.js L80](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/autopilot.js)
- **Grafting / BN8:** "Grafting is very useful in this BitNode. Losing capital after each reset sets you back a lot." "Completing at least BN10.1 is highly recommended" before BN8. — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md), [SG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_short_guide.md)
- **Stocks:** AB says "Stocks are never nerfed in any BN (4S can be made too pricey though)". — [AB autopilot.js L54](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/autopilot.js)
- **SF rewards with little automation leverage:**
  - SF11 cuts the per-aug price increase by 4/6/7% and boosts company salary/rep; the guide says "rewards are mediocre".
  - SF12 gives free NFG levels equal to its SF level, with no maximum.

  — [BNT](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/BitNode/BitNode.tsx), [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md)
- **Darknet:** `phishingAttack` gives money/caches and `promoteStock` gives stock volatility, available in all nodes after buying DarkscapeNavigator.exe. SF15.1 gives TOR + DarkscapeNavigator at start and a darknet Red Pill route everywhere except BN8. — [CG](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/advanced/bitnode_recommendation_comprehensive_guide.md), [darknet.md](https://raw.githubusercontent.com/bitburner-official/bitburner-src/dev/src/Documentation/doc/en/programming/darknet.md)

### Inferences
- **Roadmap implication for this project** (inference):
  - Cheap, broad wins first. IPvGO (works in every node now, S effort) and hacknet hash spending (S, needed for BN9) can ship early.
  - Then gang + karma loop. BN2 is hacking-feasible and the gang module turns every later node's aug grind into a single-faction grind.
  - Then BN10 with sleeves + grafting. Sleeves multiply gang karma and Bladeburner, and grafting prepares BN8.
  - Then BN6/BN7 with Bladeburner, the alternate win path for BN9/BN13/BN15.
  - Then Stanek (BN13), BN15 darknet, pre-4S stocks for BN8, and corp last or never. AB, the most mature community autopilot, wins without corp: "Autopilot will win normally while ignoring corps."
- **Diminishing returns:**
  - SF x.2/x.3 for 6, 7, 8.3, 9.3, 11, 13.3 and 14.3 add little automation leverage.
  - SF10.3 (two more sleeves) and SF4.2/4.3 (Singularity RAM 16x to 4x to 1x) have large practical value for this RAM-constrained autopilot.
  - SF1.2/1.3 and SF5.2/5.3 are broad multiplier bumps.

### Gaps
- I found no quantitative cross-node speed-up data (e.g., hours saved per node by gangs or sleeves) in reachable sources.
