# Handoff 2026-11-13: node.fallback (stop instead of auto-picking outside node.order)

Branch `feat/node-fallback-stop`. Spec: `docs/specs/node-fallback.md`. Ledger: F-011 (in-progress). No live game writes, no `bb push`, no settings POST, no Railway change, no workflow edit.

## What changed
- New setting `node.fallback` (`recommend` default | `stop`), schema + `docs/specs/settings.md` + AGENTS.md owner-defaults line.
- `game/lib/nodectl.js`: `pickNextBn` returns `nextBn: null`, `source: "order-exhausted"` for `stop` when `node.order` has no available entry (an empty list counts). `decideNode` then flags (READY flag plus `node.order exhausted (node.fallback=stop) ...` naming the recommended node and why), never requests or destroys, cancels an open request, and adds `source` to the `node` block (only in that case, so default output is byte-identical).
- Dead-end text: "every Source-File is maxed" instead of "autoSelect off" when autoSelect is on.
- `server/checkin.js` `OWNER_DECISION` also matches the new flag (held back like READY, then escalated).
- Dashboard: destroy KPI shows `READY · node.order exhausted`; the flag is a warn-level attention item pointing at the BitNode view; the BitNode view gets a `next-node source` row when exhausted.
- Tests: `test/node-fallback.js` (18), golden `test/fixtures/node-fallback-golden.json` (generated from the code before the change), one case in `test/dashboard.js`.

## Findings worth knowing
- With the real `SF_MAX` (BN12 = Infinity) the planner always has a recommendation, so "every Source-File maxed" cannot happen in the game today. The text fix is tested against a patched copy.
- With BN12 in `node.order`, the list never runs out.
- The exhausted flag only exists while w0r1d_d43m0n is READY (`decideNode` is only called then). The aug-plan `node.source` field is visible on the dashboard earlier.

## After merge (owner)
1. Merge, wait for the Railway deploy of that commit.
2. `bb push lib/nodectl.js lib/settings-schema.js lib/kpi.js lib/ui/views.js`, restart `agent/autopilot.js` (and `agent/sl-plan.js`, `dashboard.js`), `bb note` what changed.
3. `bb settings set node.fallback=stop`. Rollback: `bb settings unset node.fallback`.

## Follow-ups (not in this PR)
BN12/BN15 handling, `SF_MAX`, `DEFAULT_BN_ORDER`; an early "node.order will run out" warning before READY.
