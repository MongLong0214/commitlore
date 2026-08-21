# CDEB-Fresh v4 Stage 0 Result

> Generated from this study's artifacts by `scripts/render-stage0-result.mjs`.
> Every number below is read from a committed file; none is typed by hand.

## Owner estimand decision

> **The estimand concerns delivery of a prior repository decision, not delivery of a product Record-Id.**

Limit carried with it: Id-less candidates still must pass every provenance, viability, oracle, and delivery gate. Absent identity is neither an exclusion nor an admission.

## Study identity

```text
study_id:              cdeb-fresh-v4
phase:                 stage0-corpus-feasibility
measured_run_allowed:  false
predecessors:          cdeb-fresh-v3, cdeb-fresh-v3r1
predecessor status:    terminal-invalidated-no-measured-data
predecessor artifacts: none
product release:       v1.2.0 (90a8b212e1db)
```

## Candidate universe

These are potential source decisions, not qualified tasks and not benchmark cases.

| repository           | records | with a reason | decisions | identified | id-less |
|----------------------|---------|---------------|-----------|------------|---------|
| gitseed              | 84      | 71            | 104       | 94         | 10      |
| agent-operator-score | 155     | 30            | 59        | 48         | 11      |
| logic-pro-mcp        | 53      | 29            | 43        | 0          | 43      |
| agent-control-plane  | 90      | 27            | 35        | 1          | 34      |

```text
decisions enumerated:  241
identified:            143
legacy id-less:        98
benchmark-authored excluded: 0
```

## Qualification by repository

| repository           | raw | provenance | hidden | viable | oracle | delivery | bounded | qualified | eligible |
|----------------------|-----|------------|--------|--------|--------|----------|---------|-----------|----------|
| agent-control-plane  | 35  | 3          | 17     | 27     | 30     | 28       | 33      | 1         | no       |
| agent-operator-score | 59  | 2          | 31     | 35     | 56     | 41       | 58      | 1         | no       |
| gitseed              | 104 | 4          | 32     | 62     | 56     | 42       | 71      | 2         | no       |
| logic-pro-mcp        | 43  | 8          | 22     | 19     | 41     | 43       | 43      | 2         | no       |

## Repository eligibility

```text
eligible repositories: 0  (threshold 3)
qualified per repository floor: 12
total qualified:       6  (threshold 48)
recommended fixed set: none
```

## Freshness audit

```text
old tasks reused:        0
old trajectories reused: 0
old result rows reused:  0
synthetic Record-Ids:    0
```

## Instrument

```text
decision audit anchor implemented: yes
Record-Id required:               no
content delivery observable:      yes, for identified and id-less alike
  delivered carrying an identifier: 69
  delivered carrying none:          85
```

## Provenance tiers

```text
P1           17
P2           0
unsupported  224
```

P2 is the owner-attested tier. No owner testimony was collected in Stage 0, so it
is empty by construction rather than by a judgement about its admissibility. That
decision belongs to a later preregistration, and nothing here mixes an attested
candidate with an independently sourced one.

## Reviewer agreement, per gate

| gate | compared | agreed | rate  |
|------|----------|--------|-------|
| G2   | 207      | 188    | 0.908 |
| G3   | 207      | 153    | 0.739 |
| G4   | 207      | 189    | 0.913 |
| G5   | 207      | 193    | 0.932 |
| G7   | 207      | 205    | 0.990 |

Both reviewers are independent sessions of one model family; see the deviation
record. Their agreement bounds reliability from above, not below, and this is how
far from independent they actually were:

```text
pairs where both found a rejection: 159
mean overlap of the two quotes:     0.57
quoted near-identical text:         72 (45%)
```

## Where the candidates went

| exclusion reason                   | count |
|------------------------------------|-------|
| insufficient-provenance            | 190   |
| source-packet-empty                | 33    |
| reason-obvious-from-code           | 7     |
| wrong-path-not-functionally-viable | 3     |
| shipping-content-not-observable    | 1     |
| scope-unresolvable                 | 1     |

## Robustness: does the diff carry what the message did not?

Does showing the reviewer the commit's diff, as well as its message, recover the rejected alternative that the message alone did not?

```text
sample:                       60 candidates, 15 per repository
both reviewers found a rejection: 55
message and diff together:    8 (13%)
message alone, same candidates: 6 (10%)
```

Adding the diff moves the pass rate by three points on the same candidates. The narrow packet is not why G2 fails; the rejected alternative is not written outside the record.

## What these gates were judged from

Stage 0 is a screen, not a qualification freeze, and the evidence each gate was
decided from bounds what its number means.

- **G2** was decided from the commit's redacted prose alone, which is what the
  ordinary-source packet contains. A reviewer never saw the ruling.
- **G3** and **G4** were decided from the commit message, the changed paths and the
  ruling. Neither reviewer read the current code or ran a test, so both are
  informed judgements about a maintenance task rather than measurements of one.
- **G5** classifies whether a deterministic oracle *could* be written. No oracle
  was built, and none may be at this stage.
- **G6** is a measurement: the shipping hook was run against the frozen release for
  every candidate, and the bytes it forwarded were read.

## Verdict

**HOLD**

Unmet:

- eligible repositories 0 < 3
- total qualified 6 < 48

### The blocker

`insufficient-provenance` — 190 of 241 enumerated decisions.

It is corpus, not instrument. The instrument works: the shipping path delivers
the ruling, the reason, the scope and the lifecycle for 154 of the 207 candidates
that had ordinary source at all, and it does so for decisions with no identifier
just as well as for decisions with one. What the corpus does not have is an
independent written record of *which* alternative was rejected and why. For most
of these decisions the `Ruled-out:` trailer is the only place that exists, so gold
built from ordinary source cannot be written — and gold copied from the record
would make the benchmark measure its own instrument.

The robustness arm above rules out the obvious alternative explanation: showing
the reviewer the commit's diff as well as its message moves the rate by three
points. The rejection is not written outside the record in some form the packet
was simply too narrow to see.

## Deviations recorded

- `CDEB-V4-REVIEWER-MODEL-FAMILY` — reviewer-independence-limitation
- `CDEB-V4-G2-OPERATIONALIZATION` — preregistration-refinement
- `CDEB-V4-PACKET-SECOND-REDACTION` — instrument-correction
- `CDEB-V4-DELIVERY-HARNESS-FALSE-ZERO` — instrument-correction
- `CDEB-V4-G2-DIFF-ROBUSTNESS-ARM` — added-robustness-check

## Deliberately not done

- no pilot
- no measured run
- no treatment randomization
- no README headline
- no synthetic identity migration

```text
measured product-effect data = 0
qualification rows written   = 241
```

STAGE 0 COMPLETE — MEASURED PRODUCT-EFFECT DATA STILL ZERO
