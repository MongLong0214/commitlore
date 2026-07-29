# Closed packet — #176 guard scoring

Ready to run. Hand to `gpt-worker.sh sol danger-full-access <worktree>`.

---

GOAL: Find out whether the guard's signals can separate a genuine revival from a coincidental textual match at all. Issue #176. Against the 417-decision corpus the guard scores precision 44.8% (95% Wilson 32.7%–57.5%) and recall 22.0% — 92 false negatives against 26 true positives. If the signals cannot separate the classes, no reweighting will, and the answer is different signals rather than different weights.

TASK_CLASS: architecture

EXACT_SHA_OR_FILES: files:src/core/guard.ts,bench/deterministic/quality.ts,docs/adr
Cut a branch from origin/dev. Do NOT run git fetch. Read GitHub issue #176 first, then
docs/adr/ADR-0016-guard-quality-corpus.md which registered the corpus this is judged against.

ACCEPTANCE: ten items.

1. Read the 92 false negatives before proposing anything. They are in
   bench/fixtures/guard-quality.json and they are readable. The question this branch answers is
   whether they share a property the current signals cannot see. Report what you found — a list of
   the recurring shapes, with counts — before any code.

2. Do the same for the 32 false positives. A guard wrong more often than right when it fires has a
   second problem, and it may or may not be the same one.

3. **Do not change the corpus.** ADR-0016 made it the instrument; moving it in the same commit as the
   scorer returns this question to the state #157 resolved it from. If the corpus is wrong in some
   case, report that as a finding and leave it.

4. Report both precision and recall on every change, with intervals. A scorer that lifts precision by
   suppressing firings makes the recall problem worse while looking like an improvement, and recall
   at 22% is the larger problem.

5. **The interval is the acceptance criterion, not the point estimate.** A change whose precision
   point estimate improves but whose interval still spans the old one has not been shown to do
   anything.

6. It is a valid outcome to conclude the signals are insufficient and propose different ones without
   implementing them. That conclusion, with the false-negative analysis behind it, is worth more than
   a reweighting that moves a point estimate inside its own interval.

7. If you do change the scorer, the change must be motivated by something in the analysis from items
   1 and 2 — not by trying combinations until a number improves. Say which finding motivated it.

8. Write the ADR if the branch reaches a conclusion. If it does not, say so plainly and leave the
   scorer alone; an honest "the signals cannot do this" is the finding.

9. Tests. Cover whatever you change, and each new test must be seen to fail before it passes — break
   the production code deliberately, confirm the failure, restore, confirm the pass, paste both.

10. Do not run any wall-clock benchmark. The corpus replay needs no timing.

VERIFY: npx vitest run passes; establish the baseline yourself from the local origin/dev ref. Run
`npx tsc -p tsconfig.json --noEmit` and `npx tsc -p bench/tsconfig.json --noEmit` — CI runs both and
the suite covers neither. Paste the false-negative analysis, and precision and recall with intervals
before and after if you changed anything.

FORBIDDEN_SCOPE: Do not modify bench/fixtures/guard-quality.json. Do not touch README.md or its
translations. Do not report a figure without its interval. Commit with a CommitLore record using the
repository's existing trailer vocabulary including a unique Record-Id, then push and open a PR
against dev referencing #176. Do not merge.
