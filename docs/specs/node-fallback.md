# Spec: node.fallback — stop instead of auto-picking outside node.order

Status: planned 2026-11-13. Owner request, evidence verified by the owner's agent the same day.

## Problem
`pickNextBn()` (game/lib/nodectl.js) with `node.autoSelect=true` takes the first available entry of `node.order`. When no entry is available (every listed Source-File is maxed, or the list is empty), it silently falls back to `recommendNextBn()`, which is `firstAvailable(DEFAULT_BN_ORDER)`.

With the live `node.order=[10,2,3,11]` and `SF_MAX(12)=Infinity`, the bot would, after BN2 (SF2 2->3), BN3 x3 and BN11 x3, auto-select BN9 x3 and then BN12 forever. BN6/7/8/13/14 never come. BN9 (purchased servers disabled, home RAM cost x5, hacking XP x0.05) and BN8 (hacking earns nothing) are nodes the scripts cannot play unattended. At about one node a day this happens in roughly 10 days.

## Goals
1. A setting `node.fallback` (enum `recommend` | `stop`, default `recommend`).
   - `recommend`: today's behavior, byte-identical outputs.
   - `stop`: when `node.order` has no available entry, `pickNextBn` returns `nextBn: null`, `source: "order-exhausted"`, and still reports `recommended`.
2. In `stop` mode `decideNode` never requests or destroys in that case. It raises one attention flag that says `node.order` is exhausted and names the recommended node and why. Everything else about w0r1d_d43m0n is unchanged: the bot stays in the node, the READY flag is still raised, and the READY escalation timer in `server/checkin.js` keeps working.
3. Fix the misleading dead-end text: when every Source-File is maxed the pending detail says so, not "autoSelect off".
4. The aug-plan `node` block carries `source: "order-exhausted"` when it applies, and the dashboard shows it (BitNode view and the destroy KPI).

## Non-goals (follow-ups, listed in the PR)
- BN12 / BN15 handling, `SF_MAX`, `DEFAULT_BN_ORDER` are not touched. With BN12 in `node.order`, `SF_MAX(12)=Infinity` means the list never runs out; that is existing behavior.
- An early warning before w0r1d_d43m0n is ready (the attention flag only exists while READY, because `decideNode` is only called then). The `node.source` field in `aug-plan.txt` is visible earlier on the dashboard.
- Choosing what the bot should do after the flag. The owner picks the next node by hand (`bb settings set node.order=...` or destroys manually).

## Design
### Setting
`game/lib/settings-schema.js`, group `node`, `{ key: "node.fallback", type: "enum", default: "recommend", options: ["recommend", "stop"], ui: "select", owner: "autopilot" }`. Invalid values are rejected by `coerce` (existing enum path). A stored value that is not a valid option falls back to the default (existing parse warning path). In code, anything other than the string `"stop"` behaves as `recommend`.

### pickNextBn
```
autoSelect off                         -> { nextBn: null, source: "manual" }                 (unchanged)
order has an available entry           -> { nextBn: n, source: "node.order" }                (unchanged)
else fallback == "stop"                -> { nextBn: null, source: "order-exhausted" }        (new)
else                                   -> { nextBn: recommended.bn, source: "recommendation" } (unchanged)
```
An empty `node.order` counts as exhausted in `stop` mode: "never auto-pick outside the owner's list" is taken literally. (The `node.order` help text says empty = use the recommendation; that is the `recommend` mode.)

### decideNode
- The `node` block (`base`) gets `source: "order-exhausted"` only in that case. For every other case the block is unchanged, so default outputs stay byte-identical (golden test).
- Order of checks after `ready` and `autoDestroy`: if `pick.source === "order-exhausted"`:
  - open request for this BN: `cancel` (writes `{action:"cancel"}`), attention `[READY_FLAG, ORDER_EXHAUSTED(...)]`.
  - otherwise `flag`, no `writeRequest`, `nextBn` null, attention `[READY_FLAG, ORDER_EXHAUSTED(...)]`.
- `node.autoDestroy` off, or not ready: unchanged (the owner decides anyway; READY already carries the recommendation). `node.autoSelect` off: unchanged.
- The flag text is `node.order exhausted (node.fallback=stop) — owner picks the next BitNode; recommended BN<n>: <why>`. It is built from the recommendation, which only changes when Source-Files change, so it is stable across loops and dedupes in the autopilot flag list and in `server/checkin.js` (`normalizeAttention`, `attentionKey`) exactly like the READY flag. With nothing left to recommend it says `every Source-File is maxed` instead.
- `server/checkin.js` `OWNER_DECISION` also matches `/node\.order exhausted/i`: it is an owner decision and is held back for `BB_READY_ESCALATE_MIN` (default 120 min) like READY, then escalates.
- `lib/kpi.js`: the flag is shown with level `warn` and view `node` (like READY). The destroy KPI display says `READY · node.order exhausted` when `node.source` is `order-exhausted`.
- `lib/ui/views.js`: BitNode view gets a `next-node source` row only when the source is `order-exhausted`.

### Dead-end text
`autoDestroy on, autoSelect on, nextBn null` and the recommendation is also null (`every Source-File is maxed`), in `recommend` mode: detail is `every Source-File is maxed: no BitNode left to select (...)`. The `autoSelect off` text is only used when autoSelect is really off. Same fix for the cancel text of an open request. Actions and flags do not change.

Note: with the real `SF_MAX` (BN12 is `Infinity`) a recommendation always exists, so this dead end is not reachable in the game today. It becomes reachable if the BN12 follow-up changes `SF_MAX`. The test runs the real `nodectl.js`/`augplan.js` copied with `SF_MAX` patched to 3.

## RAM
Pure functions in lib files; no new `ns.*` calls. Script RAM is measured before and after for autopilot.js and sl-plan.js (static check cost of imports) and must not increase.

## Risk
Low. Default `recommend` takes the same code path as today. `stop` only reduces actions (never requests/destroys). Worst case of a bug in `stop`: the owner gets a flag and a node is not auto-chosen.

## Tests (plain Node, test/node-fallback.js plus additions)
1. default `recommend` unchanged: golden outputs of `pickNextBn` and `decideNode` for the current behavior (order available, order exhausted -> recommendation, autoSelect off), compared deep-equal, including no `source` key in the node block.
2. `stop` with an order entry available picks from the order.
3. `stop` with the order exhausted (and with an empty order): `nextBn` null, `source` "order-exhausted", `recommended` reported; `decideNode` action `flag`, no `writeRequest`, attention `[READY_FLAG, flag]` with the flag naming the recommended BN; repeated calls give the identical flag (dedupe); with an open request it cancels.
4. `stop` + `node.autoSelect` false: identical to `recommend` (manual).
5. `stop` / `recommend` + every SF maxed: pending detail says "every Source-File is maxed", not "autoSelect off"; autoSelect really off still says autoSelect off.
6. schema: default is `recommend`; `coerce` rejects invalid values, accepts both options; settings round trip through `applyPatch` / `serialize` / `parse`.
7. `OWNER_DECISION` matches the new flag; `kpi.js` attention level and destroy display; dashboard view row.
8. `autopilot.js` and `sl-plan.js` integration: the existing code path passes `readSettings` flat settings into `decideNode`, so the new key flows without changes (covered by the settings round trip plus a `readSettings` fake-ns test).

## Rollout (owner)
Merge, Railway deploy, `bb push` of the changed game files, restart `agent/autopilot.js` (sl-plan restarts with it), then `bb settings set node.fallback=stop`. Rollback: `bb settings unset node.fallback`.
