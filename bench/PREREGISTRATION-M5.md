# Pre-registration — M5 re-proposal measurement, powered

Written **before** the measurement it describes is run, and committed before the
harness is invoked. Its purpose is to fix the task set, the model, the run
parameters, the stopping rule and the analysis in advance, so that nothing about
the analysis can be chosen after the numbers are visible.

- Follows: `bench/PREREGISTRATION.md` (M1) · ADR-0007 · PRD-F7
- Status: **registered, not yet run**

---

## 1. Why this run exists

M1 ran the right experiment at the wrong size. It reported 5/30 against 7/30,
Fisher exact p = 0.7480, and — the number that matters — **5.1% power to detect
the difference it observed.** `bench/VERDICT-M1.md` states the consequence
plainly: an experiment with a 5% chance of detecting its own effect has not
tested the hypothesis, it has reported that it cannot see.

M5 changes exactly one thing: **n**. Same tasks, same detection rules, same
analysis. If M5 returns a null, that null means something M1's could not.

## 2. Hypothesis

An agent that can see recorded decisions re-proposes previously rejected
approaches **less often** than an agent that cannot.

Direction is specified: the hypothesis predicts `commitlore-on <
commitlore-off`. A difference in the other direction is a refutation, not a
result, and is reported as such.

## 3. The single table that tests it

One 2×2 table, over all ten tasks and all registered seeds:

|                    | re-proposed | did not |
|--------------------|-------------|---------|
| `commitlore-on`    | a           | b       |
| `commitlore-off`   | c           | d       |

- **Test**: two-tailed Fisher exact, α = 0.05.
- **Effect size**: difference in re-proposal rates, in proportion points, with a
  95% Newcombe interval.
- **Unit**: one run = one (task, condition, seed).

**No other statistical test will be reported as a result.** Per-task rates are
reported as description, never as a second test, and no subset is analysed as if
it were the registered comparison.

## 4. Size, and the basis for it — fixed now

| parameter | value | basis |
|---|---|---|
| planning control rate | **23.3%** | M1's observed control rate over the full ten-task set |
| minimum effect of interest | **to 16.7%** (−6.6pp) | the difference M1 observed and could not resolve |
| α, two-sided | 0.05 | ADR-0007 |
| power | 0.80 | conventional |
| **n per arm** | **576** | two-proportion normal approximation |
| seeds × tasks × arms | **58 × 10 × 2 = 1,160 runs** | 580 per arm, the first multiple of 10 above 576 |

**The planning rate is M1's 23.3%, not the 33.3% measured in this run's pilot.**
The pilot covered three tasks and included `reproposal-index-server`, which M1
showed is the strongest single task in the set (3/3 in control). Planning from it
would assume a base rate the full task set has not demonstrated, and would size
the run too small. Where the two disagree, the more conservative and more broadly
measured number is used.

The pilot's job was wall-clock and base rate, not effect. Its 12 rows
(`20260801T114947Z-7e2a8f`) are **not** part of the analysis set and are not
citable as a result.

## 5. Model — fixed now

`sonnet`, passed with `--model` and recorded on every row. The harness refuses a
non-simulated run without it, so no row can be produced whose producer is
unknown. This is the defect that invalidated M4, whose rows record `Model | not
recorded`.

The model is a design parameter, chosen before the run and not revisited. Should
a later run use a different model, it is a different measurement reported
separately, not a substitution into this one.

## 6. Exposure — the check M4 lacked

M4 recorded no per-run treatment exposure, so whether the treatment was present
was unverifiable and the whole matrix was withdrawn. M5 requires, on every row:

- `guard_exposure.complete === true`
- `commitlore-on` rows: `accepted_records > 0` — the arm received records
- `commitlore-off` rows: `accepted_records === 0` — the arm did not

**A row failing its arm's exposure condition is reported and excluded**, with the
count of exclusions stated beside the result. If exclusions exceed 5% of either
arm, the run is reported as compromised rather than analysed.

## 7. Analysis set — fixed now

A row enters the analysis set unless it is:

- `stopped_by: "error"` — the row carries no measurement
- failing the exposure condition in §6

Exclusions are counted and reported per arm before the table is shown. No row is
excluded for its outcome.

## 8. Stopping rule — fixed now

**The run completes all 1,160 rows before any 2×2 table is computed.** No interim
analysis, no early stop, no extension after seeing a result. Sharding by seed
range is an operational convenience for restartability and carries no analytical
meaning; shards are concatenated and analysed once.

If the run is interrupted, it resumes at the next unrun (task, condition, seed)
cell. A partially completed run is not analysed and not reported as a result.

## 9. What would refute the hypothesis

- `commitlore-on` re-proposing at a rate **at or above** `commitlore-off`.
- A null at this n. Unlike M1's, a null here is informative: at 580 per arm the
  run has 80% power against the difference M1 observed, so failing to find it
  bounds the effect rather than reporting an inability to see.

ADR-0007 commits this project to acting on the result either way. That commitment
is the reason for the stopping rule in §8.

## 10. What this measurement is not

- It is not evidence about agents in general. Ten synthetic tasks, one model, one
  harness.
- It is not evidence that the delivered record was *read*. `bench/ROUTE-GAP.md`
  records treatment-arm runs that implemented something explicitly listed in the
  injected block. Re-proposal rate is an outcome measure and says nothing about
  the mechanism.
- It is not a benchmark anyone else reports. No third party has published a
  number on this instrument, and a sceptic should discount it accordingly.
