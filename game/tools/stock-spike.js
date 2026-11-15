/**
 * tools/stock-spike.js — READ-ONLY stock-market logger for the BN8 spike (docs/specs/bn8-spike.md). Never buys, sells, shorts or places
 * an order: it only calls ns.stock getters and writes data/stock-spike.txt.
 *
 *   run tools/stock-spike.js [maxTicks]        default 5000 ticks (about 8 h at 6 s); keeps the newest maxTicks lines
 *
 * Needs TIX API access (BN8 starts with it). Records prices every tick; once the 4S TIX API is owned it also records forecasts and
 * volatilities (switching on automatically). Analyze offline: `bb read data/stock-spike.txt > spike.txt && node server/stockspike-report.js spike.txt`.
 * Log format: see game/lib/stockspike.js. No imports on purpose (nothing else in the game depends on this file).
 * @param {NS} ns
 */
const FILE = "data/stock-spike.txt";
const TRIM_EVERY = 500;
const r6 = (x) => Number(Number(x).toPrecision(8));

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const st = ns.stock;
  const cap = Math.max(100, Math.min(50000, Math.floor(Number(ns.args[0])) || 5000));
  if (!st.hasTixApiAccess()) { ns.tprint("[stock-spike] no TIX API access: nothing to log (this script never buys anything)"); return; }
  const syms = st.getSymbols();
  let had4S = null, lines = 0;
  const raw = ns.read(FILE);
  if (raw) lines = raw.split("\n").filter(Boolean).length;
  const info = (has4S) => JSON.stringify({ k: "i", t: Date.now(), s: syms, max: syms.map((s) => st.getMaxShares(s)),
    ask: syms.map((s) => r6(st.getAskPrice(s))), bid: syms.map((s) => r6(st.getBidPrice(s))), has4S }) + "\n";
  ns.tprint(`[stock-spike] logging ${syms.length} stocks to ${FILE} (keeps the newest ${cap} ticks); read-only`);
  while (true) {
    const has4S = st.has4SDataTixApi();
    if (has4S !== had4S) { ns.write(FILE, info(has4S), "a"); lines++; had4S = has4S; }
    const t = { k: "t", t: Date.now(), p: syms.map((s) => r6(st.getPrice(s))) };
    if (has4S) { t.f = syms.map((s) => r6(st.getForecast(s))); t.v = syms.map((s) => r6(st.getVolatility(s))); }
    ns.write(FILE, JSON.stringify(t) + "\n", "a");
    lines++;
    if (lines > cap + TRIM_EVERY) {
      const all = ns.read(FILE).split("\n").filter(Boolean);
      const infos = all.filter((l) => l.startsWith('{"k":"i"')), ticks = all.filter((l) => !l.startsWith('{"k":"i"')).slice(-cap);
      ns.write(FILE, [...infos.slice(-2), ...ticks].join("\n") + "\n", "w");
      lines = infos.slice(-2).length + ticks.length;
    }
    await st.nextUpdate();
  }
}
