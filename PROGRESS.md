# 진행 상황 보드

> 폰에서 한 화면으로 보는 작업 현황. 작업이 끝날 때마다 갱신됨.
> 최종 갱신: **2026-07-26 13:1x KST**

## 지금 상태

| | |
|---|---|
| 목표 | v0.1.0 — **2026-08-23** (4주) |
| 진행 | **1 / 27 티켓** 완료 · M1 착수 |
| 지금 돌아가는 것 | T-101 스펙 작성(sonnet) · T-701 벤치 하니스(opus) — 병렬 |
| 막힌 것 | 없음 |
| 오너 결정 대기 | 없음 |

## 마일스톤

| | 마일스톤 | 기한 | 티켓 | 상태 |
|---|---|---|---|---|
| M1 | Spec & Bench | 08-02 | 5 (T-101~103, 701~702) | 🔵 진행 중 |
| M2 | Core CLI | 08-09 | 8 (T-201~205, 301~303) | ⚪ 대기 |
| M3 | Agent Fabric | 08-16 | 8 (T-401~406, 501~502) | ⚪ 대기 |
| M4 | Org + v0.1.0 | 08-23 | 6 (T-601~602, 703~704, 801, 901) | ⚪ 대기 |

→ [GitHub 마일스톤](https://github.com/MongLong0214/lore/milestones) (진행률 바 자동)

## 티켓 현황

### M1 · Spec & Bench (08-02)
- 🔵 [T-101](https://github.com/MongLong0214/lore/issues/1) 스펙 문법·어휘·enum 정본 — 작성 중
- ⚪ [T-102](https://github.com/MongLong0214/lore/issues/2) JSON Schema + 픽스처 20 — T-101 대기
- ⚪ [T-103](https://github.com/MongLong0214/lore/issues/3) 라우트 계약 케이스 — T-101 대기
- 🔵 [T-701](https://github.com/MongLong0214/lore/issues/22) 벤치 하니스 골격 — 작성 중
- ⚪ [T-702](https://github.com/MongLong0214/lore/issues/23) **재제안율 첫 측정** ← M1 최대 관문

> ⚠️ T-702에서 Lore on/off 유의차가 안 나오면 프로젝트 방향 재검토(오너 에스컬레이션). 그래서 M1에 배치.

### M2 · Core CLI (08-09)
⚪ [T-201](https://github.com/MongLong0214/lore/issues/4) 파서 · [T-202](https://github.com/MongLong0214/lore/issues/5) validate+훅 · [T-203](https://github.com/MongLong0214/lore/issues/6) 인덱스 · [T-204](https://github.com/MongLong0214/lore/issues/7) 조회 4종 · [T-205](https://github.com/MongLong0214/lore/issues/8) stale
⚪ [T-301](https://github.com/MongLong0214/lore/issues/9) notes 미러 · [T-302](https://github.com/MongLong0214/lore/issues/10) squash 승계 · [T-303](https://github.com/MongLong0214/lore/issues/11) 리네임 회귀

### M3 · Agent Fabric (08-16)
⚪ [T-401](https://github.com/MongLong0214/lore/issues/12) MCP · [T-402](https://github.com/MongLong0214/lore/issues/13) 주입 훅 · [T-403](https://github.com/MongLong0214/lore/issues/14) 수확 · [T-404](https://github.com/MongLong0214/lore/issues/15) 검증자 · [T-405](https://github.com/MongLong0214/lore/issues/16) guard · [T-406](https://github.com/MongLong0214/lore/issues/17) 스킬
⚪ [T-501](https://github.com/MongLong0214/lore/issues/18) 등급·강등 · [T-502](https://github.com/MongLong0214/lore/issues/19) secret guard

### M4 · Org + 릴리스 (08-23)
⚪ [T-601](https://github.com/MongLong0214/lore/issues/20) PR lint Action · [T-602](https://github.com/MongLong0214/lore/issues/21) squash Action · [T-703](https://github.com/MongLong0214/lore/issues/24) 어블레이션 · [T-704](https://github.com/MongLong0214/lore/issues/25) 실측 리포트 · [T-801](https://github.com/MongLong0214/lore/issues/26) backfill(스트레치) · [T-901](https://github.com/MongLong0214/lore/issues/27) 릴리스

## 완료 기록

| 날짜 | 내용 |
|---|---|
| 07-26 | 레포 생성·공개 전환, ADR 7 + PRD 8 + 티켓 스펙 9, 마일스톤 5, 이슈 34, README 4개 언어 |

---

**범례**: 🔵 진행 중 · ⚪ 대기 · ✅ 완료 · 🔴 막힘
**폰에서 보기**: GitHub 앱 → `MongLong0214/lore` → 이 파일, 또는 Issues/Milestones 탭
