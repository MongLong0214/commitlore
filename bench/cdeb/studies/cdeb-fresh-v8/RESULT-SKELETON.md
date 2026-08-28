# RESULT skeleton — written before the numbers

Drafted while the judgements run, so the frame is chosen before the result is
seen. Deciding what to lead with after reading the effect is how a study ends up
telling the story its numbers happen to support.

Nothing here fills in an outcome. It fixes the order, the decision rule, and the
sentences that must appear whatever the answer turns out to be.

## The decision rule, from section 28

Read in this order, and stop at the first that holds:

```
data-integrity failure                         -> TERMINAL_HOLD_FINAL
panel reliability below section 10.1's floor
  or indeterminate rate excessive              -> PUBLISHED_INDETERMINATE
material harm, or supported negative effect    -> PUBLISHED_NEGATIVE
all 25 conditions of section 27 pass           -> PUBLISHED_POSITIVE
benefit evidence, some conditions fail         -> PUBLISHED_QUALIFIED
primary CI contains zero, reliability
  acceptable, no material harm                 -> PUBLISHED_NULL
```

Two of these are easy to confuse and the difference matters. INDETERMINATE says the
instrument could not be trusted. NULL says the instrument worked and found no
effect. A study whose panel agrees strongly and whose interval spans zero is a
null, not an indeterminate, and calling it the latter would understate what was
established.

## Order of the document

1. **What the study set out to measure, and what it measured instead.** Whatever
   the effect turns out to be, roughly 41% of episodes changed no file, and in
   agent-operator-score it was 85%. The pinned agent read that repository's own
   gate rules, ran its ticket resolver, and declined. A reader who meets that fact
   on page three will have already misread page one.
2. **The headline, with its scope in the sentence.** Section 27 as amended:
   *R% fewer repeated bad decisions on a fixed 17-task benchmark* — and only if
   every one of the 25 conditions passed. Otherwise the category from section 28
   and its registered wording, unedited.
3. **The primary estimate**: P-DSFPS delta, its bootstrap interval, the
   randomization p, and both repository effects.
4. **Reliability**, per section 10: three-way exact agreement, pairwise raw
   agreement, pairwise Gwet AC1, Fleiss kappa, the panel indeterminate rate, and the
   per-stratum figures. AC1 and kappa both, because they disagree under skew and the
   disagreement is informative.
5. **Secondary outcomes**: P-FVR, RBDR with its registered pair-based definition,
   P-IND, completion and functional-pass differences.
6. **The claim gate, condition by condition**, with what each read and where the
   number came from. A gate reported as a single verdict cannot be checked.
7. **The two independent analyses** and what matched. Section 24's deterministic
   quantities are compared strictly; the Monte Carlo pair is reported with its gap.
8. **Limitations.**
9. **Deviations**, all of them, by id.

## Sentences that appear regardless of the outcome

These are commitments, not drafts. Each of them is already established and none
depends on how the effect comes out.

- **The refusal rate.** "Of 340 episodes, N changed no file at all; in
  agent-operator-score the figure was M of 160. The tasks were solvable — each
  candidate's rebuilt control passes its acceptance — and the agent declined to
  start them under the repository's published gate rules. To that extent this study
  measured whether an agent begins work under one repository's governance, which is
  not the question that was registered."
- **The calibration confound** (v8-d010). "The panel was selected on a corpus where
  30 of 30 compliant cases were v7 rebuilds and 16 of 17 violations were v6
  imports. That bounds what passing calibration establishes about these three
  seats. It does not bound the measured agreement statistics, which were computed
  on episodes carrying no such split."
- **What the interval is about** (bootstrap unit). "Repetition blocks were resampled
  within each candidate; candidates and repositories were held fixed. The interval
  describes rerunning this benchmark with this pinned agent, and says nothing about
  other tasks or other repositories."
- **Arm concealment** (v8-d005). "Concealment was role separation, not cryptography.
  Anyone holding the committed seed can recompute every arm; judges were kept from
  it by running in a scratch copy with no repository path in reach."
- **What a judge saw** (packet-size-and-reading). "A packet tree is millions of
  tokens and no judge read one whole. A judge read the decision, the task, the diff,
  and whatever else it chose to open. A violation visible only in a file no judge
  opened would have been scored compliant."
- **Snapshot availability** (snapshot-lock). "The bundle digests guarantee
  integrity, not availability. A fresh clone has no bundles and cannot repeat the
  verification without obtaining them separately."
- **Treatment salience differs by repository** (delivery-control). "On gitseed the
  target decision was one of three records in about a kilobyte; on
  agent-operator-score, one of sixty in twenty-four. The equal-weight estimand
  averages over that rather than adjusting for it."
- **The seven pre-execution defects and the one incident.** Five of the seven would
  have put a silent zero in the data. They are listed with what each would have
  cost, because a reader assessing the numbers should know what the harness got
  wrong before it got them right.

## What must not appear

- An effect claimed without its 25 conditions.
- A subgroup, stratum or post-hoc cut that section 23 did not register.
- A p-value reported without the interval beside it.
- The word "significant" doing work the gate did not do.
- Any suggestion that a null is a lesser result than a positive. v7 ended without
  measuring a product effect and that was a finding.
