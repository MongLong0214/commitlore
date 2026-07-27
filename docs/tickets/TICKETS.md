# Tickets index — v0.1.0 (deadline 2026-08-23)

> Ticket details (implementation outline, module paths, interfaces, test list, and AC) are in per-feature files. 1:1 with GitHub Issues.

| File | Tickets | Milestone | Issues |
|---|---|---|---|
| [F1-protocol-spec.md](F1-protocol-spec.md) | T-101 ~ T-103 (3) | M1 | #1–#3 |
| [F2-core-cli.md](F2-core-cli.md) | T-201 ~ T-205 (5) | M2 | #4–#8 |
| [F3-workflow-survival.md](F3-workflow-survival.md) | T-301 ~ T-303 (3) | M2 | #9–#11 |
| [F4-agent-fabric.md](F4-agent-fabric.md) | T-401 ~ T-406 (6) | M3 | #12–#17 |
| [F5-trust-minimal.md](F5-trust-minimal.md) | T-501 ~ T-502 (2) | M3 | #18–#19 |
| [F6-org-action.md](F6-org-action.md) | T-601 ~ T-602 (2) | M4 | #20–#21 |
| [F7-commitlorebench.md](F7-commitlorebench.md) | T-701 ~ T-704 (4) | M1 / M4 | #22–#25 |
| [F8-backfill.md](F8-backfill.md) | T-801 (1, stretch) | M4 | #26 |
| [release.md](release.md) | T-901 (1) | M4 | #27 |

Total: 27 v0.1.0 tickets · 7 Backlog (#28–#34, items cut from scope in ADR-0001)

## Dependency overview (critical path)

```
T-101 → T-102 → T-201 → T-203 → T-204 → T-402 → T-703 → T-704 → T-901
                  ├→ T-202 → T-502, T-601
                  ├→ T-205 → T-501 ─┘(T-402)
                  └→ T-301 → T-302 → T-602 → T-901
T-701 → T-702 (M1, independent track — highest priority)
T-403 → T-404 → T-801 (stretch)
```

Warning: **T-701/T-702 (CommitLoreBench) is independent of everything else — run it in parallel with top priority in M1** (early decision on the utility hypothesis, ADR-0001).
