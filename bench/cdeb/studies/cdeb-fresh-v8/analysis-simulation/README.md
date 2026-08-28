# Analysis proven on synthetic data

Required by section 17 (execution readiness: "judge packet/analysis simulation
pass") and by PR-A. An earlier version of this file and its commit message cited
section 13, which is the artifact layout and asks for nothing of the sort; the
commit message is left as written rather than rewritten.

Run before any episode exists. No benchmark outcome is involved and none could
be: the generator here produces rows from probabilities I chose, so every answer
was known before the analysis saw the data.

## What was run

| Artifact | What it establishes |
|---|---|
| `scenarios.txt` / `scenarios.json` | the analysis recovers effects it was given, and reports no effect where there is none |
| `unit-controls.txt` | the analysis refuses what it must refuse — 20 checks |
| `mutation-controls.txt` | those checks can actually fail — 12 defects injected, 12 caught |

Reproduce with `harness/simulate.py`, `harness/test_analysis.py`,
`harness/mutate-analysis.py`. The analysis itself is `harness/analysis.py`, which
also carries the section 27 claim gate as 25 separately named conditions.

## Scenarios

Six datasets, one generator, 340 rows each — the same shape as the measured study.

```
known_positive       delta +0.305  CI [+0.208,+0.411]  p 0.0005   generated 0.70 vs 0.40
exact_null           delta +0.023  CI [-0.075,+0.126]  p 0.6927   generated 0.55 vs 0.55
known_negative       delta -0.183  CI [-0.283,-0.084]  p 0.0010   generated 0.35 vs 0.60
completion_degraded  ON completion 0.771 against 0.971, and the gate catches it
high_indeterminate   panel indeterminate 0.429, far above the 15% ceiling
suppressed_fvr_zero  RBDR undefined and said so, rather than divided by zero
```

The two that matter most are the ones with no effect to find. `exact_null` puts
zero inside the interval and returns p = 0.69; `known_negative` returns an
interval entirely below zero. An analysis that cannot produce those two is not
measuring anything, however well it agrees with real data later.

## The claim gate blocked all six

Every scenario was also run through the section 27 gate, with the fifteen
non-statistical conditions (reliability, delivery, provenance, analyst agreement)
held at passing values so that only the statistics could decide.

`suppressed_fvr_zero` is the case worth keeping. It was generated with **exactly
zero effect**, and it still returned CI lower `+0.008` and p `0.0485` — clearing
both of the gate's headline statistical conditions. Ten further seeds on that same
generator put the mean at +0.003 with sd 0.037 and never exceeded |0.10|, so this
was a ~2.9σ draw: the 5%-level false positive a 5%-level test is supposed to
produce 5% of the time. It is not a defect in the analysis.

The gate blocked it anyway, on `rbdr_point` and `rbdr_lower`, because the
suppressed arm never revived and RBDR is therefore undefined. That is the whole
argument for a 25-condition gate rather than a p-value: the one dataset that
could have produced a false headline was stopped by a condition about mechanism,
not significance.

`known_positive` was also blocked — its RBDR is real but below the 50% floor. A
generated effect large enough to see is not automatically a claim.

## Mutation controls

The unit controls went green before they could catch anything. Twelve defects
were injected into the analysis; two survived the first pass and both were real
gaps:

- **bootstrap resamples candidates instead of blocks** — the original test made
  all four candidates identical, so resampling candidates changed nothing. The
  fixture now gives each candidate a different effect while holding blocks
  constant inside it, and the check enumerates the values block resampling can
  reach rather than approximating a window.
- **bootstrap does not resample at all** — every replicate equals the observed
  value, the interval collapses onto the point estimate, and the gate's `CI lower
  > 0` becomes true for free whenever the estimate is positive. This passed every
  other check. A control was added that requires spread where blocks genuinely
  differ.

A third mutation, taking the interval's extremes instead of the 2.5/97.5
percentiles, survived at first for a different reason: it widens the interval, so
it errs toward refusing claims. Safe-direction defects are the ones a suite of
"did we get the right answer" checks will never see, so the percentile is now
checked as a property of the returned distribution.

## What this does not establish

- **Nothing here is evidence about CommitLore.** These are synthetic rows. The
  study's estimand, its effect and its sign are all still unmeasured.
- **The bootstrap's unit is a choice with consequences.** It resamples repetition
  blocks inside a candidate and holds candidates and repositories fixed, so the
  interval describes rerunning *this* benchmark with *this* pinned agent. A
  near-deterministic agent makes it narrow, and narrow here does not mean general
  — it says nothing about other tasks or other repositories.
- **The generator is independent across rows.** Real episodes may correlate within
  a candidate in ways this cannot show, which would make the true interval wider
  than the simulation suggests.
- **`p_dsfps` is deliberately conservative** — an incomplete run, a functional
  failure and an indeterminate panel all score zero. The simulation shows the rule
  is applied consistently; it cannot say the rule is the right one.
