# ADR-0019: guard signals cannot separate revivals from coincidental matches

- Status: Accepted (2026-07-30)
- Issue: [#176](https://github.com/MongLong0214/commitlore/issues/176)
- Related: ADR-0016 (corpus); [#157](https://github.com/MongLong0214/commitlore/issues/157)

## Context

ADR-0016 established a fixed 417-decision corpus and measured the guard at
precision 44.8% (95% Wilson 32.7%–57.5%) and recall 22.0% (26/118). Issue #176
asked whether the guard's three signals — token Jaccard, distinctive-keyword
strength, and Record-Id hit — can separate a genuine revival from a coincidental
textual match at all, or whether no reweighting will because the signals
themselves are structurally blind to the classes they must distinguish.

The analysis read all 92 false negatives and all 32 false positives. Their
failure shapes are reported below; the full data is in the analysis artifact
(`176-analysis.md`).

## False Negatives: 92 decisions, two shapes

### Shape 1: Semantic revival with zero or one lexical echo (49 cases)

The diff implements the rejected pattern without naming it. Code creates a
stateless JWT session, lowers a Node floor, injects a fake TTY stream, or
samples once — all without sharing vocabulary with the alternative text. The
corroboration gate blocks every match because 0–1 distinctive tokens hit.

Tasks: `reproposal-node20-floor` (16), `qualification-gitseed-single-smoke-sample` (14),
`qualification-gitseed-fake-tty` (12), `reproposal-jwt-sessions` (5),
`qualification-gitseed-drop-withheld` (2).

All three signals depend on surface-text overlap. A revival that does not name
itself produces zero signal and no combination of the weights can raise it above
any threshold.

### Shape 2: Partial match scoring 0.09–0.24, below threshold (43 cases)

The diff shares 2+ distinctive tokens with a *sibling* alternative (enough to
pass corroboration) but the overlap is diluted by diff size, producing scores
well below 0.35. The matched tokens are incidental domain-vocabulary overlap
(e.g., "security" and "verdict" matching a sibling alternative when the target
is a boolean variant), not evidence of the target alternative.

Tasks: `qualification-gitseed-boolean-security` (14),
`qualification-gitseed-grading-fail-fast` (14),
`qualification-gitseed-numeric-sentinel` (9),
`qualification-gitseed-approved-bool` (4),
`qualification-gitseed-fake-tty` (2).

Lowering the threshold to capture these would admit the same domain-vocabulary
matches from true negatives — the scores sit in an identical band.

## False Positives: 32 decisions, three shapes

### Shape A: Mention-in-prose-of-avoidance (19 cases)

The diff names the alternative to document why it was *not* used: comparison
tables, design-rationale text, architecture notes. Keywords fire identically
on "we avoided Prisma" and "we implemented Prisma" because the signal has no
negation or context awareness. Scores: 0.50–0.53.

### Shape B: Record-Id compliance citation (7 cases)

The agent cites a record identifier in documentation or CLI examples to show
compliance. The Record-Id weight (0.6) fires, and surrounding keywords from
the compliance text push scores to 0.93–1.00 — the same band as true positives.
`requireContent` cannot suppress these because keywords fire alongside the id.

### Shape C: Avoidance-documentation with domain keywords (6 cases)

Design-rationale headings use the alternative's keywords in explanatory context
("Why Not a Lookup Service?", "❌ Ruled Out: Lookup Service"). Same root cause
as Shape A: code-vs-prose blindness. Scores: 0.50–0.53.

## Decision

The current signals are insufficient. No reweighting or threshold adjustment
can fix this, for two independent structural reasons:

1. **Recall is unbounded below.** 49 of 92 false negatives produce literally
   zero signal — no match at any threshold, because the three signals all
   require surface-text overlap between the proposal and the alternative, and
   these revivals implement the rejected pattern without using its vocabulary.
   The remaining 43 score in the same band (0.09–0.24) as true negatives from
   the same domain; no threshold separates them.

2. **Precision has no separating threshold.** 32 of 32 false positives score in
   the same band (0.50–1.00) as the 26 true positives. There is no threshold
   that admits one class and excludes the other.

The scorer is unchanged. No weight or threshold change is motivated by the
analysis — the finding is that the feature space itself does not contain
a decision boundary, not that the boundary is in the wrong place.

## What different signals would need to do

For the recall problem (49 zero-signal FNs):
- A **behavioural/implementation-detection signal** that can recognise whether a
  diff implements the pattern described by an alternative without sharing its
  vocabulary. This is a semantic matching problem that lexical signals cannot
  approximate. A lightweight version might precompute implementation indicators
  per alternative (e.g., for "stateless JWT sessions": JWT library import, HMAC
  token construction, absence of server-side session store). This is
  task-specific and non-generalizable without embedding similarity or a
  classifier.

For the precision problem (32 FPs in the same score band as TPs):
- A **code-vs-prose discrimination signal** that distinguishes keywords
  appearing in implementation code (imports, function definitions, config
  values) from keywords appearing in rationale text (Markdown, comments,
  comparison tables). A heuristic proxy: weight matches in added code lines
  above matches in added comment/documentation lines.
- A **negation-context signal** that detects "we avoided X" vs "we implemented
  X". This requires syntactic analysis of the sentence surrounding the match.

Neither class of signal is implementable within the guard's current design
constraints (no LLM call, no embedding, no network, deterministic hot-path
execution) without substantial new infrastructure.

## Consequences

The guard remains as-is: precision 44.8% (95% Wilson 32.7%–57.5%), recall 22.0%.
Both figures describe a deliberately hard decision corpus (ADR-0016), not
deployment prevalence.

The guard's role as an advisory warning (not a blocker) means the cost of a
false positive is an unnecessary interruption and the cost of a false negative
is a missed warning. At current performance the guard misses roughly four in
five genuine revivals and is wrong more often than right when it does fire.

Future work on the guard should pursue *different* signals rather than
*different weights* for the current ones. The two most tractable directions are:

1. Code-vs-prose line classification for precision (would address 25 of 32 FPs
   if effective — Shapes A and C).
2. Per-alternative implementation indicators for recall (would require a
   precomputation step when records are indexed).

## Falsification

This ADR's conclusion — that the signals cannot separate the classes — is
falsified if a reweighting or threshold change to the *current three signals*
produces a precision whose 95% Wilson lower bound exceeds 57.5% (the current
upper bound) without reducing recall below 22.0%, measured on the unchanged
417-decision corpus. Any such change would demonstrate a decision boundary
that this analysis claims does not exist.
