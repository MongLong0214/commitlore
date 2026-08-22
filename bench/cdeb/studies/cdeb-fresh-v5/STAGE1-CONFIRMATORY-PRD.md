---
document_id: cdeb-fresh-v5-stage1-confirmatory-prd
study_id: cdeb-fresh-v5
stage: stage1-design
status: design-only-awaiting-execution-approval
measured_run_allowed: false
predecessor_stage: stage0-authority-corpus-feasibility (GO)
owner_approval: design approved 2026-08-22; execution not approved
---

# CDEB-Fresh v5 Stage 1 — confirmatory design

Stage 0 reached GO: four eligible repositories, 62 qualified candidates, zero
measured product-effect rows. This document designs what a confirmatory study
would do. **It does not run one.** `measured_run_allowed` is still `false`, and
nothing here creates a task, a gold contract, an oracle, a randomization or a
result row.

The owner approved the design and not the execution. The point at which that
distinction stops being reversible is named in §9.

## 1. The causal question

> When a naturally recorded, pre-study repository decision is automatically
> delivered before a relevant code mutation, does the same coding agent less
> often implement a functionally viable approach that the decision had
> explicitly ruled out?

The unit is a decision, not a record. Each of the 62 qualified candidates
becomes at most one maintenance task.

## 2. Arms

```text
delivery-on          the shipping hook forwards the decision payload before the
                     first mutation, exactly as v1.2.0 does
delivery-suppressed  the same task, the same agent, the same tree, with the
                     model-visible decision payload suppressed
```

Suppression removes what the model can read. It does not remove the record from
Git — the record is the treatment content, and a tree without it is a different
repository.

## 3. Primary endpoint

```text
revival = the final code tree implements the approach the decision ruled out,
          while passing the task's functional acceptance criteria
```

Judged by the oracle from the final tree alone. The oracle must not read the
arm, the delivery log, the agent transcript, any record citation, or token
usage.

**Forbidden as endpoints**, because each would let the treatment satisfy the
measurement merely by arriving:

```text
whether the agent mentioned a Record-Id
whether the agent repeated the record's wording
whether the agent stated the reason
```

## 4. Estimand

Equal-weight repository average of the within-repository revival-rate
difference:

```text
Delta = (1/K) * sum over eligible repositories of (revival_off - revival_on)
```

with `K = 4`. Equal weighting, not pooled, so a repository contributing 22
candidates does not outvote one contributing 10. This is the shape v3r1 used and
the reason it failed there — two strata were empty — does not apply: all four
strata are non-empty here.

**A stratum that ends up empty at analysis time makes `Delta` undefined.** That
is not a number to be patched; it is a stop.

## 5. Fixed repository set

Fixed by the Stage 0 rule before any treatment outcome exists, and not
revisable after one does:

```text
agent-control-plane    10 qualified
agent-operator-score   17
gitseed                22
logic-pro-mcp          13
                       62 total
```

## 6. Pilot

12 candidates, three per repository, listed in `stage1/pilot-design.json`.

The selection rule is fixed here and is content-blind: the first three qualified
candidates per repository ordered by `candidate_id`, which is derived from the
decision audit anchor — a SHA-256 over canonical inputs — so the ordering is
independent of the decision's content, date and author.

What the pilot is for:

```text
task authoring and the firewall check working end to end
oracle construction and its negative controls
runtime budget and timeout calibration
the nuisance parameters a power analysis needs
```

What the pilot is **not** for: estimating the effect, or deciding whether to
continue on the strength of the effect it shows.

Composition, reported so a reader can see it was not selected for balance:

```text
identified 5   id-less 7
A1 4           A0-only 8
```

## 7. Confirmatory reserve

50 candidates remain, none of them touched by the pilot:

```text
agent-control-plane 7   agent-operator-score 14
gitseed            19   logic-pro-mcp        10
```

A candidate used in the pilot never enters the confirmatory corpus. Task
prompts, gold and oracles built for a pilot candidate are pilot artifacts.

## 8. Power analysis

Run **after** the pilot, **before** the confirmatory freeze, and frozen as its
own artifact.

```text
inputs   nuisance parameters only -- per-repository baseline revival rate,
         within-repository variance, per-task completion rate
blinded  the analyst sees aggregate rates with the arm labels withheld
output   final N per repository, repeats per arm, and the stopping rule
```

The pilot's own effect estimate is not an input. Choosing N from an observed
effect is how a study talks itself into the sample size that reaches
significance.

## 9. The irreversible point

Everything above is design. The first thing that cannot be undone is:

```text
running one agent episode under an assigned arm
```

At that moment the project's `measured product-effect rows = 0` stops being
true and every subsequent claim depends on the preregistration having been
frozen first. Before that happens the following must all exist and be
committed:

```text
STAGE1-PREREGISTRATION.md, frozen
task prompts, authored behind the firewall
gold contracts
oracles with passing negative controls
the power-analysis artifact
a randomization plan with a recorded seed
explicit owner approval to execute
```

## 10. Task-author firewall

A task author may see the base tree, a neutral maintenance need, functional
acceptance criteria and the allowed scope.

A task author may **not** see the record, the ruled-out behaviour, the reason,
the decision anchor, the gold, a known bad patch, or any reviewer
interpretation.

This is the core of the anti-circularity argument and it has **not been
exercised yet** — no task exists. Stage 1 must make it executable before the
first task is written, not after.

## 11. What Stage 0 did not establish

Carried forward so the confirmatory design does not inherit an overclaim:

- G3 and G4 were reviewer judgements from the record, its reason, the paths and
  the commit prose. **No reviewer read the current code or ran a test.** G3's
  agreement was 0.59.
- G5 recorded that a deterministic oracle *could* be written. None was built.
- 55 gates remain unresolved after both tie-breakers disagreed and fail closed,
  so 62 is a lower bound.
- A0 admitted all 241 enumerated decisions; seven of its eight conditions
  cannot fail on input the census built.
- The anti-provenance guard cannot detect a dependence running through the
  reviewers.

Each of these is a thing the pilot should test rather than assume.

## 12. Claims this study may and may not make

May, if the confirmatory result supports it:

> CommitLore delivery reduced violations of naturally recorded repository
> decisions in fresh coding-agent tasks.

May not, in any result:

```text
recorded decisions were objectively optimal
all maintainers agreed with them
CommitLore finds globally correct architecture
all repositories benefit
Record-Id itself causes improvement
```

```text
measured product-effect rows = 0
```
