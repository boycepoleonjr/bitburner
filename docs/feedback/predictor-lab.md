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

---

## Run 2026-11-17 — experiment (b): regime-aware reset prior

Data: snapshot 2026-11-17 ~13:15 UTC. `pred2.txt` tail (2 MB cap): 4,028 predictions (first 2026-10-12 07:37 UTC),
2,352 resolved, 1,658 voided by an install; `install-log.txt` 166 installs. New since the 2026-11-16 run: 202 resolved
outcomes (known at or after 2026-11-16 13:15 UTC), 193 of them made after it.

### Pre-registration (written before the experiment ran)
- Hypothesis: the base models extrapolate rates measured across the install reset, so early-cycle predictions of
  recurring targets (same kind, faction and target value; 66 rep and 28 money targets recur in >= 3 cycles) are biased.
  A new ensemble member `pri` built only from earlier cycles — the time since install at which the same target was
  reached in each earlier cycle (median per cycle, then median over the last K cycles), minus the current time since
  install — gives the prequential ensemble an anchor that does not extrapolate across the reset. Expected: lower point
  error on rep and money (all horizons), therefore narrower honest residuals and a lower interval score.
- Member rules (no look-ahead): only outcomes with knownAt <= made and an earlier `lastAug` count; at least `minCycles`
  earlier cycles with the same `tkey`; the member is offered only if the prior is > 60 s. It is never part of `med`
  and gets weight only through the existing prequential loss (minModelN 8, tau 0.3). Bands unchanged (v3 conformal on
  the honest residual of whatever point the ensemble produced).
- Windows: tuning = made before the snapshot's median made time (2026-11-04 14:05 UTC; 1,173 resolved); held-out = made
  at or after it (1,179 resolved, 40 install cycles). Replay is rolling-origin over the whole snapshot.
- Tuning (tuning half only): K in {3, 5, all} x minCycles in {2, 3}, chosen by the backtest objective (interval score +
  coverage penalty). Frozen before held-out rows are scored.
- Metric: held-out interval score (log space, alpha 0.2), paired difference candidate − v3 with a 95% block bootstrap
  over install cycles (2,000 resamples, seed 7); secondary: median |log error| per kind x bucket, coverage. Also
  reported on rows made after 2026-11-16 13:15 UTC (never seen by any lab run).
- Acceptance: the standing rule above.

### Baseline backtest (shipped v3 `DEFAULTS`, this snapshot; 95% block-bootstrap CIs over install cycles)
| window | n | cycles | v2 coverage | v3 coverage [CI] | v2 IS | v3 IS [CI] | v2 median log err | v3 median log err [CI] | paired v3 − v2 IS [CI] |
|---|---|---|---|---|---|---|---|---|---|
| this run's held-out (made ≥ 11-04 14:05) | 1,179 | 33 | 0.595 | 0.781 [0.687, 0.855] | 3.23 | 2.74 [2.12, 3.55] | 0.178 | 0.138 [0.071, 0.219] | −0.48 [−1.41, +0.11] |
| 2026-11-16 lab held-out (made ≥ 10-29 22:11) | 1,333 | 36 | 0.572 | 0.778 [0.701, 0.844] | 3.65 | 2.85 [2.27, 3.60] | 0.196 | 0.152 [0.083, 0.270] | −0.80 [−1.88, −0.02] |
| new since 2026-11-16 run (made ≥ 11-16 13:15) | 193 | 3 | 0.663 | 0.617 [0.306, 0.782] | 3.39 | 2.49 [1.17, 4.93] | 0.193 | 0.191 [0.078, 1.196] | −0.91 [−2.94, +0.18] |

Same-window comparison with the 2026-11-16 run (made ≥ 10-29 22:11): coverage 0.811 → 0.778, interval score 2.91 → 2.85,
median log error 0.147 → 0.152 (the snapshot also lost its oldest four days to the 2 MB cap). The new rows are the
story: v3 covers only 61.7%, with 34% of outcomes EARLY (reached before the lower edge). It is concentrated in rep >3h
(new rows n 62: coverage 0.26, early 0.71), matching live `liveCoverage` rep|>3h 0.46 and the open check-in attention.
Censored definite misses (held-out): 3.2%. Calibration replay of 4,028 predictions: 3.4 s (candidate 3.4 s).

### Result
Tuning half chose K = 3, minCycles = 2 (objective 3.280 vs v3 3.312; every grid point within 0.04). The member was
offered on 771 tuning and ~550 held-out predictions, but the prequential ensemble gave it little weight (mean weight
0.2-4% per cell; highest money <20m 4.1%, money >3h 2.7%, rep >3h 1.7%).

| held-out (made ≥ 11-04 14:05) | v3 | prior member | change |
|---|---|---|---|
| interval score | 2.742 | 2.718 | −0.9%, paired CI [−0.066, +0.028] |
| coverage | 0.781 | 0.779 | away from 80% (slightly) |
| median log err, rep 1-3h (n 159) | 0.013 | 0.016 | +23% (fails the 10% rule) |
| median log err, money <20m (n 32) | 1.177 | 0.921 | −22% |
| median log err, money >3h (n 224) | 0.785 | 0.743 | −5% |
| median log err, other buckets n ≥ 30 | — | — | within ±4% |
| new rows (made ≥ 11-16 13:15), IS | 2.486 | 2.450 | −1.4%, paired CI [−0.074, +0.041] (3 cycles) |

Verdict: **rejected.** Interval score improves 0.9%, not 5%, and its CI includes 0; rep 1-3h point error is 23% worse.

Learned: a "same target, earlier cycles" anchor is mostly redundant with the base models plus per-cell bias
correction; the ensemble already learns not to trust it. It helps a little on money (<20m −22%, >3h −5%), where
spending inside a cycle breaks the rate models, but not enough to move the band. The bigger, newer problem is rep >3h
going early since ~2026-11-16 (outcomes arrive far sooner than any model predicts, and ACI is not catching up within
the 50-outcome window). Donations are not the cause (last `donate` in audit.txt: 2026-11-12 12:55 UTC). To check
next: a work switch or a jump in share RAM that raised the rep rate after the predictions were made. Next backlog item: (c) install-aware censoring; a rep-jump-aware
member (donation / work-switch flag) deserves its own pre-registration.

---

## Run 2026-11-19 — experiment (c): install-aware censoring

Data: snapshot 2026-11-19 ~13:15 UTC. `pred2.txt` tail (2 MB cap; `POST /api/ro/read` without `tailLines`, since
`tailLines` is capped at 5,000 lines): 3,972 predictions (first 2026-10-15 02:55 UTC), 2,344 resolved, 1,608 voided by
an install; `install-log.txt` 168 installs. New since the 2026-11-17 run: 180 resolved outcomes (resolved at or after
2026-11-17 13:15 UTC), 162 of them made after it. No lab run was logged for 2026-11-18.

### Pre-registration (written before the experiment ran)
- Hypothesis: 41% of predictions (1,608; 84% of them in money >3h and rep >3h) are voided by an install and never reach
  the calibrator. The resolved long-horizon outcomes it does see come from cycles that lasted long enough, so they lean
  early. Treating a voided prediction as right-censored at its install (actual > censor time) and feeding that to the
  band brings back the information on the late side. Expected: fewer censored definite misses, coverage toward 80% in
  the >3h cells, and a lower interval score.
- Candidate (pure predcal.js change; point and ensemble weights untouched, they still learn from resolved outcomes only):
  - `censor: "aci"`: when the install voids a prediction, its band's per-edge ACI step uses the expected miss
    indicators given actual > c (redistribution to the right under the band's own piecewise-lognormal distribution,
    10% / 50% / 90% at lo / d / hi): late = 1 if c >= hi else S(hi) / S(c); early = 0 if c >= lo else
    (F(lo) - F(c)) / S(c). Scaled by a censored weight `cw`.
  - `censor: "km"`: as "aci", and the band quantiles of each cell also take censored residuals ln(c / d) through a
    Kaplan-Meier (redistribution-to-the-right) estimate of the residual distribution, with weight `cw`; mass left
    after the last resolved residual sits at the largest censored residual.
  - The censor time is known only at the install (the void record's `at`); it is fed in time order like any outcome
    (no look-ahead).
- Windows: tuning = made before the snapshot's median made time (2026-11-08 03:39 UTC; 1,122 resolved); held-out = made
  at or after it (1,222 resolved, 29 install cycles, 746 censored). Replay is rolling-origin over the whole snapshot.
  Also reported on rows made after 2026-11-17 13:15 UTC (never seen by any lab run).
- Tuning (tuning half only): `censor` in {aci, km} x `cw` in {0.5, 1}, chosen by the backtest objective (interval score
  + coverage penalty). Frozen before held-out rows are scored.
- Metric: held-out interval score (log space, alpha 0.2) on resolved outcomes, paired difference candidate − v3 with a
  95% block bootstrap over install cycles (2,000 resamples, seed 7); secondary: median |log error| per kind x bucket,
  coverage, censored definite misses (band ends before the install).
- Acceptance: the standing rule above. Caveat stated in advance: the primary metric is scored on resolved outcomes only,
  which is the selection this experiment corrects, so a candidate can improve censored misses and still fail the rule.
  The rule is applied as written.

### Baseline backtest (shipped v3 `DEFAULTS`, this snapshot; 95% block-bootstrap CIs over install cycles)
| window | n | cycles | v2 coverage | v3 coverage [CI] | v2 IS | v3 IS | v2 median log err | v3 median log err | paired v3 − v2 IS [CI] |
|---|---|---|---|---|---|---|---|---|---|
| this run's held-out (made ≥ 11-08 03:39) | 1,222 | 29 | 0.623 | 0.789 [0.665, 0.869] | 3.59 | 3.12 | 0.161 | 0.115 | −0.47 [−1.52, +0.16] |
| new since 2026-11-17 run (made ≥ 11-17 13:15) | 162 | 3 | 0.759 | 0.864 [0.316, 0.984] | 5.30 | 3.60 | 0.033 | 0.046 | −1.69 [−14.8, +0.50] |
| whole snapshot (rolling origin) | 2,291 | 71 | 0.567 | 0.778 [0.709, 0.836] | 3.75 | 3.14 | 0.170 | 0.110 | −0.61 [−1.43, +0.04] |

Censored definite misses: held-out v2 12.3%, v3 12.1% (746 censored; money >3h 25.7% of 210, money 1-3h 21.6%);
whole snapshot v2 17.1%, v3 6.1%. Held-out cells with n >= 30 outside 70-90%: level >3h 0.585 (n 53), money <20m 0.645
(n 31), rep 20-60m 0.909 (n 132). Calibration replay of 3,972 predictions: 3.2 s (candidate 3.3 s).

### Result
Tuning half: every candidate was worse than shipped v3 (objective: v3 3.308; aci/0.5 3.726, aci/1 3.749, km/0.5 3.897,
km/1 4.054; coverage fell 0.765 → 0.72-0.74). The rule picks the best grid point, aci with cw 0.5, frozen before scoring
held-out rows. A check run with `censor: "none"` reproduced the shipped scores exactly.

| held-out (made ≥ 11-08 03:39) | v3 | censored ACI (cw 0.5) | change |
|---|---|---|---|
| interval score | 3.122 | 2.952 | −5.4%, paired CI [−0.399, +0.052] (includes 0) |
| coverage | 0.789 | 0.767 | away from 80% |
| early / late | 0.120 / 0.091 | 0.156 / 0.077 | more early misses |
| censored definite misses | 12.1% | 12.1% | unchanged |
| rep >3h (n 292): coverage, IS | 0.760, 4.15 | 0.671, 3.47 | narrower band, coverage out of 70-90% |
| money >3h (n 211): coverage, IS | 0.735, 4.07 | 0.749, 3.95 | slightly better |
| median log err, every bucket | — | — | unchanged (the point is untouched) |
| new rows (made ≥ 11-17 13:15), IS | 3.602 | 3.506 | −2.7%, paired CI [−0.110, 0.000] (3 cycles) |

Verdict: **rejected.** The interval score falls 5.4%, but the CI includes 0, coverage moves away from 80%, and the
tuning half preferred shipped v3 over every censoring variant.

Learned: censored rows mostly carry lower-edge information. Most voids happen after the band's lower edge, which
counts as "not early" and narrows the lower edge, so early misses rise (rep >3h coverage 0.76 → 0.67). On the upper edge
the late signal is real: the live snapshot has the upper ACI alpha pinned at its 0.25 ceiling (narrowest band) in money
>3h, rep >3h, level >3h and money 1-3h, because late outcomes are voided and never seen as resolved. The candidate drives
money >3h's upper alpha to the 0.01 floor, but the censored definite misses do not move (25.7%). The 99th percentile of
resolved residuals still ends before the install, because resolved residuals never include the long-late tail. ACI
cannot widen past data it has not seen. Kaplan-Meier residuals should fix that in principle, but were the worst on the
tuning half, because the censoring is not independent of the residual (cycles end when the augs are bought). A fair test of
censoring needs a metric that also scores voided rows (for example a censored interval score). The standing rule scores
resolved rows only, so it cannot reward this fix. Next backlog item: (d) cycle-phase cells with shrinkage.
