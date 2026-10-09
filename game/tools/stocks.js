/**
 * tools/stocks.js — stock market module (started and kept alive by the daemon's stocks hook).
 *
 * 1. Access: buys WSE account → TIX API → 4S Market Data → 4S TIX API, each once
 *    money >= cost / accessSpendFraction (achievement "4S").
 * 2. Trading (needs 4S TIX API for forecasts): long-only (shorts need BitNode 8).
 *    - sell a position when its forecast drops below sellBelow
 *    - buy the strongest forecasts above buyAbove while holdings <= maxPortfolioFraction of equity
 *    - skip trades smaller than minTrade so the $100k commission stays negligible
 *    - stocks.liquidate = true (config override) sells everything and stops buying — do this
 *      before installing augmentations so the cash is spendable
 * 3. Writes data/stocks.txt (JSON summary) for tools/status.js / tools/goals.js.
 * Kill it any time; the daemon restarts it within a loop (disable: hooks.stocks.enabled=false).
 * @param {NS} ns
 */
import { loadConfig } from "lib/config.js";

const DEFAULTS = {
  accessSpendFraction: 0.25,
  buyAbove: 0.6,
  sellBelow: 0.5,
  maxPortfolioFraction: 0.5,
  minTrade: 50e6,
  commission: 100e3,
};

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const st = ns.stock;
  const f = (n) => ns.format.number(n, 2);
  let realized = 0;
  let trades = 0;

  while (true) {
    const k = st.getConstants();
    const c = { ...DEFAULTS, commission: k.StockMarketCommission, ...(loadConfig(ns).cfg.stocks ?? {}) };
    const cash = () => ns.getServerMoneyAvailable("home");
    const access = [
      ["WSE account", st.hasWseAccount, st.purchaseWseAccount, k.WseAccountCost],
      ["TIX API", st.hasTixApiAccess, st.purchaseTixApi, k.TixApiCost],
      ["4S Market Data", st.has4SData, st.purchase4SMarketData, k.MarketData4SCost],
      ["4S TIX API", st.has4SDataTixApi, st.purchase4SMarketDataTixApi, k.MarketDataTixApi4SCost],
    ];
    for (const [name, has, buy, cost] of access) {
      if (has()) continue;
      if (cash() * c.accessSpendFraction >= cost && buy()) ns.tprint(`[stocks] bought ${name} for $${f(cost)}`);
      break; // in order
    }

    let holdings = 0;
    const rows = [];
    if (st.hasTixApiAccess()) {
      for (const sym of st.getSymbols()) {
        const [long, avg] = st.getPosition(sym);
        const bid = st.getBidPrice(sym);
        holdings += long * bid;
        rows.push({ sym, long, avg, bid, ask: st.getAskPrice(sym), max: st.getMaxShares(sym) });
      }
    }

    const has4S = st.has4SDataTixApi();
    if (has4S) for (const r of rows) r.fc = st.getForecast(r.sym);
    if (has4S || c.liquidate) {
      // sells
      for (const r of rows) {
        if (r.long > 0 && (c.liquidate || r.fc < c.sellBelow)) {
          const price = st.sellStock(r.sym, r.long);
          if (price > 0) {
            const pnl = r.long * (price - r.avg) - 2 * c.commission;
            realized += pnl;
            trades++;
            holdings -= r.long * r.bid;
            ns.print(`SELL ${r.sym} ${f(r.long)} @ ${f(price)} pnl $${f(pnl)}`);
          }
        }
      }
    }
    if (has4S && !c.liquidate) {
      // buys, strongest forecast first
      const equity = cash() + holdings;
      let room = Math.max(0, equity * c.maxPortfolioFraction - holdings);
      for (const r of rows.filter((x) => x.fc > c.buyAbove).sort((a, b) => b.fc - a.fc)) {
        const shares = Math.floor(Math.min(r.max - r.long, (Math.min(room, cash()) - c.commission) / r.ask));
        if (shares <= 0 || shares * r.ask < c.minTrade) continue;
        const price = st.buyStock(r.sym, shares);
        if (price > 0) {
          room -= shares * price;
          trades++;
          ns.print(`BUY  ${r.sym} ${f(shares)} @ ${f(price)} (forecast ${(r.fc * 100).toFixed(0)}%)`);
        }
      }
    }

    ns.write("data/stocks.txt", JSON.stringify({
      at: Date.now(),
      access: access.map(([name, has]) => [name, has()]),
      holdings, realized, trades, liquidating: !!c.liquidate,
      positions: rows.filter((r) => r.long > 0).map((r) => ({ sym: r.sym, shares: r.long, avg: r.avg, bid: r.bid })),
    }), "w");

    if (st.hasTixApiAccess()) await st.nextUpdate();
    else await ns.sleep(30_000);
  }
}
