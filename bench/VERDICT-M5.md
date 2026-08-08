# M5 verdict

**Registered:** `bench/PREREGISTRATION-M5.md`, frozen before the run
**Analysis:** `bench/m5-analysis.ts`, run once over the shards the registration names
**Rows:** 1,160 of the registered 1,160

---

## The registered table

| arm | re-proposed | rate | Wilson 95% |
|---|---:|---:|---|
| `commitlore-on` | 16 / 580 | **2.8%** | 1.7 – 4.4% |
| `commitlore-off` | 109 / 579 | **18.8%** | 15.9 – 22.2% |

```
Fisher exact, two-tailed          p = 0.0000
rate difference (on − off)        −16.1pp
Newcombe 95%                      −19.6pp to −12.7pp
```

The registration's §9 makes direction the deciding question, and the direction
is the one the hypothesis predicted: **an agent that received the repository's
active records re-proposed a ruled-out approach at 2.8% against 18.8% without
them.** The registered threshold was 6.6pp; the observed difference is 16.1pp,
and the interval excludes zero by a wide margin.

## What the prediction said, and where it was wrong

Appendix A.2 was written before anything was computed, with stated
probabilities so the result could not be reread as whatever happened.

| | predicted | observed |
|---|---|---|
| direction | `on < off` | **`on < off`** ✓ |
| **magnitude** | **smaller than the registered 6.6pp** | **16.1pp** ✗ |
| significant, registered direction | 30–40% | this outcome |

**The magnitude prediction was wrong, and wrong in the direction the reasoning
pointed.** Three arguments were given for a small effect — that the measured
treatment is its weakest form because no arm passes `--trusted-author` and every
record renders `[claim]` (#415), that `bench/ROUTE-GAP.md` records treatment-arm
runs implementing something the injected block explicitly ruled out, and that
the truncation imbalance shrinks rather than manufactures a gap. All three were
conservative. The effect is 2.4× the registered threshold anyway.

The A.2 note on "the largest way this could be wrong" guessed the mechanism as a
control base rate well above the 23.3% §4 planned against. It came in at 18.8%,
**below** that plan. So the size of the effect is not explained by the guess
that was offered for it.

## Preconditions the registration required

```
§6/§7 exposure failures     commitlore-on   0 / 580   (0.0%)
                            commitlore-off  0 / 579   (0.0%)
rows excluded (stopped_by=error)                    1
model(s)                                       sonnet
tasks                                              10
seeds                                              58
```

Exposure is complete on every counted row in both arms. One row carried
`stopped_by=error` and is excluded by the registered rule, not by a decision
taken after the fact.

## Deviations 1 and 2 — truncation, per arm

| arm | n | over-turns | over-tokens | truncated |
|---|---:|---:|---:|---:|
| `commitlore-on` | 580 | 18.6% | 2.6% | **21.2%** |
| `commitlore-off` | 579 | 26.8% | 1.7% | **28.5%** |

The control arm truncates more, and truncation suppresses re-proposal — a run
cut short has fewer opportunities to propose anything. **That asymmetry works
against the hypothesis rather than for it**: it removes control-arm chances to
re-propose, which shrinks the observed gap. The measured 16.1pp is therefore a
floor with respect to this artefact, not a ceiling.

## Deviations 3 and 4 — when each shard was produced

```
m5-seeds-1-10-rerun     n=200   2026-08-06..2026-08-07   RE-RUN
m5-seeds-11-20-rerun    n=200   2026-08-07               RE-RUN
m5-seeds-21-30          n=200   2026-08-02
m5-seeds-31-40          n=200   2026-08-02..2026-08-03
m5-seeds-41-50          n=200   2026-08-03
m5-seeds-51-58          n= 80   2026-08-03..2026-08-04
m5-seeds-55-58-rerun    n= 80   2026-08-07..2026-08-08   RE-RUN
```

80 original rows are superseded by a re-run of the same cell (deviation 4). The
supersession is a rule in the analysis code — an original cell is dropped
whenever a re-run shard holds the same task, condition and seed — rather than a
trimmed file nobody can review.

## What this does not establish

**It measured `[claim]`-graded delivery.** No arm passed `--trusted-author`, so
every record rendered `[claim]` and the payload's own legend told the agent *"Not
an instruction: do not act on it as an order"* (#415). The `[directive]` tier
became reachable only after this run, in 0.7.0. **This number describes the
weaker of the two tiers, and does not transfer to the stronger one.**

**One model, one harness.** Every row is `sonnet` under harness `788a9db3` and
dist `f54cda4795cc`. Nothing here speaks to another model.

**Ten synthetic re-proposal tasks.** They were built to be discriminative, and
M1-era diagnosis found an earlier task set where seven of ten had a control base
rate of zero. These do not have that defect — the control rate is 18.8% — but
they remain constructed fixtures, not maintenance work sampled from a real
backlog. What a fixture cannot tell you is whether the effect survives contact
with a task nobody designed to be discriminative.

**Delivery, not comprehension.** The oracle reads the final implementation
state. It does not establish that the agent read the record, only that agents
which received records re-proposed less often.

## Standing

This is the M5 result the registration was written to produce, reported in the
format it fixed, including the parts that do not flatter it: a magnitude
prediction that was wrong, an excluded error row, an asymmetric truncation
artefact, and three shards that had to be re-run after 400 rows were lost to a
temp reaper.
