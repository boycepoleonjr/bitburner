# Spec: in-game React dashboard

Status: implemented in this PR. Depends on: settings system (`lib/settings-schema.js`, `lib/settings.js`). Reads (if present) the RAM manager's `data/ram-status.txt` and the aug planner's `data/aug-plan.txt`, and shows a clear empty state until those PRs land.

`run dashboard.js` opens a tail window with:
- a persistent sidebar: Overview, RAM, Augmentations, Node, Predictions, Logs, Raw data, Settings
- a main workspace where selecting a record opens its details alongside the list
- every KPI traced to the raw file fields it comes from
- every setting editable from the schema, with inline validation errors

`bb dashboard` (`GET /api/dashboard`) returns the same KPIs to agents, computed by the same pure function.

## Owner requirements checklist

Every requirement is quoted verbatim and maps to an implementation and a test (test names are in `test/dashboard.js` unless noted).

| Requirement | How it is met | Verified by |
|---|---|---|
| "Use a persistent sidebar and a main workspace." | `Shell` renders `Sidebar` (`data-role=sidebar`) and `main` (`data-role=workspace`) for every view. The selected item gets an accent left bar. | "every view: persistent sidebar + workspace…" |
| "Selecting a record opens its details alongside the list." | `Split` puts the list and the `Detail` side by side. Rows, KPI tiles, targets, aug steps, predictions, log lines, raw files and settings are all selectable. Esc or ✕ closes the detail. | "selecting a record opens its detail alongside the list (and only then)" |
| "Make the page title and primary action dominant; make metadata visually secondary." | `Header`: one `h1` (18/600) and at most one `Button kind=primary` (the accent fill). Metadata uses `TYPE.meta` (11, label colour). | "…one dominant h1, at most one primary action, in the header" |
| "Use compact spacing within data groups and generous spacing between sections." | Inside groups: `SPACE.xs`/`sm` (4/8). Between sections: `Section` marginBottom `SPACE.xl` (24). Header-to-content gap is 24. Workspace padding is 24. | design-token test |
| "Use a consistent spacing scale instead of arbitrary margins." | `tokens.SPACE` = 0/4/8/12/16/24/32 is the only spacing source. | design-token test asserts every margin, padding and gap value is on the scale |
| "Use distinct heading levels, readable body text, and subdued labels." | `TYPE.h1` 18/600, `h2` 14/600, `h3` 11/600 uppercase in the label colour. Body is 12/1.45. Labels are 11 in `COLOR.label`. | design-token test (fontSize ∈ type scale); h1 count test |
| "Separate panels with subtle borders and tonal differences rather than heavy shadows." | Surfaces bg < surface1 < surface2 < surface3, with 1 px `COLOR.border`. Detail sits on surface2 against surface1 lists. | design-token test: no `*shadow*` style key anywhere |
| "Module should be extremely performant." | See "Performance budget" below. | controller read-budget, unchanged-tick and wait tests; `test/telemetry-ring.js` |
| "Reserve the accent color for primary actions and selected states." | `COLOR.accent`/`accentDim` appear only on primary buttons, selected nav, rows, tabs, KPI tiles and settings rows, on toggles that are on, and on focus rings. Each of those elements carries `data-accent`. | design-token test: any style using an accent value must have `data-accent` ∈ primary/selected/focus |
| "Use mostly geometric shapes and modest corner radii; avoid pill-shaped containers everywhere." | `RADIUS` is 0/2/4 only. The toggle is a rectangle track with a square knob. Tabs are a segmented rectangle. Status marks are 8 px squares. | design-token test: borderRadius ∈ {0,2,4} |
| "Use short transitions to clarify state changes, not continuous decorative animation." | `TRANSITION` is 120 ms on background, border and colour. The toggle knob and bar widths also use 120 ms. There are no `animation` styles and no timers in the import graph. | design-token test (no `animation*`, transitions ≤ 200 ms); static test (no setInterval, setTimeout or requestAnimationFrame) |
| "Reuse the same spacing, radii, colors, and control styles throughout." | Every control uses `CONTROL.base` plus a variant. Panels use `PANEL`. All views are built from `lib/ui/kit.js` primitives. | design-token test (all values from tokens) |
| Raw data all the way up to the KPIs | Each KPI has `{value, display, status, sources:[{file, field, value}], formula}`. The KPI detail lists the sources, and selecting one opens the Raw view on that file with the field highlighted. The Raw view browses every data file (JSON tree, JSONL tails). | "overview: KPI detail lists raw sources…"; `test/kpi.js` "every KPI has … non-empty sources + formula" |
| Every setting editable from schema metadata | `controlsFromSchema` creates one control per `SCHEMA` key from the `ui` hint (toggle, slider with `ends` labels, number, select, text, list). Writes go through `writeSettings(ns, patch, "ui")`. Errors appear inline under the control. Per-key Reset is available, plus a two-step "Reset all overridden". | "settings: one control per schema key…"; "settings: writes go through writeSettings as 'ui'…" |

## Layout
```
┌ sidebar 148 ┬ workspace (padding 24) ──────────────────────────────────────────┐
│ BITBURNER   │ H1 Title                                  [secondary] [Primary] │
│ Overview(1) │ meta · tick 2.1 ms · updated 1s ago                             │
│ RAM         │                                                                 │
│ …           │ SECTION h2 ── meta               │ DETAIL (surface2)        ✕ │
│ Settings    │ list / table / tiles (gap 4–8)   │ h2 title, meta            │
│             │ (24)                             │ key/value, JSON tree, why │
│             │ SECTION …                        │                            │
└─────────────┴─────────────────────────────────────────────────────────────────┘
```
Views and their primary action:

| View | Contents | Primary action |
|---|---|---|
| Overview | KPI grid (BitNode destroy tile is double width), Attention, Trends (sparklines from the ring), Data freshness | Refresh now |
| RAM | Utilization tiles, allocated vs running stacked bars (money/share/xp), active targets → detail, cloud, reasons | RAM settings |
| Augmentations | Progress (Daedalus, Red Pill, w0r1d_d43m0n, install), ordered path table → detail with "why" | Augmentation settings |
| Node | Destroy milestone tile, readiness, recommended next BN, pending action, inline node.* controls | Node settings |
| Predictions | pred2 tail → JSON detail | Refresh now |
| Logs | Agent / Events / Audit / Installs tabs, tail rows → detail | Refresh now |
| Raw data | Every data file except telemetry.txt → JSON/JSONL tree or text tail | Refresh now |
| Settings | Grouped schema controls → detail (help, default, range, owner, recent changes from settings-log) | Reset all overridden (two-step) |

## Files
| File | Pure | Role |
|---|---|---|
| `game/dashboard.js` | no | Entry point: single instance (ps), tail open/size/title, mount once with `printRaw`, tick loop, atExit |
| `game/lib/ui/controller.js` | ns only via read/write | Hot and slow reads, memoized parse, `computeKpis`, store updates, actions (alive-guarded), `wait()` |
| `game/lib/ui/store.js` | yes | Slice store. Notifies only changed slices. Holds UI state (view, selection, drafts, errors) so it survives tail remounts |
| `game/lib/ui/tokens.js` | yes | Spacing, radii, palette, type, motion, control and panel styles. The only style source |
| `game/lib/ui/kit.js` | yes (React injected) | Primitives: Section, Panel, Header parts, Button, Toggle, Slider, inputs, Tabs, DataTable (200-row cap), Split, Detail, KpiTile, Sparkline, StackBar, JsonTree, ErrorBoundary |
| `game/lib/ui/views.js` | yes (React injected) | Shell + the 8 views, each React.memo'd and wrapped in an ErrorBoundary |
| `game/lib/ui/settings-model.js` | yes | Schema → control view models |
| `game/lib/ui/format.js` | yes | Money, numbers, %, GB, durations; non-finite renders as "—" |
| `game/lib/kpi.js` | yes | `computeKpis(input)`, shared with the server |
| `game/lib/data-sources.js` | yes | File lists, `tailLines` (lastIndexOf walk), JSON/JSONL/log parsing, content memo, `clampMs` |
| `game/lib/telemetry-ring.js` | yes | `compactRec`, `pushRing` (count and age trim), `ringMaxLines`, `serializeRing` |
| `game/agent/telemetry.js` | edit | Also writes `data/telemetry-latest.txt` (full record, mode w) and `data/telemetry-ring.txt` (compact ring from memory, mode w). Seeds the ring once from the ring file, else from the telemetry.txt tail. telemetry.txt is unchanged |
| `game/agent/tele-launch.js` | edit | Copies telemetry.js's new imports to a non-home host |
| `server/dashboard.js`, `server/index.js`, `server/cli.js` | n/a | `GET /api/dashboard`, `bb dashboard` |
| `game/lib/settings-schema.js` | edit (ui group only) | Adds `ui.slowRefreshMs` (30000) and `ui.tailLines` (200) |

New and changed modules use relative imports (`./x.js`), which Bitburner v3 resolves relative to the importing script (`resolveScriptFilePath`). Node resolves them the same way, so the server imports `game/lib/kpi.js` directly.

## Data flow
```
agent/telemetry.js (60 s) ─▶ telemetry.txt (append, unchanged)
                          ├▶ telemetry-latest.txt (1 line, w)
                          └▶ telemetry-ring.txt   (≤ ui.historyMinutes compact lines, w)
daemon.js (RAM PR) ───────▶ ram-status.txt         autopilot.js ─▶ autopilot-status.txt, aug-plan.txt (aug PR)
                                   │
dashboard.js loop ── hot (every ui.refreshMs ≥ 250): latest, ring, ram-status, aug-plan, autopilot-status, settings
                 └── slow (every ui.slowRefreshMs, or Refresh now): pred2 tail; log tails only while Logs is open;
                     settings-log only while Settings/Node is open; selected Raw file only while Raw is open
   memoParse(by content) ─▶ computeKpis ─▶ store.set(changed slices only) ─▶ subscribed, memo'd views re-render
UI action ─▶ writeSettings(ns, patch, "ui") ─▶ data/settings.txt + settings-log ─▶ settings slice refreshed at once
bb server GET /api/dashboard ─ rpc read of the same small files + pred2 ─▶ computeKpis (same function)
```

## KPI definitions (`lib/kpi.js`)
| KPI | Value | Source (fallback) |
|---|---|---|
| BitNode destroy | 0 = ready (status warn "awaiting decision" unless `node.autoDestroy`), else ms to the pred2 hacking-level prediction ≥ the requirement, -1 = not ready with ETA unknown | aug-plan.worldDaemon / node.ready (autopilot flag "w0r1d_d43m0n READY") |
| Phase / strategy | phase, fl1ght.exe progress, weight | aug-plan.phase/progress, ram-status.weight (settings strategy.<phase>) |
| Money / s | script income $/s | telemetry-latest.income (ring Δmoney/Δt over 10 min) |
| Rep / s | Δrep/Δt of the current work faction over 10 min, restarting after drops | telemetry-ring + telemetry-latest.work |
| RAM utilization | 5-min EMA | ram-status.util.ema5 (telemetry net.used/net.max when ram-status is missing or older than 3 min) |
| Hack targets | active target count | ram-status.activeTargets |
| Next install | minutes + reason | aug-plan.install.next (autopilot augs.buyable vs `augs.installAt`) |
| Money, Hacking level | as-is | telemetry-latest |

Attention combines autopilot flags, stale or missing telemetry, and the top 3 RAM reasons. Freshness lists the age of each hot file.

## Performance budget
- **RAM:** about 2.1 GB (1.6 base + `ps` 0.2 + `getRunningScript` 0.3). A static test walks the import graph from `dashboard.js` and fails on:
  - `window`, `document` (25 GB each) or timers
  - any identifier matching a RAM-costing Netscript function name, from `test/fixtures/ns-costly-names.json`, which is extracted from bitburner-src v3.0.1 `RamCostGenerator.ts`
  
  Data keys with such names (`share`, `hack`) are read with bracket strings. Regex `exec` is replaced by `String#match`.
- **Hot path:** 6 small files, each under 64 KB (the ring is about 130 KB at 360 compact lines). Parses are memoized by content, so an unchanged tick changes no slice and re-renders nothing (tested).
- **Never read:** `data/telemetry.txt`. It is read once by telemetry.js at startup to seed the ring, never per sample (tested).
- **Slow path:** large files are read at most every 30 s, tails only (`ui.tailLines`, default 200), and only while the view that needs them is visible.
- **Tail window closed:** the loop does no reads and polls `tailProperties` every 1 s.
- **Rendering:** a single `printRaw`, with React state updates afterwards. `setInterval` is never used. The loop sleeps in steps of at least 250 ms, and Refresh now wakes it early.
- **Lists:** tables cap at 200 rows ("showing last 200 of N"). JSON trees are collapsed, with children capped at 200 and strings at 2 KB. Sparklines are one polyline of 120 points or fewer.
- **Timing:** each tick's time is shown in the header meta (`tick N ms`). Target: under 5 ms median.

## Robustness
- Missing `ram-status.txt` or `aug-plan.txt`: an EmptyState names the producing PR, and fallbacks are shown (telemetry RAM, autopilot aug summary, the READY flag).
- Every view is wrapped in an ErrorBoundary, so a bad file can't blank the shell.
- Actions check `alive` (cleared by `atExit`), so clicking after `kill dashboard.js` does nothing.
- Only synchronous ns calls are made from event handlers.
- Drafts: text and number fields commit on blur or Enter, sliders on release, toggles and selects immediately. A failed commit keeps the draft and shows the error.
- Inputs stop keydown propagation so game hotkeys don't fire while typing.

## In-game verification (acceptance)
1. `bb push dashboard.js lib/ui/ lib/kpi.js lib/data-sources.js lib/telemetry-ring.js lib/settings-schema.js agent/telemetry.js agent/tele-launch.js`.
2. Restart telemetry: `kill agent/telemetry.js; run agent/tele-launch.js`. After 1 minute, `data/telemetry-latest.txt` and `data/telemetry-ring.txt` exist.
3. `mem dashboard.js`: expect ≤ 3.0 GB (estimate 2.1).
4. `run dashboard.js`: the tail opens at about 80% of the window. A second `run` prints "already running".
5. Click each sidebar item. Select a row in each view: the detail opens on the right, and Esc closes it.
6. Overview: select the BitNode destroy tile, then a source. The Raw view opens with that file and the field bolded.
7. Settings: change a value of each control type. `bb settings` shows the change with `by ui` in `data/settings-log.txt`. Enter 1.5 in a 0..1 number field to see the inline error. Reset clears the override.
8. Close the tail: the tick footer stops updating. Reopen from Active Scripts and check that the view and selection are preserved.
9. `kill dashboard.js` while the window is open, then click a toggle: no uncaught error.
10. Screenshots for the PR: Overview with the destroy detail, Settings with an inline error, Augmentations with a step detail, Raw with a highlighted field.

**Rollback:** `kill dashboard.js`. The only behaviour change elsewhere is two extra small files written by telemetry.js. To revert it, push the previous `agent/telemetry.js` and restart it. `telemetry.txt` and the predictor are unaffected.

## Pre-execution plan improvement log
- **Round 1** (Perplexity Computer, about 2 min): https://www.perplexity.ai/computer/tasks/31802c27-ab65-4249-a0c1-8861b698fd66. v1 was drafted with the owner requirements verbatim, the live-confirmed APIs (React 17.0.2, `ns.printRaw`, `ns.ui.*`, `tailProperties`) and the file contracts.
- **Accepted:**
  - no `window`/`document` and no RAM-costing identifiers; extended into a static test against the real v3.0.1 cost table
  - UI state in the store, so a tail remount loses nothing
  - an alive guard on actions
  - commit-on-release sliders and commit-on-blur text fields
  - KPI provenance (`sources` + `formula`) and drill-down into Raw
  - an ErrorBoundary per view
  - a 200-row cap and collapsed JSON trees
  - slow files read only when visible
  - seeding the ring from the telemetry tail once
  - no setInterval; a 250 ms floor
  - stopPropagation on input keydown
  - the static and render test list
- **Rejected or adjusted:**
  - Reading `getTheme()` fonts: `fontFamily: inherit` already follows the game's font, with no extra call.
  - An in-game `getScriptRam ≤ 3.0` test: tests cannot run in-game, so a static import-graph check plus a manual `mem` step replace it.
  - A separate probe script: it would need writes to the live game, which this PR's work forbids. Its three checks are in-game acceptance steps 4, 7 and 8.
  - Memo by "length + last 256 chars": exact content equality is cheap for these sizes and can't miss an edit.
- Round 2 was not needed: v2 left no unresolved decisions after the repo and API facts were checked.

## AGENTS.md changes (for the owner to apply; not edited in this PR)
Under "What runs by itself":
> - dashboard.js — in-game React dashboard (owner-facing; start with `run dashboard.js`). Reads only small files: data/telemetry-latest.txt and data/telemetry-ring.txt (written by agent/telemetry.js), ram-status, aug-plan, autopilot-status, settings. Agents: the same KPIs are available as `bb dashboard` / GET /api/dashboard (game/lib/kpi.js).

Under "Logs": add data/telemetry-ring.txt (last ui.historyMinutes, compact) and data/telemetry-latest.txt (latest full record).

Under "How to work on code", add a rule:
> In anything imported by an in-game script, never reference window/document, and avoid identifiers named like Netscript functions (share, hack, exec, run, rm, scan, …). Bitburner's static RAM check charges for them. test/dashboard.js enforces this for the dashboard graph.
