# PRD F7 — CommitLoreBench (re-proposal rate · ablation lite · CPAA)

- Milestone: M1 skeleton+first measurement (08-02) → M4 ablation+report (08-23) · ADR: 0007

## Goal
Measure the utility hypothesis within 4 weeks. If this feature fails, change the project's direction — that is why it comes first.

## User stories
- As the owner, I see the first "significant difference in CommitLore on/off re-proposal rate" number at the end of M1.
- As a release reader, I can confirm from harness logs that every number in the README is a reproducible measurement.

## Requirements
1. Harness: task-sequence runner (two conditions, CommitLore on/off), state isolation between sessions, result JSONL.
2. Scenarios: ≥ 10 tasks that "revisit a decision point with a rejection history" (this repository + port from 1 public repository).
3. Metrics: re-proposal rate (required), constraint-violation rate and convergence time (instrumentation only), CPAA (harvest cost/accepted record).
4. Ablation lite (M4): 3 conditions — remove scope / remove grades / remove lifecycle.
5. Dual stopping: attempt cap per condition + token-budget cap.

## AC
- [ ] M1: complete 10 tasks × on/off, calculate re-proposal rate + run 1 significance test
- [ ] M4: results for 3 ablation conditions + CPAA report → update the README measured-results section
- [ ] Reproduce the numbers by rerunning the entire runner (fixed seed)

> ⚠️ **The M4 AC is limited by §Measurement Scope Correction below** (2026-07-26). The original text above is decision
> history, so leave it unchanged.

## Measurement Scope Correction (2026-07-26 · before inspecting results)

Record this while the primary matrix is being collected and **before aggregating any results**. Lowering
the AC after seeing the results would be a post hoc adjustment. Two items cannot be measured, for reasons independent of the results.

### 3 ablation conditions → 2 conditions (exclude `no-scope`)

`no-scope` is **inert** in this harness. The harness's placeholder injector,
`bench/context.ts`, applies no path scope and assembles every record in the workspace
history. The baseline arm, `commitlore-on`, is already unscoped, so there is nothing
to "remove."

Verification: across all 7 ablation tasks, the `no-grade` and `no-lifecycle` payloads differ from
baseline (`DIFFERS`, each inert in 0/7), while `no-scope` has 0 contrast. Direct payload inspection
confirmed that the planted decoy `r-lock05` (`docs/publishing.md`) is also present in
`commitlore-on`.

**Therefore this measurement does not test route scoping.** It measures "records present vs absent,"
not "scoped injection vs unscoped injection." The latter can be measured only after replacing the
harness injector with the actual `src/core/inject.ts` (#36).

### CPAA — not measured, reason recorded

CPAA is harvest cost/accepted record. `harvest` is **deliberately model-free** — under the permanently
free principle, the CLI carries neither a model nor an API key, and judgment occurs in the user's own agent
session (ADR-0006 §5). CPAA therefore requires `harvest_tokens` and `verify_tokens`, but because
re-proposal tasks do not run harvest, those two fields **do not exist** in result rows.
Ablation tasks have the same shape.

The CPAA implementation in `bench/metrics.ts` is complete and reports
`undefined_because: "not-instrumented"` instead of inventing a value. Substituting total session tokens
for harvest cost produces a number with the wrong definition — the comment in `metrics.ts` is a guard
added specifically to prevent that confusion. **Do not bypass that guard.**

Measurement requires a harvest-shaped task, which means changing the runner and therefore lifting the freeze.
Leave it outside v0.1.0 scope. Put this reason in the report instead of a number.
