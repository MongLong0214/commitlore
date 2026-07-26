# Tickets 인덱스 — v0.1.0 (기한 2026-08-23)

> 티켓 상세(구현 개요·모듈 경로·인터페이스·테스트 목록·AC)는 기능별 파일에 있다. GitHub Issues와 1:1.

| 파일 | 티켓 | 마일스톤 | 이슈 |
|---|---|---|---|
| [F1-protocol-spec.md](F1-protocol-spec.md) | T-101 ~ T-103 (3) | M1 | #1–#3 |
| [F2-core-cli.md](F2-core-cli.md) | T-201 ~ T-205 (5) | M2 | #4–#8 |
| [F3-workflow-survival.md](F3-workflow-survival.md) | T-301 ~ T-303 (3) | M2 | #9–#11 |
| [F4-agent-fabric.md](F4-agent-fabric.md) | T-401 ~ T-406 (6) | M3 | #12–#17 |
| [F5-trust-minimal.md](F5-trust-minimal.md) | T-501 ~ T-502 (2) | M3 | #18–#19 |
| [F6-org-action.md](F6-org-action.md) | T-601 ~ T-602 (2) | M4 | #20–#21 |
| [F7-annalsbench.md](F7-annalsbench.md) | T-701 ~ T-704 (4) | M1 / M4 | #22–#25 |
| [F8-backfill.md](F8-backfill.md) | T-801 (1, 스트레치) | M4 | #26 |
| [release.md](release.md) | T-901 (1) | M4 | #27 |

합계: v0.1.0 티켓 27 · Backlog 7 (#28–#34, ADR-0001 범위 컷 항목)

## 의존성 개요 (critical path)

```
T-101 → T-102 → T-201 → T-203 → T-204 → T-402 → T-703 → T-704 → T-901
                  ├→ T-202 → T-502, T-601
                  ├→ T-205 → T-501 ─┘(T-402)
                  └→ T-301 → T-302 → T-602 → T-901
T-701 → T-702 (M1, 독립 트랙 — 최우선)
T-403 → T-404 → T-801(스트레치)
```

주의: **T-701/T-702(AnnalsBench)는 다른 모든 것과 독립 — M1에서 병렬 최우선 실행** (효용 가설 조기 판별, ADR-0001).
