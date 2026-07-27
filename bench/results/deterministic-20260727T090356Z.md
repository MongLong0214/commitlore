# CommitLore deterministic measurements

Provenance: commit `1edccdfb62ae51d63d045ae6c86374beed9131af`; dist sha256 `e2e700b9b063456daf74f171b3ada8a98efde9bfde4261b49f9f750f57041eb7`.

Machine: Apple M4 Pro, 12 logical CPUs, 48.0 GiB RAM, darwin 25.3.0 (arm64), Node v24.13.0, git version 2.50.1 (Apple Git-155).

These numbers say what CommitLore costs and what it catches. They say nothing about whether recorded context helps an agent; M4 is registered for that question and may still come back null.

## 1. Query latency at scale

Method: one discarded warmup, then the stated run count per CLI command and mode. Indexed mode uses a completed rebuild; `--no-index` scans Git directly.

| commits | records | command | mode | runs | p50 ms | p95 ms |
|---:|---:|---|---|---:|---:|---:|
| 1000 | 9 | context | indexed | 20 | 182.65 | 189.54 |
| 1000 | 9 | limits | indexed | 20 | 183.53 | 187.63 |
| 1000 | 9 | ruled-out | indexed | 20 | 184.38 | 188.47 |
| 1000 | 9 | guard | indexed | 20 | 183.58 | 189.32 |
| 1000 | 9 | context | no-index | 20 | 316.84 | 333.39 |
| 1000 | 9 | limits | no-index | 20 | 321.63 | 328.59 |
| 1000 | 9 | ruled-out | no-index | 20 | 324.63 | 333.05 |
| 1000 | 9 | guard | no-index | 20 | 325.66 | 332.34 |
| 10000 | 97 | context | indexed | 20 | 200.76 | 206.23 |
| 10000 | 97 | limits | indexed | 20 | 202.28 | 206.12 |
| 10000 | 97 | ruled-out | indexed | 20 | 201.17 | 205.91 |
| 10000 | 97 | guard | indexed | 20 | 201.34 | 206.93 |
| 10000 | 97 | context | no-index | 20 | 950.25 | 1008.24 |
| 10000 | 97 | limits | no-index | 20 | 945.96 | 986.49 |
| 10000 | 97 | ruled-out | no-index | 20 | 953.01 | 988.88 |
| 10000 | 97 | guard | no-index | 20 | 924.62 | 980.57 |
| 100000 | 967 | context | indexed | 20 | 384.37 | 388.77 |
| 100000 | 967 | limits | indexed | 20 | 385.96 | 396.13 |
| 100000 | 967 | ruled-out | indexed | 20 | 389.02 | 397.87 |
| 100000 | 967 | guard | indexed | 20 | 387.23 | 391.86 |
| 100000 | 967 | context | no-index | 20 | 7684.42 | 7846.54 |
| 100000 | 967 | limits | no-index | 20 | 7810.28 | 7939.46 |
| 100000 | 967 | ruled-out | no-index | 20 | 7929.21 | 8123.23 |
| 100000 | 967 | guard | no-index | 20 | 8013.36 | 8184.08 |

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

True positives: **21/21 (100.0%)**. False positives: **0/15 (0.0%)**. False negatives: 0; true negatives: 15.

## 4. Guard precision and recall

Method: replay the existing labelled task artifacts in `bench/results/transcripts-final` through the shipped guard at threshold **0.35**.

Precision: **37.5%** (3 TP, 5 FP). Recall: **60.0%** (3 TP, 2 FN). Correct silence: 20.
Ground truth is the frozen corpus label; the suite does not relabel archived agent output after seeing the guard result.

## 5. Hook overhead

Method: time the same operation with and without the installed hook after one discarded warmup; commit-msg wraps an empty Git commit, and PreToolUse wraps the same file write with the shipped inject hook.

| hook | runs | without p50 / p95 ms | with p50 / p95 ms | delta p50 / p95 ms |
|---|---:|---:|---:|---:|
| commit-msg | 20 | 18.01 / 18.65 | 152.00 / 154.30 | 133.99 / 135.65 |
| pre-tool-use-inject | 20 | 0.05 / 0.11 | 250.51 / 256.33 | 250.46 / 256.23 |

## 6. Index cost

Method: rebuild the derived index once in each fresh synthetic history, time the rebuild, then measure the on-disk database size after the process exits.

| commits | records | build ms | size bytes | bytes / record |
|---:|---:|---:|---:|---:|
| 1000 | 9 | 176.23 | 98304 | 10922.67 |
| 10000 | 97 | 494.27 | 454656 | 4687.18 |
| 100000 | 967 | 3651.55 | 3854336 | 3985.87 |
