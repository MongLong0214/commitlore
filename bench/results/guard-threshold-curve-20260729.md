# Guard threshold curve

This is a deterministic replay of the frozen labelled corpus only. It collects no wall-clock measurements.

## Baseline confirmed before this change

The archived report `bench/results/deterministic-20260727T083941Z.md` is retained in local Git object `8bfcd43576de8890686b256911592cf96a5fce15`. At the old and current shipped threshold, **0.35**, it recorded **3 true positives, 5 false positives, 2 false negatives, and 20 correct silences**: precision **3/8 (37.5%)**, recall **60.0%**.

The 95% Wilson score interval for that 3/8 precision is **13.7%–69.4%**. Thirty labelled decisions and eight firings are too small to describe 37.5% as a precise estimate.

## Current replay

Source scorer: `origin/dev` at `7f823bd66cac51e3e4dceeac49435bd5e39fc0f4`. The #61 scoring-composition repair already merged on that branch removes one archived false positive without changing the default threshold. The current default point is therefore **3 TP, 4 FP, 2 FN, and 21 correct silences**: precision **3/7 (42.9%)**, recall **60.0%**, with a 95% Wilson interval of **15.8%–75.0%**.

Method: replay all 30 frozen `commitlore-on` artifacts in `bench/results/transcripts-final` through the shipped guard. Scores span their usable 0.00–1.00 range; this table uses a fixed 0.05 step. Precision is `n/a` only when the guard does not fire; F1 is `n/a` when both precision and recall are zero.

| threshold | precision | recall | F1 | firings | correct silences |
|---:|---:|---:|---:|---:|---:|
| 0.00 | 33.3% | 60.0% | 42.9% | 9 | 19 |
| 0.05 | 33.3% | 60.0% | 42.9% | 9 | 19 |
| 0.10 | 33.3% | 60.0% | 42.9% | 9 | 19 |
| 0.15 | 37.5% | 60.0% | 46.2% | 8 | 20 |
| 0.20 | 37.5% | 60.0% | 46.2% | 8 | 20 |
| 0.25 | 37.5% | 60.0% | 46.2% | 8 | 20 |
| 0.30 | 42.9% | 60.0% | 50.0% | 7 | 21 |
| 0.35 | 42.9% | 60.0% | 50.0% | 7 | 21 |
| 0.40 | 42.9% | 60.0% | 50.0% | 7 | 21 |
| 0.45 | 42.9% | 60.0% | 50.0% | 7 | 21 |
| 0.50 | 42.9% | 60.0% | 50.0% | 7 | 21 |
| 0.55 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.60 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.65 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.70 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.75 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.80 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.85 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.90 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.95 | 0.0% | 0.0% | n/a | 2 | 23 |
| 1.00 | 0.0% | 0.0% | n/a | 2 | 23 |

## Decision

Keep the shipped default at **0.35**. This advisory guard's false positive consumes attention during an otherwise correct edit, so this decision weights false positives more heavily than false negatives; it does not select the F1 maximum. Lower thresholds add false positives. Raising the threshold to 0.55 or above removes all three true positives while retaining two false positives. The 0.30–0.50 plateau has identical observed counts, so the curve provides no reason to move 0.35 within it.

No threshold reaches a defensible precision for an advisory guard that interrupts attention: the best observed precision is only 42.9%, and its interval is wide. This is a finding, not a search for a favorable cutoff. The corpus remains frozen and unrelabeled; resolving the uncertainty requires more independently labelled cases, not a different step size or metric.
