---
document_id: cdeb-fresh-v5-stage1-r1-validation-report
study_id: cdeb-fresh-v5
stage: stage1-r1
verdict: HOLD
measured_run_allowed: false
---

# Stage 1-r1 validation report

**Verdict: HOLD.** Eleven of the fifteen FINAL-PRD §19 acceptance criteria are
satisfied by evidence in this tree. Four are not, and each of the four is a
P0/P1: the population is not fixed, no oracle exists, no task has been authored,
and the runtime is not pinned. Under §19's own rule, any unresolved P0/P1 is a
HOLD, so no measured episode is authorized and none has been run.

This is the expected outcome of the implementation prompt, not a failure of it.
The prompt asked for the pre-execution design layer — schemas, manifests,
validators, allocation checks, analysis code, runtime lock, power rule, pilot
thresholds and census machinery. That layer is built and tested. The four open
criteria are the per-candidate construction work that comes next, and each is
open because the artifact that would close it does not exist, not because a
check was skipped.

## Criterion-by-criterion

| # | Criterion | State | Evidence |
|---|---|---|---|
| 1 | failed Stage 1 draft remains historically visible | PASS | `../STAGE1-PREREGISTRATION.md` still carries `status: DRAFT-NOT-FROZEN-failed-adversarial-review`; `../stage1/adversarial-review.md` untouched. Test: *keeps the failed Stage 1 draft and its review in the tree* |
| 2 | r1 has a distinct preregistration identifier | PASS | `STAGE1-PREREGISTRATION-r1.md` declares `preregistration_identifier: CDEB-FRESH-V5-STAGE1-R1` and `supersedes:` the draft. Test: *gives r1 its own identifier* |
| 3 | `measured_run_allowed=false` | PASS | `STATUS.json`, `study.json`, the r1 preregistration and the analysis plan all declare it. Test: *keeps measured_run_allowed false everywhere it is declared* |
| 4 | measured product-effect rows remain 0 | PASS | No `tasks/`, `gold/`, `oracles/`, `pilot/`, `rows/`, `randomization/`, `episodes/` or `results/` directory exists under the study or under `stage1-r1/`. The census is the only per-candidate artifact and `assertDispositionsOutcomeBlind` confirms it carries no outcome field. Tests: *creates no directory a measured run would write outcomes into*, *holds zero measured product-effect rows* |
| 5 | all 62 candidates have exactly one buildability disposition | **FAIL — P0** | `buildability-census.jsonl` has 62 rows, one per qualified candidate, and all 62 carry `disposition: null`. `assertCensusComplete` throws on the committed file. See §"What is open" below |
| 6 | reasons are schema-bound and fail closed | PASS | Seven registered reasons in `buildability-reasons.schema.json` and in `NOT_BUILDABLE_REASONS`; `parseDisposition` throws on anything else. Test: *accepts only registered reasons* |
| 7 | pilot and reserve are deterministic, disjoint and total 62 | PASS | 12 + 50 = 62, no overlap, and every allocated candidate appears in the census. Test: *recomputes the allocation from the artifacts* |
| 8 | every BUILDABLE candidate has required oracle controls | **FAIL — P0** | No oracle has been built for any candidate. The gate itself is implemented and tested against a well-formed matrix, a single-compliant matrix, a failing violation control, an always-yes oracle and an always-no oracle. It has nothing to run on |
| 9 | firewall manifests prove record-blind task freeze precedes oracle construction | **FAIL — P0** | `firewall-manifest.jsonl` is empty; no task has been authored. The ordering check, the input allow/deny lists, the digest binding and the n-gram leakage detector are implemented and tested, including the case where an empty manifest file would otherwise pass vacuously |
| 10 | runtime lock is complete | **FAIL — P1** | `runtime-lock.json` has all 17 fields null and `frozen_at: null`; `assertRuntimeLockComplete` throws on it. The agent under test has not been chosen, and filling the lock with placeholders would make an unpinned runtime read as a pinned one |
| 11 | power/resource rule is executable and pilot-effect-independent | PASS | `power-and-resource-rule.json` fixes all nine fields before the pilot. `minimumDetectableEffect` was run over the reserve to produce the table in that file; `assertPowerInputsEffectBlind` refuses any sizing input naming an effect. Tests: *reads the frozen power rule*, *refuses a sizing input that carries a treatment contrast*, *computes the detectable effect from the frozen envelope* |
| 12 | analysis resamples candidates within fixed repositories, never repositories | PASS | `stratifiedBootstrap` draws candidates within each fixed stratum; `assertNoRepositoryResampling` throws on `repository`, `repositories`, `stratum` and `strata`. Tests: *resamples candidates within fixed repositories*, *produces a reproducible interval* |
| 13 | ITT cannot silently drop post-treatment failures | PASS | `ittEpisodes` materializes an assigned-but-unobserved episode as a failure; `assertNoPostTreatmentDrop` throws on a filtered set. A synthetic treatment that only prevents completion produces a negative `Delta`. Tests: *keeps an assigned-but-unobserved episode in the denominator*, *cannot score a treatment that only prevents completion as a success* |
| 14 | pilot PASS/HOLD cannot inspect treatment-effect direction or magnitude | PASS | The feasibility record has six fields, none of which can carry an arm contrast, and `assertFeasibilityCarriesNoEffect` refuses one that does. This replaces the draft's blind, which the review found protected the analyst while the operator held the key. Test: *gates the pilot on feasibility alone* |
| 15 | the PR executes no measured episode | PASS | The randomization seed and schedule hash are both null and the plan is marked `PLAN-FROZEN-SCHEDULE-NOT-COMPUTABLE`. Test: *declares the state plainly and leaves the randomization schedule uncomputable* |

## What is open, and why it is not closable by machinery

The four failures share one cause. Criteria 5, 8 and 9 all require per-candidate
construction — a maintenance task authored without sight of the record, a
deterministic acceptance suite, and an oracle validated against at least two
compliant passing patches and one ruled-out passing patch. Criterion 10 requires
an owner decision about what agent is under test.

The mechanical screens were run and they settle nothing:

```text
repository             candidates  screen-refuted  acceptance runner
agent-control-plane            10               0  npm test
agent-operator-score           17               0  npm test
gitseed                        22               0  pytest
logic-pro-mcp                  13               0  swift test
```

All four sealed bundles materialize with matching digests and trees. 61 of the
62 decision scopes survive intact at the frozen snapshot and the 62nd survives
partially. Every repository has an executable test command. So no candidate can
be excluded mechanically, and none can be admitted mechanically either:
`BUILDABLE` asserts that an oracle exists and discriminates, which is a claim
about an artifact, not about a screen.

There is a second reason the remaining work cannot be done from here.
Criterion 9's firewall requires the task author not to have read the record.
Whoever built this corpus has read all 241 of them. The firewall is therefore
not something this context can satisfy for itself — it needs a task-authoring
step whose inputs are the base tree and nothing else, with the manifest proving
it. The machinery for that manifest exists; running it needs a separate,
record-blind author.

## One defect found and fixed during implementation

The first transcription of the inverse-normal quantile dropped a term from the
central-region denominator. Every quantile came out at roughly 1/400 of its true
value, which made the minimum detectable effect come out near 0.1 percentage
points — a corpus of 50 candidates appearing able to detect almost any effect.

The bug is fixed, the function is exported, and a test now pins `q(0.975)`,
`q(0.9)`, `q(0.01)` and `q(0.5)` against published values to five decimals. The
episode is worth recording because the failure mode was flattering rather than
noisy: a broken power calculation that produced *large* detectable effects would
have been questioned immediately.

## A finding the corrected arithmetic produced

The corpus cannot detect a small effect, and this is registered before any
outcome exists so it cannot later be discovered in the direction that suits a
result.

At the frozen envelope of 8 repeats per arm over all 50 reserve candidates, the
detectable difference in equal-weight `Delta` is:

```text
tau^2 = 0.00   12.3 pp        tau^2 = 0.03   14.9 pp
tau^2 = 0.01   13.2 pp        tau^2 = 0.06   17.2 pp
```

Reaching 10 points needs 12 repeats — 1,200 episodes — and only if candidates
are homogeneous. At `tau^2 = 0.06`, 20 repeats and 2,000 episodes still leaves
14.3 points undetectable. `tau^2` is between-candidate variance in how much
delivery helps, and repeats cannot average it away; only more candidates can,
and the corpus is fixed at 62.

The consequence for the report is stated in the preregistration: **a null result
from this study is not evidence of no effect.** It is what an underpowered
corpus produces either way, and the registered minimum practically important
effect of 15 points is set where the envelope can actually reach.

## What would close the HOLD

```text
criterion 5   62 frozen dispositions, each BUILDABLE with a validated oracle or
              NOT_BUILDABLE with one of the seven registered reasons
criterion 8   for every BUILDABLE candidate: an oracle reading the final tree
              only, with two structurally distinct compliant passing controls and
              at least one ruled-out passing control, shown to discriminate
criterion 9   for every BUILDABLE candidate: a task-author manifest whose inputs
              are the base tree and the neutral maintenance need, and an oracle
              manifest at a later sequence carrying that manifest's digest
criterion 10  the 17 runtime fields pinned and frozen, from the owner
```

Criterion 10 is an owner decision. Criteria 5, 8 and 9 are construction work
that must be done candidate by candidate, behind the firewall, before any
episode. None of it may begin from a context that has read the records.

## State

```text
measured product-effect rows   0
measured_run_allowed           false
buildability dispositions      0 of 62
oracles built                  0
tasks authored                 0
firewall manifests             0
runtime lock                   not frozen
randomization schedule         not computable
verdict                        HOLD
```
