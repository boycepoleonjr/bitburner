# Spec: BN8 readiness — stock-trading module (docs/specs/bn8-readiness.md)

Status: spec only, nothing implemented. Input for later build PRs; companion of `docs/specs/node-readiness.md` and
`docs/specs/node-targets.md`. Today the bot cannot finish BN8: the only income it has there is stock trading, and the existing
`game/tools/stocks.js` is a long-only forecast follower with no sizing model, no risk limits and no BN8 bootstrap.

## 1. Problem
BN8 "Ghost of Wall Street" removes every income source the bot uses. In `getBitNodeMultipliers(8, …)` (bitburner-src v3.0.1,
`src/BitNode/BitNode.tsx` `case 8`, read 2026-11-14):

| Multiplier | BN8 | Effect on the bot |
|---|---|---|
| `ScriptHackMoney` / `ScriptHackMoneyGain` | 0.3 / **0** | daemon hacking earns $0 (the gain multiplier is zero, not just the 0.3) |
| `ManualHackMoney`, `CompanyWorkMoney`, `CrimeMoney`, `InfiltrationMoney`, `CodingContractMoney`, `HacknetNodeMoney` | 0 | no other money source |
| `FavorToDonateToFaction` | **0** | rep can be bought with money from the first faction day (donation floor 0) |
| `DarknetLabyrinthRewardsTheRedPill` | 0 | the Red Pill still comes from Daedalus, as in BN1 |
| `CloudServerSoftcap` | 4 | cloud (purchased) servers get very expensive as the count grows (softcap 4; the exact curve is read from `ns.cloud.getServerCost` at run time) |
| `WorldDaemonDifficulty` | unset (1) | w0r1d_d43m0n needs hack 3000; hacking level/XP multipliers are default |
| `DaedalusAugsRequirement` | unset (30) | 30 installed augs before the Daedalus invite |
| `StaneksGiftExtraSize` | -99 | no Stanek's Gift |

The BN8 description gives: start money $250m, a WSE account and TIX API access from the start, and shorting plus limit/stop
orders (BN8 only; other nodes need SF8.2 / SF8.3). The path to destruction still needs the Daedalus route: 30 installed augs,
$100b and hack 2500 for the invite, then The Red Pill, then hack 3000. All of that money has to come from the stock market.

## 2. Facts for the design (v3.0.1 source)
| Fact | Source file | Note |
|---|---|---|
| Stock tick every 6 s (`msPerStockUpdate` 6e3, min 4e3); forecasts cycle every 75 ticks | `src/StockMarket/data/Constants.ts` | |
| WSE $200m, TIX API $5b, 4S Market Data $1b, **4S TIX API $25b**, commission $100k per transaction | same | BN8 does not change the 4S multipliers (BN7 x2, BN9 x5/x4, BN11 x4, BN13 x10) |
| Each tick: one shared `v = Math.random()`; a stock moves by `v * mv / 100` up with probability `forecast = (50 ± otlkMag)/100`, else down | `src/StockMarket/StockMarket.ts` `processStockPrices` (lines 260-290) | so the expected move per tick is about `(2f - 1) * mv / 200` (E[v] = 0.5) and every stock moves with the same `v` |
| A stock above its `cap` has up-probability forced to 0.1 | same | caps are random between 1e3 and 25e3 times the start price |
| `getForecast` and `getVolatility` need the 4S TIX API; positions, prices and orders need the TIX API | NS docs | `ns.stock.getConstants()` already returns the costs (used in `game/tools/stocks.js`) |
| Large trades move the price: `shareTxUntilMovement` | `src/StockMarket/Stock.ts` | the price impact of our own orders must be modeled (§4.3); not measured yet |
| Whether stock positions or money survive an aug install in BN8 | `src/Prestige.ts` | **not verified**; `autopilot.js` already liquidates before installs (`cfg.stocks.liquidate`), the safe assumption |

## 3. What exists
- `game/tools/stocks.js`, kept alive by `hooks.stocksHook` in `game/lib/hooks.js`: buys WSE, TIX API, 4S, 4S TIX API in order when
  `cash * accessSpendFraction (0.25) >= cost`; trades long-only (`buyAbove 0.6`, `sellBelow 0.5`, `maxPortfolioFraction 0.5`,
  `minTrade 50e6`); writes `data/stocks.txt`; honours `cfg.stocks.liquidate`, which `agent/autopilot.js` sets before an install and
  `agent/post-install.js` clears.
- The daemon's income tracking (`state.income.stockSinceInstall`, `game/daemon.js:287`) and the aug planner's money inputs (they read
  `snap.money` and `snap.income` = `getTotalScriptIncome`, which does not include stock gains).

What is missing for BN8: a plan for a $250m start with a $25b data wall in front of the good trades, shorting, position sizing and risk
limits, an income figure for the planner/predictor, and BN8-aware bootstrap (no hacking income, no cloud servers).

## 4. Design: `lib/stockplan.js` (pure) + `tools/stocks.js` (applies)

Same split as the gang module: a pure planner that is unit-tested, and one tool that reads the market and applies the plan.
Single instance on home; the tool is read-only toward everything except `ns.stock.*` and writes only `data/stocks.txt`.

### 4.1 Stages (what to do with how much money)
| Stage | Condition | Behavior |
|---|---|---|
| 0 access | BN8 starts with WSE + TIX API; elsewhere buy them | buy what is missing, in order, only when cash after the purchase still covers `stocks.reserve` |
| 1 blind | no 4S TIX API yet | trade only from observed price history (§4.2 estimator), small positions (`stocks.blindFraction`, default 0.2 of equity), long and short allowed in BN8 or with SF8.2 |
| 2 data | 4S Market Data ($1b) is useful for the UI only; the API needs the **4S TIX API ($25b)** | save for the 25b item when equity (cash + positions) >= `cost / stocks.accessSpendFraction`; the owner can set the fraction higher in BN8 |
| 3 informed | 4S TIX API owned | forecast-driven trading with the sizing below |

The blind stage exists because $250m is 1% of the 25b item; it must make money without forecasts for a while. The estimator keeps a
rolling window per symbol (price changes per tick over `stocks.window` ticks, default 40, about 4 min) and estimates `f` as the share of
up-ticks, shrunk toward 0.5 by the standard error. Because every stock shares one random `v` per tick, a window of the market-wide
average move is subtracted first so market noise does not look like an outlook. This is the least certain part of the design: it needs the
spike in §7 before anyone relies on it.

### 4.2 Edge model
Per stock, with `f` = forecast (4S) or the shrunk estimate (blind) and `mv` = volatility in percent per tick:
```
edge_long  = (2f - 1) * mv / 200          expected fractional move per tick, long
edge_short = -edge_long                   short profits from the opposite
cost_round = 2 * commission / position    round trip, as a fraction of the position
```
A position is worth opening when `|edge| * expectedHoldTicks > cost_round + spreadPerc` (the spread is the bid/ask gap; `getAskPrice`
and `getBidPrice` are already read in `tools/stocks.js`) and `|f - 0.5| >= stocks.minEdge` (default 0.08, i.e. `f > 0.58` or `< 0.42`).
Forecast cycles every 75 ticks flip some stocks, so `expectedHoldTicks` is capped at 75 and the position is re-evaluated every tick.

### 4.3 Position sizing
- Fractional Kelly on the per-tick edge: `frac = clamp(kellyScale * edge / variance, 0, maxPerStock)` with `variance = (mv/100)^2 / 3`
  (uniform `v`) and `kellyScale = 0.25` (quarter Kelly, `stocks.kellyScale`).
- Hard caps: `stocks.maxPerStock` (default 0.2 of equity), `stocks.maxExposure` (default 0.9 of equity in total, longs plus shorts),
  `stocks.maxShortFraction` (default 0.4 of equity short), never more than `getMaxShares - owned`.
- Market impact: do not trade more shares than `shareTxUntilMovement` per order without re-reading the price (each order moves the price
  once the counter is exhausted); split large orders over ticks. `stocks.impactSafety` (default 0.5) scales it. Real numbers come from
  the spike.
- Minimum trade `max(stocks.minTrade, 100 * commission)` so commissions stay below 1%.

### 4.4 Risk limits
- Stop loss per position: close when the position is down `stocks.stopLoss` (default 0.08) from its average price.
- Portfolio drawdown stop: if equity falls `stocks.maxDrawdown` (default 0.25) below its running peak, close everything and pause for
  `stocks.cooldownMin` (default 30 min), then restart at half size. Logged to `data/stocks.txt` and `data/events.txt`.
- Forecast flip exit: close a long when `f < 0.5` (short when `f > 0.5`) as `tools/stocks.js` does today with `sellBelow`.
- Limit/stop orders (BN8 or SF8.3) are an optimization, not required: v1 uses market orders only. A resting stop order per position is
  safer when the loop is stalled, so it is the first follow-up after v1.
- Liquidate before installs and before destroy, using the existing `cfg.stocks.liquidate` flag (no new coupling), and keep `post-install`
  clearing it.
- Kill switch: `bb settings set stocks.enabled=false` closes everything and stops. `stocks.dryRun=true` logs the plan and makes no
  `ns.stock` order call (same pattern as `gang.dryRun`).

### 4.5 Outputs
`data/stocks.txt` (existing file, extended fields): `stage`, `equity`, `cash`, `holdings`, `exposure`, `peak`, `drawdown`, `realized`,
`trades`, `incomePerMin` (rolling 30 min of equity change excluding deposits), `positions[]` with side, shares, average, forecast, edge.
`lib/kpi.js` and the dashboard read it; `lib/progress`/predictor use `incomePerMin` as the BN8 income (today they use script income,
which is 0 in BN8). Attention flags: `stocks: drawdown stop` and `stocks: blind stage for more than 4 h` (a signal that the estimator
does not earn).

### 4.6 Settings (schema group `stocks`, owner `stocks`)
`stocks.enabled` (true), `stocks.dryRun` (false), `stocks.accessSpendFraction` (0.25), `stocks.minEdge` (0.08), `stocks.kellyScale`
(0.25), `stocks.maxPerStock` (0.2), `stocks.maxExposure` (0.9), `stocks.maxShortFraction` (0.4), `stocks.stopLoss` (0.08),
`stocks.maxDrawdown` (0.25), `stocks.cooldownMin` (30), `stocks.blindFraction` (0.2), `stocks.window` (40), `stocks.minTrade` (50e6),
`stocks.impactSafety` (0.5). The old `cfg.stocks` keys in `lib/config.js` are read as fallbacks for one release, then removed.

## 5. BN8 bootstrap and planner changes
1. **No hacking income.** `daemon.js` and `agent/daemon-lite.js` must not spend RAM on hack/grow/weaken for money in BN8. `ram.*` settings
   already let the RAM manager shift RAM to share/xp (`strategy.*`); the BN8 rule is a clamp: `moneyWeight = 0`. The hacking level for
   w0r1d_d43m0n (3000) still needs xp: the xp loop stays.
2. **Cloud servers off.** `lib/cloud.js` buys through `ns.cloud.getServerCost`; with softcap 4 the ladder is a money sink in a node with no income. Gate: skip
   `planCloud` when `ns.cloud.getServerCost(minRam) > money * ram.cloud.maxSpendFraction` (the setting exists), plus a BN8 test.
3. **Donate for rep early.** `snap.favorToDonate` is 0 in BN8 (`ns.getFavorToDonate`), and `lib/augplan.js` `donateThreshold` already
   takes the game value as the floor (`Math.max(favorToDonate, augs.donateAtFavor)`), but `augs.donateAtFavor` defaults to 150:
   in BN8 the effective threshold stays 150. Spec change: the setting's floor must not exceed the game value in BN8 (or
   `augs.donateAtFavor` becomes `min(setting, game value)` when the game value is below it). One-line change plus test.
4. **Planner money input.** `plan()` uses `snap.income` ($/s from scripts). In BN8 `sl-plan.js` must pass the stock module's
   `incomePerMin / 60` instead.
5. **Install timing.** An install resets money; positions must be closed first (see §4.4). The planner's install ETA must include the
   time to liquidate (one tick) and the commission.
6. **BN8 target setting.** `node.targets={"8":0}` keeps the bot out of BN8 until the module exists; once built the default order
   (`DEFAULT_BN_ORDER`) already contains BN8 after BN6 and BN7.

## 6. Risk
Money loss in BN8 only matters inside BN8 (a reset node, saves are backed up before destroy and hourly). A bug in the module cannot
touch other nodes if `stocks.enabled` stays true everywhere, because the same module also trades in other nodes: the rollout therefore
starts with `stocks.dryRun=true` in non-BN8 nodes and compares the plan with the existing `tools/stocks.js` results before enabling.
Highest risk: the blind-stage estimator losing the $250m. Mitigation: `blindFraction` 0.2 and the drawdown stop.

## 7. Spikes (measure before building the module)
Each is a read-only script or a log run on the live game; none changes game state.
1. Price impact: log `shareTxUntilMovement` and the price after a 10-share buy/sell on one cheap stock (any node with TIX API).
2. Blind estimator: record 24 h of price ticks for all stocks (cheap: `ns.stock.getPrice` per tick) and back-test the estimator against
   the ground truth `getForecast` once 4S is owned; the estimator must reach `|f_hat - f| < 0.1` on at least 70% of stocks, else the
   blind stage is replaced by "sit in cash until 4S" (slower but safe).
3. Prestige behavior: does an aug install keep stock positions or cash? (`src/Prestige.ts` and one controlled test in a non-BN8 node.)
4. Hash/`getVolatility` units (fraction or percent) on the live API.

## 8. Tests (plain Node, `test/stockplan.js`)
Pure planner: stage selection, edge sign for long/short, cost threshold, Kelly sizing and every cap, drawdown stop and cooldown, stop loss,
forecast-flip exit, liquidate flag, impact splitting, dry run produces no orders, invalid/NaN inputs produce no orders. A fake `ns.stock`
market (like `test/helpers/fake-game.js`) simulates 10,000 ticks with the real update rule and asserts: positive expected equity with a
true forecast edge, no trade without edge, drawdown stop fires, no order after `enabled=false`. Static RAM test as in
`test/ram-xp-static.js` (ns.stock functions only in `tools/stocks.js`).

## 9. Effort and order
About 5 PRs: (1) spikes + `data/stocks.txt` extension and the income feed, (2) `lib/stockplan.js` + tests, (3) `tools/stocks.js` rewrite
behind `stocks.dryRun`, (4) BN8 bootstrap changes (§5), (5) enable + dashboard row. Rough size: 3 to 5 agent sessions. The module is also
useful outside BN8 (a better long/short trader in every node once SF8.2 is owned), which is why it is the first readiness item.
Acceptance: a BN8 run reaches $100b equity from $250m without a hacking income, with no drawdown stop left unresolved and a documented
income curve.
