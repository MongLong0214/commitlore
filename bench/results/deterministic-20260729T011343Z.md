# CommitLore deterministic measurements

Provenance: commit `82259cdd8d5dcbaee61c63c0aedf8675950e3b72`; dist sha256 `88a8cd1a8df1b62934be65570f19ff8d79119a452c8ddc9a588a5e3195948368`.

Machine: Apple M4 Pro, 12 logical CPUs, 48.0 GiB RAM, darwin 25.3.0 (arm64), Node v24.18.0, git version 2.50.1 (Apple Git-155).

These numbers measure structured addressability. They say nothing about semantic rationale abundance or agent benefit.

## 9. Addressable rationale density

Method: `git log HEAD` supplies commit messages at run time. Git parses each record block; the denominator is non-empty body lines, excluding the subject.

CoMRAT defines rationale density and decision density with rationale and decision sentences per commit message ([CoMRAT (MSR 2025)](https://arxiv.org/abs/2506.10986)). This benchmark does not infer those semantic sentences: it reports structured trailer lines and record-bearing messages instead.

| commits examined | commits carrying a record | structured trailers | trailers / commit | structured trailer share of non-empty body lines |
|---:|---:|---:|---:|---:|
| 260 | 201 (77.3%) | 2230 | 8.58 | 37.5% |

This measures addressability, not abundance: prose rationale is not machine-addressable while structured trailers are.
The Linux OOM-Killer dataset reports 98.9% of commits containing a rationale sentence ([Linux OOM-Killer rationale dataset (ICPC 2024)](https://arxiv.org/abs/2403.18832)), above this repository's 77.3% record-bearing rate; CommitLore does not claim more rationale than that disciplined project.

Published context: roughly 44% of commit messages omit either the what or the why ([Commit Message Matters (ICSE 2023)](https://dl.acm.org/doi/abs/10.1109/ICSE48619.2023); [What Makes a Good Commit Message? (ICSE 2022)](https://arxiv.org/abs/2202.02974)).
