# Spec: RAM manager

Status: implemented in this PR. Depends on: settings (`lib/settings.js`) and `lib/progress.js`. Feeds: the dashboard, via `data/ram-status.txt`.

## Plan improvement log
- **v1** was drafted by the agent with the live BN5 context (plan text in the PR conversation).
- **Round 1:** Perplexity (Computer mode), prompt "Improve this plan for oneshot execution", output plan v2 (https://www.perplexity.ai/computer/tasks/393f2603-2e2b-4921-a410-3e5a9c48af78).
- **Accepted from v2:**
  - Step-0 ground truth from the API typings.
  - Kill switch `ram.manager.enabled`.
  - Explicit formulas for usable, demand and phase.
  - Packing order: share on home first, xp largest-first.
  - Preemption policy: loops shrink before any hacking worker, and in-flight H/G/W are never killed by the manager.
  - Persistent share/xp loops instead of the 5 s relaunch.
  - No Singularity calls in the daemon.
  - Install-freeze window for cloud buys.
  - Ordered, test-first commits.
  - Rollback equality against a captured baseline fixture.
  - A 10-minute utilization simulation.
  - The donation check as a higher-leverage lever (handled by the aug planner PR, which owns `augs.donateAtFavor`).
- **Changed or rejected:**
  - *Settings adapter (`lib/ram-settings.js`):* dropped. The settings PR lands first, so the daemon reads `readSettings()` directly.
  - *`lib/cloud-api.md` in game:* moved here. Bitburner only stores `.js`/`.txt`.
  - *`server/test/...`:* tests live in `test/`.
  - *New `agent/work-probe.js`:* not needed. `autopilot-status.txt` (`work: "FACTION:<name>"`) and the telemetry last line already carry the work signal. Staleness is 120 s, not 30 s, because autopilot writes every ~30 s.
  - *"Small-RAM decisions equal the baseline with the manager on":* impossible by design (loops replace one-shot XP). It was replaced by two checks:
    - manager OFF equals the baseline exactly, at small and huge RAM;
    - manager ON keeps the same floor target set.
  - *Surplus rule:* v2's wording was ambiguous. It was replaced by the explicit order below.
  - *Cloud names `cloud-NN`:* kept.
- **Stop reason:** one round. v2 left no material ambiguity, and the remaining choices were repo facts that were verified directly.

## Step-0 facts (verified against bitburner-src `NetscriptDefinitions.d.ts`, v3)
- `ns.cloud`:
  - `getServerNames()` 1.05 GB
  - `getServerLimit()` 0.05
  - `getRamLimit()` 0.05
  - `getServerCost(ram)` 0.25
  - `purchaseServer(host, ram)` 2.25, returns hostname or ""
  - `getServerUpgradeCost(host, ram)` 0.1, returns -1 if invalid
  - `upgradeServer(host, ram)` 0.25, returns boolean
  - RAM must be a power of 2, max 2^20.
- `ns.share()`: 2.4 GB, 10 s cycles, "scales with thread count, but at a sharply decreasing rate". `ns.getSharePower()`: 0.2 GB.
- `ns.getResetInfo()`: 1 GB. Gives `ownedAugs: Map<name, level>` and `currentNode`.
- `ns.getBitNodeMultipliers()`: 4 GB. Too expensive for the daemon. Daedalus requirements come from the optional cache `data/daedalus-req.txt` (`{augs, money, hack}`, to be written by a script that already pays for it), falling back to `cfg.hooks.milestones.daedalus` (30 / $100b / 2500).
- **New daemon RAM:** +1.2 GB (`getResetInfo` + `getSharePower`). The cloud calls were already paid by `lib/hooks.js`.

## BN5 baseline (2026-10-08, before this PR)
- Home: 64 PB, 8 cores. 71 rooted, 63 with money.
- Cloud servers: 0 of 25. 1 PB costs ≈ $0.74t, cash is $145q.
- Hacking: 7 targets (`secondary.slots` = 6), ≈ 140 TB of HGW. The one-shot XP weaken on joesguns spikes to about 67 PB but idles between 5 s loops.
- Sampled utilization: 74 TB of 64 PB (0.11%).
- Work: The Black Hand hacking contracts at 2.4k rep/s. `agent/share-keeper.js` was not running.
- Income ≈ $1.49t/s.

## Behaviour (manager on)
Each daemon loop:
1. **Settings.** `readSettings(ns)`. `managedConfig()` maps the settings onto cfg:
   - `ram.homeReserveGb` → `homeReserveGb`
   - `ram.xp.target` → `xp.target`
   - `ram.batches.max` → `farm.maxBatches` (0 = bounded only by weaken time and RAM)
   - One-shot XP (`xp.enabled`) and `hooks.purchasedServers` are turned off, so nothing buys twice.
2. **Observe** (`lib/rammgr.js`):
   - `usable = Σ executors max(0, maxRam − reserve(home) − nonManagedUsed)`. Managed = the H/G/W workers plus `workers/share-loop.js` and `workers/xp-loop.js`.
   - Strategy: `strategyNow(...)` with installed aug count (`getResetInfo`), cash, hacking level and the Daedalus requirements. Red Pill comes from `ownedAugs` or `autopilot-status.augs.redPill`.
   - `repActive`: autopilot-status first, then the telemetry last line (read at most every 60 s), else false.
   - `hackNeed`: below the Daedalus hack requirement, below the w0r1d_d43m0n requirement, or a rooted money server out of reach.
3. **Targets.**
   - Floor = primary + `pickSecondaries` (unchanged, so small-RAM behaviour holds).
   - Then ranked targets are added while their full-wave demand (`planWave` with infinite budget) fits `usable − share − floorDemand`, capped by `ram.targets.max`.
4. **Allocate** (`lib/ramplan.js allocate`):
   - `share = w × usable` if faction work is active and share is enabled.
   - `money = min(usable − share, demand)`.
   - Surplus goes to the first that applies:
     1. xp if `xp.mode=always` or hackNeed (and not off)
     2. share if faction work is active
     3. xp otherwise
     4. idle if `xp.mode=off`.
   - The four buckets sum to `usable`.
5. **Money first.** If `alloc.money − runningMoney − free ≥ max(8 GB, 0.1% usable)`, kill xp loops, then share loops, before placing waves. If a primary is starved, the old preemption path also shrinks loops first. Hacking workers are never killed by the manager.
6. **Waves.** Same planner, same placement.
7. **Loops.** Resize share/xp toward their allocation (`resizePlan`):
   - Hysteresis: `ram.resizeThreshold`, default 10%.
   - Shrinking kills the largest processes first.
   - Share is placed on home first, then the largest free host. Xp goes largest-free first. Xp loops on an old target are replaced.
8. **Cloud** (`lib/cloud.js`):
   - Budget is `cash × ram.cloud.maxSpendFraction`.
   - Buy the largest affordable power of two up to the limit (`cloud-NN`), then upgrade the smallest server to the largest affordable size.
   - Frozen within `ram.cloud.freezeBeforeInstallMin` of `autopilot-status.installEtaMs`. If that ETA is missing, the freeze is ignored and a reason is logged.
9. **Status.** Write `data/ram-status.txt`.

**Manager off:** cfg is untouched, the old path runs, and leftover share/xp loops are killed once so rollback holds no RAM. Status is still written with `enabled:false`.

## `data/ram-status.txt` contract (dashboard depends on it; keep the shape)
```json
{"t":ms,"enabled":bool,"phase":"early|mid|late","progress":0..1,"weight":0..1,"repActive":bool,"hackNeed":bool,"usableGb":n,
 "alloc":{"money":n,"share":n,"xp":n},"running":{"money":n,"share":n,"xp":n},"util":{"instant":0..1,"ema5":0..1},
 "activeTargets":[{"host":s,"kind":s,"batches":n,"ramGb":n}],"cloud":{"count":n,"limit":n,"minGb":n,"maxGb":n,"spentThisLoop":n},
 "sharePower":n,"reasons":[s]}
```
`ema5` is a time-weighted EMA over 5 minutes, persisted in daemon state (`state.ram`). Running money is HGW threads × 1.75 GB.

## Settings used (all existing keys in the `ram` / `strategy` groups; none added)
`ram.manager.enabled`, `ram.homeReserveGb`, `ram.cloud.enabled`, `ram.cloud.maxSpendFraction`, `ram.cloud.freezeBeforeInstallMin`, `ram.share.enabled`, `ram.xp.mode`, `ram.xp.target`, `ram.targets.max`, `ram.batches.max`, `ram.resizeThreshold`, `strategy.early|mid|late`, `strategy.phase.midAt|lateAt`.

## Cross-PR contracts
- **Aug planner / autopilot PR:**
  - Write `installEtaMs` (absolute ms) into `data/autopilot-status.txt` to enable the cloud freeze.
  - Optionally write `data/daedalus-req.txt` (`{augs, money, hack}` from `getBitNodeMultipliers().DaedalusAugsRequirement` etc.) so non-BN5 nodes use their real requirements.
- **Dashboard PR:** read `data/ram-status.txt` as above.

## Tests
- `test/ramplan.js`:
  - `allocate` for every branch, plus invariants over 1,000 seeded random inputs (finite, ≥ 0, sum = usable, money ≤ demand, no share without rep work, no xp when off).
  - Phase via progress.
  - Target extension.
  - Resize hysteresis.
  - EMA.
  - Work signal: autopilot, telemetry fallback, stale.
  - hackNeed and the Daedalus cache.
  - Exact status shape.
- `test/cloud.js`:
  - Largest affordable power of two.
  - The 25 limit and naming.
  - Spend fraction.
  - Smallest-first upgrades.
  - Freeze window, including a missing ETA.
  - BN5-scale purchase of 25 × 1 PB.
- `test/daemon-ram.js`, run on a deterministic fake network (`test/helpers/fake-game.js`):
  - Manager OFF equals `test/fixtures/daemon-baseline.json` exactly (20 loops, small and huge RAM). The fixture was captured from the unmodified daemon.
  - `managedConfig` mapping.
  - Small-RAM floor set kept.
  - Huge RAM activates every money target (41 vs 7).
  - Late weight puts RAM into share, and `strategy.late=0` returns it to money within 2 loops. Only loops are killed.
  - In-flight H/G/W never killed.
  - Hysteresis: no kill or respawn on a ±3% change.
  - Cloud superseding the legacy hook: no double buys.
  - Rollback kills the loops.
  - A stale work file means no share.
  - 10-minute simulation: average utilization 99.7%, `ema5` ≥ 0.9.

## Acceptance
**Now (BN5, within 1 h of deploy):**
- 25 × 1 PB cloud servers.
- `util.ema5` ≥ 0.9.
- Record `sharePower` and rep/s against 2.4k/s.
- `bb settings set strategy.late=0` moves RAM to money within 2 loops.
- `bb settings set ram.manager.enabled=false` restores the old behaviour within 1 loop.

**Next BitNode:**
- `ema5` ≥ 0.9 after about 30 min.
- Early money/s ≥ the baseline at equal RAM.
- Phases move early → mid → late at the thresholds (check `ram-status` history and telemetry).

## AGENTS.md changes (to apply when merging)
- "What runs by itself": replace the `daemon.js` bullet with:
  > daemon.js --reset — hacking + RAM manager (settings ram.*, strategy.*): grows the target set with RAM, fills spare RAM with share/xp loops by strategy weight, buys cloud servers (lib/cloud.js). Status: /data/ram-status.txt. Rollback: `bb settings set ram.manager.enabled=false`.
- Note that `agent/share-keeper.js` is retired.
- "Logs": add `/data/ram-status.txt`.
- "How to work on code": after `bb push`, restart with `kill daemon.js; run daemon.js` (state is kept). New scripts to push: `workers/share-loop.js`, `workers/xp-loop.js`, `lib/ramplan.js`, `lib/rammgr.js`, `lib/cloud.js`.
