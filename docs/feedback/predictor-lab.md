# Predictor lab log (F-002)

One pre-registered experiment per run of the "Bitburner predictor lab" routine. Each entry is written BEFORE the
experiment runs (hypothesis, windows, metric, acceptance rule) and the result is appended after. Negative results stay.
Data is a read-only snapshot of the live game (`POST /api/ro/read`), never committed. Backlog order: (a) hybrid point,
(b) regime-aware reset prior, (c) install-aware censoring, (d) cycle-phase cells with shrinkage, (e) quantile regression
+ conformal, (f) local-linear-trend / change-point base model, (g) ensemble weights by recent pinball loss with forgetting.

Standing acceptance rule (every experiment): held-out interval score improves by >= 5% with a block-bootstrap 95% CI
(resampling install cycles) of the paired difference that excludes 0; median |log error| no worse than +10% on any
held-out kind x bucket with n >= 30; overall 80%-band coverage moves toward 80%; RAM/CPU limits of
docs/specs/predictor-v3.md hold (pure predcal.js, no new ns calls, calibration time about the same).

## Snapshot limits (read before comparing runs)
`/api/ro/read` returns at most the last 2,000,000 bytes of `data/pred2.txt`, so a lab snapshot starts later than the
v3 PR's full-file snapshot (first prediction 2026-09-27). Lab numbers are recomputed on the lab snapshot for both the
baseline and the candidate; they are not directly comparable with the PR #52 tables.

---

## Run 2026-11-16 — experiment (a): hybrid point per cell

Data: snapshot 2026-11-16 ~13:15 UTC. `pred2.txt` tail: 4,060 predictions (first 2026-10-08 13:34 UTC), 2,336 resolved
with their prediction present, 1,707 voided by an install; `install-log.txt` 164 installs. New since the v3 PR snapshot
(2026-11-14 03:10 UTC): 342 resolved outcomes (317 answered by v3 live, live since 2026-11-14 04:45 UTC).

### Pre-registration (written before the experiment ran)
- Hypothesis: v3's ensemble point is worse than a simpler point (v2's own logged point, or the plain median of the base
  models) in a few long-horizon cells (PR #52: level >3h +12%, money >3h +34% median error). Using the better point in
  those cells and calibrating v3's conformal band around it (honest residuals against the point actually used, same
  ACI + shrinkage) lowers point error there and, because the residual spread shrinks, the interval score.
- Windows: tuning = predictions made before the median `made` time of the snapshot (2026-10-29 22:11 UTC; 1,205
  resolved); held-out = made at or after it (1,131 resolved). Replay is rolling-origin over the whole snapshot (no
  look-ahead); only the cell choice is fit, on tuning rows only.
- Selection rule (tuning half only): for each kind x bucket with >= 30 tuning outcomes, compare the median |log error|
  of v3's point, v2's logged point and the base-model median; override the cell with the best alternative only if it
  beats v3's point by >= 10%. The override set is frozen before held-out rows are scored.
- Candidate: shipped `DEFAULTS` plus `pointOverride = {cell: "v2" | "med"}` for the chosen cells (band = v3's
  conformal band computed on residuals of the overridden point). A literal variant (v3's lo/hi kept, only the point
  swapped) is reported for point error only: its interval score equals v3's by construction.
- Metric: held-out interval score (log space, alpha 0.2), paired difference candidate - v3 with a 95% block bootstrap
  over install cycles (2,000 resamples, seed 7); secondary: median |log error| per bucket, coverage.
- Acceptance: the standing rule above.

### Baseline backtest (shipped v3 `DEFAULTS`, lab snapshot; 95% block-bootstrap CIs over install cycles)
| window | n | cycles | v2 coverage | v3 coverage [CI] | v2 IS | v3 IS [CI] | v2 median log err | v3 median log err [CI] |
|---|---|---|---|---|---|---|---|---|
| PR #52 held-out (2026-10-21 08:21 → 11-14 03:10) | 1,231 | 45 | 0.530 | 0.769 [0.680, 0.847] | 4.27 | 3.20 [2.39, 4.01] | 0.204 | 0.120 [0.052, 0.275] |
| PR #52 as published (full file) | 1,222 | 61 | 0.528 | 0.729 [0.651, 0.818] | 4.29 | 3.18 | 0.204 | 0.114 |
| new since v3 snapshot (made ≥ 11-14 03:10) | 333 | 6 | 0.616 | 0.865 [0.747, 0.886] | 2.59 | 2.49 [1.94, 4.07] | 0.165 | 0.161 [0.045, 0.606] |
| lab held-out (made ≥ 10-29 22:11) | 1,131 | 34 | 0.560 | 0.811 [0.719, 0.867] | 3.69 | 2.91 [2.29, 3.80] | 0.195 | 0.147 [0.067, 0.267] |

Paired v3 − v2 interval score: lab held-out −0.77 [−1.87, −0.02]; new data −0.10 [−1.62, +0.47] (6 cycles, not
significant). Censored definite misses, lab held-out: v2 20.0%, v3 3.2%. Calibration replay of 4,060 predictions: 3.1 s.
v3 now slightly over-covers on new data (86.5%; rep 20-60m 0.97, level >3h 0.94), matching the live check-in (86%).

### Result
Override set chosen on the tuning half (>= 10% better than v3's point there): money >3h → v2, money 20-60m → v2,
rep >3h → med, rep 1-3h → med, level >3h → med.

| held-out | v3 | hybrid | change |
|---|---|---|---|
| interval score | 2.912 | 3.067 | +5.3% (worse), paired CI [−0.001, +0.362] |
| coverage | 0.811 | 0.799 | toward 80% |
| median log err, money >3h (n 194) | 0.766 | 0.578 | −25% |
| median log err, money 20-60m (n 58) | 0.468 | 0.578 | +24% |
| median log err, rep >3h (n 209) | 0.125 | 0.192 | +54% |
| median log err, rep 1-3h (n 138) | 0.013 | 0.013 | 0% |
| median log err, level >3h (n 105) | 0.963 | 0.980 | +2% |

Verdict: **rejected.** Interval score is worse, not 5% better, and two buckets with n >= 30 lose more than 10% point
accuracy. Same direction on the PR #52 window (+1.6%) and on the new data (+3.2%). The literal variant (v3 band kept)
has the hybrid's point errors and v3's interval score, so it fails the same rule.

Learned: per-cell point rankings from the tuning half mostly do not transfer (rep >3h median was 35% better than v3 on
tuning and 54% worse held-out; level >3h 65% better, then 2% worse). The prequential ensemble already adapts to this.
The one ranking that held in all three windows is money >3h → v2's point (tuning −24%, held-out −25%, new −32%).
That was found after looking at held-out data, so it is a hypothesis, not a result. If it is tested, it gets its own
pre-registration and only data made after 2026-11-16 13:15 UTC counts as held-out.
