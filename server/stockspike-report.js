#!/usr/bin/env node
// Offline report for the BN8 stock spike (docs/specs/bn8-spike.md).
//   bb read data/stock-spike.txt > spike.txt && node server/stockspike-report.js spike.txt [--json]
// Exit code: 0 all gates pass or not all evaluable, 1 a gate fails, 2 usage / unreadable file.
import fs from "node:fs";
import { parseSpikeLog, analyze, formatReport } from "../game/lib/stockspike.js";

export function reportFile(file) {
  const text = fs.readFileSync(file, "utf8");
  return analyze(parseSpikeLog(text));
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href;
if (isMain) {
  const args = process.argv.slice(2), json = args.includes("--json"), file = args.find((a) => !a.startsWith("--"));
  if (!file) { console.error("usage: node server/stockspike-report.js <stock-spike.txt> [--json]"); process.exit(2); }
  let rep;
  try { rep = reportFile(file); } catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(2); }
  console.log(json ? JSON.stringify(rep, null, 1) : formatReport(rep));
  process.exit(rep.pass === false ? 1 : 0);
}
