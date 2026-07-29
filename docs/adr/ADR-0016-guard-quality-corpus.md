# ADR-0016: guard quality is a scoring problem, measured on a fixed 417-decision corpus

- Status: Accepted (2026-07-29)
- Supersedes: nothing. Resolves [#157](https://github.com/MongLong0214/commitlore/issues/157)
  and keeps #61's shipped threshold decision unchanged.

## Context

The 30-decision corpus could not distinguish a bad scorer from sampling noise.
The archived pre-#61 composition fired eight times: 3/8 precision, 60% recall,
and a 95% Wilson interval of 13.7%–69.4%. The scorer on `origin/dev` removed one
false positive, so the same corpus replayed at the shipped 0.35 threshold as
3/7 precision (42.9%), 60% recall, and a still wider 15.8%–75.0% interval.

The measured threshold curve in
`bench/results/guard-threshold-curve-20260729.md` already ruled out tuning:
precision was 42.9% throughout 0.30–0.50 with 60% recall, then precision and
recall both collapsed to zero at 0.55. Moving the threshold traded recall for
nothing.

The old corpus also did not carry a self-contained labeling protocol. It reused
the archived `reproposed` field, even though `bench/DETECTOR-DEFECT.md` had
already established that four treatment-arm labels called explanations of
compliance re-proposals. Three diffs said Prisma or RabbitMQ had been avoided;
one mentioned Sigstore only in a comment describing what was absent. None
implemented the rejected alternative.

## Decision

Guard quality is measured against the fixed labels in
`bench/fixtures/guard-quality.json`.

The fixture includes every JSON artifact from five reconstructable real-session
sets:

- `bench/results/transcripts-final`
- `bench/results/transcripts-m1b`
- `bench/results/transcripts-m2`
- `bench/results/transcripts-m3-invalidated`
- `bench/results/transcripts-m4`

That is 417 decisions: 118 positive and 299 negative. M3 was invalidated as an
experiment because exposure provenance was absent; its final diffs are still
real, readable decisions and need no exposure claim for offline scorer replay.
No model was run to create this corpus.

Labels follow four reproducible rules:

1. Positive means the final added code implements a still-active
   `Ruled-out` alternative or an operationally equivalent decision.
2. Names in prose, comments, tests, or explanations of avoidance are negative
   unless the final code also implements the alternative.
3. Lifecycle and path scope come from the seeded record; superseded or
   out-of-scope alternatives are negative.
4. Labels are fixed before scorer replay. Guard scores, thresholds, matches,
   and output are not fixture fields.

The four corrected labels retain the prior disagreement in the fixture. A
literal-name reading called them positive; decision-level adjudication calls
them negative because their final code implements something else. These are
the hard cases precision depends on, not obvious unrelated negatives.

## Sample-size boundary

The operational bands were fixed before the enlarged replay:

- precision at or below 50% is broken because the guard is wrong at least as
  often as it is right;
- precision at or above 60% is the minimum "fine" boundary for this advisory
  interruption;
- 50%–60% remains explicitly inconclusive.

The denominator for a precision interval is guard firings, not total labeled
decisions. Holding the observed 3/7 precision, 12/28 has a 95% Wilson interval
of 26.5%–60.9%; 15/35 has an interval of 28.0%–59.1%. Therefore 35 firings was
the minimum target: the first multiple of seven whose upper bound excludes the
predeclared 60% boundary.

## Measurement

Before replay, no running Node `bench/deterministic` process was present. Only
the corpus was replayed; no wall-clock benchmark or timing section ran.

| corpus | decisions | TP / FP / FN / TN | precision | recall | 95% Wilson precision interval |
|---|---:|---:|---:|---:|---:|
| archived pre-#61 | 30 | 3 / 5 / 2 / 20 | 37.5% | 60.0% | 13.7%–69.4% |
| `origin/dev` before this ADR | 30 | 3 / 4 / 2 / 21 | 42.9% | 60.0% | 15.8%–75.0% |
| fixed enlarged corpus | 417 | 26 / 32 / 92 / 267 | 44.8% | 22.0% | 32.7%–57.5% |

The enlarged corpus produced 58 firings, exceeding the 35-firing target.
Precision moved 1.9 percentage points from the current 42.9% baseline and the
interval excludes 60%. The old figure was not rescued by more data. Recall
also fell from 60.0% to 22.0%, showing that the same score misses most genuine
revivals in the broader decision set.

## Consequences

The low precision is a scoring-composition problem, not an inference supported
only by the old small corpus. The scorer is unchanged in this branch. Any
scoring change is separate work and must be judged against this fixed corpus;
changing the labels and scorer together would make both unverifiable.

The 44.8% figure describes this deliberately hard decision corpus, not
deployment prevalence. Precision changes with prevalence, and repeated
benchmark tasks are clustered observations. Those limits prevent publishing
the number as a general product claim, but they do not rescue the scorer on the
cases it is explicitly meant to distinguish: its 95% upper bound remains below
the predeclared minimum fine boundary.

The enlarged curve is evidence for a later scoring change, not permission to
fit a new threshold to these labels. #61's no-tuning decision remains in force.
