# Configurable augmentation purchase order (augs.order.*)

Status: approved by the owner 2026-11-02 with defaults unchanged. This file is the contract for the `feat/aug-order` PR.
Where the code and this spec differ, the code wins and the difference is listed in "Implementation notes" at the end.

## 1. Goal

Today the purchase order is hard-wired: highest rep requirement first, each aug's unowned prerequisites immediately
before it, NeuroFlux Governor last. The owner wants to steer it (pin, push to the end, exclude, sort differently, hold the
install until a pinned aug is reachable) from the dashboard or the CLI, without losing the old behaviour.

**With no `augs.order.*` overrides the behaviour is exactly today's.** Golden tests enforce it. Prerequisites-first and
NeuroFlux-last are not configurable. Nothing here is specific to one achievement: pinned / last / exclude are general lists.

## 2. Facts about today's code (main at 25e5fdd)

- The planner (`lib/augplan.js` `ownerOrder`) sorts by repReq desc, ties by name (`localeCompare`), prerequisite depth cap 10.
- The autopilot (`agent/autopilot.js` `buyBatch`) stable-sorts by repReq desc, ties in discovery order
  (`getPlayer().factions` order, then each faction's aug list), depth cap 5, and only places prerequisites that are
  themselves rep-met candidates. So one function needs the tie rule as a parameter.
- Augs are bought only at install time: `buyBatch` runs under the step-8 install trigger and any non-empty batch installs.
- `augs.top` / `augs.buyable` are computed in step 6 (aug report), not step 8. `augs.buyable` feeds the count trigger.
- Attention comes from `flags.push(msg)` (deduped into the `flags` audit entry).
- `K.ListInput` commits a comma-joined string, not an array.
- Settings file `data/settings.txt`, log `data/settings-log.txt` (no leading slash). `bb settings unset` accepts several keys.
- After #28: in BN2 the gang faction sells The Red Pill, cannot be worked for or donated to; `nextPurchaseCost(steps)`
  follows the planner order and is the gang module's cash reserve.
- `agent/sl-plan.js` already snapshots repReq, price and prereqs for every aug of every faction.

## 3. Design

### 3.1 Settings (group `augs`)

| key | type | default | meaning |
|---|---|---|---|
| `augs.order.sort` | enum `rep\|price\|cheap\|name` | `rep` | order for augs not listed below. `rep` = today's rule. `price` = most expensive first (minimises total cost under the ×1.9 ramp). `cheap` = cheapest first. `name` = alphabetical |
| `augs.order.pinned` | stringList | `[]` | bought first, in this order, when present in the batch |
| `augs.order.last` | stringList | `[]` | bought after all others (still before NeuroFlux) |
| `augs.order.exclude` | stringList | `[]` | never bought. Rejects The Red Pill |
| `augs.order.strict` | bool | `false` | hold the batch and the install while a pinned aug is not rep-met (§3.4) |
| `augs.order.strictMaxWaitMin` | int 0..1440 | `120` | strict wait cap per blocking aug |
| `augs.order.drivesWork` | bool | `false` | `auto-faction` work targets the highest-ranked pinned aug's faction (§3.4) |

Precedence when a name is in several lists: exclude > pinned > last. The planner warns; the dashboard prevents it in the draft.

`stringList` coercion: input is an array; or a string starting with `[` (JSON); or a string split on `|` if it contains one,
else on `,`. Entries are trimmed, at most 80 chars, unique (case-sensitive), at most 200. Delimited strings drop empty
pieces; arrays/JSON with an empty entry are rejected. Any entry starting with `NeuroFlux` is rejected ("NeuroFlux is
always last; not orderable"). `augs.order.exclude` also rejects `The Red Pill`. Unknown aug names are accepted and
surfaced as warnings.

`K.ListInput` gets `mode: "json"` (commits `JSON.stringify(list)`, adds one entry per click without comma-splitting);
`SettingControl` uses it for `stringList` keys. `augs.neuroFluxLast` keeps its behaviour; its help text says it is fixed.

### 3.2 `game/lib/augorder.js` (pure)

```
orderAugs(names, cfg, info, have, { tie = "name" }) -> { order, excluded, blocked, warnings, tags }
cfg  = { sort, pinned, last, exclude }     // missing fields = defaults
info = { [name]: { repReq, price, prereqs } }
tie  = "name" (planner) | "input" (autopilot: keep the order of `names`)
```
Also `DEFAULT_ORDER_CFG`, `ORDER_KEYS` (the six settings keys, as written by the dashboard), `cfgFromSettings(s)`,
`isDefaultCfg(cfg)`, `projectedCost(order, info, step)`, `buildCatalog(snap)`, `sameCatalog(text, cat)`, and the strict /
drivesWork helpers `pinnedBlocker` and `strictStep`.

Algorithm: remove excluded names; rank = pinned (list order, those present) + the rest by `sort` (ties by `tie`) + last
(minus anything pinned); walk the rank placing each aug's unowned prerequisites that are in `names` immediately before it
(recursive, depth cap 10, cycle-safe); an aug with an unowned prerequisite that is excluded (or itself blocked) is dropped
and reported in `blocked` with a warning; an unowned prerequisite missing from `names` keeps the aug (the caller's
"prereq missing" skip handles it, as today). Names in the lists that are not in `info` give an "unknown aug" warning.
`tags[name]` is `pinned | auto | last | prereq` for the dashboard.

No `ns`, no `window`/`document`, no Netscript-named identifiers, relative or `lib/` imports only.

`augplan.ownerOrder(names, augs, have)` stays exported and becomes `orderAugs(names, DEFAULT, augs, have, {tie:"name"}).order`.

Golden equivalence (tests): `orderAugs(default, tie "name")` equals the legacy `ownerOrder`; `orderAugs(default, tie
"input")` equals the legacy autopilot `place()` on fixtures whose prerequisite chains are shorter than 5 (the real catalog
is: max chain depth 4).

### 3.3 Planner

`plan(snap, s)` builds `cfg = cfgFromSettings(s)`, removes excluded augs from `obtainable` before selection (no-op with
defaults), orders the steps with `orderAugs(..., {tie:"name"})`, appends a `blocked` step with the reason for each blocked aug,
and keeps NeuroFlux as the final step. Additive field in `data/aug-plan.txt`:

```
order: { sort, pinned, last, excluded, strict, drivesWork, warnings, blocked, projectedCost, defaultProjectedCost, isDefault }
```
`pinned`, `last`, `excluded` are name arrays. Both cost fields are computed over the currently buyable steps, with the
planner's `PRICE_STEP`.

`agent/sl-plan.js` also writes `data/aug-catalog.txt` from its snapshot (no new Netscript calls), only when the content
without `t` changed:
```
{ t, augs: [{ name, factions: [{ f, joined }], repReq, price, prereqs, owned, installed }] }
```

### 3.4 Autopilot

`buyBatch` reads settings once (`readSettings`) and derives the legacy config from that same read. Candidates are as today
plus `!exclude.has(a)`. Ordering: `orderAugs(..., {tie:"input"})` in a try/catch. On a throw it falls back to
`legacyOrder()` (the old inline algorithm, kept in `autopilot.js`), writes `audit("orderFallback", {err})` and
`flags.push("aug order fallback: …")`; buying continues. Everything after ordering (prereq-missing skip, affordability,
buy/skip/plan audits with `cfg` = `"default"` or the config, NeuroFlux, leftover cash to RAM/cores) is unchanged.

Step 6 excludes `exclude` from `buyable` (excluded augs never count toward the install trigger) and sorts `augs.top` with
the same `orderAugs` call and fallback.

Strict mode (`augs.order.strict`): when an install trigger fires, the blocker is the highest-ranked pinned aug that is
unowned, not excluded, not already timed out, sold by a joined faction other than the gang faction, and not rep-met in any
such faction. While there is a blocker and `now - firstBlocked[blocker] < strictMaxWaitMin`: buy nothing, do not install,
`audit("strictHold", {blocker, waitedMin, capMin})` once per blocker, and re-enable stock trading as the `nfgHold` branch does.
After the cap: `audit("strictTimeout", {blocker, waitedMin})` once, then the soft order proceeds. State is kept in memory and
in `data/aug-order-state.txt` `{ reset, first:{aug:t}, timedOut:[aug] }`; it is discarded when `reset` (the game's
`lastAugReset`) differs, and a corrupt file resets it.

`drivesWork` (only inside `work: "auto-faction"`, before the existing best-faction loop): if on, the highest-ranked pinned aug
that is unowned, not excluded and not rep-met in a joined, non-gang faction makes that faction the work target
(`act("working for <f> (pinned aug <a>)")` once per change); otherwise the existing logic runs unchanged.

### 3.5 Dashboard

The Augmentations view gets tabs **Path** (existing, default) and **Order** (`ui.augsTab`). The controller reads
`data/aug-catalog.txt` in the slow path only while the Augs view's Order tab is open, plus once immediately on opening it.
The Order tab shows the effective order of unowned augs ("show owned" toggle): rank, name, factions, rep, price, prereqs,
status tag (`pinned / auto / last / excluded / prereq / blocked / unknown`). Row actions: ↑ ↓, To top, Pin/Unpin, Send to
last, Exclude/Include (disabled for The Red Pill). Keys on a focused row: `k`/`j` move, `p` pins, `x` excludes. Header: sort
select, Strict toggle + wait cap, drivesWork toggle.

The draft lives in component state, seeded from the effective settings, with pure transitions in `lib/ui/augorder-model.js`.
"Draft · N changes", **Apply order** (primary), **Discard**, **Reset to default**. `actions.applyAugOrder(draft)` makes one
`writeSettings` call (actor `ui`); keys equal to the schema default go into `unset`. `actions.resetAugOrder()` unsets exactly
`ORDER_KEYS`. Errors are shown inline and the draft is kept. A live preview shows batch cost for draft / current / default.
Warnings: unknown names, blocked by an excluded prerequisite, list precedence, and "excluding N augs leaves fewer
obtainable augs than Daedalus requires" (only when The Red Pill's source is Daedalus).

### 3.6 CLI / API

No new endpoints. `GET /api/plan` shows `order`.
```
bb settings set 'augs.order.pinned=["The Red Pill","BitRunners Neurolink"]'
bb settings set augs.order.sort=price
bb settings unset augs.order.sort augs.order.pinned augs.order.last augs.order.exclude augs.order.strict augs.order.strictMaxWaitMin augs.order.drivesWork
```

## 4. Decisions

Soft ordering by default, strict opt-in with a 120-minute cap per blocker; `drivesWork` off; NeuroFlux position not
configurable; #28 is a hard prerequisite; buttons and keys instead of drag-and-drop; no per-BitNode profiles in v1.

## 5. Stop conditions

A golden test fails with defaults (report the diff, never edit the golden); ordering would need a new Netscript call in
`autopilot.js` or `dashboard.js` (get the data through sl-plan / the catalog instead); CI red after two fix attempts on the same failure.

## 6. Post-merge (owner)

1. Baseline in-game before pushing: `ns.getScriptRam("agent/autopilot.js")`, `ns.getScriptRam("dashboard.js")`, one copy of `data/aug-plan.txt`.
2. Confirm Railway deployed the merge commit, then `bb push`, then restart autopilot and dashboard.
3. Re-measure RAM: neither may increase.
4. After one sl-plan cycle: `steps` in `aug-plan.txt` match the baseline and `order.isDefault === true`.
5. `bb note "aug-order deployed, defaults, plan unchanged, RAM a→a' / d→d'"`.
6. Optionally set `augs.autoInstall=false` while editing the order, then turn it back on.

## 7. Acceptance

Defaults reproduce today's plan steps and buy sequences; no `augs.order.*` keys appear in `data/settings.txt`; Apply writes
exactly one settings-log line (actor `ui`); exclude prevents purchase and removes the aug from the install-trigger count;
excluding The Red Pill is rejected in the dashboard and the CLI; prerequisites always precede dependents and an aug with an
excluded prerequisite is reported blocked and never bought; strict mode holds and times out as specified with one audit per
blocker; if `orderAugs` throws the legacy order is used with an `orderFallback` audit and an attention flag; RAM of
`autopilot.js` and `dashboard.js` does not increase; rollback is the `bb settings unset …` command above.

## Implementation notes (differences from the approved plan text)

- The planner's projected cost uses `PRICE_STEP` only; it has no BitNode-multiplier term today, so none is added.
- The strict hold is evaluated before the liquidation branch of step 8 (not after it): checking after it would liquidate
  stocks on one loop and re-enable them on the next, repeating until the cap.
