# Spec: augmentation path planner + BitNode auto-select / auto-destroy

Status: implemented in this PR. Depends on: settings (`lib/settings-schema.js`, `lib/settings.js`) and `lib/progress.js`.
Consumers: autopilot (install timing, node control), dashboard PR (reads `data/aug-plan.txt`), agents (`GET /api/plan`).

## Problem
1. **BN5 idled about 72 h at the finish.** Hacking passed w0r1d_d43m0n's requirement (4,500 = 3,000 x WorldDaemonDifficulty 1.5) on 2026-10-05. The autopilot only raised `w0r1d_d43m0n READY — agent decides BitNode destruction`. server/checkin.js treats that as an owner decision, so it is never escalated, and nothing happened.
2. **No mapped augmentation path.** The autopilot buys whatever is rep-met. Nothing shows the shortest path to Daedalus, then The Red Pill, then the w0r1d_d43m0n hacking level. Install timing is a fixed rule: 6 buyable.
3. **Why it is not donating for NeuroFlux right now.** Every non-NeuroFlux aug is owned. NeuroFlux needs 797m rep at The Black Hand (388m owned, favor 551, donation unlocks at 150). Donations still don't happen, for two reasons:
   - Section 7 (work-faction donations) computes its rep gap over non-NeuroFlux augs only. That gap is now 0 or less.
   - NeuroFlux donations only happen inside `buyBatch`, which only runs on an install trigger. `nfgHold` (hack >= 90% of w0r1d_d43m0n's requirement) deliberately suppresses the NeuroFlux trigger, because an install resets hacking and would throw away the finish.

   This is correct behaviour: the right move at that point is to destroy the BitNode, not to buy NeuroFlux. This PR keeps `nfgHold` but makes it settings-aware (`augs.nfgHoldFrac`, default 0.9). The planner now lists NeuroFlux with `why: "held: w0r1d_d43m0n is ready ..."`, so the dashboard shows the reason.

## Design

### Planner: `game/lib/augplan.js` (pure, no ns)
`plan(snapshot, settings)` returns the `data/aug-plan.txt` object.

**Candidates.** Augs sold by joined or invitable factions; owned and queued augs are excluded. Each aug's source is the joined faction with the most rep.

**Goal `destroy` (default).** Three groups, in this order:
1. The fastest augs that fill the Daedalus count (`DaedalusAugsRequirement - installed - queued`). "Fastest" is a time-cost estimate (see the ETA rule below); hacking value breaks ties.
2. The Red Pill. If Daedalus has not invited us yet, it is listed as `blocked` with the missing requirements.
3. If hacking is below w0r1d_d43m0n's requirement: every obtainable hacking-mult aug, ranked by hacking score per minute.

**Goal `complete`.** Every purchasable aug.

**Owner rules (always).**
- Prerequisites go immediately before the aug that needs them; otherwise the highest rep requirement comes first. This is the same algorithm as `buyBatch`.
- The purchase sequence is simulated with the x1.9 price ramp per purchase.
- NeuroFlux is always the final step.
- Donation threshold = `max(ns.getFavorToDonate(), augs.donateAtFavor)`. The setting can only raise the game's threshold.
- Rep per $ donated is the measured rate when known, else `faction_rep / 1e6`.

**Statuses.** `owned | queued | buyable | needRep | needMoney | blocked`.

**ETA rule (`etaMin`).**
- A buyable step is 0.
- A rep gap with no donation available is `gap / repRate`. Rep rates are measured per faction between `sl-plan` runs.
- With donation available, a rep gap becomes money. A money gap is `gap / income`, where income is `ns.getTotalScriptIncome()[0]`.
- Unknown is `null`, never Infinity.

**Install timing** (`installDecision`). `install.next.etaMin === 0` means install now.

| Situation | Result |
|---|---|
| w0r1d_d43m0n ready | hold (`etaMin: null`; destroy instead) |
| The Red Pill buyable or queued | install now |
| Only NeuroFlux left and hack >= `augs.nfgHoldFrac` x requirement | hold |
| `count`: buyable + queued >= `augs.installAt`, or nothing else coming | install now |
| `eta` (default): buyable + queued >= `augs.installAt` and the next aug is further away than the recovery time (or unknown) | install now |
| `eta`: batch is ready but the next aug arrives within the recovery time | wait for it |
| `eta`: nothing else coming | install now |

Recovery time (heuristic, `agent/sl-plan.js recoveryMinutes`): 25% of the median install cycle over the last 5 entries of `data/install-log.txt`, clamped to 15..240 min, 60 when there is no history. Moving this to the predictor is a follow-up.

**Next BitNode recommendation** (`recommendNextBn`). The first entry of `DEFAULT_BN_ORDER` whose Source-File is not maxed *after* this destroy (the current BN's SF goes up by one). SF caps at 3, except BN12, which has no cap.

### Snapshot: `game/agent/sl-plan.js` (one-shot)
All the 16x-RAM Singularity aug calls live here, not in the autopilot, so the autopilot's static RAM is unchanged. The autopilot starts it every 4th loop (about 2 min) when home has room.

It writes `data/aug-plan.txt`. It also writes `data/aug-plan-state.txt` (previous rep values, used for the rep rates). It is read-only: it buys and joins nothing.

### Node control: `game/lib/nodectl.js` (pure) + autopilot + `game/agent/sl-destroy.js` + `server/node-control.js`

| Condition | Result |
|---|---|
| Not ready | nothing (an open request is cancelled) |
| Ready, `node.autoDestroy=false` (default) | the exact READY flag, as before, plus a recommendation in `plan.node` |
| Ready, autoDestroy on, `node.autoSelect=false` (default) | READY flag only; the owner picks the BitNode |
| Ready, autoDestroy on, autoSelect on | next BN = first available in `node.order`, else the recommendation; write request |
| Request open, no ack | wait; after 15 min `blocked`, attention `destroy blocked: no backup ack` (this escalates; a late ack still unblocks) |
| Ack with `backupOk:false` | `blocked`, attention `destroy blocked: backup failed (...)`; new request (new id) after 15 min |
| Ack ok | wait `node.destroyDelayMin` (default 10: the veto window), then run `agent/sl-destroy.js id nextBn` (attention `NO_RAM` if it can't start) |
| autoDestroy, autoSelect or readiness turns off while a request is open | `{action:"cancel"}` written; nothing destroyed |
| `node.backupBeforeDestroy=false` | no ack needed; the veto window still applies |

`sl-destroy.js` is the only caller of `ns.singularity.destroyW0r1dD43m0n(nextBn, "agent/post-install.js")`. That signature was checked in the bitburner-src dev `NetscriptDefinitions.d.ts`: `nextBN?`, `callbackScript?`, `bitNodeOptions?`; 32 GB x16 outside BN4. Right before calling it, the script re-reads settings, the request and the ack (`destroyGate`) and aborts on any mismatch, so a late veto always wins. Every decision is written to `data/audit.txt` (`kind: node|destroy`), `data/events.txt` and `data/agent-log.txt`.

**Server side.** `server/node-control.js` polls `data/node-request.txt` every 60 s (`BB_NODE_POLL_MS`) while rpc is up:
- For a new destroy id, it runs the existing `backup()` and writes `data/node-ack.txt` `{id, backupOk, key, bytes|error, at}`.
- Acks are persisted per id in `state/node-control.json`. A repeated id gets the same ack and no second backup; a lost ack file is rewritten.
- Cancels are recorded only.
- The server never destroys anything, and there is deliberately **no destroy endpoint**: settings are the only control.
- `GET /api/plan` returns the parsed plan (503 until the first `sl-plan` run).

**Settings added** (node/augs groups only):
- `node.destroyDelayMin=10`: veto window.
- `augs.nfgHoldFrac=0.9`: was `autopilot-config.nfgHoldFrac`.

**Autopilot settings mapping** (`withSettings`; settings win over `autopilot-config.txt`): `augs.autoInstall`, `augs.installAt`, `augs.donateAtFavor`, `augs.nfgHoldFrac` and `augs.installPolicy`.

**`eta` in the autopilot** (`etaGate`):
- A count trigger is held while the plan says the next aug is closer than the recovery time.
- A plan "install now" with 1 or more buyable fires on its own.
- The Red Pill, NeuroFlux and stall triggers are unchanged.
- A missing or stale plan (older than 5 min) falls back to count behaviour.

## Data contract: `data/aug-plan.txt` (dashboard depends on this exact shape)
```json
{"t":ms,"bn":n,"goal":"destroy|complete","phase":"early|mid|late","progress":0..1,
 "daedalus":{"augsReq":n,"augsInstalled":n,"moneyReq":n,"hackReq":n,"met":bool},
 "redPill":{"owned":bool,"repReq":n,"rep":n},
 "worldDaemon":{"req":n,"hack":n,"ready":bool},
 "steps":[{"order":n,"aug":s,"faction":s,"repReq":n,"price":n,"prereqs":[s],"status":"owned|queued|buyable|needRep|needMoney|blocked","etaMin":n|null,"why":s}],
 "install":{"policy":"eta|count","queued":n,"next":{"etaMin":n|null,"reason":s}},
 "node":{"ready":bool,"autoSelect":bool,"autoDestroy":bool,"recommended":{"bn":n|null,"why":s},
         "pending":{"id":s,"stage":"none|requested|acked|destroying|blocked","detail":s}}}
```
Notes:
- `install.next.etaMin`: 0 = install now, `null` = hold or unknown, otherwise at least 0.1.
- Step `etaMin` is 0 only when `buyable`.
- `price` is the simulated price at that point in the purchase sequence.
- The dashboard should treat a step whose `why` starts with `held:` as held. NeuroFlux is the only such step.
- `stage: "acked"` = backup confirmed and inside the veto window. `"destroying"` = `sl-destroy.js` started.
- `test/augplan.js` pins the contract.

## Recommended BitNode order (default `DEFAULT_BN_ORDER`)
We own SF1.1 and SF4.1, and SF5.1 on destroying BN5. "First available" skips maxed Source-Files. `node.order` holds unique entries, so a BN repeats until its SF reaches 3.

**`1, 4, 2, 5, 10, 9, 3, 11, 12, 6, 7, 8, 13, 14`**

1. **BN1 (to SF1.3).** The fastest node, with no penalties. Each SF1 level raises every multiplier, which shortens every later run. Our hacking-only automation finishes it as is.
2. **BN4 (to SF4.3).** SF4.2 and 4.3 cut Singularity RAM from 16x to 4x to 1x. That removes the 1 TB autopilot bootstrap wall that forced `daemon-lite` in BN5, and the 512 GB destroy script. This is the biggest saving for this automation across all later nodes. Hacking-only automation handled BN4 before.
3. **BN2 (gangs).** A gang faction sells almost every aug with nearly unlimited rep. This is the strongest aug-path accelerator, **but it needs gang automation first** (not in the repo). Don't let `node.autoSelect` reach it before that exists. Put `node.order` ahead of it, or keep autoSelect off.
4. **BN5 (to SF5.3).** Hacking and intelligence multipliers; hacking-friendly.
5. **Then BN10** (sleeves), **BN9** (hacknet servers), **BN3** (corporations), **BN11/12**. **BN6/7/8/13/14** need Bladeburner, stock or Stanek automation; these are non-goals for now.

For the next run (BN5 to BN1), set `node.order=[1,4]`, `node.autoSelect=true`, `node.autoDestroy=true`. The current BN5 recommendation is BN1 (SF1.1 to 1.2).

## Plan improvement log (pre-execution-plan-improvement skill)
- **Round 1:** plan v1 (`tmp/plan-aug-v1.md`) went to Perplexity with "Improve this plan for oneshot execution". Thread: https://www.perplexity.ai/computer/tasks/8540963e-d19e-4866-a867-8415ec7ed402 (Computer mode, Plan v2 document).
- **Accepted:**
  - RAM isolation. Destroy and the 16x aug calls go into one-shot scripts (`sl-plan.js`, `sl-destroy.js`); the autopilot's static RAM is unchanged.
  - A veto window (`node.destroyDelayMin`) plus a settings re-check right before destroy (`destroyGate`).
  - A cancel request when autoDestroy flips off.
  - `NO_RAM` attention.
  - Donation threshold = `max(getFavorToDonate, setting)`.
  - Unknown ETAs are `null`, never Infinity.
  - Server ack idempotency persisted in the state dir.
  - `/api/plan` 503 when no plan exists.
  - `augs.nfgHoldFrac` setting.
  - A BN order that leads with BN1 and BN4 and skips maxed Source-Files.
- **Rejected:**
  - Making `count` the default install policy. The settings PR already set `eta`, and the next BitNode is the agreed testing ground. Flip `augs.installPolicy=count` to roll back.
  - Using `node.order` even when `autoSelect=false`. The owner asked that autoSelect off means recommend only.
  - Adding `schemaVersion` to `aug-plan.txt`. The contract is fixed by the dashboard PR.
  - Deterministic request ids from `lastNodeReset`. The request file already survives restarts; ids include the time so a retry gets a new id.
  - Adding new attention strings to `OWNER_DECISION`. A blocked destroy should escalate.
  - A separate snapshot-schema module. The fixture test covers it.
- No second round: v2 left no open ambiguity against the code.

## Tests
- **`test/augplan.js`** (real read-only BN5 fixture `test/fixtures/bn5-snapshot.json`: 31 factions, 99 augs, BN multipliers; plus a synthesized fresh-BN variant). Covers:
  - the contract shape
  - the BN5 state: NeuroFlux held, ready, recommends BN1
  - prerequisite and highest-rep ordering, and NeuroFlux last
  - destroy vs complete, and Red Pill blocked until the Daedalus invite
  - the Daedalus filler count and hacking preference
  - statuses and the x1.9 ramp
  - the donation threshold and donation path
  - count vs eta install timing
  - Source-File availability
  - an empty snapshot
- **`test/node-control.js`.** Covers:
  - the state machine: no request with autoDestroy off, no destroy without an ack, the veto window, timeout to blocked to late-ack unblock, backup failure and retry, cancel on veto, nextBn change, backupBeforeDestroy off
  - autoSelect order and fallback
  - `destroyGate`
  - the server module with a fake rpc and fake backup: idempotent ack, lost-ack rewrite, failure ack, cancel, garbage, rpc down
  - `/api/plan`
  - the autopilot `withSettings` and `etaGate`
  - the recovery heuristic
  - that checkin's `OWNER_DECISION` still matches `READY_FLAG` and not the blocked attention
- **`test/unit.js`:** the READY-flag pin now reads `READY_FLAG` from `lib/augplan.js`. **`test/autopilot-city.js` and `test/rpc-keepalive.js`:** load the game-import helper (the autopilot now imports `lib/settings.js`).

## AGENTS.md changes (for the merge; not edited in this PR)
- **Goals / NOW:** destroying is settings-driven. With `node.autoDestroy=true` and `node.autoSelect=true`, the autopilot backs up and destroys on its own. Otherwise READY stays an owner decision.
- **What runs by itself:** add `agent/sl-plan.js` (aug plan, `/data/aug-plan.txt`, `GET /api/plan`), `agent/sl-destroy.js` (the only destroyer) and `server/node-control.js` (backup ack).
- **Owner's standing rules:** add "BitNode destruction only via settings `node.autoDestroy`, after a backup ack and a `node.destroyDelayMin` veto window; to veto, `bb settings set node.autoDestroy=false`."
- **Logs:** add `/data/aug-plan.txt`, `/data/node-request.txt`, `/data/node-ack.txt`, `state/node-control.json`.
- **PLAYBOOK pointer:** "Why no NeuroFlux donations at the finish" (Problem 3 above).
