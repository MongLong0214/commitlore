# CommitLore binary hook-overhead measurement (#39)

Machine: Apple M4 Pro, 12 logical CPUs, 48.0 GiB RAM, darwin 25.3.0 (arm64), Node v24.18.0, git version 2.50.1 (Apple Git-155).

Method: same as `bench/deterministic/hooks.ts#preToolUseOverhead` (one discarded warmup, then 20 timed runs of a file write, with and without the hook in front of it) — run against three arms in the same session so the comparison is same-machine rather than read off two separate reports.

| arm | runs | p50 ms | p95 ms | delta p50 vs baseline ms |
|---|---:|---:|---:|---:|
| no hook (baseline) | 20 | 0.06 | 0.09 | 0.00 |
| node dist/cli.js inject --hook-input | 20 | 127.13 | 132.63 | 127.07 |
| dist/commitlore inject --hook-input | 20 | 68.24 | 71.77 | 68.18 |

Node-path delta p50: **127.07 ms**. Binary delta p50: **68.18 ms**. Binary vs node-path, same session: **-58.89 ms** (46.3% lower).
