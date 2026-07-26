# F5 티켓 — Trust 최소분 (M3)

> PRD: `docs/prd/PRD-F5-trust-minimal.md` · ADR: 0005
> 모듈: `src/core/grade.ts`, `src/hooks/secret-guard.ts`

---

## T-501 등급 모델 + Directive 강등 + 인젝션 휴리스틱 (M) — #18 · 의존 T-205

**구현 개요**
- `grade.ts`: 원자 → `{provenance, lifecycle, trust: 'directive'|'claim'|'blocked'}`.
  - provenance: trailer의 `Provenance:` + 커밋 메타(작성자·병합 경로). 외부 기여 판정: 커밋 author가 저장소 push 권한자 목록 외(로컬에서는 `--trusted-authors` 설정, Action에서는 GitHub API) → 무조건 claim.
  - reconstructed/unknown → 항상 claim.
- 인젝션 휴리스틱: Directive 값에서 도구 호출 유도·정책 우회·권한 상승 패턴(픽스처 5종 기반 규칙) → `blocked`(주입 제외 + 경고 목록).
- 조회·주입 출력 스키마에 등급 필드 정식 포함(T-204/T-402 인터페이스 확정판).

**테스트**: `spec/contract-cases/` 강등 케이스(5~8) 직접 실행 / 인젝션 픽스처 5종 blocked / trusted-authors 경계.
**AC**: PRD-F5 AC 1·2.

---

## T-502 secret guard (S) — #19 · 의존 T-202

**구현 개요**
- commit-msg 훅 체인에 편입: 메시지(trailer 포함) 대상 자격증명·토큰·개인키·내부 URL 패턴 스캔(gitleaks 규칙 서브셋 이식, 정규식 테이블 `src/hooks/secret-rules.ts`).
- 차단 시 어떤 규칙에 걸렸는지 + 우회 플래그(`--no-verify` 안내는 하지 않음) 출력.

**테스트**: secret 픽스처(AWS 키·GitHub 토큰·사설 URL 등 6종) 차단 / 정상 커밋 통과 / 오탐 흔한 케이스(예: `token` 단어만) 통과.
**AC**: PRD-F5 AC 3.
