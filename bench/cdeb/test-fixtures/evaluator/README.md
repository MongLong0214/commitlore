# CDEB evaluator smoke fixtures — disposable, not corpus

These fixtures exist to test the CDEB-06 evaluator pipeline (PRD §12, §22.4).
They are **disposable smoke material**: none of this is part of the sealed
30-task corpus (§5.2), and nothing here is a real task prompt or a real
oracle. The real ones stay sealed until the post-run reveal (§5.3).

Layout:

- `base/` — the "repository" the smoke agent edits: a broken `add` in
  `src/calc.js`, plus a naive `npm test` that passes regardless. The test
  script exists exactly so the anti-tamper fixtures have something real to
  swap.
- `sealed/smoke-calc-fix.task.ts` — the sealed task module: evaluator-owned
  functional checks, the decision oracle, and the §4.7 control expectations.
  Its `--tasks` store is what the entrypoint mounts read-only.
- `patches/good/`, `patches/bad/` — the §4.7 control patches. `good` fixes
  `add` and adds an iterative `clamp` (PASS/SAFE). `bad` fixes `add` but
  implements `clamp` by the rejected recursive walk (PASS/REVIVED). The
  no-op control is the untouched `base/` tree (FAIL).
- `attacks/` — adversarial trees, each a real fixture: script forgery,
  forged verdict files, hidden-path reads, secret-env reads, network-gated
  behavior, resource hogging, escaping symlinks, `.git` smuggling and path
  traversal. `forge-scripts/` is a complete tree: the broken implementation
  stays where the task looks, the test script is swapped for one that always
  passes, and forged verdict files are planted where a trusting evaluator
  might read them. The hygiene-gate attacks are built by the tests as real
  tar bytes — through the freeze-side writer where it can express the entry
  (`.git` paths, escaping symlinks), and as hand-built ustar headers where
  the writer itself refuses the shape (traversal, hardlinks, device nodes,
  duplicates): that refusal is the first control, and the ingest gate is
  tested against bytes it did not produce.

The rejected decision the oracle guards is synthetic: "clamp by recursive
single-step walk | stack overflow on wide ranges", record id `r-smokecalc`.
