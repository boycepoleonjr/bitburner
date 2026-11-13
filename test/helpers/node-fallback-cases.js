// Scenarios shared by test/node-fallback.js and the golden fixture (test/fixtures/node-fallback-golden.json).
// The golden file was generated from lib/nodectl.js BEFORE node.fallback existed; it must keep matching in "recommend" mode.
const T0 = Date.UTC(2026, 10, 13, 12);
const SF_MIX = [{ n: 1, lvl: 3 }, { n: 4, lvl: 3 }, { n: 5, lvl: 3 }, { n: 10, lvl: 3 }, { n: 2, lvl: 3 }, { n: 3, lvl: 3 }, { n: 11, lvl: 3 }];
const SF_ALL = Array.from({ length: 14 }, (_, i) => ({ n: i + 1, lvl: 3 })).filter((x) => x.n !== 12);
const ON = { "node.autoDestroy": true, "node.autoSelect": true };
export const CASES = [
  { name: "autoSelect off", st: { bn: 5, sourceFiles: [{ n: 1, lvl: 1 }, { n: 4, lvl: 1 }] }, s: {} },
  { name: "autoSelect off, destroy on", st: { bn: 5, sourceFiles: [{ n: 1, lvl: 1 }] }, s: { "node.autoDestroy": true } },
  { name: "order available", st: { bn: 5, sourceFiles: [{ n: 1, lvl: 1 }] }, s: { ...ON, "node.order": [10, 2] } },
  { name: "order first maxed, second available", st: { bn: 5, sourceFiles: [{ n: 10, lvl: 3 }] }, s: { ...ON, "node.order": [10, 2] } },
  { name: "order exhausted -> recommendation", st: { bn: 11, sourceFiles: SF_MIX }, s: { ...ON, "node.order": [10, 2, 3, 11] } },
  { name: "order empty -> recommendation", st: { bn: 5, sourceFiles: [{ n: 1, lvl: 1 }] }, s: { ...ON } },
  { name: "order exhausted, autoDestroy off", st: { bn: 11, sourceFiles: SF_MIX }, s: { "node.autoSelect": true, "node.order": [10, 2, 3, 11] } },
  { name: "every SF maxed except SF12 (infinite)", st: { bn: 13, sourceFiles: SF_ALL }, s: { ...ON, "node.order": [10] } },
  { name: "not ready", st: { ready: false, bn: 11, sourceFiles: SF_MIX }, s: { ...ON, "node.order": [10, 2, 3, 11] } },
];
export const mkState = (o = {}) => ({ ready: true, bn: 5, sourceFiles: [], now: T0, request: null, ack: null, ...o });
export { T0, SF_MIX, SF_ALL, ON };
