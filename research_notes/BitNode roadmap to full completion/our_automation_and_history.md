# Our automation and run history (internal evidence for the BitNode completion roadmap)

Source conventions. Repo files are cited as links to their path in github.com/boycepoleonjr/bitburner (local checkout /home/user/bitburner, HEAD a8549e9). Live game files were read read-only on 2026-10-11 ~01:00 UTC with `node server/cli.js remote getFile` (`remote getFileNames` for the listing) from the hosted game at https://game-production-0b2d.up.railway.app. They are cited as "live:data/<file>". No game state was changed. Times are UTC.

## 1. What each in-game script does, and which game mechanics are automated or absent

### Takeaway
The stack is a hacking-only engine. It covers HGW hacking, rooting, programs/TOR, home RAM and cores, purchased (cloud) servers, faction joins, backdoors, hacking-contract faction work, donations, batch aug buying and installs, long-only 4S stock trading, a hacknet-node ROI gate, share() for rep, and settings-gated BitNode destruction. There is no code for gangs, corporations, Bladeburner, sleeves, grafting, Stanek, IPvGO, hacknet-server hash spending, crime, company work, infiltration, coding contracts, or combat-stat training.

### Cited Findings
**Script roles**
- `daemon.js` is the "continuous hacking orchestrator". Each loop runs scan → root → classify → score → decide → reconcile → plan/launch waves. When `ram.manager.enabled` is on, the target set grows with RAM, share/xp loops fill the remaining RAM by strategy weight, and cloud servers are bought. It writes data/ram-status.txt. It also runs hooks for programs, pserv, hacknet, stocks and milestones. — [game/daemon.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/daemon.js)
- `agent/autopilot.js` is the in-game Singularity autopilot ("needs Singularity: BN4 or SF4"). Every 30 s it handles TOR and port programs, home RAM/cores, faction-server backdoors, faction invites, the work policy, donations, and, with autoInstall, the aug batch and the install. It also covers NeuroFlux mode, the nfgHold rule (no NeuroFlux-only install at hack ≥90% of w0r1d_d43m0n's requirement), city-faction invite gating, and node control through lib/nodectl.js. — [game/agent/autopilot.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/autopilot.js)
- Singularity calls used by the autopilot and the sl-* scripts: getFactionRep, getAugmentationsFromFaction, getAugmentationRepReq, getOwnedAugmentations, getAugmentationPrice/Prereq/Stats, workForFaction, getCurrentWork, connect, installBackdoor, upgradeHomeRam/Cores (+costs), getFactionFavor, purchaseAugmentation, joinFaction, checkFactionInvitations, donateToFaction, universityCourse, travelToCity, purchaseTor, purchaseProgram, getDarkwebProgramCost, installAugmentations, destroyW0r1dD43m0n (sl-destroy only). — grep over [game/agent/](https://github.com/boycepoleonjr/bitburner/tree/main/game/agent)
- `agent/daemon-lite.js` is the "self-bootstrapping money engine + purchase ladder for a fresh BitNode on a tiny home (32GB)":
  - It roots what it can and runs phase-based HGW over at most 15 targets (MAXT=15) on home, rooted and purchased servers.
  - It buys a reserved purchased server, `pserv-sing` (64GB at first, later SING_RAM=512GB), to run the one-shot Singularity scripts agent/sl-*.js: TOR, programs, home RAM, cores, backdoors, faction work.
  - It spends leftover cash on worker pservs while worker utilization is at least 60%.
  - Handoff: it starts the autopilot once home ≥ apRam+32, then starts `daemon.js --reset` and exits once home ≥ apRam+dRam+64.
  - Hard-coded values: program prices (BruteSSH $500k … SQLInject $250m), pserv price $55,000/GB, pserv limit 25.
  - — [game/agent/daemon-lite.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/daemon-lite.js)
- `agent/sl-work.js` joins invites (a city faction only if it is in joinCity). It then works for the highest-priority faction that is not rep-complete: "Hacking contracts, else field work". — [game/agent/sl-work.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/sl-work.js)
- `agent/sl-destroy.js` is "the ONLY script that destroys a BitNode". It re-checks settings, the request and the backup ack (destroyGate) right before calling `destroyW0r1dD43m0n(nextBn, "agent/post-install.js")`. It is "Kept out of the autopilot because destroyW0r1dD43m0n costs 32 GB x16 outside BN4". — [game/agent/sl-destroy.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/sl-destroy.js)
- `agent/sl-plan.js` holds the 16x-RAM Singularity aug calls. It also calls getBitNodeMultipliers and writes data/aug-plan.txt and data/daedalus-req.txt. It is read-only (buys nothing) and the autopilot starts it about every 2 min. — [docs/specs/aug-planner.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md); [game/agent/sl-plan.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/sl-plan.js)
- `lib/augplan.js` is a pure planner. For the `destroy` goal it lists, in order:
  1. The fastest augs to fill the Daedalus count.
  2. The Red Pill (`blocked` until the Daedalus invite).
  3. Hacking-mult augs while hack is below w0r1d_d43m0n's requirement.

  It applies the owner rules (prereqs immediately before dependents, otherwise highest rep first; x1.9 price ramp; NeuroFlux last), the donation threshold max(getFavorToDonate, setting), and the `eta` vs `count` install policy. — [docs/specs/aug-planner.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md)
- `lib/nodectl.js` is a pure destroy state machine with this flow:
  1. The autopilot writes data/node-request.txt.
  2. server/node-control.js backs up the save and writes data/node-ack.txt.
  3. A `node.destroyDelayMin` veto window runs (default 10 min).
  4. sl-destroy.js runs.

  With no ack within 15 min the request is "blocked". If autoDestroy turns off, a cancel is written. — [game/lib/nodectl.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/lib/nodectl.js); [docs/specs/aug-planner.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md)
- `lib/rammgr.js` is the ns side of the RAM manager. Decisions live in the pure lib/ramplan.js. It uses no Singularity. Daedalus requirements come from the data/daedalus-req.txt cache, or fall back to 30 augs / $100b / hack 2500. — [game/lib/rammgr.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/lib/rammgr.js); [game/lib/ramplan.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/lib/ramplan.js)
- `lib/cloud.js` buys cloud (purchased) servers. While count < limit it buys the largest affordable power of two, then upgrades the smallest server. Budget = cash × ram.cloud.maxSpendFraction. It does not buy inside ram.cloud.freezeBeforeInstallMin of a predicted install. — [game/lib/cloud.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/lib/cloud.js)
- `lib/hooks.js` hacknetHook buys hacknet nodes/levels/RAM/cores with the best gain/cost first, and only if payback ≤ `maxPayoffHours` (override = 2 h). It uses only `ns.hacknet` node production. It has no hash spending (no hacknet-server/hash code anywhere in game/). — [game/lib/hooks.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/lib/hooks.js); [live:data/config-overrides.txt]: `{"hooks":{"hacknet":{"maxPayoffHours":2}}}`
- `tools/stocks.js` buys WSE → TIX → 4S data → 4S TIX. It trades long-only on 4S forecasts ("shorts need BitNode 8"), with buyAbove 0.6, sellBelow 0.5 and maxPortfolioFraction 0.5. `stocks.liquidate=true` sells everything before installs. — [game/tools/stocks.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/tools/stocks.js)
- `agent/share.js` runs `ns.share()` forever. The RAM manager fills spare RAM with share loops by strategy weight. Live BN5 end state: `alloc.share` = 100% of 160 PB usable ("faction work active"), sharePower 1.716. — [game/agent/share.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/share.js); live:data/ram-status.txt
- Telemetry and prediction: agent/telemetry.js writes 60 s JSONL. predictor v2 is walk-forward calibrated. Its 2026-09-27 baseline accuracy: rep within ±25% 96% (MAPE 10), level 67% (MAPE 23), money 34% (MAPE 60). — [game/agent/PLAYBOOK.txt](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/PLAYBOOK.txt) (PREDICTOR v2)

**Mechanics: automated vs absent**
- Grep result: game/ contains no references to `ns.gang`, `ns.corporation`, `ns.bladeburner`, `ns.sleeve`, `ns.grafting`, `ns.stanek`, `ns.go`, `ns.codingcontract`, crime or company work, or infiltration. The only namespaces used besides core ns are `ns.singularity`, `ns.stock`, `ns.hacknet` and `ns.cloud`. In augplan.js the words "gang", "corporations", "sleeves and grafting" and "hacknet servers" appear only as recommendation strings. — grep over [game/](https://github.com/boycepoleonjr/bitburner/tree/main/game)
- Telemetry money sources for the current BN5 install (live:data/telemetry-latest.txt `src`): hacking +$576q, stock +$2.22q, hacknet +$37.5b, crime +$6.1m (manual), servers −$413q, augmentations −$7.57t. Hacking is more than 99% of income.
- Hacknet was money-losing in BN4. Install #1 spent $1.69b on hacknet and earned $0.14b (ROI 0.08), which led to the 2 h payback gate. — [game/agent/PLAYBOOK.txt](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/PLAYBOOK.txt) (HARDENING); live:data/install-log.txt (first entry: hacknet 166m, hacknet_expenses −1.687b)
- Crime was tried once by hand in BN4 and abandoned: "Rob Store: only $93k/60s @44% in BN4 (< course cost) -> reverted to Algorithms". — live:data/agent-log.txt 2026-09-26T12:30Z
- Combat-gated factions are not automated. The PLAYBOOK notes: "Illuminati QLink … needs 30 augs, $150b, hack 1500, ALL combat 1200. Covenant needs combat 850. Corp factions need 200k company rep (work at company)". — [game/agent/PLAYBOOK.txt](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/PLAYBOOK.txt) (AUG TARGETS)
- Achievement clicks: "HOSPITALIZED/UNCLICKABLE need trusted clicks (owner via noVNC)". — live:data/agent-log.txt 2026-10-01T19:16Z

### Inferences
- Any node whose Source-File needs a non-hacking mechanic to finish is out of reach without new subsystems: Bladeburner (BN6/7), stock-only money (BN8), corp/gang-centric nodes, Stanek (BN13). This matches the spec's "non-goals for now".
- In BN9, `hooks.js` treats hacknet as nodes with a money-production ROI. It cannot spend hashes, so the hacknet-server economy there would be unused.
- The stock module is long-only and needs 4S. It cannot play BN8's short-selling / no-hack-money conditions.

### Gaps
- I did not read every daemon sub-library line by line (targets.js, planner.js, deploy.js). Batch quality (HWGW timing accuracy) was not measured here.
- No grafting, IPvGO or Stanek prototypes exist anywhere in the repo, so their build cost can't be estimated from our code.

## 2. Node-specific assumptions baked into the automation

### Takeaway
The automation assumes four things:
- Singularity RAM costs 16x outside BN4 (we own SF4.1 only), which forces a 32 GB → 2048 GB bootstrap phase run by daemon-lite plus a reserved 512 GB pserv for one-shot Singularity scripts.
- The w0r1d_d43m0n requirement scales by BitNode. The code reads it live; the Daedalus requirements are read from multipliers via the sl-plan cache.
- The planner orders BitNodes 1, 4, 2, 5, 10, 9, 3, 11, 12, 6, 7, 8, 13, 14 with SF cap 3 (BN12 uncapped).
- Destruction is off by default and owner-gated.

### Cited Findings
- `DEFAULT_BN_ORDER = [1, 4, 2, 5, 10, 9, 3, 11, 12, 6, 7, 8, 13, 14]` and `SF_MAX = (n) => (n === 12 ? Infinity : 3)`. Reasons strings:
  - 1: "fastest node, SF1 raises every multiplier"
  - 4: "SF4.2/4.3 cut Singularity RAM 16x -> 4x -> 1x, removing the 1 TB autopilot bootstrap wall"
  - 2: "gangs (needs gang automation first)"
  - 5: "SF5 raises hacking and intelligence; hacking-friendly"
  - 10: "sleeves and grafting"
  - 9: "hacknet servers"
  - 3: "corporations"

  — [game/lib/augplan.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/lib/augplan.js) lines 19–20, 277–283
- Spec rationale for that order:
  - BN1 to SF1.3: "fastest node, with no penalties … Our hacking-only automation finishes it as is."
  - BN4 to SF4.3: removes "the 1 TB autopilot bootstrap wall that forced daemon-lite in BN5, and the 512 GB destroy script. This is the biggest saving for this automation across all later nodes."
  - BN2: "the strongest aug-path accelerator, but it needs gang automation first (not in the repo). Don't let node.autoSelect reach it."
  - BN5 to SF5.3: hacking-friendly.
  - Then BN10, 9, 3, 11/12.
  - "BN6/7/8/13/14 need Bladeburner, stock or Stanek automation; these are non-goals for now."
  - Next-run settings: `node.order=[1,4]`, autoSelect=true, autoDestroy=true.

  — [docs/specs/aug-planner.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md) "Recommended BitNode order"
- AGENTS.md: in each fresh BitNode, daemon-lite "bootstraps until home reaches 2048GB (with SF4.1 the Singularity autopilot needs ~1TB outside BN4)". — [AGENTS.md](https://github.com/boycepoleonjr/bitburner/blob/main/AGENTS.md)
- Measured RAM figures:
  - The autopilot was 52 GB at first, later 75 GB in BN4 at 1x (homeReserveGb 128). — [game/agent/PLAYBOOK.txt](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/PLAYBOOK.txt) (CHECK-IN v3, AUTO-INSTALL)
  - On BN5 entry: "Autopilot needs 1024GB (singularity cost) and daemon 26.8GB > free ~19GB". — live:data/agent-log.txt 2026-10-03T01:42Z
  - sl-ram/sl-info are 49.6 GB each on pserv-sing, and sl-work needs pserv-sing at 512 GB. — live:data/agent-log.txt 2026-10-03T15:48Z; [game/agent/daemon-lite.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/daemon-lite.js)
- w0r1d_d43m0n requirements observed per node:
  - BN1: 3000 (destroyed at hack 4333).
  - BN4: 9000 (destroyed at hack 9010).
  - BN5: 4500 = 3000 × WorldDaemonDifficulty 1.5.

  — live:data/agent-log.txt 2026-09-26T11:48Z and 2026-10-03T01:39Z; [docs/specs/aug-planner.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md); live:data/aug-plan.txt `worldDaemon.req 4500`
- BN5 multipliers captured in the test fixture: WorldDaemonDifficulty 1.5, DaedalusAugsRequirement 30, ScriptHackMoney 0.15, AugmentationMoneyCost 2, AugmentationRepCost 1, FavorToDonate 150. Owned SFs at capture: SF1.1, SF4.1. — [test/fixtures/bn5-snapshot.json](https://github.com/boycepoleonjr/bitburner/blob/main/test/fixtures/bn5-snapshot.json)
- Hard-coded defaults that may not hold in every BitNode:
  - Daedalus fallback 30 / $100b / 2500. — [game/lib/ramplan.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/lib/ramplan.js)
  - pserv price $55,000/GB and limit 25 ("dl-buy.js verifies by actually buying"). — [game/agent/daemon-lite.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/daemon-lite.js)
  - The factionPriority list is hacking factions only: CyberSec, NiteSec, BitRunners, The Black Hand, Daedalus, Tian Di Hui, Sector-12, Netburners. Other config: skipHacknetAugs true, joinCity [Sector-12]. — live:data/autopilot-config.txt
  - Install trigger ≥6 augs; donate at favor 150; nfgHoldFrac 0.9; installPolicy "eta". — [game/lib/settings-schema.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/lib/settings-schema.js)
- Owner defaults: node.autoSelect=false and node.autoDestroy=false. Destruction only via node.autoDestroy after a save-backup ack and a veto window. — [AGENTS.md](https://github.com/boycepoleonjr/bitburner/blob/main/AGENTS.md); [docs/specs/settings.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/settings.md)
- Live planner state at the end of BN5: recommended next = "BN1: fastest node, SF1 raises every multiplier (SF1 1 -> 2)". Node stage "none": "waiting for the owner (node.autoDestroy off)". — live:data/aug-plan.txt

### Inferences
- The 16x Singularity multiplier is the single largest node-independent structural cost for this stack. Until SF4.3, every fresh node starts with roughly 14 h of daemon-lite bootstrap (see section 3). That is consistent with the spec's priority on BN4 → SF4.3.
- The ScriptHackMoney 0.15 and 2x aug cost in BN5 did not stop the stack: BN5 still reached READY in about 58 h. That suggests hack-money penalties of that size are tolerable for this automation.

### Gaps
- The exact static RAM of autopilot.js outside BN4 was not measured in this pass; "~1TB/1024GB" comes from the agent-log and AGENTS.md. I could not call getScriptRam because the game had to stay untouched.
- Whether BN-specific multipliers (PurchasedServerLimit, PurchasedServerCost, HackingLevelMultiplier) would break the hard-coded pserv constants in daemon-lite is unverified.

## 3. Measured wall-clock durations of past runs

### Takeaway
| Node | Key timings | Main limiter |
|---|---|---|
| BN1 | Agent-era stretch about 20 h, 4 manual installs. Start date unknown. | — |
| BN4 | About 6.6 days entry→destroy; 17 auto-installs; Red Pill at about 101 h | Reaching hack 9000 took another ~57 h |
| BN5 | About 58 h entry→READY, but 7.96 days entry→destroy; 13 auto-installs | ~14.5 h bootstrap at the start; ~5.5 days at the end waiting on the owner/PR decision (READY not escalated) |

### Cited Findings
**BN1 (no Singularity; agent drove the UI through Claude in Chrome)**
- The agent log starts 2026-09-25T15:53Z ("bridge v2 installed by Claude"). The first agent check-in installed 22 augs at 16:07Z. — live:data/agent-log.txt
- Agent-era installs:
  1. 2026-09-25T16:07Z (22 augs).
  2. 2026-09-26T00:48Z, "PLAN C install" (BitRunners 325k rep; NF L21→36).
  3. 2026-09-26T08:01Z (Neuroreceptor, Neuregen, NF53; Donate! unlocked).
  4. Red Pill install about 11:42Z ("INSTALLED 07:42 ET", after donating $5t to Daedalus for 10.7m rep).

  Then "hack 4333 >= 3000: backdooring w0r1d_d43m0n" at 11:48Z, and "BN1 DESTROYED 07:49 ET … entered BN4.1" at 11:51Z. — live:data/agent-log.txt
- Main BN1 time sinks in the agent era:
  - Waiting on BitRunners rep, about 10–12 rep/s toward 275k (≈7.5 h).
  - The Daedalus favor grind, about 35 rep/s toward 470k (≈4 h) to reach 150 favor for donations.
  - Manual UI work (Chrome-extension disconnects skipped some check-ins).

  — live:data/agent-log.txt 2026-09-25T17:16Z–2026-09-26T07:10Z

**BN4 (Singularity at 1x RAM; the autopilot was written during this run)**
- Entered 2026-09-26T11:49Z (07:49 ET) on a 32 GB home. First 7 h were manual check-ins:
  - Algorithms in debt; crime abandoned.
  - Created BruteSSH and FTPCrack; bought relaySMTP and HTTPWorm.
  - Home RAM grew 32→256 GB by +4.7 h.

  The autopilot started at 2026-09-26T18:45Z (+6.9 h). — live:data/agent-log.txt
- First auto-install at 2026-09-27T02:37Z (+14.8 h; `sinceAug` 14.8 h). — live:data/install-log.txt
- 17 auto-installs between 2026-09-27T02:37Z and 2026-10-02T23:31Z. "Red Pill" install at 2026-09-30T16:44Z (+101 h). — live:data/install-log.txt
- After the Red Pill install, hacking peaked near 6,150 on 2026-10-01T00:52Z and stayed around 5,600–6,700 through 2026-10-02. Repeated NeuroFlux-only "stalled" installs reset it each time; 9 installs came after the Red Pill. The nfgHold fix was deployed at 2026-10-03T00:42Z ("hack 8746/9000 now"). Hack reached 9010 ≥ 9000 and BN4 was destroyed at 2026-10-03T01:39Z, about 57 h after the Red Pill install. Total BN4 ≈ 157.8 h (6 d 13.8 h). — live:data/agent-log.txt; live:data/install-log.txt
- "BN4 NOT destroyed per owner" (2026-10-01T19:16Z). Hack was ~6,450 then, below 9,000, so this was not yet blocking. — live:data/agent-log.txt
- Infrastructure moves during BN4 (possible wall-clock overhead):
  - Migration to Railway on 2026-09-28T22:30Z (save imported from Comet).
  - A dashboard staged-patch apply reverted the service to old code from 21:43 to 15:57 UTC (2026-09-29/30).

  — live:data/agent-log.txt 2026-09-28T22:30Z, 2026-09-30T16:01Z

**BN5 (SF4.1, so Singularity at 16x RAM)**
- Entered 2026-10-03T01:39Z with 32 GB home, $1.2k and hack 8. The autopilot could not start (needs about 1 TB). daemon-lite was written and deployed at 01:58Z. — live:data/agent-log.txt
- Bootstrap bugs that cost time:
  - daemon-lite "never hacked (grew to 90% first with weaken eating all threads) -> BN5 income was $0" until the fix at 04:07Z (about 2.5 h lost).
  - Telemetry sat on pserv-sing, so the 49.6 GB sl-ram/sl-info could not run: "home RAM stuck at 128GB for hours while cash went to idle pserv upgrades" until the fix at 15:48Z.

  — live:data/agent-log.txt 2026-10-03T04:07Z, 15:48Z
- daemon-lite handed off at 2026-10-03T16:07:35Z (live:data/daemon-lite-status.txt `stage:"handoff"`), at home 2048 GB, **about 14.5 h after entry**. Within the next hour the autopilot took home RAM 2048→4096→8192 GB, then 16 TB, then 32 TB by 19:08Z. — live:data/daemon-lite-status.txt; live:data/agent-log.txt 2026-10-03T16:53Z–19:08Z
- First BN5 install at 2026-10-03T20:43Z (+19.1 h). Red Pill install at 2026-10-05T10:43Z (+57.1 h). "w0r1d_d43m0n READY" first flagged at 2026-10-05T11:47Z (hack 5855 vs 4500), **about 58.1 h after entry**. — live:data/install-log.txt; live:data/agent-log.txt
- BN5 had 13 installs in total: 7 up to and including the Red Pill, and 6 more after READY ("stalled (all rep-complete)" / "6 augs buyable", last at 2026-10-06T13:40Z). nfgHold only blocks NeuroFlux-only installs. — live:data/install-log.txt
- Idle at the finish:
  - The spec says "BN5 idled about 72 h at the finish … The autopilot only raised `w0r1d_d43m0n READY — agent decides BitNode destruction`. server/checkin.js treats that as an owner decision, so it is never escalated". — [docs/specs/aug-planner.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md)
  - The final destroy was owner-requested: "w0r1d_d43m0n backdoored via ns.singularity.installBackdoor at ~00:44:40Z" on 2026-10-11. — live:data/agent-log.txt 2026-10-11T00:48Z
  - Total BN5 entry→destroy ≈ 191 h (7 d 23 h), of which about 133 h came after READY.
- BN5 end state: hack 13,354 (mult 15.1), money $164.9q, income about $1.06t/s, home 128 PB (134,217,728 GB) with 8 cores, 25 × 1 PB cloud servers, 96/96 servers rooted, 69 augs installed. Black Hand rep 979m, working for NeuroFlux rep (NFG at 1.036b rep). — live:data/telemetry-latest.txt; live:data/aug-plan.txt; live:data/ram-status.txt
- Install cadence comparison:
  - BN4 Red Pill came after 8 installs in about 101 h.
  - BN5 Red Pill came after 7 installs in about 57 h.
  - BN5 cycles were often 5–19 h (`sinceAugH` at install: 19.1, 14.2, 15.3, 2.5, 0.2, 5.6, 0.3).

  — live:data/install-log.txt

### Inferences
- Pure automation time-to-READY improved from about 158 h (BN4) to about 58 h (BN5), despite BN5's 16x Singularity RAM and 0.15 ScriptHackMoney. Contributing factors: SF4.1 plus the SF1/SF4 multipliers, a mature autopilot, and BN5's lower w0r1d requirement (4500 vs BN4's 9000).
- With node.autoDestroy on, BN5 would have ended about 58 h in. That makes the default-off owner gate the largest single wall-clock cost on record, bigger than any automation bottleneck. The BN5→BN1 run is set up to test the autoDestroy path.
- BN4's post-Red-Pill tail of about 57 h is mostly a hack-level problem: requirement 9000 combined with installs that reset hacking. Nodes with WorldDaemonDifficulty > 1.5 should expect a similar tail.
- Bootstrap (about 14.5 h in BN5, including about 2.5 h plus several hours lost to two bugs) should shrink in the next node now that those bugs are fixed. It will go away only with SF4.2/4.3.

### Gaps
- **BN1 start date and total duration are unknown.** The agent log begins 2026-09-25 mid-run (after earlier human play). Snapshots don't record the BN start, and git history starts 2026-09-27.
- The exact hour hack first crossed 9000 in BN4 is not logged separately; it is inferred from the destroy note.
- Downtime during the Comet→Railway migration (2026-09-27T22:13Z to 2026-09-28T22:30Z, with sparse check-ins) was not quantified.
- There is no per-install aug list per BN in this summary. The data is in live:data/install-log.txt `bought` arrays.

## 4. Biggest time sinks and failures per run

### Takeaway
| Run | Main time sinks |
|---|---|
| BN1 | Manual UI work and rep grinds |
| BN4 | Bootstrapping before the autopilot existed; NeuroFlux-only installs resetting hacking near a 9000 requirement; money-losing hacknet; aug-batch bugs |
| BN5 | Bootstrap under 16x Singularity RAM (two bugs); stale BN4 status files causing false READY alerts; above all, the un-escalated owner decision at READY (about 5.5 days) |

### Cited Findings
- **BN4 incidents:**
  - Hacknet ROI 0.08 on install #1.
  - "auto-install left Cranial Signal Processors Gen II … unbought" because of prereq ordering and the x1.9 ramp. Fix: prereqs immediately before dependents, plus skipHacknetAugs.

  — [game/agent/PLAYBOOK.txt](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/PLAYBOOK.txt) (HARDENING, INCIDENT 2026-09-27)
- **BN4 incident 2026-10-02 21:55Z:** "NeuroFlux-mode install (#13) bought only 1 NFG; ~$9.15q discarded. Cause: donation formula under-estimated rep/$ in BN4." Fixed with a measured donation rate. — live:data/agent-log.txt
- **BN4 nfgHold:** "no NeuroFlux-only installs at hack >= 90% of w0r1d_d43m0n (8746/9000 now)", deployed 2026-10-03T00:42Z, about 1 h before the destroy. — live:data/agent-log.txt
- **BN4 early phase:** Algorithms debt and near-zero income while daemon prepped joesguns (−$2.26m at +57 min); "Algorithms had run all day (only passive rep, no aug progress)" until auto-faction work began on 2026-09-26T22:38Z. — live:data/agent-log.txt; [game/agent/PLAYBOOK.txt](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/PLAYBOOK.txt) (WORK POLICY)
- **City factions:** Aevum/Sector-12 invite handling caused escalations; a city-faction gate was deployed 2026-10-02T01:57Z. — live:data/agent-log.txt
- **BN5 bootstrap failures:** "$0 income" HGW bug (fixed 04:07Z), and pserv-sing blocked by telemetry so home sat at 128 GB "for hours" (fixed 15:48Z). — live:data/agent-log.txt
- **BN5 stale state:** autopilot-status.txt stayed frozen at the BN4 snapshot (hack 9010, false "w0r1d_d43m0n READY") for about 2.5 h, prompting several escalations. checkin-lib now ignores status files older than 3 min, or telemetry that is BN-mismatched. — live:data/agent-log.txt 2026-10-03T01:42Z–04:07Z
- **BN5 finish:** READY was never escalated (about 72 h according to the spec as of 2026-10-08, about 133 h in total). Also, "PRs 9-13 had never been pushed" to the game until 2026-10-10T16:55Z, so the planner, RAM manager and node control did not run in-game for most of BN5. — [docs/specs/aug-planner.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md); live:data/agent-log.txt 2026-10-10T16:55Z
- **BN5 RAM utilization before the RAM manager:** "74 TB of 64 PB (0.11%)" was used, with 0/25 cloud servers and income about $1.49t/s. After rollout: util.ema5 ≈ 1.0 and 25 × 1 PB cloud. — [docs/specs/ram-manager.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/ram-manager.md); live:data/ram-status.txt
- **Hosted infrastructure:** watchdog live test passed (page freeze → Chromium restart at +10 min). — live:data/agent-log.txt 2026-10-01T02:25Z
- **Lessons carried across all nodes:**
  - Aug batches go highest-rep first with NeuroFlux last (x1.9 per purchase).
  - Donate after 150 favor (favorToRep(150) ≈ 462k rep).
  - Liquidate stocks before installs.
  - Endgame is Daedalus → Red Pill → w0r1d_d43m0n.
  - Early run: TOR and programs first.

  — [game/agent/PLAYBOOK.txt](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/PLAYBOOK.txt) (CORE STRATEGY, DAEDALUS PLAN)

### Inferences
- In order of wall-clock impact, the fix priorities are:
  1. Ensure autoDestroy or escalation at READY.
  2. Cut bootstrap time (SF4.2/4.3, or a better daemon-lite).
  3. Stop hack-resetting installs once w0r1d is within reach. nfgHold covers only NeuroFlux-only installs; BN5 still did 6 non-NFG installs after READY.
- In the first BN5 hours, cash went into idle pserv upgrades instead of home RAM, which suggests the purchase ladder's priorities matter a lot for bootstrap time.

### Gaps
- No quantified time loss per incident beyond those noted. The NFG-install resets in BN4 cannot be cleanly separated from the inherent time to reach hack 9000.

## 5. What existing docs say about future nodes, and what each candidate would require us to build

### Takeaway
The docs explicitly support repeating BN1 (to SF1.3) and BN4 (to SF4.3) with the current stack, then BN5. Every other node needs a new subsystem: gangs for BN2, sleeves/grafting for BN10, hash spending for BN9, corporations for BN3, and Bladeburner/stock/Stanek for BN6/7/8/13. BN6/7/8/13/14 are declared non-goals for now.

### Cited Findings
- "BN2 (gangs) … needs gang automation first (not in the repo). Don't let node.autoSelect reach it before that exists." — [docs/specs/aug-planner.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md)
- "BN6/7/8/13/14 need Bladeburner, stock or Stanek automation; these are non-goals for now." — [docs/specs/aug-planner.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md)
- "BN4 repeat deferred to SF4.3 later". The BN4→BN5 choice was made because "SF4.1 already enough for singularity". — live:data/agent-log.txt 2026-10-03T01:39Z
- The earlier PLAYBOOK node preference was "SF4 (Singularity) first, then SF5, SF2". — [game/agent/PLAYBOOK.txt](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/PLAYBOOK.txt) (EACH CHECK-IN 3e)
- The hacknet gate notes: "Revisit in BitNodes with strong hacknet mults (BN9) - raise maxPayoffHours there." — [game/agent/PLAYBOOK.txt](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/PLAYBOOK.txt) (HARDENING)
- The stock module states "long-only (shorts need BitNode 8)". — [game/tools/stocks.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/tools/stocks.js)
- RAM manager "Next BitNode" acceptance: ema5 ≥ 0.9 after about 30 min; early money/s at least the baseline; phase transitions. Its BN5-scale purchase was 25 × 1 PB. — [docs/specs/ram-manager.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/ram-manager.md)
- Achievement status: 25/108 at the time of the BN1 playbook. The live file data/achievements-done.txt lists only ["Big trouble","Need more real life ram"], so it is not a full record. — [game/agent/PLAYBOOK.txt](https://github.com/boycepoleonjr/bitburner/blob/main/game/agent/PLAYBOOK.txt); live:data/achievements-done.txt

**Per-candidate build requirements, from our code and docs**

| Node | What our stack needs |
|---|---|
| BN1, BN4, BN5 repeats | Nothing new; already completed by this stack (BN5 as SF5.1). |
| BN2 | Gang automation (none in repo). |
| BN3 | Corporation automation (none). |
| BN9 | Hash spending / hacknet-server logic (hooks.js is node-only, 2 h payback gate). |
| BN10 | Sleeve and grafting automation (none). |
| BN6/7 | Bladeburner (none). |
| BN8 | Stock automation beyond long-only 4S, plus shorting (stocks.js is long-only). |
| BN13 | Stanek (none). |
| BN11/12/14 | No node-specific notes in repo docs beyond their position in the default order. |

— [game/lib/augplan.js](https://github.com/boycepoleonjr/bitburner/blob/main/game/lib/augplan.js); [docs/specs/aug-planner.md](https://github.com/boycepoleonjr/bitburner/blob/main/docs/specs/aug-planner.md); grep over game/

### Inferences
- Measured data supports the current low-risk plan: BN1 → BN4 with autoSelect/autoDestroy on. These nodes need no new code, and BN4×2 removes the 16x Singularity RAM bootstrap that cost about 14.5 h in BN5.
- **Watch item for BN4:** BN4's 9000 hack requirement combined with hack-resetting installs produced a ~57 h tail. Better install suppression near the finish would directly shorten BN4 repeats.
- Any jump to BN2/3/9/10 needs a new subsystem written, tested (test/*.js) and specced (docs/specs) first, per AGENTS.md "How to work on code".

### Gaps
- The repo has no docs or specs for BN11, BN12 or BN14 mechanics, and no estimates of build effort for gang/corp/sleeve/Bladeburner automation.
- No in-repo measurement of how much SF1.2/SF4.2/SF5.x would shorten our runs. That needs external game data (multiplier tables) and is outside this internal-history scope.
