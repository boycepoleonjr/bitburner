# Handoff 2026-11-15: stock access guard + BN8 logger auto-start

Branch `feat/stocks-bn8-guard`. Spec: `docs/specs/stocks-access-guard.md`. Owner decision (aside, 2026-11-15): option C, wait for BN8; no WSE/TIX purchase by hand, no `augs.autoInstall`/reserve/settings
changes, nothing may buy TIX or 4S in this BitNode (WSE alone is fine), the guard must be code (no config-overrides edit), the logger stays deployed but not running and should start in BN8.

## What changed
- `game/lib/stockaccess.js` (pure): `accessLimit` (BN8: all four access items; elsewhere only the first `stocks.accessOutsideBn8`, default 1 = WSE) and `shouldStartSpike`.
- `game/tools/stocks.js`: the access loop stops at the limit; in BN8, with TIX API access and free home RAM, it starts `tools/stock-spike.js`.
- `game/lib/config.js`: `DEFAULTS.stocks` gains `accessOutsideBn8: 1`, `spikeLogger: true`, `spikeMinFreeGb: 64`.
- `test/stockaccess.js` (13 tests): runs the real `tools/stocks.js` main() on a fake ns and records purchases, orders and `run()` calls for every scenario; mutating the guard fails five of them.
- `docs/specs/bn8-spike.md` §8a records the decision.

## Findings worth knowing
- Live check 2026-11-15: BN3, cash $678m (+$203k/s), WSE/TIX/4S all unowned, `tools/stocks.js` running (home 512 GB, 386 GB used), logger deployed and not running (16.7 GB; `tools/stocks.js` is 29.4 GB).
- The old tool buys WSE at $800m cash (about 10 minutes of income away, if the autopilot does not spend first), TIX only at $20b cash (never reached in BN3: peak cash in the last 5.4 h was $0.64b) and 4S Market Data at $4b once TIX is owned.
- Owning TIX alone never trades: buys and sells need the 4S TIX API (or `liquidate`). Verified by the fake-ns test.
- Stock access flags survive an aug install (cleared only on BitNode destroy, `PlayerObjectGeneralMethods.ts` `prestigeSourceFile`); the market itself is re-created on every install.
- Nothing else in `game/` buys stock access (a test scans every file).

## Commands (Node 22.23)
`npm ci` pass, `node .github/scripts/check-syntax.js` pass, `npm test` pass, `npm audit --audit-level=high` pass.

## After merge (owner)
1. Merge, wait for the Railway deploy of that commit.
2. `bb push lib/config.js lib/stockaccess.js tools/stocks.js`, then `kill tools/stocks.js` (the daemon hook restarts it within a loop), `bb note` what changed.
3. Until step 2 the old tool is live: it may buy the WSE account at $800m cash; TIX needs $20b cash, 4S needs TIX first.
4. In BN8 the logger starts by itself; read it later with `bb read data/stock-spike.txt > spike.txt && node server/stockspike-report.js spike.txt`.

## Next
BN8 build order continues after the spike result (`docs/specs/bn8-readiness.md` §9). BN9 stays undecided.
