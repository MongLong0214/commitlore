---
document_id: cdeb-fresh-v5-stage1-r1-adversarial-review
study_id: cdeb-fresh-v5
stage: stage1-r1
verdict: HOLD
measured_episode_authorized: false
---

# Stage 1-r1 independent adversarial review

An independent reviewer was asked to manufacture a plausible favorable-but-wrong
conclusion from the design, against a detached worktree of the exact commit under
review. Static reading only: it ran nothing.

Its verdict was **HOLD**, matching the implementation's own, and it reached that
verdict through eleven findings rather than through the four open criteria the
validation report already named.

## Coverage

```text
files given      22
files read       30
files not read   0
tool calls       43 over 87 events
```

Reading beyond the given list is a property of a real review, not a defect; the
list is a floor. Coverage was checked before the verdict was read, because a
schema-complete answer from a reviewer that opened nothing is worse than no
answer -- it reads as a judgement.

## What was confirmed by running the code

Six findings made concrete claims about behaviour. Each was reproduced before
anything was changed:

```text
interval collapse       50 agreeing candidates -> [0.125, 0.125], zero width,
                        superiority declared
retry overwrite         a success with the same key silently replaced the failure
                        it followed; every assigned key still present
wrong repository        an observation labelled with a repository it was not
                        assigned to was accepted and carried into that stratum
masked degradation      a one-candidate repository losing every completion
                        pooled to -1.6 points and passed the -5 margin
impossible controls     three controls sharing one patch digest, two saying
                        revival=false and one revival=true, validated
label-only exclusion    NOT_BUILDABLE with null evidence validated
common-mode drift       both arms moved off the freeze together and the
                        arm-versus-arm check passed
```

## Findings

### Fatal (P0/P1)

**1. [P0] `bench/cdeb/studies/cdeb-fresh-v5/stage1-r1/validation-report.md`**

The study is not executable: all 62 census rows are undecided, the firewall manifest has zero rows, no task or oracle artifacts exist, all 17 runtime fields are null, and the randomization seed and schedule hash are null.

*How it manufactures a wrong conclusion:* Starting now would leave the operator free to choose the population, tasks, oracle boundaries, runtime, and schedule after observing pilot or early behavior. Almost any favorable result could then be selected into existence.

*Fix:* Do not authorize an episode. Complete and freeze every disposition with evidence; build record-blind tasks and executable oracle controls; bind all cross-artifact digests; pin and attest the runtime; generate and commit the reproducible schedule; then obtain a new independent adversarial review and explicit owner authorization.

**2. [P1] `bench/cdeb/freeze/oracle-v5.ts`**

Oracle validation trusts declared booleans and free-form structural notes rather than replaying an executable oracle. The positive test validates three controls with the same patch digest: two declare revival=false and one declares revival=true, an impossible result for a deterministic final-tree oracle.

*How it manufactures a wrong conclusion:* An oracle author can submit metadata saying that hand-picked controls discriminate while the actual oracle is always-no or overly broad. The latter particularly penalizes novel control-arm solutions while accepting record-shaped treatment solutions, manufacturing a delivery advantage.

*Fix:* Replay the frozen acceptance suite and content-addressed oracle executable on unique, materialized control trees; recompute every outcome; reject duplicate patch/tree digests; bind the oracle executable digest to the firewall manifest; require diverse mandatory near-boundary controls authored independently of the oracle; and freeze the full replay transcript before any episode.

**3. [P1] `bench/cdeb/freeze/firewall-v5.ts`**

The firewall proves only which keys a self-reported manifest contains. It requires only base_tree_oid, permits maintenance_need and functional_acceptance as channels, stores only their claimed hashes, and detects only exact normalized four-word overlap.

*How it manufactures a wrong conclusion:* A record-aware coordinator can paraphrase the ruled-out decision into the maintenance need or acceptance criteria, or simply omit an undeclared input from the manifest. The ON arm then receives an answer key to a task constructed around that key, while the lexical leakage check remains clean.

*Fix:* Run task authoring in an isolated, attestable environment; require an exact closed set of raw content-addressed inputs rather than optional claimed hashes; ensure the producer of the maintenance need and acceptance criteria is also record-blind; freeze those bytes before candidate-record matching; and add independent semantic-leakage adjudication with adversarial paraphrase controls.

**4. [P1] `bench/cdeb/freeze/buildability-v5.ts`**

Closed reason labels do not control buildability discretion. Evidence may be null, no fixed construction effort or failed-attempt record is required, and no independent adjudication establishes that a registered NOT_BUILDABLE reason actually holds.

*How it manufactures a wrong conclusion:* Builders who know every record can stop trying on decisions expected to show little benefit and diligently construct tasks and controls for crisp, salient decisions expected to favor delivery. All resulting exclusions can pass the current outcome-blind schema.

*Fix:* Precommit a uniform effort and attempt protocol per candidate; require content-addressed evidence and all failed construction artifacts for every exclusion; make evidence non-null conditionally in both schema and runtime validation; use independent adjudicators blinded to predicted treatment receptivity; and audit disposition rates by pilot/reserve and repository before freezing.

**5. [P1] `bench/cdeb/freeze/analysis-v5.ts`**

The primary interval resamples candidate-effect point estimates even though the declared target is the fixed frozen corpus; it has no valid source of candidate-sampling randomness and does not separately represent repeat-level uncertainty.

*How it manufactures a wrong conclusion:* With the registered eight repeats, if every candidate happens to have one ON success and zero SUPPRESSED successes, every candidate effect is 1/8 = 12.5 percentage points. Every candidate-bootstrap draw is then identical, producing a 12.5-to-12.5-point interval and declaring superiority despite nonzero episode-level uncertainty.

*Fix:* State the source of random inference explicitly. For the fixed finite corpus, use assignment/randomization inference with confidence-set inversion and model repeat-level stochasticity within candidate. If a candidate superpopulation is intended, define it and justify probabilistic sampling, then use a two-level method that represents both candidate and repeat variation.

**6. [P1] `bench/cdeb/freeze/analysis-v5.ts`**

The purported noninferiority test is only a comparison of pooled point estimates to the −5-point margin. It has no confidence bound, uses candidate-count weighting rather than the primary equal-repository weighting, and is not combined with the superiority flag.

*How it manufactures a wrong conclusion:* An arbitrarily imprecise estimate just above the margin passes, degradation in a smaller repository can be masked by a larger repository, and the result object can declare superiority even when nonDegradation.holds is false.

*Fix:* Define matching completion and functional-pass estimands; compute preregistered one-sided confidence bounds under equal repository weighting; specify multiplicity handling for both endpoints; and expose a single claim gate that requires primary superiority and both noninferiority bounds to pass.

**7. [P1] `bench/cdeb/freeze/analysis-v5.ts`**

The ITT join silently accepts duplicate observations because Map construction keeps the last row for a candidate/arm/repeat key. The key also omits repository_id, and observed repository identity is never checked against assignment.

*How it manufactures a wrong conclusion:* A failed episode can be retried and followed by a success with the same key; the success overwrites the failure while all assigned keys remain present. Selective retries can therefore erase treatment failures without triggering the post-treatment-drop guard.

*Fix:* Reject duplicate assignment and observation keys; include and verify repository identity; validate the exact registered repeat indices and arm counts; assign immutable attempt IDs; and preregister whether infrastructure retries are forbidden, scored as separate failures, or evaluated by a fixed first-attempt rule.

**8. [P1] `bench/cdeb/freeze/effect-independence-v5.ts`**

The effect-blind pilot gate constrains only field names in one feasibility object. It does not prevent the operator or approving owner from seeing or reconstructing paired-arm outcomes, nor does it prevent repair or continuation decisions after that exposure.

*How it manufactures a wrong conclusion:* A favorable pilot can continue while an unfavorable pilot becomes an instrument-repair episode or a discretionary refusal to proceed. Omitting an effect-named field from the gate record does not blind the decision-maker who observed the runs.

*Fix:* Separate execution, custody, and continuation roles; encrypt or sequester arm-coded pilot outcomes until confirmatory artifacts and conditional owner authorization are irrevocably frozen; have the continuation authority receive only a signed feasibility verdict; and require any post-pilot task/oracle repair to start a new preregistration.

**9. [P1] `bench/cdeb/studies/cdeb-fresh-v5/stage1-r1/power-and-resource-rule.json`**

The power rule is internally unimplementable as written. minimumDetectableEffect requires tau_squared for candidate-level ON-minus-SUPPRESSED effects, while the rule forbids reading arm comparisons and exposes only a generic within_repository_variance input. The pilot design itself says its per-repository pilot sample cannot stably estimate the nuisance variance.

*How it manufactures a wrong conclusion:* The operator can substitute an optimistic within-arm variance or the favorable lower bracket for the required treatment-effect heterogeneity, certify that the design detects the important effect, and later present a positive result with unjustified power and precision.

*Fix:* Freeze an externally justified conservative heterogeneity bound now, or preregister an arm-masked estimator and an upper confidence bound from a pilot actually sized for variance estimation. Name the exact estimator, inputs, missing-data rule, and executable HOLD calculation; do not use a noisy point estimate.

**10. [P1] `bench/cdeb/freeze/runtime-lock-v5.ts`**

Runtime validation checks only that lock fields are nonempty and that two supplied arm objects are equal. It does not validate field types or values, bind episode attestations to the lock, or detect both arms drifting together from the frozen runtime.

*How it manufactures a wrong conclusion:* Placeholders can pass, and a hosted model or harness revision can change during execution while both comparison objects remain equal or self-reported. If revision timing correlates with scheduled arms, service drift can be credited to delivery.

*Fix:* Validate the lock with a strict runtime schema; require immutable model/release identifiers; emit signed per-episode attestations for every locked field; compare every episode to the frozen lock as well as to the opposite arm; and stop on any mismatch.

**11. [P1] `package.json`**

There is no frozen end-to-end v5 randomization or analysis entry point. analysis-v5.ts exports optional helpers but has no driver, while bench:cdeb:analyze points to a different generic analyzer.

*How it manufactures a wrong conclusion:* An analyst can invoke only favorable helpers, omit ITT or non-degradation checks, mishandle retries, or use an older analysis path while still saying the registered functions exist.

*Fix:* Add one versioned CLI that loads the frozen schedule and raw observations, validates all cross-artifact identities and uniqueness, constructs ITT, performs the registered inference and claim gate, and writes a deterministic result artifact. Pin that CLI in package.json and test it end to end on hostile fixtures.

### Important (P2)

**1. [P2] `bench/cdeb/guards/baseline.json`**

Legacy-contamination coverage is mostly unproved: for the 15 indexed exclusions, the baseline records one bound property, one unavailable property, and 13 uncovered properties.

*Fix:* Represent every exclusion kind in the relevant candidate/task/oracle/runtime manifests, add constructed negative controls for all kinds, and bind those controls to v5 tests rather than relying on generic value matching in predecessor census code.

**2. [P2] `bench/cdeb/studies/cdeb-fresh-v5/stage1-r1/pilot-feasibility-thresholds.json`**

The pilot thresholds require complete manifests, controls, and delivery checks for the entire fixed pilot, but the buildability design permits pilot candidates to be NOT_BUILDABLE and specifies neither a reduced denominator nor replacement handling.

*Fix:* State explicitly whether any unbuildable pilot candidate causes an irrevocable HOLD. If not, preregister the buildable-subset denominator and prohibit replacement; do not let feasibility pressure force marginal candidates into BUILDABLE.

## What the reviewer could not refute

These are as informative as the findings: each is an attack that was tried and failed.

- The endpoint's basic assigned-episode ITT rule makes missing, non-completed, functionally failing, and oracle-null episodes failures; simple treatment-induced non-completion does not look favorable if duplicate handling is repaired and the pipeline invokes the rule.

- The stated estimand is the total shipped delivery effect, including payload, salience, token load, and hook behavior. I found no semantic-content-only claim in the preregistration.

- The suppressed arm retains record access, natural discovery is a manipulation check rather than an exclusion, and the permitted claim is automatic delivery versus suppression rather than access versus no access.

- The listed pilot and reserve candidate IDs are disjoint and exhaustive for the qualified corpus; I found no direct pilot candidate reused in the confirmatory reserve.

- The primary repository aggregation gives equal weight to the four fixed repositories and stops on an empty stratum rather than silently averaging survivors.


## The reviewer's own stated limits

- Static review only: per instruction, no tests, builds, study scripts, hash recomputation, oracle execution, or measured episodes were run.

- No real task, oracle, schedule, episode, or result artifacts exist, so their future semantic quality and provenance could not be inspected.

- The additional candidate-census file was sampled at its head and searched for named legacy identifiers; the qualification JSONL was only searched for those identifiers.

- CommitLore context was consulted, but its fallback history scan was incomplete because the repository index was unavailable.
