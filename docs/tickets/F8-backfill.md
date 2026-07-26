# F8 티켓 — Backfill MVP (M4 · 스트레치)

> PRD: `docs/prd/PRD-F8-backfill-mvp.md` · ADR: 0006 · **릴리스 비차단**

---

## T-801 backfill MVP (L) — #26 · 의존 T-301, T-404

**구현 개요**
- `lore backfill [--limit N] [--with-prs] [--budget-tokens N]`
  1. 대상: trailer 없는 최근 N 커밋(+`--with-prs`: gh CLI로 연결 PR 본문 수집, 옵트인)
  2. 재구성: 사용자 세션 위임 프롬프트로 커밋/PR 텍스트에서 원자 초안 → **T-404 검증자 필수 통과**(근거 = 원문 인용) → notes 부착, 전부 `Provenance: reconstructed`
  3. 무LLM 모드: LLM 미가용 시 trailer 이미 있는 과거 커밋 인덱싱만 수행(그것도 가치)
  4. 이중 정지: 신규 원자 0인 배치 2연속(수렴) 또는 `--limit`/`--budget-tokens` 캡. 재구성 실패 커밋은 스킵+로그, **날조 금지**
- 병렬 실행 없음(v0.1 단순화 — 순차 배치).

**테스트**: 자체 레포 대상 1회 실행 로그(재구성 ≥10, 전수 Provenance 표기, 검증 통과율) / 예산 캡 강제 종료 / 무LLM 모드.
**AC**: PRD-F8 AC 1·2. 실패 시 v0.1.0 릴리스는 그대로 진행(스트레치).
