/**
 * lib/stockaccess.js — which stock-market access items tools/stocks.js may buy, and when it starts the BN8 spike logger. PURE (no ns,
 * no imports): unit-tested in test/stockaccess.js.
 *
 * The access items are bought in a fixed order: WSE account, TIX API, 4S Market Data, 4S TIX API (tools/stocks.js `access`). Only in BN8
 * are all of them allowed (BN8 starts with WSE + TIX API and the BN8 plan needs the 4S TIX API, docs/specs/bn8-readiness.md); in every other
 * BitNode the tool may buy only the first `limit` items (default 1 = the cheap WSE account), so it never spends on TIX ($5b) or 4S ($1b, $25b)
 * by itself. Owner override: config `stocks.accessOutsideBn8` (0 to 4).
 */
export const ACCESS_ITEMS = 4;
export const BN8 = 8;
export const DEFAULT_OUTSIDE_BN8 = 1;

/** How many of the access items (in order) may be bought in BitNode `bn`. Anything that is not an integer 0..4 falls back to the default. */
export function accessLimit(bn, outsideBn8 = DEFAULT_OUTSIDE_BN8) {
  if (bn === BN8) return ACCESS_ITEMS;
  return Number.isInteger(outsideBn8) && outsideBn8 >= 0 && outsideBn8 <= ACCESS_ITEMS ? outsideBn8 : DEFAULT_OUTSIDE_BN8;
}

/**
 * Start the read-only spike logger (tools/stock-spike.js, docs/specs/bn8-spike.md)? Only in BN8, with TIX API access (never bought for it),
 * not already running, enabled (`stocks.spikeLogger`, default true), and with at least `needGb + minFreeGb` of free home RAM so it cannot
 * starve a small fresh-BitNode home.
 * @param {{bn:number, hasTix:boolean, running:boolean, enabled?:boolean, freeGb:number, needGb:number, minFreeGb?:number}} s
 */
export function shouldStartSpike({ bn, hasTix, running, enabled = true, freeGb, needGb, minFreeGb = 64 }) {
  if (bn !== BN8 || !hasTix || running || enabled === false) return false;
  const free = Number(freeGb), need = Number(needGb), min = Number.isFinite(Number(minFreeGb)) ? Number(minFreeGb) : 64;
  return Number.isFinite(free) && Number.isFinite(need) && need > 0 && free >= need + min;
}
