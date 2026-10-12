# Spec: settings system

Status: implemented in this PR. Consumers: RAM manager, aug planner / node control, dashboard (follow-up PRs).

## Problem
Tunables are spread across `lib/config.js` DEFAULTS + `data/config-overrides.txt` (daemon), `data/autopilot-config.txt` (autopilot), and constants in scripts. None of it is discoverable, validated, or changeable from one place. The owner and agents need every sensible knob to have a default and be adjustable live from the in-game dashboard and the server API.

## Design
- **One schema:** `game/lib/settings-schema.js`. Pure data plus pure functions, with no `ns` and no imports. The game, the bb server, the CLI and the tests all import the same file, so validation is identical everywhere.
- **One store:** `data/settings.txt` in-game:
  `{"version":1,"rev":N,"updatedAt":ms,"updatedBy":"ui|api|cli|agent","values":{...}}`.
  - `values` holds explicit overrides only. Everything else follows the schema default.
  - Setting a key to its default pins it.
  - `unset` returns the key to "follow default".
- **Audit:** every effective change appends one JSONL line to `data/settings-log.txt`: `{t, rev, by, changed:[{key,from,to}]}`.
- **Validation:** strings are coerced (for the CLI and forms). Out-of-range values are rejected, never clamped. Patches are all-or-nothing. If a stored value goes invalid after a schema change, it is ignored with a warning and the default is used.
- **Concurrency:**
  - Every write bumps `rev`. API callers may pass `rev` and get 409 on mismatch.
  - In-game writes (`lib/settings.js`) read-modify-write with no `await` in between, so they are atomic within a tick.
  - A corrupt file is never overwritten automatically (409, or `ok:false` in-game).

## Field metadata
`key`, `group`, `type` (`bool|number|int|enum|string|intList`), `default`, `min`/`max`/`step`, `options`, `ends` (slider end labels), `label`, `help`, `ui` (`toggle|slider|number|select|text|list`), `owner` (the script that reads it). The dashboard renders its settings pane from this metadata alone.

## Initial keys (owner-mandated defaults in bold)
| Group | Keys |
|---|---|
| BitNode | **node.autoSelect=false**, **node.autoDestroy=false**, node.backupBeforeDestroy=true, node.order=[] |
| Strategy (0 = money, 1 = faction rep) | **strategy.early=0** (o--), **strategy.mid=0.5** (-o-), **strategy.late=1** (--o), strategy.phase.midAt=0.34, strategy.phase.lateAt=0.9 (phase = fl1ght.exe progress) |
| RAM | ram.manager.enabled, ram.homeReserveGb=128, ram.cloud.*, ram.share.enabled, ram.xp.mode=auto, ram.xp.target, ram.targets.max=0, ram.batches.max=0, ram.resizeThreshold=0.1 |
| Augmentations | augs.autoInstall, augs.installPolicy=eta, augs.installAt=6, augs.planner.goal=destroy, augs.donateAtFavor=150, augs.neuroFluxLast=true |
| Dashboard | ui.refreshMs=1000, ui.historyMinutes=360 |

Adding a setting means adding one schema entry (the test suite checks its metadata and default) and reading it with `readSettings(ns)[key]` in the owning script.

## Interfaces
- **Game:** `import { readSettings, writeSettings } from "lib/settings.js"`. `readSettings(ns)` returns flat effective values plus `_rev`, `_warnings`, `_overrides`, cached by file content (0 GB RAM).
- **HTTP:** `GET /api/settings` returns `{rev, updatedAt, updatedBy, values, overrides, warnings, schema, groups}`. `POST /api/settings` takes `{set?, unset?, rev?, actor?}` and returns the same plus `changed`. Errors: 400 invalid, 409 stale rev or corrupt file, 502 game unreachable.
- **CLI:** `bb settings` lists every key (`*` = overridden). Also `bb settings get <key>`, `bb settings set k=v [k=v...]`, `bb settings unset k [...]`, `bb settings schema`.

## Migration
Legacy override files keep working. Each consumer PR maps its keys: settings win over legacy for the same concept, and legacy files remain for keys that have no setting yet.

## Tests
`test/settings.js` covers schema integrity, owner defaults, coercion and rejection, parse warnings, atomic patches, rev/409, unset, round-trip, the in-game lib with a fake ns, the server API with a fake rpc, and the CLI formatting. `test/smoke.js` covers the real server, the CLI `settings set/get`, 400 on invalid input, and the log line.
`test/helpers/game-import.js` lets Node import in-game modules such as `lib/settings.js` (it maps Bitburner's `lib/...` import paths to `game/`). Follow-up PRs reuse it for daemon and autopilot tests.
