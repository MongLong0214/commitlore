<!-- Adversarial review of this study's own Stage 0 result, run before publication and
     kept verbatim. The reviewer was an independent session given the result and the
     code, asked to refute the headline claim, defaulting to "refuted" when unsure.

     Every numeric claim it made was recomputed from the artifacts before acting, and
     every one checked out: 34 undecidable vs 10 decidable-no-hit; 31 of the 44 having
     failed v4 for insufficient-provenance; 16 of the 18 corroborated having failed v4
     too.

     What it changed:
       - `explicitRuledOut` was computed and stored but never pushed a failure, while
         the authority policy lists it as required. Now it fails, and the discrimination
         report covers it.
       - The "44 have no corroboration" headline conflated "scanned, no hit" (10) with
         "ruling too short to scan" (34). The result now reports all three states.
       - "Exactly the population v4 excluded" was false. The result now carries the
         measured join: 47 of 62 failed v4's independent-prose gate, 57 failed a v4
         provenance-family gate, 4 were qualified in both.
       - The result contradicted itself on adjudication, saying both "third blind vote
         decides by majority" and "both tie-breakers must agree". The implementation is
         the latter; the stale sentence is gone.
       - The anti-provenance guard was described as refusing "any run" in which a
         candidate is excluded for missing corroboration. It checks three specific
         shapes and cannot see a dependence running through the reviewers. Stated at its
         real strength.
       - "Every number is read from a committed file" was untrue of the freshness block,
         which is a set of assertions. The header says so now.
       - The evidence behind each gate is now stated: no reviewer read code or ran a
         test, G5 is a judgement rather than a probe, G8 is unexercised, and the GO
         delivery condition is a presence check over synthetic events.

     What it did not change: the arithmetic. 62 qualified, four eligible repositories,
     GO under all three tie-break rules. The construct-circularity objection is a
     design question the owner adjudicated in the v5 review pack, not a defect in this
     implementation. -->

# Red-team verdict: refuted

The narrow arithmetic is reproducible: the committed qualification rows contain 62 `qualified:true` rows and the adopted rule makes all four repositories eligible. The headline's interpretation of those counts is not supported.

The “44” does not mean 44 decisions have no corroboration. `RESULT.md:80` says “qualified with no independent corroboration: 44,” but `authority-v5.ts:207-210` sets `independent_corroboration:false` both when the scan found no hit and when corroboration was undecidable. Joining the committed qualification and authority-audit rows gives 34 undecidable cases and only 10 decidable no-hit cases. Moreover A1 purports to include “a pull request, issue, ADR...” (`STAGE0-PREREGISTRATION.md:65-68`), while the actual scan searches commit prose, frozen-tree documents, and scoped paths, not external PRs or issues (`corroboration-v5.ts:110-138`). The supported statement is only “44 have no detected A1 hit under this lexical, incomplete scan.”

Nor are those 44 “exactly” the population v4's gate excluded. The current document says v4 excluded 190/241 (`STAGE0-PREREGISTRATION.md:31-35`). A candidate-id join to v4's committed qualification rows shows that, among the 44, only 31 failed `insufficient-provenance`; 10 failed `source-packet-empty`, one failed `wrong-path-not-functionally-viable`, and two were v4-qualified. Conversely, 16 of the 18 corroborated v5 qualifiers had failed v4 for `insufficient-provenance`. The two classifications are demonstrably not equivalent.

The exact 62/four-repository result is post-preregistration. The registered procedure says “Disagreement goes to a third blind vote” (`STAGE0-PREREGISTRATION.md:81-86`). After seeing that the first third vote produced 88 qualifiers and sided with reviewer A 120/180 times, the study adopted two tie-breakers that must agree (`deviations.jsonl:4`). That same deviation self-contradictorily records `"measured_data_exists": false` beside `"measured_bias"` and the measured 44-to-88 corpus effect. Eighteen of the final 62 rows contain at least one `adjudicated` reviewer gate; without tie-breaking there are 44 qualifiers and only three eligible repositories (`RESULT.md:134-138`). GO survives that sensitivity analysis, but “four repositories and 62” is not the preregistered result.

The report even gives incompatible accounts of adjudication. It first says “a third blind vote decides by majority” (`RESULT.md:122-124`), then says a split resolves only when “both tie-breakers” agree (`RESULT.md:128-137`). `qualify-v5.ts:91-108` implements the latter. A generated report that contradicts its own implemented procedure is not publication-ready.

The reviewers lacked the evidence needed for central gates. G3 asks about “current code, a neutral task and the obvious tests,” and G4 requires both functionally passing implementation classes (`STAGE0-PREREGISTRATION.md:88-95`). The recorded deviation says each reviewer instead received “the record, its reason, the paths and the commit prose” (`deviations.jsonl:2`); no reviewer inspected code or ran functional tests. G3 agreement was only 141/240 (58.8%; `RESULT.md:114-120`). Thus G3/G4 are model plausibility judgments, not demonstrations of hidden rationale or functional viability. G5 is likewise stored as a bare boolean (`qualify-v5.ts:28-42`), with no executable or even structured oracle required. Calling all 62 “qualified candidates” overstates what was established.

A0 does not validate the advertised authority construct. The report admits “A0 admitted every decision it was given” and lists every tested condition as inert (`RESULT.md:47-61`). In code, snapshot presence is copied from `candidate.pre_cutoff`, scope means only a nonempty path list, and ordinary-development origin is inferred from not matching benchmark/reconstruction markers (`authority-v5.ts:100-155`). Worse, `explicitRuledOut` is computed at line 124 but never adds a failure, despite “explicit ruled-out behaviour” being required (`authority-policy.json:11-21`). The census's construction, not an independent authority gate, supplies nearly all of “natural recorded authority.”

The claimed anti-provenance guard proves much less than stated. `RESULT.md:159-161` says it “refuses any run” in which a candidate is excluded for missing corroboration. In fact `assertNoProvenanceGate` rejects only a provenance-looking exclusion-code string, an exclusion with every declared gate true, or a run with zero uncorroborated qualifiers (`qualify-v5.ts:168-191`). A disguised dependence through G2-G7—or exclusion of every uncorroborated candidate but one—passes. The current merge does not directly read corroboration into a gate, but this guard cannot establish the universal claim or exclude reviewer-mediated circularity.

Removing external validation also leaves construct circularity unresolved. The record is declared to be repository policy by definition (`authority-policy.json:5-6`), supplies the prohibited behavior and reason, and is then used by reviewers to define the violation boundary. Reading an eventual outcome from code avoids the trivial “agent repeated the record” metric, but it does not independently establish that the record is authoritative, current, or correct. With no task, gold, or oracle yet, the task-author firewall (`STAGE0-PREREGISTRATION.md:132-138`) has not been exercised.

Finally, GO's delivery condition is weaker than its prose. `decideV5` treats “delivery observability” as merely the existence of at least one qualified identified row and one qualified id-less row (`qualify-v5.ts:262-291`), and the delivery evidence is explicitly a synthetic `PreToolUse` event rather than a real-agent observation (`RESULT.md:106-110`). GO therefore certifies an administrative count over simulated delivery and subjective annotations, not demonstrated end-to-end benchmark feasibility.

`RESULT.md:3-4` also claims “Every number below is read from a committed file,” but its renderer hard-codes `missing-id exclusions: 0` and all seven freshness/owner-testimony zeroes (`scripts/render-v5-stage0-result.mjs:160-177`). Those values may be true, but the claimed artifact derivation does not support them.

The defensible conclusion is narrower: under a post-measure dual-tie-break rule, the committed booleans yield GO, four eligible repositories, 62 qualified rows, and 44 rows whose A1-hit boolean is false. The claims that those 44 truly lack outside corroboration, exactly match v4's excluded population, or that the 62 have been shown to satisfy the scientific construct are refuted.
