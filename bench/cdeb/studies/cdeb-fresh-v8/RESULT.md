# CDEB-Fresh v8 — terminated before a result

**No product-effect estimate was produced, and none can be produced from what
exists.** The study was stopped by the owner partway through judging, after the
cost of the run became clear. This records what was measured, what it cost, and
what the artifacts do and do not support.

## Status

```text
episodes          340 / 340 sealed
judgements        104 / 1,020 sealed
episodes with a complete panel        0
product-effect estimate               none
result category (section 28)          none reached; terminated by owner
successor                             none. No automatic V9.
```

A panel label needs three judgements on one packet. Not one of the 340 episodes
has three. The primary outcome is defined on the panel label, so P-DSFPS, its
interval, the randomization p, RBDR and every section 27 condition that depends on
them are not merely unreported here — they are uncomputable from this data. That
is the honest ceiling on anything below.

## What the episodes established

All 340 ran, and twelve integrity checks pass over the complete set:

```text
exactly the assignments the frozen schedule asked for, none twice
ten per arm per candidate
no timeout, no pre-start failure, no retry
every resolved model matched the pin, read per episode from its own rollout
every product digest matched the pin
SUPPRESSED removed exactly one record, 170 times out of 170
ON removed none, 170 times out of 170
340 distinct packet ids
```

### The finding that does not depend on the effect

**141 of 340 episodes changed no file at all, and 140 of those are one repository.**

```text
agent-operator-score   160 episodes   140 changed nothing   (87%)
gitseed                180 episodes     1 changed nothing   ( 0%)
```

This is not the tasks being impossible. Each candidate's v7-rebuilt control patch
applies cleanly and passes its acceptance — verified before the run in
`preflight/scoring-path-control.json`. The pinned coding agent read
agent-operator-score's own `AGENTS.md`, ran the repository's ticket resolver,
received `unknown ticket`, and declined to start under the gate rules the
repository publishes.

Whatever else v8 did or did not measure, it measured this: **on one of the two
repositories, a capable coding agent refused to begin 87% of solvable tasks because
the repository's own governance told it not to.** That is a fact about agents and
repository governance, established on 160 episodes with the integrity checks above.
It is not a fact about CommitLore.

Not split by arm, here or anywhere. Whether refusal differs between arms is part of
the effect, and no effect is being reported.

### Other pooled counts

```text
functional pass          173 / 340
task acceptance pass     179 / 340
regression pass          331 / 340
```

## What the judgements established

```text
sealed         104 (judge-1: 79, judge-2: 25, judge-3: 0)
labels         COMPLIANT 104
confidence     high 94, medium 10
packets with any judgement    95 / 340
packets with all three         0 / 340
```

104 judgements, all compliant, is not a reliability figure and not a result. It is
too few, it is missing a whole seat, and it covers 95 packets none of which has a
panel. Section 10's metrics need three judgements per episode; none exists.

Every sealed judgement passed the section 21.3 protocol: written through a temp
file, fsynced, atomically renamed, read back, schema-validated, hashed, and
appended to `judgements-seal-manifest.jsonl`. **265 attempts failed and none of
them entered the manifest** — validation precedes sealing, so the failures left log
lines and nothing else.

## Why it stopped

The judging cost real money and I did not say so before asking for approval.

```text
claude-seat calls that succeeded    82
reported cost of those              $82.08
claude-seat calls rate-limited     258   (HTTP 429, zero cost)
what the full seat would have cost  ~$340, on that one seat
```

When approval was sought for "340 episodes and 1,020 judgements, about 27 hours",
the figure given was time. One of the three judge seats runs on the owner's own
Claude subscription, and each of its judgements costs about a dollar. That was
visible in the first judgement's response and I did not read it. The owner stopped
the run on learning the cost, and stopped the research.

## What the readiness work found

Seven defects in the pre-execution harness, plus three that blocked judging, plus
one incident. Five of the seven would have put a silent zero in the data and
produced a number that read as a finding about the product:

| defect | what would have been zero |
|---|---|
| suppression removed nothing for one candidate | 20 episodes reporting a manipulation that never happened |
| regression scored by exit code against an already-red suite | all 160 AOS episodes |
| four acceptance commands not runnable | 80 episodes across both repositories |
| a pre-start failure recorded as an episode outcome | any infrastructure failure |
| regression measured after the acceptance was installed | all 160 AOS episodes, surviving the fix above |

Two more made judgements misstate their own subject: every judgement would have
reported its packet id as `work.judge-1`, and every packet directory was named
`packet`, collapsing 340 results into one folder.

None of these could have been caught by CI or by a unit test on any component —
each part did exactly what it was told. They were found by asking whether each path
can produce a correct answer at all, with an input whose answer was known.

## Limitations that stand regardless

- **The calibration confound** (v8-d010). The panel was selected on a corpus where
  30 of 30 compliant cases were v7 rebuilds and 16 of 17 violations were v6
  imports.
- **Arm concealment was role separation, not cryptography** (v8-d005). Anyone
  holding the committed seed can recompute every arm.
- **A judge read what it chose to open.** A packet tree is millions of tokens and
  no judge read one whole.
- **Snapshot digests give integrity, not availability.** A fresh clone has no
  bundles.
- **Treatment salience differs by an order of magnitude between repositories** —
  one record in three on gitseed, one in sixty on agent-operator-score.

## What is published

Everything section 29 lists that exists: the preregistration, the 17-task manifest,
the product, snapshot, runtime and schedule locks, the panel lock and calibration,
the 340 coding rows, the 104 judgements and their seal manifest, the analysis code
with its controls, the readiness red-team across 19 surfaces, all deviations by id,
and this document.

Not published, because they do not exist: 1,020 judgements, reliability metrics,
the analysis output, ANALYST-A/B reports, the claim gate evaluation.

## Terminal

No successor. No automatic V9. The research line ends here by the owner's decision.
