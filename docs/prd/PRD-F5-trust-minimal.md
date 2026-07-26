# PRD F5 — Trust 최소분 (등급 · 강등 · secret guard)

- Milestone: M3 (08-16) · ADR: 0005

## 목표
저장소가 인젝션 벡터가 되지 않게 하는 최소 방어선(D7). 실서명 없이도 "미검증 지시는 명령이 아니라 주장"을 기계로 보장한다.

## 사용자 스토리
- 에이전트로서, 포크 PR 커밋의 `Warn:`를 지시가 아닌 "주장"으로 명시된 형태로만 받는다.
- 커밋 작성자로서, 토큰·자격증명이 결정 서술에 섞이면 pre-commit에서 차단된다.

## 요구사항
1. 등급 모델: provenance(authored|squashed-from|reconstructed|unknown) × lifecycle(active|superseded|expired) — 조회·주입 출력에 등급 필드 포함.
2. 강등 렌더: 주입·`--json` 출력에서 Directive를 `warn`(신뢰) vs `claim`(강등)으로 분리 필드화. 외부 기여는 무조건 claim.
3. 인젝션 휴리스틱: 명령형 우회 패턴 검출 시 주입 제외 + 경고 목록화.
4. secret guard: gitleaks 계열 패턴 서브셋(자격증명·토큰·내부 URL) pre-commit 스캔.

## AC
- [ ] 라우트 계약 테스트: "외부 기여 Warn → claim" 케이스 통과
- [ ] 인젝션 페이로드 픽스처(≥5종)가 주입 경로에서 전부 차단/강등
- [ ] secret 픽스처 커밋 시도 시 훅이 비정상 종료 코드로 차단
