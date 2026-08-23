---
preregistration_identifier: CDEB-FRESH-V6
study_id: cdeb-fresh-v6
document_date: 2026-08-23
authority: PRD.md (COMMITLORE_CDEB_FRESH_V6_FINAL_END_TO_END_SSOT, sha256 a003e9803bff7c6174d32dca3be00e35d2f58bfc0f2df1e0f4f4254d06be89b0)
supersedes: nothing — cdeb-fresh-v5 is terminal and is not resumed
measured_run_allowed: false
research_line_finality: final-planned-study-no-automatic-v7
---

# CDEB-Fresh v6 preregistration

This registers, before any episode exists, the values the study will be judged
by. Everything here is taken from the governing SSOT; where this document adds a
number the SSOT left to execution, it says so and says why that number and not
another.

## What is being measured

Whether automatic, model-visible CommitLore decision delivery before the first
relevant mutation raises Decision-Safe First-Pass Success against the same
shipping hook with the model-visible payload suppressed.

The estimand is the **total effect of relevant automatic delivery** — semantic
content, salience and payload cost together. It is not the effect of semantic
content alone, not hook installation overhead, and not knowledge access versus
no access.

## Population

Fresh coding tasks successfully constructed from naturally recorded,
v5-prequalified functionally violable decisions in two author-operated
repositories whose acceptance instruments were deterministic under the frozen
configuration.

Not generalisable to all repository decisions, all repositories, all coding
agents, all CommitLore versions, all teams, or objective architectural
correctness.

Evidence tier: **author-operated, multi-agent internally replicated confirmatory
study**. Not independent external validation.

## Fixed strata

`agent-operator-score` and `gitseed`, chosen on pre-treatment measurement
feasibility established in v5 while zero product-effect rows existed. They are
fixed strata and are never resampled.

The two repositories excluded — `agent-control-plane` and `logic-pro-mcp` —
were excluded because their acceptance instruments could not produce the same
result twice on their own unmodified trees, which is a property of those suites
and was measured before any treatment outcome existed.

## Source pool

34 decisions: 16 in agent-operator-score, 18 in gitseed.

- selection rule: `repository_id ∈ {agent-operator-score, gitseed}` **and**
  current v5 adjudication `= FUNCTIONALLY_VIOLABLE`
- source ledger digest: `fa3883f780c6907f84cc2b43413b3d2e8b8b370ea436919a4205a5e23f65f7f0`
- `source-pool.json` digest: recorded in `study.json`

The pool carries no v5 patch bytes, no v5 worker prose, no ambiguous candidate
and no candidate from a nondeterministic repository.

## Product and snapshots

CommitLore `v1.2.0`, commit `90a8b212e1db70cccf69fbf48415b9c036b2d854`. The tag
resolves to that commit exactly. The SSOT's `product_dist_sha256` matches no
artifact at that commit and deviation `v6-d001` records what was searched;
`product-lock.json` pins the measured digest alongside the SSOT value. No newer
release is substituted.

Repository snapshots are the exact bundles v5 sealed, digests re-verified.

## Seed

```text
preregistration_seed = sha256("cdeb-fresh-v6|" + source_pool_sha256)
```

Derived from the frozen source pool rather than chosen, so it cannot be picked
after seeing which candidates it ranks where. It orders NEED-SCOUT needs, pilot
candidate selection and arm order.

## Acceptance

Two layers. `functional_pass = task_acceptance_pass AND regression_acceptance_pass`.
Regression-only pass is never a functional pass.

Every acceptance run carries a machine receipt: registered and executed command
digests, timestamps, exit code, structured counts, failure ids, baseline
fingerprint, changed files, worktree and final tree ids, stdout and stderr
digests, runtime identity. Worker prose is not evidence.

A run on a tree the attempt did not change is not evidence about the attempt.

## Task-buildability floors

Registered before any task is built and not moved to fit the corpus:

```text
agent-operator-score  TASK_BUILDABLE >= 10
gitseed               TASK_BUILDABLE >= 10
total                 TASK_BUILDABLE >= 22
```

Confirmatory reserve after the pilot takes two per repository:

```text
agent-operator-score >= 8
gitseed              >= 8
total                >= 18
```

Any shortfall is `TERMINAL_HOLD_FINAL`.

## Repeat rule

From the confirmatory candidate total `M`, and from nothing the pilot shows:

```text
M >= 24        5 repeats per arm
20 <= M < 24   6 repeats per arm
18 <= M < 20   8 repeats per arm
M < 18         TERMINAL_HOLD_FINAL
```

## Primary endpoint

```text
DSFPS = completed AND functional_pass AND revival == false
```

Intention to treat. Every assigned episode stays in the denominator. Timeout,
non-completion, task failure, regression failure, revival, not-evaluable and
post-turn provider failure all score zero. One retry is allowed for a registered
infrastructure failure before any meaningful model turn, and both attempts are
kept.

## Analysis

```text
d_rc   = mean_repeat(DSFPS_ON) - mean_repeat(DSFPS_SUPPRESSED)
D_r    = mean_candidate(d_rc)
Delta  = 0.5 * D_AOS + 0.5 * D_gitseed
```

Primary interval: candidate-cluster bootstrap resampling candidates within each
fixed repository, carrying all repeats and both arms together, never resampling
repositories, never resampling repeats, 50,000 replicates, fixed seed,
percentile 95%.

Randomization sensitivity: swap ON/SUPPRESSED labels within each candidate ×
repeat pair, 100,000 permutations, fixed seed.

STAT-A and STAT-B are implemented independently and must match: raw counts
exactly, point estimates to 1e-12, bootstrap quantiles to 1e-6, claim gate
identically. An unresolved mismatch is `TERMINAL_HOLD_FINAL` and is never
resolved by averaging.

## Claim gate

The strong README headline requires every gate in SSOT §24.2 to pass. Any
failure publishes `PUBLISHED_QUALIFIED`, `PUBLISHED_NULL`,
`PUBLISHED_NEGATIVE` or `TERMINAL_HOLD_FINAL` truthfully with no headline.

A null result means *no detectable effect under this design*, not *CommitLore
has no effect*.

## What this study may not do

Resume v5. Add the excluded repositories. Drop a repository after seeing
outcomes. Reuse v5 patch bytes as controls. Leak a ruling into a task prompt.
Accept regression-only pass as functional pass. Let the pilot effect choose N,
repeats or candidates. Exclude post-treatment. Bootstrap repositories. Backfill
a Record-Id. Use owner testimony. Stop on interim significance. Put a number in
the README before the claim gate. Call a fatal defect a limitation. Generate a
v7 automatically.

## Registered before the fact

Every threshold above is fixed while the study holds zero product-effect rows.
The floors, the repeat rule, the endpoint, the interval method and the claim
gate are all written down before the first task exists, so none of them can be
chosen by the answer.
