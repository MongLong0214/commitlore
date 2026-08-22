<!-- Adversarial review of this study's own result, run before publication.
     The reviewer was an independent session, given the result and the code and
     asked to refute the headline claim, defaulting to "refuted" when unsure.
     It is kept verbatim: a review that only survives in the changes it caused
     cannot be checked by a later reader.

     What it changed: the claim in RESULT.md was narrowed to what the evidence
     supports, the delivery gate's three structural bounds were named, the G2
     floor's sensitivity was published, and two deviations it found unrecorded
     were added to deviations.jsonl (CDEB-V4-THIRD-VOTE-INSTEAD-OF-ADJUDICATOR
     and CDEB-V4-G2-NARROWER-THAN-REGISTERED).

     What it did not change: the arithmetic. The reviewer confirmed the HOLD
     reproduces, and an independent recomputation of 154 / 6 / 190 from the raw
     artifacts agrees. One figure it cited is slightly off -- it reports 41
     majority-found candidates with nonzero overlap below the floor; the artifact
     gives 43, of which 7 sit at or above 0.333, which it had right. -->

# Red-team verdict: refuted as stated

The HOLD arithmetic is reproducible, but the headline causal claim is not. The evidence
supports a much narrower statement about one packet and one lexical decision rule; it
does not establish that the CommitLore record is the only place the information exists.
First, the denominator does not support “most decisions in these four repositories.”
`STAGE0-PREREGISTRATION.md:79-81` defines the pool as “historical decisions carrying an
explicit reason” and warns that it is only a “potential source-decision pool.”
`RESULT.md:26` likewise calls the rows “potential source decisions.” Thus 190/241 is a
fraction of an instrument-discovered candidate pool, not a census of repository decisions.
Second, absence was not searched broadly enough to prove nonexistence. `RESULT.md:141-142`
says G2 was judged from “the commit's redacted prose alone.” The robustness arm added only
the same commit's diff for 60 candidates (`RESULT.md:123-132`); it did not search PRs,
issues, design docs, comments, tests, other commits, or owner knowledge. Nevertheless
`RESULT.md:173-176` says this “rules out” packet narrowness and proves the rejection is not
written outside the record. That inference does not follow from the tested evidence set.
Third, G2 is primarily an exact-token correspondence test, not a test that independent
gold can be built. `qualify-v4.ts:64-78` lowercases and intersects exact content-word sets,
and `qualify-v4.ts:81-82` fixes the cutoff at 0.34. `qualify-v4.ts:144-147` then fails G2
below that floor. This cannot distinguish a paraphrase or morphological variant from a
different decision. The committed reviews have 159 pairs where both found a rejection
(`RESULT.md:106-110`), yet only 17 P1 candidates (`RESULT.md:81-85`); the correspondence
rule, not simple absence of a written rejection, does most of the work. Recalculation also
finds 41 majority-found cases with nonzero overlap below 0.34, including seven that would
pass at 0.333. Fixing the cutoff before merging does not validate what the cutoff measures.
Fourth, the implementation does not implement preregistered source sufficiency.
`STAGE0-PREREGISTRATION.md:100-102` requires decision, reason, path scope, and lifecycle to
be recoverable. But `qualify-v4.ts:138-147` uses only the boolean “found an alternative”
and overlap of `quoted_alternative` with `ruling`; it never compares `quoted_reason` with
the recorded reason and never tests recovery of scope or lifecycle. Therefore neither the
17 passes nor the 190 failures directly answer whether complete independent gold exists.
Fifth, split votes were resolved contrary to the preregistration without a recorded
deviation. `STAGE0-PREREGISTRATION.md:177-179` requires an `ADJUDICATOR` to resolve
disagreement on the evidence. `qualify-v4.ts:84-102` instead takes a third blind vote and
labels its result “adjudicated.” The raw artifacts contain 92 such third-reviewer rows.
None of the five entries at `deviations.jsonl:1-5` records this analysis change. That is a
material protocol violation because it can change every judgment gate, including G2.
Sixth, the diff arm is post hoc and too narrow to “rule out” an explanation. Its own entry
admits it was added because “the primary G2 pass rate is low” (`deviations.jsonl:5`).
`RESULT.md:128-134` reports 8/60 versus 6/60, with no uncertainty or power calculation.
Failure to detect a larger difference in this post-result sample is not evidence that a
broader ordinary-source packet would make no difference.
Seventh, an unmeasured route to independent gold is acknowledged by the study itself.
`RESULT.md:87-90` says owner-attested P2 is empty “by construction rather than by a
judgement about its admissibility.” `STAGE0-PREREGISTRATION.md:157-168` defines conditions
under which such testimony is independent and permitted. Not collecting it cannot support
the categorical conclusion at `RESULT.md:168-171` that independent gold “cannot be written.”
Finally, 154/207 and the 85 id-less count are arithmetically supported, but “delivered” is
overinterpreted. `delivery-v4.ts:123-128` tests scope with one selected negative path;
`delivery-v4.ts:129-132` treats an active lifecycle as correct whenever the ruling is
visible, without observing lifecycle text; and `delivery-v4.ts:140-142` hard-codes
`before_first_mutation: true` because the synthetic payload is named `PreToolUse`.
Thus the count measures ruling/reason containment for a synthetic `Edit` on a known touched
path plus one negative probe, not actual delivery of correct scope/lifecycle before an
agent's first mutation. Identity is merely `record_id !== null` (`delivery-v4.ts:134-137`),
and the identity assertion only demands one success in each state (`delivery-v4.ts:219-225`),
so it does not establish the prose claim that id-less decisions work “just as well.”
Defensible conclusion: under this post-registered lexical G2, only 17 candidates had a
matching alternative in the redacted source-commit prose. The stronger “only place that
exists, therefore independent gold cannot be built” conclusion should not be published.
