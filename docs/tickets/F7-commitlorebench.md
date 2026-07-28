# F7 tickets — CommitLoreBench (M1 skeleton and measurement / M4 ablation and report)

> PRD: `docs/prd/PRD-F7-commitlorebench.md` · ADR: 0007
> Layout: `bench/runner.ts`, `bench/tasks/*.yaml`, `bench/metrics.ts`, `bench/report.ts`, results in `bench/results/*.jsonl` (committed)

---

## T-701 Harness skeleton (M) — #22 · no dependencies [M1]

**Implementation outline**
- `bench/runner.ts`: task-sequence runner. Conditions = `commitlore-on | commitlore-off` (+3 ablation conditions in M4). Isolated workspace for each task (temporary clone); only the commitlore channel shares state between sessions.
- Task definition `bench/tasks/*.yaml`: `{repo, setup(prior commits · rejected-history injection), prompt, detect(reproposal decision rule: signature strings/AST patterns for prohibited approaches), budget{turns, tokens}}`.
- Dual stopping: attempt cap per task + total token cap. Fixed seed, result JSONL (`{task, cond, reproposed, violations, turns, tokens}`).
- Agent driver: v0.1 supports only 1 type, Claude Code headless (`claude -p`).

**Test**: round trip 3 dummy tasks on/off, validate JSONL schema.
**AC**: PRD-F7 requirements 1·5.

---

## T-702 Re-proposal-rate metric + first significance measurement (M) — #23 · depends on T-701 [M1]

**Implementation outline**
- Write 10 tasks: "revisit a decision point with a rejection history" — this repository + port from 1 public repository. Each task's `detect` rule must use mechanical classification (string/structural match) — no subjective grading.
- `metrics.ts`: re-proposal rate = tasks with re-proposal / all tasks, difference test between conditions (Fisher exact — small n); constraint-violation rate and convergence time are instrumentation only.
- Run: on/off × 10 tasks × 3 repetitions (change seed) = 60 runs.

**AC**: complete 1 significance test and record the number. **If there is no significant difference, escalate to the owner immediately (ADR-0001) — commit the log regardless of the result.**

---

## T-703 Ablation lite + CPAA (M) — #24 · depends on T-702, T-402 [M4]

**Implementation outline**
- 3 conditions: `no-scope` (inject global dump) / `no-grade` (do not apply demotion) / `no-lifecycle` (do not filter stale records) — implement as condition flags on the T-402 injector.
- CPAA = (harvest+verification token total) / accepted record count — calculate from harness instrumentation.

**AC**: result JSONL for 3 conditions × 10 tasks + table of re-proposal and violation rates by condition. Describe the directional decision on the CTIM-Rover noise hypothesis.

---

## T-704 Measured report + README update (S) — #25 · depends on T-703 [M4]

**Implementation outline**: `bench/report.ts` — JSONL → Markdown table. The README "Measured results" section includes only this output (no manually entered numbers; CI verifies regeneration).
**AC**: reproduce every README number from `bench/results/` logs. Rerun with fixed seed matches.
