---
document_id: cdeb-fresh-v5-stage1-power-analysis-plan
study_id: cdeb-fresh-v5
stage: stage1-design
status: plan-only-not-run
measured_run_allowed: false
---

# Power analysis plan

Written before the pilot, so the pilot cannot choose the method that analyses it.
Nothing here is executed. No number in this document is a result.

## When it runs

After the pilot completes and before the confirmatory freeze. Its output is a
separate committed artifact, and the confirmatory design is frozen against that
artifact rather than against a number quoted from it.

## What it may read

```text
per-repository baseline revival rate in the suppressed condition
within-repository variance of that rate
per-task completion rate -- how often a task finishes at all
per-task runtime, for the budget
```

These are nuisance parameters. They describe how noisy the measurement is, not
how large the effect is.

## What it may not read

```text
the pilot's estimated treatment effect
any per-candidate arm assignment
any comparison between arms
```

**Blinding:** the analyst receives aggregate rates with arm labels withheld and
replaced by opaque group identifiers. The unblinding key stays with the study
operator until the plan's output is committed.

The reason is narrow and worth stating plainly: a sample size chosen from an
observed effect is a sample size chosen to reach significance. The effect the
pilot happens to show is the one quantity that must not influence how many
observations the confirmatory study takes.

## Output

```text
final N per repository
repeats per arm
the stopping rule, including what happens if a repository under-recruits
the minimum detectable difference at the chosen N, stated in advance
```

## Constraints the output must respect

- Equal-weight repository estimand: N is allocated so no repository's weight
  depends on how many candidates it happened to qualify.
- Every repository in the fixed set must reach a non-zero N. An estimand that
  averages over four strata is undefined if one is empty, and that is a stop
  rather than a number to patch.
- The confirmatory corpus draws only from the 50-candidate reserve. Pilot
  candidates and every artifact built for them are excluded.
- If the required N exceeds the reserve in any repository, the answer is HOLD
  and a report, not a smaller estimand.

## What this plan does not do

```text
it does not run the pilot
it does not estimate an effect
it does not authorise a measured run
```

The first agent episode under an assigned arm remains the irreversible step, and
it needs its own approval after this plan's output exists.
