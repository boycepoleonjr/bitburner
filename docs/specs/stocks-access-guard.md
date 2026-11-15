# Spec: stock access guard and BN8 logger auto-start (docs/specs/stocks-access-guard.md)

Status: planned 2026-11-15. Owner decision on the BN8 spike (#55): wait for BitNode 8; do not buy WSE/TIX or 4S in the current BitNode; WSE alone is fine; no setting or
config-overrides edit, so the guard is code.

## Problem
`game/tools/stocks.js` (kept alive by `hooks.stocksHook`, every node) buys the stock access items in order, each when `cash * accessSpendFraction (0.25) >= cost`:
WSE account ($200m, so at $800m cash), TIX API ($5b, at $20b), 4S Market Data ($1b, at $4b) and 4S TIX API ($25b, at $100b). In BN3 that means it buys WSE within minutes
(cash was $678m at the live check) and would buy 4S Market Data the moment TIX is owned and cash reaches $4b. The owner does not want TIX or 4S bought in this BitNode.
Owning TIX alone does not make the tool trade: it buys and sells only with the 4S TIX API (or while `liquidate` is set), which is verified by test below.

## Goals
1. Outside BN8 the tool may buy only the first `stocks.accessOutsideBn8` access items (default 1: the WSE account). TIX, 4S Market Data and the 4S TIX API are never bought by it there.
   BN8 is unchanged (all four items; BN8 grants WSE and TIX API itself).
2. In BN8, once TIX API access exists, the tool starts the read-only logger `tools/stock-spike.js` (docs/specs/bn8-spike.md) if it is not running, `stocks.spikeLogger` is true
   and home has `spikeMinFreeGb` (64) free beyond the logger's RAM. The tool is restarted by the daemon hook after every install, so the logger comes back by itself.
3. No new setting and no edit of `/data/config-overrides.txt`: both knobs are keys of the existing `DEFAULTS.stocks` block in `lib/config.js`, so the owner can still override them
   there (`stocks.accessOutsideBn8: 0` buys nothing, `4` restores the old behavior everywhere).

## Non-goals
`tools/stocks.js` trading logic, thresholds and BN8 behavior (the BN8 module is a later PR, docs/specs/bn8-readiness.md); the logger itself; any `node.targets` or settings change.

## Design
- `lib/stockaccess.js` (pure): `accessLimit(bn, outsideBn8)` returns 4 in BN8, else the override when it is an integer 0..4, else 1 (an invalid value never means "allow everything");
  `shouldStartSpike({bn, hasTix, running, enabled, freeGb, needGb, minFreeGb})`.
- `tools/stocks.js`: the access loop takes the index of the first missing item and `break`s when it is not below `accessLimit`; after the loop, `shouldStartSpike` then `ns.run`.
  New calls: `ns.getResetInfo`, `ns.isRunning`, `ns.run`, `ns.getScriptRam`, `ns.getServerMaxRam`, `ns.getServerUsedRam` (tools/stocks.js is 29.4 GB today and runs on home; the
  logger is 16.7 GB). Nothing else in the game imports `tools/stocks.js`, so no other script's RAM changes.
- `lib/config.js`: `DEFAULTS.stocks` gains `accessOutsideBn8: 1`, `spikeLogger: true`, `spikeMinFreeGb: 64`.

## Risk
Low. Outside BN8 the tool can only do less than today. In BN8 the only addition is starting a read-only logger when home has room. A bug in the guard could leave WSE unbought
(harmless) or, in the worst case, restore today's behavior; the tests run the real `main()` with a fake `ns` to prove what is bought, traded and started in every scenario.

## Tests (`test/stockaccess.js`)
Pure functions (BN8 / other nodes / invalid overrides / every start condition), and the real `tools/stocks.js` against a fake `ns`: BN3 with unlimited cash buys WSE only and places
no order; WSE + TIX owned buys nothing; the $800m threshold; BN1-15 except 8; overrides 0, 4 and invalid; BN8 buys 4S Market Data then the 4S TIX API as before; the logger starts
once in BN8 and not before TIX, in other nodes, when disabled, when running, on a small home, when its file is missing; a failed `ns.run` is retried. Static: no other file buys access;
the limit check comes before the purchase. Mutating the guard makes five of these fail.

## Rollout (owner)
Merge, wait for the Railway deploy of that commit, `bb push lib/config.js lib/stockaccess.js tools/stocks.js`, then restart `tools/stocks.js` (`kill tools/stocks.js`; the daemon
hook restarts it within a loop). Until then the old tool is live: it may buy the WSE account at $800m cash, and would buy TIX only at $20b cash, which BN3 does not reach.
Rollback: `bb push` the previous files, or set `stocks.accessOutsideBn8` to 4 in config-overrides.
