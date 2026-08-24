---
preregistration_identifier: CDEB-FRESH-V7
preregistration_revision: r1
study_id: cdeb-fresh-v7
document_date: 2026-08-24
authority: PRD.md (COMMITLORE_CDEB_FRESH_V7_R1_FINAL_EFFECT_TRIAL_SSOT, sha256 bce257d0b634f43e1d2590b284351214b21be2d7965e61177b9c1368914d21b2)
supersedes: nothing measured — cdeb-fresh-v6 is terminal and is not resumed
measured_run_allowed: false
research_line_finality: final-effect-trial-no-automatic-v8
---

# CDEB-Fresh v7 preregistration (revision r1)

This fixes the values the trial will be judged by, while it holds zero measured
rows and zero assigned episodes. Where it adds a number the SSOT left to
execution, it says so and says why that number.

## What is being measured

Whether automatic delivery of the candidate-relevant CommitLore decision, before
the first relevant mutation, raises Decision-Safe First-Pass Success against the
same shipping hook with that one decision block structurally suppressed.

The estimand is the **total effect of automatic model-visible delivery of the
relevant target decision** — semantic content, salience and the target block's
token load together. It is not the effect of semantic content alone, not hook
installation overhead, and not knowledge access versus no access.

## Population

The exact 17 frozen decision-sensitive tasks that cdeb-fresh-v6 established as
`TASK_BUILDABLE`, in two author-operated repositories at the v6 snapshots.

```text
agent-operator-score  8
gitseed               9
total                17
```

These are a **fixed finite benchmark**, not a sample from a task
superpopulation. They are never reduced, replaced, rebalanced or extended, and a
candidate that cannot be used for an integrity reason ends the study rather than
being swapped.

Not generalisable to all repository decisions, all repositories, all coding
agents, all CommitLore releases, all teams, or objective architectural
correctness.

Evidence tier: **author-operated, multi-agent internally replicated,
fixed-benchmark causal effect trial**. Not independent external validation.

## Why these 17 may be reused

v6 ran no product-effect episode. The selection saw no ON outcome, no SUPPRESSED
outcome, no DSFPS, no revival rate and no token cost, so it is pre-treatment with
respect to everything v7 measures.

## Two corrections made before any episode

Both are registered in `deviations.jsonl` and neither could see an outcome,
because none existed.

- `v7-d001` — the first v7 draft pinned `318e1661…` as the product dist digest.
  The measured digest of `dist/commitlore.mjs` at the pinned commit is
  `a0c54297…`; v6 had already scanned 338 files at that commit and found none
  matching the declared value. r1 pins the measured digest and keeps the declared
  one as predecessor history.
- `v7-d002` — the first v7 draft reused a v6 revival oracle. v6 built none: what
  decided violation there was two blind semantic judges. r1 reclassifies the
  oracle as a v7 artifact, built and frozen in PR-A.

## The oracle is a v7 artifact

No oracle is imported. For each of the 17, v7 builds one under PRD §13–15:

- two independent spec extractions that must agree on the semantic boundary;
  disagreement goes to a third reading and unresolved ambiguity ends the study
- a deterministic implementation preferring black-box behaviour, then public
  API, then structured parse, and using a lexical predicate only where the
  decision is itself lexical
- a mandatory classification matrix — Base, Good A, Good B false; Bad A true
- a **fresh near-miss** that two blind judges call `NOT_A_VIOLATION` and the
  oracle calls false; failing to build one ends the study, because without it the
  false-positive boundary is unverified
- a mandatory **attempt** at a violation of a different conceptual shape than
  Bad A; failing to construct one is a recorded limitation, not an exclusion,
  because v6 already established one functionally passing violation per candidate
  and the attempt exists to attack the oracle's shape-overfit rather than to add
  an eligibility condition
- 30 identical repeated evaluations, mutation tests where a mutation that does
  not reach its target property does not count as passing, and an independent
  red-team blind to arms and outcomes

The repository holds one earlier oracle, for `v4-377f04276465b59d`, written in
v5. It is a lexical scan over a fixed list of six paths. It is not imported and
is not evidence for that candidate; it is available to the red-team as a worked
example of the failure the priority ladder exists to prevent.

## Product and snapshots

```text
tag         v1.2.0
tag object  557e6cd506c79eb5d2731885e3c544fa85f0384a
commit      90a8b212e1db70cccf69fbf48415b9c036b2d854
dist        dist/commitlore.mjs
dist sha256 a0c542977f048e6b5163f581d2e4a53963b2d9845467af8949fa105b8bc0e528
```

Repository snapshots are the exact bundles v6 sealed, digests re-verified. No
newer release is substituted and no repository is re-snapshotted.

## Design

```text
17 tasks × 2 arms × 10 fresh repetitions = 340 assigned episodes
```

There is no sample-size gate and no power gate. All 340 run. Low power is a
limitation to report, never a reason to stop.

Unit of pairing is `candidate × repetition`. Each pair is one ON session and one
SUPPRESSED session, both fresh, run close together with the arm order randomized
from the registered seed.

## Seed

```text
seed = SHA256(
  "CDEB-FRESH-V7-FINAL-EFFECT-TRIAL"
  + benchmark_manifest_sha256
  + preregistration_commit_sha
  + runtime_lock_sha256
)
```

Derived from artifacts that are frozen before the schedule exists, so it cannot
be chosen after seeing which order it produces.

## Primary endpoint

```text
functional_pass = task_specific_acceptance_pass AND regression_acceptance_pass
DSFPS           = completed AND functional_pass AND revival == false
```

Regression-only pass is never a functional pass.

Intention to treat. Every episode that reaches a meaningful start stays in the
denominator. Timeout, non-completion, task failure, regression failure, revival,
not-evaluable and post-start provider failure all score zero. Up to two retries
are allowed for an arm-independent infrastructure failure **before** a meaningful
start, and every attempt is recorded.

## Analysis

```text
p_c,a = mean DSFPS over the 10 repetitions of candidate c in arm a
d_c   = p_c,ON - p_c,SUPPRESSED
D_r   = mean of d_c over the candidates of repository r
Delta = 0.5 * D_AOS + 0.5 * D_gitseed
```

Primary interval: paired-block bootstrap resampling the 10 repetition blocks
within each candidate, carrying both arms of a block together, 100,000
replicates, fixed seed, percentile 95%. Candidates and repositories are fixed and
are never resampled in the primary.

**What that interval is.** It measures the stochastic variability of running this
exact benchmark again with the same pinned agent. It is not an interval over
tasks, and it is not evidence that the effect holds on tasks outside these 17. If
the pinned agent behaves near-deterministically the interval narrows toward zero
width without that telling us anything about a wider population.

Randomization sensitivity: swap the arm labels within each candidate × repetition
pair, 1,000,000 permutations, two-sided, fixed seed.

Task-population sensitivity, secondary and labelled as such: resample candidates
within each repository, repositories fixed, 50,000 replicates. Reported alongside
leave-one-candidate-out Delta, repository point effects and candidate-level
effects.

STAT-A and STAT-B implement the SAP independently and must match: raw counts
exactly, point estimates and candidate rates to 1e-12, bootstrap quantiles to
1e-6, permutation p to 1e-6, and the claim-gate verdict exactly. A mismatch is
never resolved by averaging; unresolved, it ends the study.

## Claim gate

The strong README headline requires every condition in PRD §35 to pass. Any
failure publishes `PUBLISHED_QUALIFIED`, `PUBLISHED_NULL`, `PUBLISHED_NEGATIVE`
or `TERMINAL_HOLD_FINAL` truthfully, with no headline number.

A null result means *no detectable effect on this fixed 17-task benchmark under
the pinned configuration*, never *CommitLore has no effect*.

## What this study may not do

Resume v6. Change the 17. Rewrite a v6 task. Import an oracle. Reuse v6 control
bytes as a near-miss. Consume a benchmark task as a pilot. Stop because power is
low. Change the repeat count after outcomes. Compute an interim arm aggregate.
Drop a started episode. Replace a failed task. Switch model, product release or
snapshot mid-study. Backfill a Record-Id. Use owner testimony. Bootstrap
repositories. Put a number in the README before the gate. Call a fatal defect a
limitation. Generate a v8.

## Registered before the fact

Every threshold above is fixed while the study holds zero measured rows and zero
assigned episodes. The endpoint, the interval method, the pairing unit, the
oracle validation requirements and the claim gate are all written down before the
first oracle exists, so none of them can be chosen by the answer.
