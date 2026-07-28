# CommitLore deterministic measurements

Provenance: commit `9857aa1e5913b4ca33db8e78077f76a35a737b13`; dist sha256 `77fff7c3c054574fca8751ee171d5148b379512cd307a04747cfa9715979d290`.

Machine: Apple M4 Pro, 12 logical CPUs, 48.0 GiB RAM, darwin 25.3.0 (arm64), Node v24.18.0, git version 2.50.1 (Apple Git-155).

These numbers say what CommitLore costs and what it catches. They say nothing about whether recorded context helps an agent; M4 is registered for that question and may still come back null.

## 7. Addressable rationale density

Method: `git log HEAD` supplies commit messages at run time. Git parses each record block; the denominator is non-empty body lines, excluding the subject.

CoMRAT defines rationale density and decision density with rationale and decision sentences per commit message ([CoMRAT (MSR 2025)](https://arxiv.org/abs/2506.10986)). This benchmark does not infer those semantic sentences: it reports structured trailer lines and record-bearing messages instead.

| commits examined | commits carrying a record | structured trailers | trailers / commit | structured trailer share of non-empty body lines |
|---:|---:|---:|---:|---:|
| 224 | 179 (79.9%) | 2086 | 9.31 | 37.3% |

This measures addressability, not abundance: prose rationale is not machine-addressable while structured trailers are.
The Linux OOM-Killer dataset reports 98.9% of commits containing a rationale sentence ([Linux OOM-Killer rationale dataset (ICPC 2024)](https://arxiv.org/abs/2403.18832)), above this repository's 79.9% record-bearing rate; CommitLore does not claim more rationale than that disciplined project.

Published context: roughly 44% of commit messages omit either the what or the why ([Commit Message Matters (ICSE 2023)](https://dl.acm.org/doi/abs/10.1109/ICSE48619.2023); [What Makes a Good Commit Message? (ICSE 2022)](https://arxiv.org/abs/2202.02974)).
