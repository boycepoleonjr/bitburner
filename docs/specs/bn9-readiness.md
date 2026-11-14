# Spec: BN9 readiness — hacknet servers, hash spending and the no-cloud bootstrap (docs/specs/bn9-readiness.md)

Status: spec only, nothing implemented. Input for later build PRs; companion of `docs/specs/node-readiness.md`.
Today the bot can start BN9 (the bootstrap already notices "no cloud servers") but cannot make progress: hacking is
nearly worthless there and the one mechanic the node exists for, the Hacknet Server and its hashes, is not used by any script.

## 1. Problem
`getBitNodeMultipliers(9, …)` (bitburner-src v3.0.1, `src/BitNode/BitNode.tsx` `case 9`, read 2026-11-14):

| Multiplier | BN9 | Effect |
|---|---|---|
| `CloudServerLimit` | **0** | no purchased servers: `pserv-sing` cannot exist, no worker fleet beyond home and rooted servers |
| `HomeComputerRamCost` | **5** | every home RAM upgrade costs 5x |
| `HackingLevelMultiplier` | 0.5 | w0r1d_d43m0n (difficulty 2 = hack 6000) needs 12,000 "base" levels |
| `HackExpGain` | **0.05** | hacking xp is 5% of normal |
| `ServerMaxMoney` / `ServerStartingMoney` / `ScriptHackMoney` | 0.01 / 0.1 / 0.1 | hacking income is about 1/1000 of BN1 |
| `ServerStartingSecurity` | 2.5 | |
| `CrimeMoney` | 0.5 | |
| `FourSigmaMarketDataCost` / `ApiCost` | 5 / 4 | stock route is expensive |
| other stats x0.45, corporation, gang, Bladeburner penalties | | |
| `DarknetMoneyMultiplier` | 0.05 | |

The node description: "This BitNode unlocks the Hacknet Server, which is an upgraded version of the Hacknet Node. Hacknet Servers
generate hashes, which can be spent on a variety of different upgrades." Source-File 9: level 1 unlocks hacknet servers in every
BitNode, level 2 starts every BitNode with 128 GB home RAM, level 3 grants a highly upgraded Hacknet Server on entering a new BitNode.
All SF9 levels also give +12/18/21% hacknet production and cost reduction. So BN9 is both the hardest bootstrap and the node whose
reward (SF9.2) removes the early-game wall of every later node.

## 2. Facts for the design (v3.0.1 source)
| Fact | Source file | Note |
|---|---|---|
| Hacknet Server: `BaseCost` $50k, `RamBaseCost` $200k, `CoreBaseCost` $1m, `CacheBaseCost` $10m, `PurchaseMult` 3.2, at most **20 servers**, level <= 300, RAM <= 8192, cores <= 128, cache <= 15 | `src/Hacknet/data/Constants.ts` `HacknetServerConstants` | `HacknetNodeConstants` (old nodes: max level 200, RAM 64, cores 16) apply only when hacknet servers are not unlocked (not re-checked) |
| Hash upgrades: Sell for Money ($1m for 4 hashes), Sell for Corporation Funds, Reduce Minimum Security (-2% on one server), Increase Maximum Money (+2% on one server, persists until a new BitNode), improve studying/gym 20%, Corporation research, Bladeburner rank/skill points, Generate Coding Contract, Company Favor | `src/Hacknet/data/HashUpgradesMetadata.tsx` | per-level cost growth is per upgrade (`costPerLevel`); whether Sell for Money's cost grows is **not verified** (spike) |
| Hacknet servers also have RAM: scripts can run on `hacknet-server-*` | `game/lib/network.js` (`isHacknet`), `game/lib/config.js` `useHacknetRam: false` | the bot currently ignores that RAM |
| `HacknetNodeMoney` is not changed in BN9 | `case 9` | so the node's own money is unmodified (in BN8, 0) |

## 3. What exists
- `game/lib/hooks.js` `hacknetHook` (cheapest-first purchases of nodes and upgrades with a payoff gate `maxPayoffHours`), for the
  old Hacknet Node, capped at `cfg.hooks.hacknet.maxNodes` 30 with `maxItemFraction 0.01` and `maxLoopFraction 0.02` of money. It
  never calls anything on hashes: `grep spendHashes game/` finds nothing.
- `game/agent/daemon-lite.js`: knows the BN9 case in one place, `singHost()` runs the `sl-*` Singularity scripts on `home` when
  `srv.limit === 0` (line 148), and the purchase ladder skips `pserv-sing` when `LIMIT === 0` (line 212). Nothing else adapts:
  workers use rooted servers and home only.
- `game/lib/cloud.js` reads `ns.cloud.getServerLimit()` and plans nothing at limit 0 (the loop `while (fleet.length < limit …)`).

## 4. Design

### 4.1 Hacknet/hash module: `lib/hashplan.js` (pure) + `agent/hacknet-hash.js` (applies)
A single-instance tool on home (started by the autopilot/daemon like the gang module), pure planner under test.

**Purchases (spend money to make hashes).** Replace the node-by-node ROI of `hacknetHook` with a hash-server-aware ROI, only when
`ns.hacknet.hashCapacity() > 0` (hacknet servers exist) and the node count/RAM is below the limits above:
```
gainPerSec(upgrade) = Δ(production) measured as getNodeStats(i).production after the upgrade formula, or computed from the
                      same formulas ns.formulas.hacknetServers provides (Formulas.exe not needed if production is read live)
valuePerHash        = moneyPerHash (see below)
payback(upgrade)    = cost / (gainPerSec * valuePerHash)
```
Buy the best `1/payback` first while `payback <= hacknet.maxPaybackHours` (default 6 in BN9, 2 elsewhere) and the spend is within
`hacknet.maxSpendFraction` of money per loop. Cache upgrades are bought when hashes are wasted at the capacity (`hashes >= 0.9 * capacity`),
because hashes above the capacity are lost. With the 20-server cap, the module ends in "all servers at level/ram/core targets" and the
hashes go to hash upgrades only.

**Spending hashes (`ns.hacknet.spendHashes(name, target?)`).** Priority list evaluated each loop, only above `hacknet.hashReserve`:
1. If money is the binding constraint of the aug plan (any step `needMoney` in `data/aug-plan.txt`, or install ETA gated by money):
   `Sell for Money` in batches so no hashes sit at the cap.
2. If a hack target exists whose income matters (not in BN9 at default multipliers; useful elsewhere): `Increase Maximum Money` on the
   best target, `Reduce Minimum Security` on the weakest, while `valuePerHash` of the upgrade beats `Sell for Money`.
3. `Generate Coding Contract` is skipped (contracts pay 0.25 in some nodes and the bot has no solver).
4. Study/gym boosts only while the character trains (sleeves/gang bootstrap), off by default.
`moneyPerHash = 1e6 / 4 = $250k` at the measured Sell-for-Money price; the planner uses the measured price, not the constant.

**Income figure.** `incomePerMin` (hashes/s x moneyPerHash while selling) is written to `data/hash-status.txt` and used by the planner
and predictor as the BN9 money income (today `snap.income = getTotalScriptIncome()[0]`, near 0 in BN9).

**Settings (group `hacknet`, owner `hacknet`)**: `hacknet.enabled` (true), `hacknet.dryRun` (false), `hacknet.maxPaybackHours` (6),
`hacknet.maxSpendFraction` (0.25), `hacknet.hashReserve` (0), `hacknet.sellMoney` (true), `hacknet.useRam` (false: the RAM of hacknet servers
for scripts, `useHacknetRam` in `lib/config.js`). The old `cfg.hooks.hacknet` keys remain as the fallback for non-hash nodes.

### 4.2 No-cloud bootstrap
1. Singularity host: `daemon-lite.js` already runs the `sl-*` one-shots on home when the cloud limit is 0. It needs home RAM for
   them: with SF4.1 outside BN4 Singularity costs 16x RAM (AGENTS.md: about 1 TB for the autopilot), so SF4.1 + home x5 cost makes the
   bootstrap very slow. **BN9 should only be started with SF4.3 (1x Singularity RAM) or SF9.2 (128 GB home start)**; the planner's
   recommendation text and an optional guard `node.targets={"9":0}` express that until it is true. A small `canBootstrapBn9(snap)` helper
   in `lib/nodectl.js` can refuse BN9 from `pickNextBn` until SF4 >= 3 or SF9 >= 2 (decision for the owner, see PR).
2. Order of spending in the first hour: hacknet server purchase and its first upgrades first (they pay back in minutes at the
   measured production), `sl-*` one-shots (programs, TOR) next, home RAM last (x5 cost).
3. No worker fleet beyond rooted servers and home: `daemon-lite.js` caps targets by free RAM already; in BN9 the target count stays
   small because `ServerMaxMoney` is 0.01. The RAM manager (`ram.*`) moves RAM to share/xp; `HackExpGain 0.05` makes xp loops weak, so
   in BN9 the useful RAM use is **share** (faction rep) and hacknet scripts only.
4. `hacknet.useRam=true` may be right in BN9: a hacknet server with 8192 GB RAM is the largest host in the node, and its hash
   production is independent of the scripts on it (to be confirmed in the spike).

### 4.3 The real wall: hack level 6000 at x0.5 and xp x0.05
The module above solves money. w0r1d_d43m0n at difficulty 2 still needs hacking 6000 with a 0.5 level multiplier and 5% xp.
Sources of hack level here are (a) hacking augmentations (each multiplies the level), (b) the xp loops (weak), (c) Source-Files
SF1/2/3/5 (hack multipliers, already counted in the multiplier), and (d) `Increase Maximum Money` / `Reduce Minimum Security` do not help xp.
Honest estimate: without measured data the time is unknown; the spike measures xp/s of the xp loop on `joesguns` with the BN9
multiplier for one hour. If the projected time to level 6000 exceeds `docs/specs/node-readiness.md`'s acceptance bound (14 days), the
build stops after the hash module and recommends the Bladeburner route (not automated) for BN9.

## 5. Risk
Medium. Money spent on a payback gate that is wrong wastes the early money of a node with no other income; the dry-run flag and the
conservative 25% spend fraction bound it. `spendHashes` calls mutate the game (sell hashes, upgrade servers): they only run when
`hacknet.enabled` and not `dryRun`. RAM: `ns.hacknet.*` functions cost RAM in the tool script only, the planner has none (static RAM test).
Everything lives in new files; `hacknetHook` stays unchanged for non-hash nodes.

## 6. Spikes (read-only or one-shot, before the build)
1. Cost behavior of `Sell for Money` (does `costPerLevel` apply?) and the hash capacity formula; log `getHashUpgradeInfo`.
2. Production of one fully upgraded hacknet server (`getNodeStats(i).production`) and the formula's RAM term, in a node with SF9.1.
3. Can scripts on `hacknet-server-*` run at full RAM while it produces hashes (docs say the RAM is separate from production).
4. xp/s of the xp loop in BN9 (needs a BN9 run or `getBitNodeMultipliers` x the BN1 rate).

## 7. Tests (plain Node, `test/hashplan.js`)
Pure planner: payback ordering, caps (20 servers, level/ram/core/cache maxima), the `maxPaybackHours` gate, the cap-waste rule for
cache upgrades, hash-spending priority with each branch, reserve respected, dry run produces no calls, NaN/empty inputs produce no
calls. A fake `ns.hacknet` simulates a day of production and spending and asserts hashes never sit above 90% of the capacity and money
rises monotonically with selling on. Static RAM test as in `test/ram-xp-static.js`.

## 8. Effort and order
About 5 PRs: (1) spikes + `data/hash-status.txt`, (2) `lib/hashplan.js` + tests, (3) `agent/hacknet-hash.js` behind `hacknet.dryRun`,
(4) BN9 bootstrap changes and the SF4/SF9 guard, (5) planner/predictor income feed and dashboard row. Rough size: 4 to 6 agent
sessions. Acceptance: a BN9 run (SF4.3) reaches 2 TB home RAM and the Red Pill purchase without hacking income, with the hash
module providing at least 80% of the money, and a measured projection for hack 6000.
