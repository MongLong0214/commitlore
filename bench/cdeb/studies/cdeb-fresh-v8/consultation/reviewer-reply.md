I read both files in full: [preflight-result.json](/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad/v8run/consult/preflight-result.json:1) and [the-three-decisions.json](/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad/v8run/consult/the-three-decisions.json:1).

My conclusion: ending the study is not yet compelled. The second “failure” is arguably a successful record-level manipulation, and the first has a plausible structural identity that has not been ruled out.

1. A suppression you have not exhausted

`record_id: null` does not establish “no identity.” That candidate has a 256-bit `decision_audit_anchor`, and its candidate ID is the anchor’s first 16 hex characters ([the-three-decisions.json:43](/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad/v8run/consult/the-three-decisions.json:43)).

A uniform structural suppressor could identify every target using one of:

- The audit anchor, mapped to its containing record.
- A provenance tuple such as `(repository, frozen revision, source commit/note object, record ordinal)`.
- A canonical whole-record digest.
- As a weaker fallback, `(ON payload digest, parsed record index)` in the frozen deterministic payload.

The operation remains: parse the payload, locate exactly one structured record occurrence, remove it, and preserve every other block byte-for-byte. It does not examine or normalize the ruling text and would not remove co-rulers.

There are qualifications:

- The anchor must identify the source object or support an exact, pre-outcome mapping to it. If it is merely a hash of the ruling string, it is text matching in disguise.
- If it identifies a decision block rather than the containing record, you must map upward and remove the whole parent record to preserve the registered transform.
- Commit alone is insufficient if the commit contains multiple records; it needs an ordinal or object locator.
- Path scope and `lifecycle: active` are eligibility attributes, not identities. Sixty-six records demonstrate that they are not selective enough.

Most importantly, apply the alternative locator uniformly to all seventeen. A special fallback invented only for this candidate is much harder to defend than an anchor-based identity function used throughout.

If the preregistration literally requires the `Record-Id` field—not merely “structured record identity”—this would require a new preregistration. But the wording you supplied is broader than that.

2. The second failure is probably not a record-suppression failure

For `v4-f901...`, the data say:

- records went from 13 to 12;
- exactly one target block was removed;
- the target reason disappeared;
- every unrelated record remained identical;
- only the ruling phrase remained through other records.

Those facts are in [preflight-result.json:603](/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad/v8run/consult/preflight-result.json:603).

Therefore, if the estimand is:

> the marginal effect of adding this exact record to the repository’s naturally occurring shipping context,

then the SUPPRESSED arm is correct. The other records are part of the held-constant environment. They repeat the alternative but do not deliver `r-f8adapter`’s reason. Under this reading, the preflight imposed an additional semantic-blackout requirement that is stricter than the registered record-deletion transform.

The cost is substantial but interpretable:

- You cannot claim an effect of “being told that JSON files were ruled out” versus not being told.
- You can claim only the incremental effect of `r-f8adapter` given redundant advice already present.
- A null effect may mean substitution by the co-rulers, not that recorded guidance is ineffective.
- The population estimand becomes the effect of records in their natural redundancy structure, not isolated semantic propositions.

If semantic exposure was explicitly the preregistered treatment—no surviving communication of the ruled-out approach—then it is a genuine failure. The record-level transform and semantic treatment are simply incompatible for this candidate. You need to determine which definition is normative; the prose you supplied supports record-level treatment, while the preflight’s `what_pass_means` adds semantic absence.

There are also two errors in the cluster objection:

- Removing three records only from `v4-f901...`’s SUPPRESSED payload would not alter `v4-ed...`’s separately constructed ON payload. It would make the former intervention too broad, but it does not create cross-episode mutation unless the harness is improperly editing shared source state.
- `v4-ed...`’s target ruling is actually “storage replay as deserialization,” not “JSON files on disk” ([the-three-decisions.json:70](/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad/v8run/consult/the-three-decisions.json:70)). `r-f8replay` contains the co-ruling, but that co-ruling is not the other candidate’s target decision.

Cluster removal should still be rejected—but because it deletes non-target records and changes the registered intervention, not because it changes another candidate’s ON arm.

3. The first failure may be recoverable

The decisive test is not “does it have a `record_id`?” It is:

> Can the frozen source-to-payload pipeline identify exactly one containing record using immutable structured provenance, without looking for the ruling or reason?

If yes, the candidate is recoverable. The audit anchor makes that plausible. If no—because the anchor is content-derived but non-addressable, the payload exposes no provenance, and several indistinguishable records occupy the same source location—then the first candidate really is unconstructible.

So the current evidence proves “missing explicit Record-Id,” not yet “no structural identity exists.”

4. The honest terminal label

If the provenance check fails and the preregistration requires all seventeen, `TERMINAL_HOLD_FINAL` is an honest protocol disposition. I would qualify it:

> `TERMINAL_HOLD_FINAL — preregistered full-population manipulation not constructible`

That is not an integrity failure in the sense of corruption, misconduct, or faulty execution. It is a successful preflight detecting that the operationalization is not total over the fixed population.

I would not publish the broader claim that “a naturally recorded repository decision is not always a unit that can be independently suppressed.” The evidence supports two narrower findings:

> One target lacked an explicit Record-Id, and one exact-record deletion left semantically redundant guidance in unrelated records.

The first does not rule out audit/provenance identity; the second shows that record suppression does not guarantee semantic non-exposure. Those are different representational facts.

My recommendation is therefore: do not run episodes yet, but do not declare the final hold until the audit-anchor construction and source mapping have been examined. If it resolves the null-ID record, treat `v4-f901...` as valid only under the explicitly stated marginal-record estimand and run all seventeen. If it does not, the zero-episode terminal hold is correct—but for one undefined structural selector, not because two decisions proved inherently unsuppressible.