# AGENTS.md — read this first (any agent, any session)
Canonical copy: repo root (github.com/boycepoleonjr/bitburner). `bb push` mirrors it into the game as AGENTS.txt
(Bitburner only allows .txt/.js files).

## Vision
A fully autonomous Bitburner run that goes on around the clock with no human input. The owner (Boyce) only reads
check-in reports. The agent (Claude) supervises, improves the automation, and gets steadily better at predicting its own progress.

## Mission
Maximize long-run progress: money → augmentations → installs → destroy BitNodes, in the fewest wall-clock hours.
In-game scripts do the work. The agent keeps them healthy, fixes what breaks, and records every decision.

## Goals (current → next)
History: BN1 destroyed 2026-09-26 (SF1.1). BN4 destroyed 2026-10-03 01:39 UTC (SF4.1) → entered BN5.1
(reasoning in /data/agent-log.txt, 2026-10-03T01:39Z).
1. NOW: BN5 is finished (w0r1d_d43m0n ready since 2026-10-05). Ship the RAM manager, aug planner + node control and
   dashboard (docs/specs/), then destroy BN5. The next BitNode is the testing ground for all three; recommended next:
   BN1 → BN4 (docs/specs/aug-planner.md "Recommended BitNode order").
2. NEXT: in each fresh BitNode, agent/daemon-lite.js bootstraps until home reaches 2048GB (with SF4.1 the Singularity
   autopilot needs ~1TB outside BN4), then autopilot + daemon follow the aug plan (/data/aug-plan.txt): Daedalus →
   The Red Pill → hack w0r1d_d43m0n → destroy. Destruction and node choice are settings-driven (node.autoDestroy,
   node.autoSelect, node.order; both off by default = owner decides). Log the reasoning to /data/agent-log.txt.
3. ALWAYS: Predictions keep improving from data (predictor v2 self-calibrates). Zero lost progress (backups).
   Cheap, short check-ins.

## Owner's standing rules (do not break)
- Aug buying: highest rep requirement first, prerequisites first, NeuroFlux Governor LAST. Leftover cash goes to home RAM/cores.
- Faction favor ≥150 → donate for rep.
- Debt is OK early.
- Rep: faction hacking contracts, not the Algorithms course.
- Never: delete saves, change game options, touch real money / Steam / logins.
- BitNode destruction only via settings node.autoDestroy, after a save-backup ack and a node.destroyDelayMin veto
  window. Veto: `bb settings set node.autoDestroy=false`.
- Check-ins: frequent and driven by ETAs. Standard report (r.report verbatim) plus one "**Notes:**" line. Owner wants terse replies.

## What runs by itself (in-game; source of truth)
- agent/daemon-lite.js — small-home bootstrap (fresh BitNode): hack/grow/weaken over up to 15 targets on home + rooted +
  purchased servers. pserv-sing is reserved for its one-shot Singularity scripts (agent/sl-*.js: TOR, programs, home
  RAM/cores, faction joins + work); nothing else may run there. Status: /data/daemon-lite-status.txt.
- agent/autopilot.js — Singularity autopilot. Buys programs, RAM and cores; installs backdoors; joins factions;
  does faction work (factionPriority); donates; auto-installs (Red Pill / ≥6 buyable / stalled)
  → runs agent/post-install.js. Config: /data/autopilot-config.txt
- daemon.js --reset — hacking + RAM manager (settings ram.*, strategy.*): grows the target set with RAM, fills spare RAM
  with persistent share/xp loops by the phase's money↔rep strategy weight, buys cloud servers (lib/cloud.js). Status:
  /data/ram-status.txt. Rollback: `bb settings set ram.manager.enabled=false`. Legacy config: /data/config-overrides.txt
  (settings win). agent/share-keeper.js is retired. (+ lib/hooks.js hacknet ROI gate.)
- agent/sl-plan.js — aug path planner (lib/augplan.js), started by the autopilot: /data/aug-plan.txt (GET /api/plan),
  /data/daedalus-req.txt. agent/sl-destroy.js is the ONLY script that destroys a BitNode; server/node-control.js does the
  save-backup handshake (/data/node-request.txt → backup → /data/node-ack.txt).
- dashboard.js — in-game React dashboard (owner-facing; `run dashboard.js`). Reads only small files
  (data/telemetry-latest.txt, data/telemetry-ring.txt written by agent/telemetry.js, ram-status, aug-plan,
  autopilot-status, settings). Agents get the same KPIs from `bb dashboard` / GET /api/dashboard (game/lib/kpi.js).
- agent/telemetry.js — 60s JSONL → /data/telemetry.txt
- agent/predictor.txt (window.__pred2) — walk-forward-calibrated ETA predictions → /data/pred2.txt, /data/pred-calib.txt
- agent/checkin-lib.txt — __checkin(): heartbeats, backups (hourly in-browser IndexedDB + hourly server-side to the
  Railway /data volume), predictions, attention list, formatted report, nextMin.

Backups by runtime (the MySaves folder export was retired 2026-09-29):
| Runtime | IndexedDB (in-browser) | Server-side | MySaves export |
|---|---|---|---|
| Railway hosted | yes | /data/backups (hourly) | removed |
| Local browser / Steam | yes (browser build) | only with a local bb server + BB_BACKUP_DIR | removed |

## Settings (one schema, every surface)

Every owner/agent-tunable knob is a key in game/lib/settings-schema.js with a default, stored as overrides in /data/settings.txt (changes logged to /data/settings-log.txt). Change them with `bb settings set key=value` (or POST /api/settings), the in-game dashboard, or writeSettings() in-game. Never edit the file by hand. Owner defaults: node.autoSelect=false, node.autoDestroy=false, strategy early/mid/late = 0 / 0.5 / 1 (money -> faction rep). Spec: docs/specs/settings.md.

## Logs (read before changing anything)
- /data/audit.txt (autopilot decisions)
- /data/events.txt (actions)
- /data/install-log.txt (one line per install)
- /data/agent-log.txt (agent notes: write with bb.note)
- /data/settings-log.txt (every settings change, who made it)
- /data/ram-status.txt (RAM manager, each daemon loop)
- /data/aug-plan.txt, /data/node-request.txt, /data/node-ack.txt, state/node-control.json (planner + destroy handshake)
- /data/telemetry-latest.txt, /data/telemetry-ring.txt (small telemetry views; telemetry.txt is ~20MB, don't poll it)

## Deeper reference
agent/PLAYBOOK.txt — procedures and lessons. NOTE: its opening section predates BN4. Singularity (SF4) IS available now,
so the autopilot handles purchases and installs. Where they conflict, trust the newer sections (HARDENING, AUTO-INSTALL,
PREDICTOR v2, SPEND PLAN, CHECK-IN REPORT FORMAT).

## Control paths (pick whichever is available)
0. HOSTED (current, since 2026-09-28): the game runs 24/7 in Chromium on Railway (project bitburner, service game,
   Dockerfile + deploy/). GUI (noVNC, basic auth): https://game-production-0b2d.up.railway.app. API: same host /api,
   Bearer BB_TOKEN. CLI: `BB_URL=https://game-production-0b2d.up.railway.app BB_TOKEN=... npx bb status|checkin|...`.
   In a cloud environment whose proxy injects BB_TOKEN, use BB_TOKEN_VIA_PROXY=1 instead of BB_TOKEN (Node >= 22.21).
   Check-ins run INSIDE the container (server/checkin.js, Railway var BB_CHECKIN_AUTO=1): __checkin() on its own
   nextMin cadence → cached in /data/state → posted to Discord (DISCORD_WEBHOOK_URL). Read the cache any time with
   `bb report` (GET /api/report; instant, no game call). `bb checkin` still forces a fresh one.
   Escalation: only for NEW attention (or the same attention still open after 2h), the container fires the claude.ai
   routine "Bitburner escalation (hosted)" via its API trigger (BB_ESCALATE_ROUTINE_ID + BB_ESCALATE_TOKEN). That routine
   has the Railway connector for diagnosis and posts its summary back via POST /api/notify.
   Test the whole path on demand: POST /api/escalate-test (auth) fires the routine with a "[TEST]" message.
   Watchdog (BB_WATCHDOG_MIN=10): if game/rpc is down or the rpc ping fails for 10 min it restarts Chromium (max 2
   attempts per outage), then escalates once and only probes until recovery. /healthz = bb server liveness (no auth).
   Rollback: set BB_CHECKIN_AUTO=0 and BB_WATCHDOG_MIN=0, re-enable the old routine "Bitburner hourly check-in (hosted)".
   Never delete /data/state, /data/backups or the volume.
   Save backups: hourly, server-side, to the /data volume. Load a save: `bb import-save <save.json.gz>`.
   Only one game instance at a time: don't open the game in a local browser while the hosted one runs.
A. HEADLESS (preferred, no browser needed; works with the browser build AND Steam):
   The owner's machine runs `npm start` (server/). The game connects to it via Remote API, and agent/rpc.js connects back.
   Agents use the CLI on that machine: `npx bb status|checkin|eval|js|read|write|note|pull|push|backup`.
   A cloud agent reaches it through the owner's linked computer (device shell) at 127.0.0.1:12525.
B. CLAUDE IN CHROME (legacy fallback): the javascript tool in the Bitburner tab, window.bb (agent/bridge-lite.js).
   `bb js` (A) runs the same page-context code as B, so checkin-lib works unchanged on both.

## How to work on code
The repo is canonical. `game/` mirrors the in-game home server.
1. `bb pull` (game → repo) before editing, in case the game changed.
2. Edit in the repo and commit.
3. `bb push [files]` (repo → game; never touches data/).
4. Restart the script in-game, then `bb note` what changed. (daemon: `kill daemon.js; run daemon.js`, state is kept.)
5. `npm test` must stay green; new test/*.js files are picked up by test/run-all.js. test/helpers/game-import.js lets
   Node import in-game modules. Write the spec in docs/specs/ first (Boyce's pre-execution plan improvement: plan →
   Perplexity "Improve this plan for oneshot execution" → review → execute).
6. In anything an in-game script imports, never reference window/document, and avoid identifiers named like Netscript
   functions (share, hack, exec, run, rm, scan, …): Bitburner's static RAM check charges for them.
Without the server: edit a scratch copy in your workspace and write it back with bb.write (path B), then commit it later.

## HANDOFF — starting in a new agent/session
Needs path A (bb server reachable) or path B (Claude in Chrome + Bitburner tab). Scheduled fresh cloud sessions have
neither unless linked to the owner's computer.
1. Path A: `npx bb status` should show game:true and rpc:true. If rpc is false, run `run agent/rpc.js` in the game terminal
   (see docs/STEAM.md). Path B: find the tab; if window.bb is missing, run agent/bridge-lite.js from the game terminal.
2. Read this file and the tail of /data/agent-log.txt (`bb read data/agent-log.txt`).
3. Check-in: `npx bb checkin` (A) or eval(bb.read('agent/checkin-lib.txt')); await __checkin() (B).
   Handle r.attention, then reply with r.report plus a Notes line.
4. HOSTED (path 0): do NOT start a send_later loop. The container schedules check-ins itself and escalates to the
   escalation routine; just read `bb report` and act on what the escalation hands you.
   Otherwise, start the loop: schedule the next check-in into THIS session (send_later, delay = r.nextMin) with the prompt below.
   Old check-ins scheduled into a previous session keep firing there. Delete them (list_triggers → delete_trigger)
   so two agents don't both act.

CHECK-IN PROMPT (verbatim; path B wording. For path A, swap the javascript call for `npx bb checkin` in the repo dir):
[Bitburner check-in v4 — unattended, don't ask questions] In the Bitburner Chrome tab (bitburner-official.github.io): if window.bb is missing, open Terminal, define __run, and `run agent/bridge-lite.js`. Then run in one javascript call: eval(bb.read('agent/checkin-lib.txt')); JSON.stringify(await __checkin()). If r.attention is non-empty: read agent/PLAYBOOK.txt (CHECK-IN v3 + AUTO-INSTALL sections + relevant rules), handle each item and bb.note what you did. Then schedule the next check-in with send_later delay_minutes = r.nextMin (this same message, initiation human_schedule). REPLY FORMAT (always): paste r.report verbatim, then one final line "**Notes:** ..." with only what the table doesn't show (actions you took, anomalies, anything the user must do, r.warn) or "**Notes:** —". If the Bitburner tab or Chrome is unreachable: schedule the next one in 30 minutes and reply "**Bitburner check-in · <time> ET** — Status: DOWN (Chrome unreachable, retry <time> ET)" plus a Notes line.

SHORT HANDOFF PROMPT (paste into a new agent):
"Take over my Bitburner agent. Read AGENTS.md in github.com/boycepoleonjr/bitburner (or AGENTS.txt on the game's home
server) and follow its HANDOFF section."
