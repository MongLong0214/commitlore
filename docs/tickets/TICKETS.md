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
| [release.md](release.md) | T-901, T-1030 ~ T-1031 (3) | M4 / M5 | #27, #192, #211 |
| [F9-unified-capture.md](F9-unified-capture.md) | T-1001 ~ T-1009, T-1018, T-1019, T-1023 (12) | M5 | #193–#201, #213, #215, #216 |
| [F10-first-run-experience.md](F10-first-run-experience.md) | T-1010 ~ T-1016 (7) | M5 | #202–#207, #212 |
| [F11-guard-classification.md](F11-guard-classification.md) | T-1020 ~ T-1022, T-1024 (4) | M5 | #208–#210, #219 |
| [F12-universal-adoption.md](F12-universal-adoption.md) | T-1101 ~ T-1108 (8) | M6 | #265–#272 |
| [F13-capture-advisory-and-policy.md](F13-capture-advisory-and-policy.md) | T-1109 ~ T-1110 (2) | M6 | #273–#274 |

Total: 27 v0.1.0 tickets · 7 Backlog (#28–#34, items cut from scope in ADR-0001) · 25 M5 Gate A tickets (T-1001 ~ T-1031; T-1019 and T-1023 are independent audit findings recorded in `docs/GATE-A-ACCEPTANCE.md` and close no acceptance-matrix row; T-1024 is ticketed to close row P0-8 and is defined in `F11-guard-classification.md`) · 10 M6 Gate B tickets (T-1101 ~ T-1110)

`docs/GATE-A-ACCEPTANCE.md` is the authority for which ticket closes which
acceptance-matrix row (`P0-1`…`P0-8`, `P1-5`) and for the `src/mcp/server.ts`
merge-sequencing constraint across T-1007/T-1008/T-1009/T-1020.

`docs/GATE-B-ACCEPTANCE.md` is the same authority for M6 (`B-1`…`B-7`), and carries Gate
B's execution constraints: the `T-1101 → T-1102 → T-1103 → T-1104` Windows chain is
strictly ordered by ADR-0023, T-1104 and T-1106 may not merge in the same wave, and T-1109
merges before T-1110. **T-1109 closes `B-6`, not `P0-8`** — `P0-8` is
`commitlore_before_change` and T-1024 already closed it.

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
