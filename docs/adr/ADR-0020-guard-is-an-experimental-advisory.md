# ADR-0020: guard is an experimental advisory

- Status: Accepted (2026-07-30)
- Extends: ADR-0019 (guard signal insufficiency)
- Issue: [#176](https://github.com/MongLong0214/commitlore/issues/176)
- Acceptance: CTO acceptance matrix, row P0-2

## Context

ADR-0019 established that the guard's three signals — token Jaccard,
distinctive-keyword strength, and Record-Id hit — cannot separate genuine
revivals from coincidental matches at any threshold. This ADR does not restate
that analysis; it extends the conclusion into an irreversible product
classification.

### Measured position

On the 417-decision corpus (ADR-0016):

| metric | value |
|--------|-------|
| Precision | 44.8% (95% Wilson CI: 32.7%–57.5%) |
| Recall | 22.0% |
| TP | 26 |
| FP | 32 |
| FN | 92 |
| TN | 267 |

A caller that receives an empty `matched` array has **not** received evidence
that the proposal is safe. At 22% recall, an empty result is a miss roughly
four times in five.

### The honesty defect

The MCP tool description for `commitlore_guard` (`src/mcp/server.ts:252-256`)
currently states:

> An empty `matched` array means the check ran and found nothing — it is a
> verdict, not an absence.

At 22% recall this sentence is false in the common case: an empty result is far
more likely to be a miss than a verdict. It is the most dangerous sentence on
the product surface because it tells a machine caller to treat silence as safety.

### Existing state (corrections C3, C4)

Guard is already absent from every default path: the default Claude `PreToolUse`
command is `commitlore inject --hook-input`, and `skills/` contains no guard
reference. Guard is already measured as non-blocking: `bench/GUARD-CANNOT-BLOCK.md`
documents that guard exits 2 (warning-only) and 3 (incomplete), never blocks.

## Decision

Guard is classified as an **experimental advisory**. Specifically:

1. **A match is a lead to inspect, not evidence the proposal is wrong.** Guard
   fires more often on non-revivals (32 FP) than on genuine revivals (26 TP).

2. **Every surface that exposes guard states its measured precision and recall.**
   The MCP tool description, README Known limitations, and CLI help text must
   each disclose precision 44.8% and recall 22.0%.

3. **The "verdict, not an absence" sentence is removed.** It is replaced with a
   disclosure that an empty result does not guarantee the proposal avoids all
   ruled-out alternatives.

4. **The score is not in default text output.** It is available via `--json` and
   debug mechanisms. The score band is not separating (ADR-0019 §FP analysis),
   so exposing it by default invites a user to calibrate trust on a number that
   carries no discriminative power.

5. **Guard stays out of default paths.** It is not registered in any default
   hook command, agent skill, or init scaffold.

6. **Guard stays non-blocking.** Already measured and confirmed
   (`bench/GUARD-CANNOT-BLOCK.md`); this ADR makes it a product invariant.

## What is explicitly NOT decided

- **Deleting guard.** A 44.8% precision advisory that fires on ~1 in 5 genuine
  revivals is still better than nothing *if honesty is maintained*. Deletion is
  not motivated by this measurement.

- **Changing any signal or weight.** ADR-0019 concluded that the current feature
  space contains no decision boundary. Reweighting is not pursued. Future work
  requires *different* signals (ADR-0019 §"What different signals would need to
  do").

## Consequences

- T-1020: MCP tool description rewritten to disclose limits and remove the
  overclaiming sentence.
- T-1021: README Known limitations updated in all four language files.
- T-1022: CLI guard surface uses "possible match" wording; score is not in
  default text output.
- The `READS_ONLY` annotation on the guard tool is preserved — it is accurate.

## Falsification

This classification is promoted out of "experimental" when a measurement on the
unchanged 417-decision corpus (ADR-0016) demonstrates:

1. Precision whose 95% Wilson lower bound exceeds 65% (currently 32.7%), **and**
2. Recall exceeds 40% (currently 22.0%)

without regression on either metric. Both conditions must hold simultaneously.
A change to signals or scorer that achieves this would motivate a new ADR
reclassifying guard as a "high-confidence advisory" or stronger.

The corpus itself may only change per the protocol in ADR-0016 §3 (new decisions
are appended, existing labels are never changed).
