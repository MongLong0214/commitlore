# CommitLore deterministic measurements

Provenance: commit `21dd96ccfc7d4e672f2178ce1371feef94611615`; dist sha256 `951939aa4206b6d188b4853fc37eec233e329e2109223dacb60edf3c85280809`.

Machine: Apple M4 Pro, 12 logical CPUs, 48.0 GiB RAM, darwin 25.3.0 (arm64), Node v24.18.0, git version 2.50.1 (Apple Git-155).

These numbers say what CommitLore costs and what it catches. They say nothing about whether recorded context helps an agent; M4 is registered for that question and may still come back null.

## 1. Query latency at scale

Method: one discarded warmup, then the stated run count per CLI command and mode. Indexed mode uses a completed rebuild; `--no-index` scans Git directly.

| commits | records | command | mode | runs | p50 ms | p95 ms |
|---:|---:|---|---|---:|---:|---:|
| 1000 | 9 | context | indexed | 20 | 200.66 | 205.51 |
| 1000 | 9 | limits | indexed | 20 | 197.58 | 206.45 |
| 1000 | 9 | ruled-out | indexed | 20 | 199.83 | 205.69 |
| 1000 | 9 | guard | indexed | 20 | 199.71 | 207.13 |
| 1000 | 9 | context | no-index | 20 | 341.47 | 349.45 |
| 1000 | 9 | limits | no-index | 20 | 341.68 | 346.50 |
| 1000 | 9 | ruled-out | no-index | 20 | 341.34 | 350.38 |
| 1000 | 9 | guard | no-index | 20 | 340.98 | 350.62 |
| 10000 | 97 | context | indexed | 20 | 216.45 | 221.06 |
| 10000 | 97 | limits | indexed | 20 | 216.74 | 220.94 |
| 10000 | 97 | ruled-out | indexed | 20 | 214.85 | 219.86 |
| 10000 | 97 | guard | indexed | 20 | 217.95 | 220.24 |
| 10000 | 97 | context | no-index | 20 | 980.42 | 1000.97 |
| 10000 | 97 | limits | no-index | 20 | 976.25 | 987.59 |
| 10000 | 97 | ruled-out | no-index | 20 | 983.90 | 992.36 |
| 10000 | 97 | guard | no-index | 20 | 985.90 | 996.74 |
| 100000 | 967 | context | indexed | 20 | 446.80 | 451.46 |
| 100000 | 967 | limits | indexed | 20 | 446.08 | 452.08 |
| 100000 | 967 | ruled-out | indexed | 20 | 445.74 | 449.01 |
| 100000 | 967 | guard | indexed | 20 | 447.58 | 455.40 |
| 100000 | 967 | context | no-index | 20 | 7694.93 | 13281.78 |
| 100000 | 967 | limits | no-index | 20 | 7752.16 | 7774.13 |
| 100000 | 967 | ruled-out | no-index | 20 | 7724.16 | 7743.37 |
| 100000 | 967 | guard | no-index | 20 | 7754.11 | 7828.67 |

## 2. Record survival

Method: seed the same number of trailer records in an isolated repository, run each Git operation, then count surviving `Record-Id` values in `HEAD`; rename cases query the new path through the shipped CLI.

| operation | survived / total | rate |
|---|---:|---:|
| interactive-rebase | 20 / 20 | 100.0% |
| rebase-onto | 20 / 20 | 100.0% |
| squash-merge | 0 / 20 | 0.0% |
| cherry-pick | 20 / 20 | 100.0% |
| filter-branch | 20 / 20 | 100.0% |
| rename | 20 / 20 | 100.0% |
| rename-heavy-edit | 0 / 20 | 0.0% |

## 3. Injection detection

Method: scan the labelled payload and benign-record corpus in `spec/fixtures/injection` with the shipped `INJECTION_PATTERNS`.

This corpus is pattern-authored: the same people who wrote `INJECTION_PATTERNS` wrote the payloads scored against it, so a high score here shows the patterns match what their own authors anticipated — it is not a real-world detection-rate claim, and is not to be quoted as one (README included).

True positives: **24/24 (100.0%)**. False positives: **0/20 (0.0%)**. False negatives: 0; true negatives: 20.

A second, independently authored corpus (`spec/fixtures/injection/adversarial.json`, GitHub issue #70, written without reading `INJECTION_PATTERNS`) is reported separately, never combined with the figure above: **7/7 (100.0%)** detected today. Before the #70 fix, that independently written set scored **4/6 (66.7%)** — the gap this suite exists to catch. Neither number estimates the scanner's real-world detection rate.

## 4. Guard precision and recall

Method: replay the existing labelled task artifacts in `bench/results/transcripts-final` through the shipped guard at threshold **0.35**.

Precision is reported by score band, never as one figure (issue #61): a rate computed from a handful of firings has a wide interval, and a single number invites reading it as more precise than it is. **Firings: 8** (of 30 replayed decisions).

| score band | firings | correct |
|---|---:|---:|
| [0.75, 1.00] | 2 | 0 |
| [0.50, 0.75) | 5 | 3 |
| [0.35, 0.50) | 1 | 0 |

Recall: **60.0%** (3 TP, 2 FN). Correct silence: 20.
Ground truth is the frozen corpus label; the suite does not relabel archived agent output after seeing the guard result.
No guard precision figure is carried into the README until the corpus is large enough for one to mean something.

## 5. Hook overhead

Method: time the same operation with and without the installed hook after one discarded warmup; commit-msg wraps an empty Git commit, and PreToolUse wraps the same file write with the shipped inject hook.

| hook | runs | without p50 / p95 ms | with p50 / p95 ms | delta p50 / p95 ms |
|---|---:|---:|---:|---:|
| commit-msg | 20 | 16.95 / 18.49 | 202.80 / 208.18 | 185.85 / 189.68 |
| pre-tool-use-inject | 20 | 0.04 / 0.06 | 102.43 / 104.84 | 102.40 / 104.78 |

## 6. Index cost

Method: rebuild the derived index once in each fresh synthetic history, time the rebuild, then measure the on-disk database size after the process exits.

| commits | records | build ms | size bytes | bytes / record |
|---:|---:|---:|---:|---:|
| 1000 | 9 | 171.63 | 98304 | 10922.67 |
| 10000 | 97 | 496.62 | 454656 | 4687.18 |
| 100000 | 967 | 3861.89 | 3854336 | 3985.87 |
