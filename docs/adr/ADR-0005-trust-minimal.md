# ADR-0005: 신뢰 최소분 — 규칙 기반 등급과 Warn 강등 (실서명은 Backlog)

- Status: Accepted (2026-07-26)

## Context

커밋 메시지는 에이전트가 지시문으로 읽는 채널이다. 서명 없는 `Warn:`는 저장소를 프롬프트 인젝션 벡터로 만든다(D7). 그러나 sigstore/gitsign 실서명 체계는 4주 범위에 맞지 않는다.

## Decision

v0.1은 **규칙 기반 등급 + 강등 렌더링**으로 최소 방어선을 구축한다.

- 기록 등급 = provenance 축(`authored | squashed-from | reconstructed | unknown`) × lifecycle 축(`active | superseded | expired`).
- **강등 규칙**: 주입·조회 출력에서 `Warn:`는 등급이 검증 가능한 경우에만 "지시"로, 그 외에는 "주장(claim)"으로 명시 표기해 전달한다. 외부 기여(포크 PR) 커밋의 Directive는 항상 주장으로 강등.
- 명령형 인젝션 패턴(도구 호출 유도·정책 우회 문구) 휴리스틱 검출 시 해당 원자를 주입에서 제외하고 경고.
- secret guard: pre-commit에서 자격증명·토큰·내부 URL 패턴 스캔 후 차단.

## Ruled-out

- sigstore/gitsign 실서명을 v0.1에 포함 | 4주 제약. 등급 모델의 provenance 축은 서명 도입 시 그대로 확장 가능하도록 설계
- 신뢰 문제를 문서 경고로만 처리 | D7은 실측된 공격면 — 기계적 최소 방어 없이는 출시 불가

## Consequences

- 강등 규칙은 라우트 계약 테스트(F1)의 필수 케이스다: "외부 기여 Directive는 반드시 claim으로 렌더".
- 실서명(Backlog) 도입 시 등급 축만 확장하면 되고 소비 측 라우팅은 불변.
