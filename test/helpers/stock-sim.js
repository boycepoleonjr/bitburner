// Seeded simulator of the stock-market update rules of bitburner-src v3.0.1 (StockMarket.ts processStockPrices / stockMarketCycle,
// Stock.ts cycleForecast / cycleForecastForecast / flipForecastForecast). Used to test lib/stockspike.js against known ground truth.
// Parameter ranges follow data/InitStockMetadata.ts (mv 0.4-4 %, spread 0.1-2 %, otlkMag 0-19). Not a replacement for the live log.
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function simulate({ seed = 1, ticks = 2000, stocks = 33, startMs = Date.UTC(2026, 10, 14), tickMs = 6000 } = {}) {
  const R = rng(seed), u = (lo, hi) => lo + (hi - lo) * R();
  const S = Array.from({ length: stocks }, () => {
    const s = { price: u(20, 30000), mv: u(0.4, 4), spread: u(0.1, 2) / 100, otlk: u(0, 19), b: R() < 0.5 };
    s.fcast2 = s.b ? 50 + s.otlk : 50 - s.otlk;
    return s;
  });
  const abs = (s) => (s.b ? 50 + s.otlk : 50 - s.otlk);
  const info = { k: "i", t: startMs, s: S.map((_, i) => `S${i}`), max: S.map(() => 1e6), ask: S.map((s) => s.price * (1 + s.spread)), bid: S.map((s) => s.price * (1 - s.spread)), has4S: true };
  const out = [], vols = S.map((s) => s.mv / 100);
  let untilCycle = 75;
  for (let t = 0; t < ticks; t++) {
    if (--untilCycle <= 0) {
      untilCycle = 75;
      for (const s of S) if (R() < 0.45) { s.b = !s.b; s.fcast2 = 100 - s.fcast2; }
    }
    const v = R();
    for (const s of S) {
      const av = (v * s.mv) / 100;
      const chc = (s.b ? 50 + s.otlk : 50 - s.otlk) / 100;
      if (R() < chc) s.price *= 1 + av; else s.price /= 1 + av;
      let change = s.otlk * av;
      if (s.otlk < 5) change = s.otlk <= 1 ? 1 : change * 10;
      const inc = (50 + Math.min(Math.max(s.fcast2 - abs(s), -45), 45)) / 100;
      if (R() < inc) s.otlk += s.b ? change : -change; else s.otlk += s.b ? -change : change;
      s.otlk = Math.min(s.otlk, 50);
      if (s.otlk < 0) { s.otlk *= -1; s.b = !s.b; }
      const c2 = change / 2;
      s.fcast2 = Math.min(100, Math.max(0, s.fcast2 + (R() < 0.5 ? c2 : -c2)));
    }
    out.push({ k: "t", t: startMs + t * tickMs, p: S.map((s) => Number(s.price.toPrecision(8))), f: S.map((s) => abs(s) / 100), v: vols });
  }
  return { info, ticks: out, text: [JSON.stringify(info), ...out.map((o) => JSON.stringify(o))].join("\n") + "\n" };
}
