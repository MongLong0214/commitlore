# ADR-0001: v0.1.0 범위 — 26주 로드맵을 4주로 압축

- Status: Accepted (2026-07-26, Isaac 지시 "1달 안에 끝낸다")
- Owner: CTO

## Context

전수 분석 보고서(annals-dossier)의 원 로드맵은 Phase 0~3 합계 26주였다. 오너 결정으로 전체 기간이 4주(v0.1.0 릴리스 2026-08-23)로 확정됐다. 또한 이 프로젝트는 전 계층 MIT 무료이며 사용자 별도 비용 0 원칙을 따른다(유료 플랜 없음, SaaS 없음, git이 SSOT).

## Decision

4주 = 4 마일스톤. 각 주의 배달물이 다음 주의 입력이 된다.

| 마일스톤 | 기한 | 배달물 | 포함 기능 |
|---|---|---|---|
| M1 Spec & Bench | 08-02 | Protocol v2 스펙+JSON Schema+적합성 스위트 v0, AnnalsBench 골격+재제안율 첫 측정 | F1, F7 |
| M2 Core CLI | 08-09 | 파서/validate/조회/인덱스/stale + squash 승계/notes 미러/--follow | F2, F3 |
| M3 Agent Fabric | 08-16 | annals-mcp, 주입 훅, 자동 수확+검증자, guard, 스킬 재작성, 신뢰 최소분 | F4, F5 |
| M4 Org + Release | 08-23 | GitHub Action(lint+승계), 어블레이션 리포트, backfill MVP(스트레치), v0.1.0 | F6, F7, F8 |

### v0.1.0에서 의도적으로 자르는 것 (→ Backlog 마일스톤)

- sigstore/gitsign 실서명 (v0.1은 규칙 기반 등급 — ADR-0005)
- 조직 결정 그래프(cross-repo), CI 정적 대시보드
- 임베딩 검색, `annals coverage`, 인터랙티브 `annals commit` 빌더(`--from-json`은 포함)
- `Anchor:` 심볼 수준 앵커링 (v0.1은 경로 + `--follow`까지)
- Expires 자동 알림, 조직 정책 필터

## Ruled-out

- 26주 원안 유지 | 오너 기한 제약과 충돌
- 전 기능 4주 압축 | 품질 붕괴 — AnnalsBench 실증(프로젝트의 존재 근거)까지 희생됨
- LoreBench를 뒤로 미루기 | 효용 가설이 틀렸다면 가장 먼저 알아야 한다 (존재론적 리스크 우선)

## Consequences

- F8(backfill)은 스트레치 — 실패해도 v0.1.0 릴리스를 차단하지 않는다.
- M1의 AnnalsBench 첫 측정에서 재제안율 유의차가 나오지 않으면 즉시 오너 에스컬레이션(피벗 판단).
- 잘린 항목은 전부 Backlog 마일스톤의 이슈로 남긴다 — 조용한 드롭 금지.
