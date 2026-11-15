# Spec: BN8 spike — read-only stock-market measurements (docs/specs/bn8-spike.md)

Status: planned 2026-11-14. First PR of the build order in `docs/specs/bn8-readiness.md` §9 (the owner chose BN8 first, starting with its
read-only spike). No trading, no new setting, no change to any existing script.

## 1. Goal
Settle the four spikes of `bn8-readiness.md` §7 before anyone writes `lib/stockplan.js`:
1. price impact of our own orders,
2. whether a forecast-free ("blind") estimator can earn before the 4S TIX API,
3. what an aug install and a destroy do to money and positions in BN8,
4. the units of `getVolatility` / `getForecast`.

Items 1, 3 and 4 are decided by the game source (below), so they need no live run. Item 2 needs data and a way to score an estimator
against ground truth; this PR ships the read-only logger, the estimator and scorer (pure, unit-tested on a simulated market that uses the
game's real update rules), and an offline report. The owner runs the logger and sends back one file.

## 1b. Live context (audit readback, 2026-11-14)
`node.targets` is `{"8":0,"9":0,"15":0}` (settings rev 10). Live Source-Files: SF1, SF2, SF4, SF5, SF10 at 3; **no SF8**; the game is in BN3. Remaining destroys: 11
(BN3 x2 after this one, BN11 x3, BN6 x3, BN7 x3) with `node.order=[2,3,11,6,7]` and `node.fallback=stop`; the order-running-low warning has not fired (11 > 2). Consequences:
- BN8 is at least 11 destroys away and held at target 0, so **the logger cannot wait for a BN8 run**; it has to run in the current node.
- TIX API access is not free outside BN8 without SF8: `ns.stock.getPrice` needs WSE ($200m) + TIX API ($5b). The logger never buys them. `hooks.stocksHook`/`tools/stocks.js` buy WSE, TIX API, 4S Market Data and 4S TIX API in order when
  `cash * 0.25 >= cost`, so whether they are already owned is visible in `data/stocks.txt` (`access`); that file was not part of the readback (open question for the audit session).
- The 4S TIX API ($25b; BN3 does not change the 4S multipliers) is probably far in BN3, which is why the spike now has a gate that needs prices only (G5 below). With prices alone the live run still
  decides the question that matters for the BN8 plan: does following the blind estimator earn after spread on the real market.

## 2. Findings from the v3.0.1 source (read 2026-11-14)
Files under `https://raw.githubusercontent.com/bitburner-official/bitburner-src/v3.0.1/src/`:
`Prestige.ts`, `StockMarket/{StockMarket.ts, Stock.ts, StockMarketHelpers.ts, BuyingAndSelling.tsx, data/Constants.ts, data/InitStockMetadata.ts}`,
`NetscriptFunctions/StockMarket.ts`.

| # | Finding | Where | Consequence for `bn8-readiness.md` |
|---|---|---|---|
| 1 | **Our orders do not move the price.** `getBuyTransactionCost` is `shares * ask + commission`; a transaction only calls `processTransactionForecastMovement`, which lowers the stock's outlook magnitude `otlkMag` by `0.006` per `shareTxForMovement` shares traded (12,000 to 216,000 shares per stock) and never below 5. `shareTxUntilMovement` refills by 10 per tick. | `StockMarketHelpers.ts` 1-109, `Stock.ts` (`StockForecastInfluenceLimit = 5`), `StockMarket.ts` `processStockPrices` | §4.3 "market impact" is wrong: there is no price impact. The real limits are the spread, `getMaxShares`, and a slow decay of the forecast of stocks we trade a lot. Replace the impact rule with a per-stock traded-share counter. |
| 2 | **`getVolatility` is a decimal fraction**: `mv * darknetMult / 100`. The per-tick move is `v * mv / 100` with `v` uniform in (0,1), so `getVolatility` is the maximum per-tick move and the mean absolute move is half of it. `getForecast` is `(50 +- otlkMag) / 100`, also a decimal. | `NetscriptFunctions/StockMarket.ts` `getVolatility`, `getForecast` | §4.2 `edge = (2f - 1) * vol / 2` with `vol = getVolatility()` (not `mv/200` with a percent). Spike 4 closed. |
| 3 | **`v` is shared, the direction is not.** One `Math.random()` per tick scales the magnitude of every stock; each stock then draws its own up/down with probability `forecast`. Up: `price * (1 + av)`; down: `price / (1 + av)`. | `StockMarket.ts` lines 260-295 | §4.1 "subtract the market-wide average move" is wrong: market noise is magnitude only. The up/down sign is an unbiased Bernoulli(`f`) per stock, so counting signs is the right blind estimator. |
| 4 | **An aug install in BN8 sets money to exactly $250,000,000** (`Player.money = BitNode8StartingMoney`, an assignment, not an addition) **and re-creates the whole market** (`initStockMarket()`): positions vanish, forecasts are re-rolled. A BitNode destroy does the same. With SF8 (`canAccessBitNodeFeature(8)`) WSE and TIX API are granted again after each install. | `Prestige.ts` 161-171 and 302-331 | Cash earned before an install is **lost**, positions too. In BN8 an install is only worth it after every dollar was spent on augs/donations; liquidating first is necessary but not sufficient. The planner must treat BN8 installs as "$250m resets" (the BN8 plan needs the money for the next batch rebuilt from $250m each time). Spike 3 closed; `bn8-readiness.md` §5.5 is rewritten. |
| 5 | Forecast dynamics: every 75 ticks (about 7.5 min) each stock flips its sign with probability 0.45 (`b = !b`); each tick `otlkMag` drifts by `otlkMag * av` (or by 1 / x10 steps when below 5) with a bias toward its second-order forecast. | `StockMarket.ts` `stockMarketCycle` and the tick loop, `Stock.ts` `cycleForecast` | A blind estimator needs memory short enough to follow flips (expected 1 flip per 167 ticks, about 17 minutes) and long enough for the sign counts to mean something: exponential weights with a half-life of 20 to 40 ticks. |
| 6 | 33 stocks. Per stock (from `InitStockMetadata.ts`): max move `mv` 0.4% to 4% per tick, spread 0.1% to 2% (each way), starting `otlkMag` 0 to 19 (forecast 31% to 69%), market cap 3e10 to 2.4e12, `shareTxForMovement` 12,000 to 216,000. | `InitStockMetadata.ts` | Spread dominates cost for the small caps; the first candidates are the large caps (mv 0.4% to 1.3%, spread 0.1% to 1%, otlk 7 to 19). Round trip of 0.2% to 2% needs a hold of a few ticks at `f = 0.65`. |
| 7 | Tick every 6 s (4 s minimum); commission $100k per transaction; 4S TIX API $25b, 4S data $1b; BN8 gives WSE + TIX API from the start, shorting and limit/stop orders. | `data/Constants.ts`, `BitNode.tsx` BN8 | unchanged |

Not decided by the source, left to the logger: the real `maxShares` per stock (`getMaxShares`), how fast `otlkMag` drifts in practice, and
whether the sign estimator reaches the accuracy gate below on live data.

## 3. Deliverables
1. `game/lib/stockspike.js` (pure, no `ns`): `moveSigns`, `estimateForecast` (exponentially weighted sign share, shrunk toward 0.5),
   `backtest` (scores an estimator against ground-truth forecasts), `parseSpikeLog`, `analyze` (log -> report with the pass/fail gates), `formatReport`.
2. `game/tools/stock-spike.js`: read-only logger. Needs TIX API access (BN8 has it); never buys, sells, shorts or places orders. One JSONL line per tick
   in `data/stock-spike.txt`: prices, plus forecasts and volatilities once the 4S TIX API is owned; an `info` line with `maxShares`, bid/ask spread at start and when
   4S ownership changes. Keeps the newest N ticks (default 5000, about 8 h; `run tools/stock-spike.js 8000`).
3. `server/stockspike-report.js`: `node server/stockspike-report.js <file>` prints the report (`bb read data/stock-spike.txt > spike.txt` first).
4. `test/helpers/stock-sim.js`: a seeded simulator of the real update rules (finding 3 and 5), used by the tests.
5. Tests: `test/stockspike.js` (pure functions, the simulator, the analyzer, the report CLI) and static checks that the logger contains no mutating
   `ns.stock` call, no import, and that no existing script imports the new files (so no existing script's RAM changes).
6. `docs/specs/bn8-readiness.md` corrected for findings 1 to 5 (sections 2, 4.1, 4.2, 4.3, 5, 7).

## 4. Gates (what "the spike passes" means)
Evaluated by `analyze` on a log that contains forecasts (so after the 4S TIX API is bought, or on any save that has it):
| Gate | Rule | If it fails |
|---|---|---|
| G1 estimator accuracy | at least 70% of (stock, tick) pairs after a 40-tick warmup have `abs(f_hat - f) < 0.10` | the blind stage becomes "sit in cash until 4S" (`bn8-readiness.md` §7 item 2) |
| G2 estimator direction | for stocks with `abs(f - 0.5) >= 0.08`, `f_hat` is on the correct side of 0.5 by at least 0.01 in at least 75% of ticks (the margin keeps an estimator that always answers about 0.5 from passing) | same |
| G3 volatility units | observed maximum per-tick move over the log is within 3% of `getVolatility` for at least 80% of stocks with 2000+ ticks (it is a maximum, so the largest observed move approaches it from below) | the edge formula's constant is re-derived from the data |
| G4 tick cadence | median tick interval between 4 s and 8 s | the stage timings in `bn8-readiness.md` §4.1 are re-based |
| G5 strategy replay (**prices only**) | replay the blind strategy on the logged real prices: long when the estimate is above 0.55, short below 0.45, one one-way spread paid per position change, equal weight over the stocks. Over non-overlapping 25-tick blocks the mean return must be > 0 with t >= 2. Needs at least 40 blocks (1000 ticks); positive but t < 2 is **inconclusive** until 150 blocks (3750 ticks), then FAIL; mean <= 0 is FAIL | the blind stage becomes "sit in cash until 4S" |
G5 is the decisive gate for the blind stage and the only one a price-only log (no 4S) can evaluate together with G4. On the simulated market a 5000-tick log passes it (t of 3.2 to 4.1); a structureless random walk fails it hard (t of -30: the strategy only pays the spread), and 2600-tick logs are often inconclusive (t of 1.4 to 1.6), so plan on the full 5000 ticks (about 8 h).
The report also prints spread statistics, per-stock `maxShares`, and the realized edge of a long/short follower of `f_hat` versus one that follows the true forecast (an upper bound), without commissions and with 2x spread.

## 4a. Market re-creation inside a log
An aug install or a destroy re-creates the whole market (finding 4): every price jumps by a random factor in one tick, and forecasts are re-rolled. A log that spans an install (likely over 8 h in BN3,
where the autopilot installs several times a day) contains that jump. The analysis treats a per-stock move above `|ln| > 0.1` (a normal tick moves at most `ln(1.04) = 0.039`) as a re-creation of that stock:
no move across it counts for G3 or the replay, the stock's estimator restarts, and it is scored again only after the 40-tick warmup. Ticks where at least half of the stocks jump are reported as
"market re-created N time(s)". Starting a fresh log after an install is therefore not required. (Raised in review of #55.)

## 4b. What the simulator says (not the live market)
`test/helpers/stock-sim.js` implements the update rules of §2 (shared `v`, per-stock direction, 75-tick sign flips with probability 0.45, `otlkMag` drift) with
parameters in the ranges of `InitStockMetadata.ts`. Five seeds of 4000 ticks, 33 stocks, default estimator (half-life 20, prior 8): within 0.10 of the true
forecast in 79.7% of scored pairs (G1 needs 70%), correct side by at least 0.01 in 81.2% (G2 needs 75%); a long/short follower with a 0.45/0.55 dead band earns about
1.2e-3 per stock-tick gross and about 1.5e-4 net of one spread per position change, against 2.0e-3 net for an oracle that knows the true forecast. A shorter half-life
(8 to 15) is more accurate (up to 82% on G2) but churns, and its net edge goes negative. These numbers say the gates are reachable and the estimator is not obviously
broken; they do not say the live market behaves like the simulation. The live log decides.

## 5. Out of scope
No `ns.stock` order function, no `stocks.*` settings, no change to `tools/stocks.js` or `hooks.stocksHook`, no dashboard row, no planner or predictor change. The module itself is PR 2 onward.

## 6. RAM
The logger uses only `ns.stock` getters and `ns.write/read`; it is started by hand (`run tools/stock-spike.js`) and by nothing else. The new files are not imported by any
existing script, which a test asserts, so no existing script's RAM changes.

## 7. Risk
None for the game: the logger cannot trade (static test on the source) and only writes `data/stock-spike.txt`. Its cost is home RAM while running and a few MB of file; the
default cap keeps the file under about 4 MB. The estimator is an experiment: it only becomes live code in PR 2 if the gates pass.

## 8. How the owner runs it
1. After merge and deploy, `bb push tools/stock-spike.js` (the pure lib is only needed by the Node report, not in game).
2. In the current node (BN3 per the readback), once WSE + TIX API are owned (check `data/stocks.txt`; the logger never buys them): `run tools/stock-spike.js` on home and leave it for 8 h (5000 ticks, the default cap) for a decisive G5.
3. `bb read data/stock-spike.txt > spike.txt && node server/stockspike-report.js spike.txt`; send the report (or the file) back.
4. G1 to G3 need the 4S TIX API at some point of the log (the logger switches to recording forecasts automatically); G4 and G5 do not. A price-only report is therefore expected to read "not every gate could be evaluated" with G5 PASS or FAIL.
