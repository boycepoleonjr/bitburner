# Spec: spare RAM goes to hack XP, not share, while hack level is the bottleneck

Status: plan for `fix/ram-xp-over-share`. Extends `docs/specs/ram-manager.md` (allocation step 4). No settings, node-order or workflow changes.

## Problem (found by a read-only audit, 2026-11-02; re-verified in code)
BN10, hack 5760 of 6000 needed for w0r1d_d43m0n. `data/ram-status.txt` shows `alloc {money:0, share:~75M GB, xp:0}` and `hackNeed:true`. The aug plan has nothing left to buy. Hack level rose 5750 -> 5759 in 7.6 h (about 50 min per level, 240 levels left, about 8 days).

Root cause, confirmed in `game/lib/ramplan.js` `allocate()`:
1. `share = w x usable` whenever faction work is active and share is enabled (lines 34-37). Late phase has `w = 1`, so `share = usable`.
2. `money = min(usable - share, demand) = 0`, so `surplus = usable - share - money = 0`.
3. The xp branch (`hackNeed` -> xp) only distributes `surplus`. It never runs, so `xp = 0`.

Share only boosts faction-work rep. Here no aug step needs rep (Red Pill and Daedalus requirements are met, every other aug is bought or held), so the RAM earns nothing while hack level is the one thing between the run and w0r1d_d43m0n.

## Design

### 1. "Does anything still need faction rep?" — `repNeededFrom` (pure, `lib/ramplan.js`)
Input: raw `data/aug-plan.txt`, `now`. Output: `{needed:boolean, why:string}`. `needed:false` only when the plan positively says no rep is outstanding:

| Plan content | Result |
|---|---|
| missing, unparseable, no `steps` array, no finite `t` | needed (`aug-plan unavailable`) |
| `now - t > 10 min` (autopilot refreshes it about every 2 min; same limit as `cloud.js`) | needed (`aug-plan stale`) |
| `redPill.owned` is false and `redPill.rep < redPill.repReq` | needed (Red Pill rep) |
| any step with `status:"needRep"` whose `why` does not start with `held` | needed (names the aug and faction) |
| anything else (`buyable`, `needMoney`, `blocked`, `owned`, held NeuroFlux) | not needed |

Rules:
- Unknown means needed, so a missing or stale plan gives today's allocation. This is the safe direction.
- Rep exactly equal to the requirement is met (`rep < repReq` is the test; there is no `<=`).
- `needMoney` is deliberately not "rep needed": rep is met, money is the gap (or rep is bought by donation, which is money).
- A `held` NeuroFlux step (`why` starts with `held`, set by the planner near the finish) never counts. This is the BN10 case.

### 2. `allocate()` gets one optional input: `repNeeded` (default `true`)
Behaviour change only when ALL hold (call this the xp-priority branch):
`repNeeded === false` and `hackNeed` and `repActive` and `shareEnabled` and `xpMode !== "off"` and `w x usable > 0`.

In that branch: `share = 0` (reason: `share 0: hack level is the bottleneck and no aug step needs faction rep (xp priority)`). Then the existing rules run unchanged: `money = min(usable, demand)`, the surplus goes to xp through the existing `hackNeed` branch (`surplus -> xp (hacking level is the constraint)`).

Every other input (no `repNeeded`, `repNeeded:true`, `hackNeed` false, `repActive` false, `shareEnabled` false, `xpMode:"off"`, `w x usable = 0`) takes the old code path and returns the old object byte for byte, reasons included.

Decision recorded here for review: **money keeps its claim at the weight-0 level (`min(usable, demand)`)** instead of xp taking everything.
- Why: `rammgr` preempts xp loops when `alloc.money` exceeds what is running, so a money bucket of 0 would starve new HGW waves as soon as xp loops fill the pool. That would cut income and also hack XP from the waves themselves.
- Cost: at BN10 scale (75M GB usable, demand about 140 TB) money takes under 0.3% of RAM. At small RAM where demand >= usable, xp gets 0 and money takes all, which is right because hacking is then RAM-bound.

### 3. Wiring (`lib/rammgr.js`, `daemon.js`) — no new Netscript calls
- `observe()` reads `data/aug-plan.txt` with `ns.read` (already used in the same function for `autopilot-status.txt`, so no new RAM-costing function) and calls `repNeededFrom`. The result is added to the returned ctx as `repNeeded`, `repNeededWhy`.
- `plan()` passes `repNeeded: ctx.repNeeded` to `allocate()`.
- The extra-target budget (`shareFirst`) is left exactly as it is today. The RAM share used to reserve is now the xp reserve, so the active target set (and money demand) does not grow when the branch fires.
- `daemon.js` adds `ctx.repNeededWhy` to the reasons list. The dashboard already prints `reasons`, so it shows why xp is winning, or why rep is still needed. `buildStatus` keys are unchanged (the dashboard contract test stays as it is).

### 4. Detector: check-in attention when xp is starved — `lib/ramwatch.js` (pure) + autopilot
Condition (from `data/ram-status.txt`): `enabled`, status fresh (< 10 min), `hackNeed`, `alloc.xp == 0`, `alloc.share > 0.9 x usableGb`, continuously for more than 60 min.

- `xpStarveCheck({sinceMs, statusRaw, now})` returns `{since, flag}`. `since` is the time the condition began (0 when it does not hold; a stale or missing status resets it). `flag` is a string once `now - since >= 60 min`, else `null`.
- `agent/autopilot.js` keeps `since` in a local variable (like `lastFlags`, `loopN`), reads the status with the `ns.read` it already uses, and calls `flags.push(flag)`. The flag then reaches the check-in attention list through the existing `st.flags` path (`checkin-lib.txt` `for (const f of st.flags)`); no check-in code changes.
- RAM: autopilot imports only `lib/ramwatch.js`, which must contain no RAM-costing identifier. It must NOT import `lib/ramplan.js`: that module (and its `share`) would add Netscript `share` RAM to autopilot. The status field `share` is read with bracket access on a string literal for the same reason. A static test enforces both.
- An autopilot restart restarts the 60 min clock (delays the flag, never creates a false one). With the fix in place the flag should not fire at all: `alloc.xp > 0` whenever the branch applies. It still fires when `xp.mode = off` leaves hack-bound RAM on share, or if the branch regresses.
- Known false positive: late phase (`w = 1`) with hack AND rep both outstanding gives `share ~ 100%`, `xp = 0`. The flag's text says to check `aug-plan` for a step that needs rep.

## RAM
- `game/lib/ramplan.js`: pure, no new identifiers that cost RAM. `game/lib/rammgr.js`: one more `ns.read` call of an already-used function. `game/daemon.js`: no new Netscript calls.
- `game/agent/autopilot.js`: no new Netscript function; new import `lib/ramwatch.js` is pure.
- Test: `test/ram-xp-static.js` compares the RAM-costing names reachable from `daemon.js` and `agent/autopilot.js` with `test/fixtures/ram-xp-static-baseline.json` (generated from main before the change) and asserts equality.

## Tests (every path)
`test/ramplan-xp-priority.js`:
- **Golden:** 648 input combinations (usable 0 / 1000 / 75M, weight 0 / 0.5 / 1, repActive, hackNeed, demand 0 / 200 / 1e8, xpMode, shareEnabled) compared as `JSON.stringify` with `test/fixtures/ramplan-allocate-golden.json`, generated from main's `allocate()` before the change. Checked with `repNeeded` omitted and `true` (all 648 identical), and with `repNeeded:false` for every case where the branch does not apply (identical), asserting that the branch cases differ.
- `hackNeed` true + rep met: xp gets the RAM (BN10 numbers: 75M GB, weight 1 -> `share 0`, `xp ~ 75M - demand`, sum = usable).
- `hackNeed` true + rep still needed: unchanged.
- `hackNeed` false: unchanged. `repActive` false: unchanged. Zero or invalid usable RAM: no branch, invariants hold. `xpMode:"off"`: no branch.
- Invariants over 1000 seeded random inputs including `repNeeded`.
- `repNeededFrom`: missing, garbage, stale, fresh+nothing needed, `needRep` step, held NeuroFlux `needRep`, Red Pill short / exactly met (boundary) / owned, `needMoney` and `blocked` steps.
- Daemon-level test (`test/daemon-ram.js` style fake game): BN10-like state (late phase, faction work, hack below `w0r1d_d43m0n`, plan with nothing needed) yields `ram-status.alloc.xp > 0`, `share = 0`, and the reason text; the same state with a `needRep` step yields today's allocation.
`test/ramwatch.js`: no flag before 60 min, flag at and after 60 min, reset when any condition breaks (xp > 0, share <= 90%, hackNeed false, status stale/missing/disabled/garbage), boundary at exactly 60 min and exactly 90%, and an autopilot-level test that the flag lands in `flags` (via the same pure call the loop makes).
`test/ram-xp-static.js`: RAM neutrality and no costly identifiers in `lib/ramwatch.js`.

## Rollout (needs the owner; this PR changes no live system)
1. Review and merge (never auto-merged by the agent). CI gates the Railway deploy.
2. Confirm the Railway deployment's commit includes the merge.
3. `bb push lib/ramplan.js lib/rammgr.js lib/ramwatch.js daemon.js agent/autopilot.js`.
4. `kill daemon.js; run daemon.js` (state is kept) and restart the autopilot.
5. Verify `bb read data/ram-status.txt`: `alloc.xp > 0`, `alloc.share == 0` while `hackNeed` is true and no aug step needs rep; `reasons` contains the xp-priority line. Then `bb note`.
6. Rollback: `bb push` the previous files, or `bb settings set ram.share.enabled=false` / `ram.manager.enabled=false` (existing switches).

## Non-goals
No settings or `node.order` changes, no live game writes, no `bb push` from this PR, no Railway changes, `.github/workflows` untouched.
