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
1. NOW: BN4.1. Finish the NiteSec → BitRunners → The Black Hand aug sets. Grow hacking and home RAM/cores.
2. NEXT: Daedalus → The Red Pill → hack w0r1d_d43m0n → destroy BN4. The agent picks the next BitNode
   (log the reasoning to /data/agent-log.txt).
3. ALWAYS: Predictions keep improving from data (predictor v2 self-calibrates). Zero lost progress (backups).
   Cheap, short check-ins.

## Owner's standing rules (do not break)
- Aug buying: highest rep requirement first, prerequisites first, NeuroFlux Governor LAST. Leftover cash goes to home RAM/cores.
- Faction favor ≥150 → donate for rep.
- Debt is OK early.
- Rep: faction hacking contracts, not the Algorithms course.
- Never: delete saves, change game options, touch real money / Steam / logins.
- Check-ins: frequent and driven by ETAs. Standard report (r.report verbatim) plus one "**Notes:**" line. Owner wants terse replies.

## What runs by itself (in-game; source of truth)
- agent/autopilot.js — Singularity autopilot. Buys programs, RAM and cores; installs backdoors; joins factions;
  does faction work (factionPriority); donates; auto-installs (Red Pill / ≥6 buyable / stalled)
  → runs agent/post-install.js. Config: /data/autopilot-config.txt
- daemon.js --reset (+ lib/hooks.js hacknet ROI gate). Config: /data/config-overrides.txt
- agent/telemetry.js — 60s JSONL → /data/telemetry.txt
- agent/predictor.txt (window.__pred2) — walk-forward-calibrated ETA predictions → /data/pred2.txt, /data/pred-calib.txt
- agent/checkin-lib.txt — __checkin(): heartbeats, backups (hourly IndexedDB + 6h export to the owner's MySaves folder),
  predictions, attention list, formatted report, nextMin.

## Logs (read before changing anything)
- /data/audit.txt (autopilot decisions)
- /data/events.txt (actions)
- /data/install-log.txt (one line per install)
- /data/agent-log.txt (agent notes: write with bb.note)

## Deeper reference
agent/PLAYBOOK.txt — procedures and lessons. NOTE: its opening section predates BN4. Singularity (SF4) IS available now,
so the autopilot handles purchases and installs. Where they conflict, trust the newer sections (HARDENING, AUTO-INSTALL,
PREDICTOR v2, SPEND PLAN, CHECK-IN REPORT FORMAT).

## Control paths (pick whichever is available)
0. HOSTED (current, since 2026-09-28): the game runs 24/7 in Chromium on Railway (project bitburner, service game,
   Dockerfile + deploy/). GUI (noVNC, basic auth): https://game-production-0b2d.up.railway.app. API: same host /api,
   Bearer BB_TOKEN. CLI: `BB_URL=https://game-production-0b2d.up.railway.app BB_TOKEN=... npx bb status|checkin|...`.
   Check-ins: claude.ai routine "Bitburner hourly check-in (hosted)" (needs BB_TOKEN in its cloud environment).
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
4. Restart the script in-game, then `bb note` what changed.
Without the server: edit a scratch copy in your workspace and write it back with bb.write (path B), then commit it later.

## HANDOFF — starting in a new agent/session
Needs path A (bb server reachable) or path B (Claude in Chrome + Bitburner tab). Scheduled fresh cloud sessions have
neither unless linked to the owner's computer.
1. Path A: `npx bb status` should show game:true and rpc:true. If rpc is false, run `run agent/rpc.js` in the game terminal
   (see docs/STEAM.md). Path B: find the tab; if window.bb is missing, run agent/bridge-lite.js from the game terminal.
2. Read this file and the tail of /data/agent-log.txt (`bb read data/agent-log.txt`).
3. Check-in: `npx bb checkin` (A) or eval(bb.read('agent/checkin-lib.txt')); await __checkin() (B).
   Handle r.attention, then reply with r.report plus a Notes line.
4. Start the loop: schedule the next check-in into THIS session (send_later, delay = r.nextMin) with the prompt below.
   Old check-ins scheduled into a previous session keep firing there. Delete them (list_triggers → delete_trigger)
   so two agents don't both act.

CHECK-IN PROMPT (verbatim; path B wording. For path A, swap the javascript call for `npx bb checkin` in the repo dir):
[Bitburner check-in v4 — unattended, don't ask questions] In the Bitburner Chrome tab (bitburner-official.github.io): if window.bb is missing, open Terminal, define __run, and `run agent/bridge-lite.js`. Then run in one javascript call: eval(bb.read('agent/checkin-lib.txt')); JSON.stringify(await __checkin()). If r.attention is non-empty: read agent/PLAYBOOK.txt (CHECK-IN v3 + AUTO-INSTALL sections + relevant rules), handle each item and bb.note what you did. Then schedule the next check-in with send_later delay_minutes = r.nextMin (this same message, initiation human_schedule). REPLY FORMAT (always): paste r.report verbatim, then one final line "**Notes:** ..." with only what the table doesn't show (actions you took, anomalies, anything the user must do, r.warn) or "**Notes:** —". If the Bitburner tab or Chrome is unreachable: schedule the next one in 30 minutes and reply "**Bitburner check-in · <time> ET** — Status: DOWN (Chrome unreachable, retry <time> ET)" plus a Notes line.

SHORT HANDOFF PROMPT (paste into a new agent):
"Take over my Bitburner agent. Read AGENTS.md in github.com/boycepoleonjr/bitburner (or AGENTS.txt on the game's home
server) and follow its HANDOFF section."
