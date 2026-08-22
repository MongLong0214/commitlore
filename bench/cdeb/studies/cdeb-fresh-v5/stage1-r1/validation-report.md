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

## An independent adversarial review ran against this layer

Recorded in full at `adversarial-review.md`. It read 30 files, left none of the
22 given unread, returned **HOLD**, and did so through eleven findings rather
than through the four open criteria this report already named.

Six of them made concrete claims about behaviour and **all six reproduced**:

| Finding | Reproduced as | State |
|---|---|---|
| the interval can collapse | 50 agreeing candidates gave `[0.125, 0.125]`, zero width, superiority declared | fixed — the bootstrap now draws repeats as well as candidates |
| a retry can overwrite a failure | the later success replaced the earlier failure under the same key, every assigned key still present | fixed — duplicate observations are refused, not resolved |
| a repository label is unchecked | an observation labelled with a repository it was not assigned to was accepted into that stratum | fixed — the join key carries the repository |
| degradation can be masked | a one-candidate repository losing every completion pooled to −1.6 points and passed the −5 margin | fixed — equal-repository weighting and a confidence bound |
| impossible controls validate | three controls sharing one patch digest, two `revival=false` and one `revival=true`, validated | fixed — controls must have distinct patches and trees |
| an exclusion needs no evidence | `NOT_BUILDABLE` with `evidence: null` validated | fixed — evidence required, attempt log required for the five attempt-based reasons |
| both arms can drift together | a rolled-forward `model_id` in both arms passed the arm-versus-arm check | fixed — every episode is compared to the freeze itself |

Two further findings were design contradictions rather than code defects, and
both are resolved below: the power rule required a quantity it forbade itself to
read, and the pilot thresholds required all twelve candidates while the census
may legitimately dispose one as `NOT_BUILDABLE`.

One finding is **not fixed and not fixable here**: the effect-blind pilot gate
constrains the *record*, not the *person*. Nothing in code stops an operator who
watched the runs from deciding to continue on what they saw. Closing it needs
role separation — execution, custody and continuation held by different
parties — which is an owner decision, and it is carried in §"What is open".

Nine mutation-registry guards now cover the fixes, each proved by defeating it
and watching a named test fail.

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
| 11 | power/resource rule is executable and pilot-effect-independent | PASS | `power-and-resource-rule.json` fixes all fields before the pilot, including `tau_squared_bound`, which the adversarial review showed could not be deferred. `assertEnvelopeDetectsImportantEffect` is executable and HOLDs on an envelope that cannot reach its own target; `assertPowerInputsEffectBlind` refuses any sizing input naming an effect. Tests: *reads the frozen power rule*, *refuses a sizing input that carries a treatment contrast*, *holds rather than lowering the important effect the envelope cannot reach* |
| 12 | analysis resamples candidates within fixed repositories, never repositories | PASS | `stratifiedBootstrap` draws candidates within each fixed stratum **and repeats within each drawn candidate**, so agreeing candidates no longer collapse the interval to zero width; `assertNoRepositoryResampling` throws on `repository`, `repositories`, `stratum` and `strata`. Tests: *resamples candidates within fixed repositories*, *does not collapse the interval when every candidate agrees* |
| 13 | ITT cannot silently drop post-treatment failures | PASS | `ittEpisodes` materializes an assigned-but-unobserved episode as a failure, **refuses a second observation of one assigned episode**, and keys on the repository so a mislabelled observation cannot enter the wrong stratum; `assertNoPostTreatmentDrop` throws on a filtered set. `claimGate` requires superiority and both noninferiority bounds together. Tests: *keeps an assigned-but-unobserved episode in the denominator*, *refuses a second observation of one assigned episode*, *gates the headline claim on superiority and both margins together* |
| 14 | pilot PASS/HOLD cannot inspect treatment-effect direction or magnitude | PASS for the record, OPEN for the person | The feasibility record has six fields, none of which can carry an arm contrast, and `assertFeasibilityCarriesNoEffect` refuses one that does; the counted thresholds are denominated in the buildable subset so feasibility pressure does not push a marginal candidate into BUILDABLE. What no code closes is an operator who watched the runs — see *Custody of the pilot's outcomes*. Test: *gates the pilot on feasibility alone* |
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

## A finding the corrected arithmetic produced, and the contradiction under it

The corpus cannot detect a small effect. This is registered before any outcome
exists so it cannot later be discovered in the direction that suits a result.

The first revision registered 8 repeats per arm and reported the detectable
effect as a family of curves over `tau^2`, the between-candidate variance in how
much delivery helps. The adversarial review found that this was not a design but
a deferral, and that the deferral was impossible to discharge: **`tau^2` is a
property of the arm contrast**, so a sizing rule that reads it is reading exactly
what the rule forbids, and the 12-candidate pilot cannot estimate a variance in
any case. An operator could have substituted a smaller within-arm variance and
certified a power the study did not have.

So `tau^2` is no longer deferred. `TAU_SQUARED_BOUND = 0.06` is frozen in code,
at the top of the bracket the design was already reporting, before any outcome
exists. If true heterogeneity is lower the study detects more than it promised,
which is the safe direction to be wrong in.

At that bound, `assertEnvelopeDetectsImportantEffect` is executable and it
changed the design:

```text
8 repeats    17.2 pp detectable   FAILS the registered 15 pp target
15 repeats   15.0 pp detectable   the smallest envelope that reaches it
             1,500 episodes, 1,650 with the infrastructure allowance
```

The registered envelope is therefore 15 repeats, not 8. The earlier figure was
chosen against a mid-range `tau^2` the design had no way to obtain.

**And there is a ceiling.** At `TAU_SQUARED_BOUND`, a 10-point effect is
unreachable at *any* repeat count — the search runs to 200 repeats and never
gets there. Repeats shrink only the within-candidate binomial term; the
heterogeneity term shrinks only with more candidates, and the corpus is fixed at
62. No budget removes this.

The consequence, stated in the preregistration: **a null result from this study
is not evidence of no effect.** It is what a corpus of this size produces either
way.

## What would close the HOLD

```text
criterion 5   62 frozen dispositions, each BUILDABLE with a validated oracle or
              NOT_BUILDABLE with one of the seven registered reasons, carrying
              evidence and, for the five attempt-based reasons, an attempt log
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

Two further items are open and neither is closable in code:

**Custody of the pilot's outcomes.** The effect-blind gate constrains the
feasibility record, and the record now has no field that could carry an arm
contrast. It does not constrain the person. An operator who watched the episodes
run has seen the direction whatever the file says, and can act on it by
continuing, by declaring an instrument repair, or by declining to proceed. The
structural fix is role separation — execution, custody of the arm-coded outcomes,
and the continuation decision held by different parties, with the continuation
authority receiving only a signed feasibility verdict. **That is an owner
decision about who does what, and it must be settled before the pilot rather
than after it.**

**Attestation of the record-blind authoring environment.** The manifest now
names who produced the maintenance need and the acceptance criteria, and refuses
one whose producer is not declared record-blind. A declaration is still a
declaration. Making it evidence needs the authoring step to run in an isolated
environment whose inputs are attestable, which is infrastructure this layer does
not have. Until then the leakage scan over the finished task text is the only
independent check, and it catches lexical reuse rather than paraphrase.

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
adversarial review             HOLD, 11 findings, 6 reproduced, all 6 fixed
guards bound in the ratchet    41
```
