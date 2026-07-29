# Fresh-agent decision-recovery protocol

- Status: **registered 2026-07-29; pilot not yet run**
- Issue: [#140](https://github.com/MongLong0214/commitlore/issues/140)
- Scope: the pilot and any later confirmatory study of decision recovery
- Replaces: the prospective coding-behaviour measurement registered after M4
- Does not change: the historical analyses or verdicts for M1, M2, or M4

This document is a registration, not a harness or a result. It fixes the claim,
gold construction, arms, scoring, qualification, and refusal rules before any
run covered by it exists. Any change after collection starts is recorded as a
deviation; it does not silently edit this protocol.

## 1. Claim and observation boundary

The primary claim is:

> Does a fresh agent recover a code path's active decision context before its
> first edit?

An episode consists of an immutable repository snapshot, a named code path, a
change request that makes that path relevant, a documentary source packet, and
a frozen gold set of decision atoms. A run starts a new agent session with no
memory of any other run. Model, driver, system prompt, tool set, repository
snapshot, and task prompt are fixed across arms except for the registered
information route.

The agent must submit one structured decision brief before any attempted file
mutation. The brief has these fields:

- active constraints;
- ruled-out alternatives, each paired with its reason;
- warnings;
- the evidence status of every item: `verified`, `unverified`, or
  `not-documented`;
- superseded or expired prior decisions and, for supersession, the replacing
  decision;
- abstentions, each naming the question and the evidence that is missing; and
- a grounded plan.

Each list entry asserts one atom. A compound entry is one compound prediction;
scorers do not split it after seeing the answer.

An attempted edit before the brief invalidates the run. No code is scored, and
the episode ends when the brief is submitted. This moves the observation from
coding behaviour to the retrieval layer CommitLore can control:

`record -> preserve -> retrieve | apply -> code well`

The bar marks the end of this measurement.

## 2. Gold construction

Gold is never derived from CommitLore trailers, notes, CLI output, or any
document created from them.

### 2.1 Source packet and cutoff

Before annotation, a coordinator fixes a documentary cutoff and prepares the
same packet for both annotators:

- merged pull-request discussion and reviews;
- linked issue threads;
- ordinary commit subjects and bodies;
- maintainer explanations written before the cutoff; and
- the code and tests at the snapshot.

CommitLore records and record-rendered views are removed from the packet. Every
scorable atom must have a direct anchor in ordinary commit prose so the
ordinary-Git arm contains the same rationale. PRs, issues, and maintainer
explanations may disambiguate scope, status, or meaning, but they cannot make an
atom scorable when the commit prose does not contain it.

### 2.2 Independent annotation

Two annotators work independently. They do not see the other annotation and do
not encode trailers. Each extracts the smallest proposition that can be true or
false on its own, cites the supporting source span, and records one of:

| Atom kind | Required fields |
|---|---|
| active constraint | constraint, scope, evidence status |
| ruled-out alternative | alternative, reason, scope, evidence status |
| warning | hazard, trigger or condition, scope, evidence status |
| supersession | prior decision, replacement, scope, evidence status |
| expiry | prior decision, expiry condition or date, scope, evidence status |

For every atom the annotator also records lifecycle status at the snapshot:
`active`, `superseded`, or `expired`. Absence of a verification statement is
`not-documented`, not `unverified`; `unverified` requires a source that says the
claim or check was not verified.

### 2.3 Disagreement resolution and freeze

After both independent passes:

1. Candidates agree only when kind, proposition, reason where required, scope,
   lifecycle, and evidence status agree.
2. Every disagreement—existence, atom boundary, field value, or status—is
   logged with both source citations.
3. The annotators attempt reconciliation using only the frozen source packet.
4. If they still disagree, a maintainer who accepted or reviewed the original
   decision adjudicates from that packet without seeing CommitLore records.
5. If no such maintainer is available, or the packet cannot decide the point,
   the disputed atom is excluded. An episode with no remaining gold atoms is
   excluded.

The reconciled atom set, source packet, cutoff, annotation log, and file hashes
are then frozen. Only after that freeze is the same information encoded as
CommitLore records, preferably on `refs/notes/commitlore` so the original commit
prose remains byte-identical. A person who was not either annotator checks every
encoded record against the frozen atom and records semantic equivalence. A
mismatch is corrected before any run or the episode is excluded. The gold never
changes to match the trailers.

## 3. Primary outcome

The primary outcome is decision-recovery F1 for one episode-run.

### 3.1 Exact match rule

A predicted atom receives either one match or none; there is no partial credit.
It matches a gold atom only when all of the following hold:

1. the atom kind is the same;
2. the proposition is semantically equivalent and does not broaden its scope;
3. lifecycle and evidence status are correct;
4. a ruled-out atom gives both the correct alternative and the documented
   reason;
5. a warning gives both the hazard and its documented trigger or condition;
   and
6. a supersession gives both the prior and replacing decisions, or an expiry
   gives both the prior decision and expiry condition.

Lexical overlap alone is not a match. A missing required field, correct
alternative with an invented reason, stale decision asserted as active, or
correct decision assigned to a broader path receives no credit.

Matching is one-to-one. The score uses the maximum one-to-one assignment between
predicted and gold atoms. Duplicate predictions beyond the first are unmatched
and therefore false positives. A plausible atom absent from the frozen gold is
also a false positive; the source packet, not post-run judgment, defines the
answer space.

Two outcome scorers, blinded to arm and exposure metadata, independently mark
the prediction-by-gold match matrix. A third blinded scorer adjudicates only
disagreements using the rule above. If the third scorer cannot decide, the
prediction is unmatched. Arm labels are revealed only after all match matrices
are frozen.

### 3.2 Formula and estimand

For a run, let:

- `TP` be matched predicted atoms;
- `FP` be unmatched predicted atoms; and
- `FN` be unmatched gold atoms.

Gold is non-empty, and the registered score is:

`F1 = 2 × TP / (2 × TP + FP + FN)`.

Thus an empty brief scores zero, and a brief that lists every guess is penalised
through `FP`. Precision or recall may be shown as components, but neither
replaces F1.

The primary contrast is **CommitLore minus ordinary Git**. The confirmatory
estimand, if a confirmatory study is later authorised, is the episode-equal mean
paired difference in F1. Code-only and full-history contrasts are secondary.
The pilot reports no p-value.

## 4. Arms and what each isolates

All arms receive identical code, task wording, and documentary cutoff.

| Arm | Information available before the brief | What it isolates |
|---|---|---|
| code only | current source snapshot and code-reading/search tools; no Git, PR, issue, or record history | rationale inferable from code |
| ordinary Git | code plus the original Git history and ordinary `log`, `show`, and `blame`; record notes are unavailable | whether rationale that exists in prose is addressable |
| full-history memory | ordinary Git plus every post-freeze encoded record injected at session start, including off-path, superseded, and expired records | structured memory without path or lifecycle filtering |
| CommitLore | ordinary Git plus CommitLore output for the named path, path-scoped and lifecycle-filtered at the snapshot | structure, path addressability, and lifecycle filtering |

The ordinary-Git arm is the primary comparator. A study of Linux OOM-Killer
commit messages found rationale sentences in 98.9% of its commits
([Dhaouadi, Oakes, and Famelis, ICPC 2024](https://arxiv.org/abs/2403.18832)).
The useful question is therefore not merely whether rationale is present, but
whether a fresh agent can address the relevant, active part of it.

Code-only versus CommitLore is expected to mix presence with addressability and
cannot support the primary claim. Full-history memory versus CommitLore
isolates the value of path scope and lifecycle filtering when the record format
and underlying information are held constant.

Every record must fit in the full-history arm's context window. An episode that
requires truncating "every record" is ineligible rather than silently receiving
a different treatment.

## 5. Episode qualification

Qualification uses the registered primary comparator, ordinary Git. For each
candidate episode, two fresh ordinary-Git agents produce briefs before any
other arm runs. Define the comparator decision-recovery rate:

`Q = (F1_ordinary-git,1 + F1_ordinary-git,2) / 2`.

An episode qualifies only when `Q` is in the inclusive **0.20–0.80** band. The
lower bound refuses an instrument with almost nothing to recover; the upper
bound preserves headroom for improvement. Both bounds are fixed before
qualification. Qualification runs are never reused in the confirmatory
analysis, the treatment arms are not run or inspected before the pool freezes,
and the band is not widened after seeing the counts.

The earlier prospective M5 record ruled out per-task comparator qualification.
That rule preceded #109's finding that a floor-only gate selected an unusable
pool. This registration supersedes it for the new outcome: the F1 band is
two-sided, fixed before collection, measured on disjoint comparator runs, and
applied before any treatment arm exists.

The current eight-task M4 pool supplies **0 qualifying episodes**. Those tasks
were built and scored for a re-proposal outcome, have no independently frozen
decision-atom gold, and have no ordinary-Git decision briefs. They are
unqualified—not measured failures of the new 0.20–0.80 band. Issue
[#109](https://github.com/MongLong0214/commitlore/issues/109) separately found
that 0 of those 8 tasks passed the old re-proposal band; that result is not
relabelled as decision-recovery evidence.

For a confirmatory pool, no more than 30 candidate episodes may be annotated.
At least 24 must qualify. If fewer do, the study stops and reports the
qualification count without running a treatment arm.

## 6. Exposure recording and refusal

Assignment is not exposure. Every run must record, before outcome scoring:

- assigned arm and route;
- IDs and hashes of rationale-bearing artifacts available to that route;
- IDs, exact bytes, SHA-256 hashes, and model-token counts actually surfaced to
  the agent before the brief;
- delivery or retrieval tool, timestamp, and success status; and
- the first attempted edit timestamp, if any.

Availability in Git is recorded separately from prose actually returned by a
history command. Outcome text, matched atoms, or an arm label cannot be used as
evidence that treatment was delivered.

The dataset is refused before outcomes are analysed when:

1. expected exposure is missing or unknown in any primary-arm run;
2. any CommitLore run cannot show a successful path-scoped,
   lifecycle-filtered delivery before the brief;
3. ordinary-Git runs cannot show whether and what prose was actually surfaced;
   or
4. no primary pair differs in artifact IDs, exact payload hash, or token count.
   A different arm label or route name alone does not satisfy this gate.

No row is imputed or reclassified from transcript inference. A refused dataset
is reported as an instrumentation failure and receives no primary effect
estimate or p-value. This rule applies even when the output files otherwise
look complete.

## 7. Variance refusal

Before a confirmatory study is authorised, its pilot must show for both
CommitLore and ordinary Git that:

- F1 is not all zero;
- F1 is not all one;
- at least two distinct F1 values occur; and
- sample variance is greater than zero.

The paired F1 differences must also contain at least two distinct values and
must not all be zero. These checks are rerun before any confirmatory outcome
analysis. Failure is reported as a floor, ceiling, or zero-variance instrument;
no hypothesis test is run. More rows do not repair an outcome that cannot vary.

## 8. Secondary outcomes

Secondary outcomes never replace or redefine primary F1.

| Outcome | Operational definition | Why it is worth its cost |
|---|---|---|
| time to a grounded plan | elapsed monotonic time from task delivery to the earliest submitted plan containing at least one matched active gold atom and a source citation; if none, record `not reached`, never the timeout value | retrieval that is accurate but too slow may still be unusable; timestamps are already required |
| tool calls to reach it | count of externally recorded tool invocations before that same plan; one batched invocation counts once; `not reached` stays missing, not zero | distinguishes addressability from long history-search chains using the existing event log |
| stale-decision error rate | assertions that a superseded or expired gold decision is active, divided by all assertions of active decisions; report numerator and denominator, and `not measurable` when the denominator is zero | directly tests the lifecycle guarantee rather than folding it invisibly into F1 |
| correctly recovered atoms per 1,000 tokens delivered | `1,000 × TP / rationale-bearing tokens actually surfaced before the brief`; task prompt and code tokens are excluded; zero delivered rationale tokens yields `not applicable` | compares path-scoped delivery with full-memory volume without treating more context as free |
| abstention quality | F1 over gold atoms labelled `unverified`: a predicted abstention matches only when it identifies the same atom or question and does not assert it as verified; abstaining on a verified, `not-documented`, or absent atom is a false positive; a missed gold-unverified atom is a false negative; if the frozen gold contains none, report `not measurable` | tests calibrated uncertainty with labels already created for the primary brief |

Times among reached runs are always accompanied by the grounded-plan reach
count. Token efficiency is not reported for code-only because its denominator
is intentionally zero.

## 9. Affordable first step and confirmatory gate

The project registers an **eight-episode feasibility pilot**, not a
confirmatory study. Each episode receives two independent gold annotators, two
ordinary-Git qualification runs, and one fresh run in each of the other three
arms: 40 agent runs in total. All pilot arms are run regardless of the pilot
qualification result so the band itself can be assessed without turning the
pilot into a claim. The first ordinary-Git run is the predesignated pilot
comparator for descriptive pairing and power planning; the second contributes
only to `Q`.

The pilot may report protocol completion counts, arm distributions, annotation
disagreements, exposure, variance, and secondary-outcome availability. It
reports **no p-value, no confirmatory confidence interval, and no product
claim**.

A confirmatory study is worth registering only if all of these hold:

1. at least 6 of 8 pilot episodes land in the 0.20–0.80 ordinary-Git band,
   making a 24-of-30 qualification yield plausible;
2. every retained episode has frozen independent gold, an ordinary-prose anchor
   for every atom, and verified trailer equivalence;
3. the exposure and variance gates in §§6–7 pass without imputation;
4. the structured brief and all five secondary outcomes can be scored exactly
   as registered; and
5. a design-stage power analysis using the pilot's episode-level paired F1
   distribution shows that some fixed size from 24 through 30 episodes can
   reach 80% power for an absolute F1 improvement of 0.10 under a two-sided
   paired randomization test at `alpha = 0.05`.

The first whole-episode size in that range meeting the power rule is fixed in a
new registration before confirmatory qualification begins. If none meets it,
or the project cannot fund two annotators for that many episodes, the
confirmatory study is not run. No gate depends on the pilot effect's direction
or significance.

Twenty-four to thirty episodes with two annotators is a real labelling project.
This protocol does not pretend the current pool already pays that cost.

## 10. Freeze and reporting order

Before the first run, freeze the repository snapshots, source packets, gold
hashes, record encodings, prompts, model identity, driver, tool policy,
randomised arm order, time limit, and token-counting method. A fresh agent and
fresh workspace are required for every run; caches, sessions, and external
memory may not cross runs.

Reporting order is fixed:

1. annotation and freeze integrity;
2. early-edit invalidations;
3. exposure refusal;
4. qualification count;
5. variance refusal;
6. primary F1 components and, for a confirmatory study only, the registered
   paired analysis; and
7. secondary outcomes.

Stopping at an earlier refusal does not permit reporting a later result.
