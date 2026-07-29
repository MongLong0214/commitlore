# CommitLore deterministic measurements

Provenance: commit `d5ab509e1c8a4807a0f246c15c3a4827221f1cc5`; dist sha256 `88a8cd1a8df1b62934be65570f19ff8d79119a452c8ddc9a588a5e3195948368`.

Machine: Apple M4 Pro, 12 logical CPUs, 48.0 GiB RAM, darwin 25.3.0 (arm64), Node v24.18.0, git version 2.50.1 (Apple Git-155).

These numbers say what CommitLore costs and what it catches. They say nothing about whether recorded context helps an agent; M4 is registered for that question and may still come back null.

## 1. Query latency at scale

Method: one discarded warmup, then the stated run count per CLI command and mode. Indexed mode uses a completed rebuild; `--no-index` scans Git directly.

| commits | records | command | mode | runs | p50 ms | p95 ms |
|---:|---:|---|---|---:|---:|---:|
| 1000 | 9 | context | indexed | 20 | 234.49 | 238.54 |
| 1000 | 9 | limits | indexed | 20 | 234.56 | 238.62 |
| 1000 | 9 | ruled-out | indexed | 20 | 234.74 | 243.76 |
| 1000 | 9 | guard | indexed | 20 | 234.91 | 240.45 |
| 1000 | 9 | context | no-index | 20 | 1132.45 | 1143.46 |
| 1000 | 9 | limits | no-index | 20 | 1131.90 | 1138.48 |
| 1000 | 9 | ruled-out | no-index | 20 | 1130.22 | 1139.01 |
| 1000 | 9 | guard | no-index | 20 | 1130.78 | 1139.34 |
| 10000 | 97 | context | indexed | 20 | 251.13 | 254.24 |
| 10000 | 97 | limits | indexed | 20 | 252.56 | 258.28 |
| 10000 | 97 | ruled-out | indexed | 20 | 253.45 | 260.15 |
| 10000 | 97 | guard | indexed | 20 | 252.31 | 257.10 |
| 10000 | 97 | context | no-index | 20 | 9054.08 | 9141.80 |
| 10000 | 97 | limits | no-index | 20 | 8945.20 | 9001.59 |
| 10000 | 97 | ruled-out | no-index | 20 | 8941.27 | 8989.33 |
| 10000 | 97 | guard | no-index | 20 | 8936.32 | 8990.07 |
| 100000 | 967 | context | indexed | 20 | 496.15 | 502.71 |
| 100000 | 967 | limits | indexed | 20 | 497.30 | 502.02 |
| 100000 | 967 | ruled-out | indexed | 20 | 496.09 | 500.07 |
| 100000 | 967 | guard | indexed | 20 | 501.08 | 505.31 |
| 100000 | 967 | context | no-index | 20 | 86672.97 | 86814.50 |
| 100000 | 967 | limits | no-index | 20 | 87754.83 | 88539.43 |
| 100000 | 967 | ruled-out | no-index | 20 | 88832.92 | 103280.67 |
| 100000 | 967 | guard | no-index | 20 | 88679.44 | 90938.69 |

## 2. Record survival

Method: history-retention rows count `Record-Id` values in `HEAD` with `historyCount`; path-reachability rows query the new path through the shipped CLI with `pathCount`. These are distinct outcomes and are never averaged.

The local `squash-merge` row exercises the installed `prepare-commit-msg` hook. GitHub’s server-side squash button runs no local hook, remains uncovered, and still loses records. `rename-heavy-edit` is a path lookup miss, not preservation: its record remains in Git history and is retrievable by commit or `Record-Id`.

| operation | outcome | counter | survived / total | rate |
|---|---|---|---:|---:|
| interactive-rebase | history-retention | historyCount | 20 / 20 | 100.0% |
| rebase-onto | history-retention | historyCount | 20 / 20 | 100.0% |
| squash-merge | history-retention | historyCount | 1 / 20 | 5.0% |
| cherry-pick | history-retention | historyCount | 20 / 20 | 100.0% |
| filter-branch | history-retention | historyCount | 20 / 20 | 100.0% |
| rename | path-reachability | pathCount | 20 / 20 | 100.0% |
| rename-heavy-edit | path-reachability | pathCount | 0 / 20 | 0.0% |

## 3. Injection detection

Method: scan the labelled payload and benign-record corpus in `spec/fixtures/injection` with the shipped `INJECTION_PATTERNS`.

This corpus is pattern-authored: the same people who wrote `INJECTION_PATTERNS` wrote the payloads scored against it, so a high score here shows the patterns match what their own authors anticipated — it is not a real-world detection-rate claim, and is not to be quoted as one (README included).

True positives: **24/24 (100.0%)**. False positives: **0/20 (0.0%)**. False negatives: 0; true negatives: 20.

A second, independently authored corpus (`spec/fixtures/injection/adversarial.json`, GitHub issue #70, written without reading `INJECTION_PATTERNS`) is reported separately, never combined with the figure above: **7/7 (100.0%)** detected today. Before the #70 fix, that independently written set scored **4/6 (66.7%)** — the gap this suite exists to catch. Neither number estimates the scanner's real-world detection rate.

## 4. Guard precision and recall

Method: replay the existing labelled task artifacts in `bench/results/transcripts-final` through the shipped guard across the full **0.00–1.00** score range in **0.05** steps. The shipped default is **0.35**.

Corpus limit: **30 labelled decisions**. At the default, precision is 3/7; its 95% Wilson interval is **15.8%–75.0%**.

| threshold | precision | recall | F1 | firings | correct silences |
|---:|---:|---:|---:|---:|---:|
| 0.00 | 33.3% | 60.0% | 42.9% | 9 | 19 |
| 0.05 | 33.3% | 60.0% | 42.9% | 9 | 19 |
| 0.10 | 33.3% | 60.0% | 42.9% | 9 | 19 |
| 0.15 | 37.5% | 60.0% | 46.2% | 8 | 20 |
| 0.20 | 37.5% | 60.0% | 46.2% | 8 | 20 |
| 0.25 | 37.5% | 60.0% | 46.2% | 8 | 20 |
| 0.30 | 42.9% | 60.0% | 50.0% | 7 | 21 |
| 0.35 | 42.9% | 60.0% | 50.0% | 7 | 21 |
| 0.40 | 42.9% | 60.0% | 50.0% | 7 | 21 |
| 0.45 | 42.9% | 60.0% | 50.0% | 7 | 21 |
| 0.50 | 42.9% | 60.0% | 50.0% | 7 | 21 |
| 0.55 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.60 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.65 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.70 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.75 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.80 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.85 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.90 | 0.0% | 0.0% | n/a | 2 | 23 |
| 0.95 | 0.0% | 0.0% | n/a | 2 | 23 |
| 1.00 | 0.0% | 0.0% | n/a | 2 | 23 |

| score band | firings | correct |
|---|---:|---:|
| [0.75, 1.00] | 2 | 0 |
| [0.50, 0.75) | 5 | 3 |
| [0.35, 0.50) | 0 | 0 |

Default-point recall: **60.0%** (3 TP, 2 FN). Correct silence: 21.
Ground truth is the frozen corpus label; the suite does not relabel archived agent output after seeing the guard result.
No guard precision figure is carried into the README until the corpus is large enough for one to mean something.

## 5. Hook overhead

Method: time the same operation with and without the installed hook after one discarded warmup; commit-msg wraps an empty Git commit, and PreToolUse wraps the same file write with the shipped inject hook.

| hook | runs | without p50 / p95 ms | with p50 / p95 ms | delta p50 / p95 ms |
|---|---:|---:|---:|---:|
| commit-msg | 20 | 21.48 / 22.22 | 249.96 / 255.70 | 228.48 / 233.48 |
| pre-tool-use-inject | 20 | 0.05 / 0.08 | 119.58 / 123.90 | 119.53 / 123.81 |

## 6. Record capture cost

Method: run the shipped local `harvest --prompt-only` and `harvest-verify --json` commands against the truthful harvest-verifier fixture after one discarded warmup; the harvest contract is what the session receives and verification input is the draft, transcript, and diff it re-reads.

| fixture | accepted / rejected records | harvest bytes / tokens | harvest p50 / p95 ms | verify bytes / tokens | verify p50 / p95 ms | cache-read bytes / tokens | marginal / including-cache tokens per accepted record |
|---|---:|---:|---:|---:|---:|---:|---:|
| test/fixtures/harvest-verify/draft-truthful.json | 1 / 0 | 6110 / 1524 | 105.18 / 107.70 | 3690 / 923 | 132.05 / 135.34 | 1320 / 330 | 2117.00 / 2447.00 |

The two floors bracket the same deterministic work. Marginal tokens exclude the transcript and diff that verification re-reads after harvest already supplied them; including-cache tokens count that prefix again. A cache-aware bill charges such reads at a fraction of the full input rate, so the figures do not contradict each other.

Model generation tokens are not measured: this benchmark makes no model call, so the model's cost to compose a draft sits on top of both floors.

The denominator is 1 accepted record(s); this fixture had 0 rejected record(s). A rejected draft that is rewritten raises verification input tokens while the accepted-record denominator stays fixed.

Common commit cost: a commit with no record pays the existing `commit-msg` p50 overhead of **185.85 ms**. A record-bearing commit has a **423.07 ms** serial p50 component sum (commit-msg + harvest + verify); it is not a jointly sampled percentile. The separate PreToolUse injection p50 is **102.40 ms**. Both existing hook figures are cited from `bench/results/deterministic-20260727T174801Z.md`, not remeasured here.

## 7. Index cost

Method: rebuild the derived index once in each fresh synthetic history, time the rebuild, then measure the on-disk database size after the process exits.

| commits | records | build ms | size bytes | bytes / record |
|---:|---:|---:|---:|---:|
| 1000 | 9 | 579.12 | 98304 | 10922.67 |
| 10000 | 97 | 4461.20 | 458752 | 4729.40 |
| 100000 | 967 | 43284.41 | 3915776 | 4049.41 |

## 8. Irrelevant decision-context exposure

This section measures exposure only, not token cost, billed cost, or accuracy.

Fixture: exactly two active records apply to `src/core/decision-context.ts`; each corpus adds the stated fixed-seed distractors with the same trailer vocabulary, plausible repository paths, and overlapping decision-context language.
Routes: `inject everything`; `top-k lexical` (k=2, case-insensitive query-token frequency over path and record text); and the shipped CommitLore injection path scope plus lifecycle filter. The current CLI has neither a pointer nor pull delivery route, so neither is simulated here.

| distractors | corpus records | route | model-visible records | model-visible tokens | relevant density | runs | p50 ms | p95 ms |
|---:|---:|---|---:|---:|---|---:|---:|---:|
| 0 | 2 | inject-everything | 2 | 179 | 2 of 2 (100.0%) | 20 | 0.00 | 0.00 |
| 0 | 2 | top-k-lexical | 2 | 179 | 2 of 2 (100.0%) | 20 | 0.01 | 0.01 |
| 0 | 2 | commitlore-path-lifecycle | 2 | 335 | 2 of 2 (100.0%) | 20 | 178.57 | 186.86 |
| 10 | 12 | inject-everything | 12 | 1181 | 2 of 12 (16.7%) | 20 | 0.00 | 0.00 |
| 10 | 12 | top-k-lexical | 2 | 190 | 1 of 2 (50.0%) | 20 | 0.14 | 0.25 |
| 10 | 12 | commitlore-path-lifecycle | 2 | 335 | 2 of 2 (100.0%) | 20 | 179.05 | 189.22 |
| 100 | 102 | inject-everything | 102 | 10220 | 2 of 102 (2.0%) | 20 | 0.00 | 0.01 |
| 100 | 102 | top-k-lexical | 2 | 190 | 1 of 2 (50.0%) | 20 | 2.51 | 2.84 |
| 100 | 102 | commitlore-path-lifecycle | 2 | 335 | 2 of 2 (100.0%) | 20 | 183.96 | 204.16 |
| 1000 | 1002 | inject-everything | 1002 | 100616 | 2 of 1002 (0.2%) | 20 | 0.06 | 0.25 |
| 1000 | 1002 | top-k-lexical | 2 | 190 | 1 of 2 (50.0%) | 20 | 28.00 | 28.72 |
| 1000 | 1002 | commitlore-path-lifecycle | 2 | 335 | 2 of 2 (100.0%) | 20 | 204.81 | 219.74 |
| 10000 | 10002 | inject-everything | 10002 | 1004554 | 2 of 10002 (0.0%) | 20 | 0.47 | 1.11 |
| 10000 | 10002 | top-k-lexical | 2 | 190 | 1 of 2 (50.0%) | 20 | 295.04 | 297.97 |
| 10000 | 10002 | commitlore-path-lifecycle | 2 | 335 | 2 of 2 (100.0%) | 20 | 369.43 | 372.43 |

## 9. Addressable rationale density

Method: `git log HEAD` supplies commit messages at run time. Git parses each record block; the denominator is non-empty body lines, excluding the subject.

CoMRAT defines rationale density and decision density with rationale and decision sentences per commit message ([CoMRAT (MSR 2025)](https://arxiv.org/abs/2506.10986)). This benchmark does not infer those semantic sentences: it reports structured trailer lines and record-bearing messages instead.

| commits examined | commits carrying a record | structured trailers | trailers / commit | structured trailer share of non-empty body lines |
|---:|---:|---:|---:|---:|
| 263 | 203 (77.2%) | 2243 | 8.53 | 37.5% |

This measures addressability, not abundance: prose rationale is not machine-addressable while structured trailers are.
The Linux OOM-Killer dataset reports 98.9% of commits containing a rationale sentence ([Linux OOM-Killer rationale dataset (ICPC 2024)](https://arxiv.org/abs/2403.18832)), above this repository's 77.2% record-bearing rate; CommitLore does not claim more rationale than that disciplined project.

Published context: roughly 44% of commit messages omit either the what or the why ([Commit Message Matters (ICSE 2023)](https://dl.acm.org/doi/abs/10.1109/ICSE48619.2023); [What Makes a Good Commit Message? (ICSE 2022)](https://arxiv.org/abs/2202.02974)).
