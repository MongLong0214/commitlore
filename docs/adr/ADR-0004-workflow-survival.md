# ADR-0004: 워크플로우 생존 — squash 승계 + notes 미러 + --follow

- Status: Accepted (2026-07-26)

## Context

재현 실험으로 확인된 결함: squash-merge 시 trailer 블록이 파괴되어 `%(trailers)` 조회 불가(D3), 리네임 후 경로 조회 0건(D4). "영구 불변" 주장은 이 두 경로를 살아남지 못하면 거짓이다.

## Decision

1. **squash 승계**: `lore squash-preserve`가 병합 전 브랜치 커밋들의 trailer를 집계해 (a) 병합 커밋 메시지의 정식 trailer 블록으로 재기록하고 (b) 동시에 notes 미러에 원자 단위로 부착한다. GitHub Action(T-602)이 이를 PR 병합 시 자동 실행.
2. **notes 미러**: `refs/notes/lore`에 원자를 커밋 SHA 기준으로 미러링 — rebase/amend로 히스토리가 재작성돼도 원자가 생존하는 2차 채널.
3. **경로 추적**: 모든 경로 스코프 조회는 `--follow` 기본. 승계·미러에는 `Provenance:` trailer로 원본 커밋 SHA를 남긴다.

## Rejected

- 서버 측 보존(외부 DB) | ADR-0003 위반
- squash 금지 정책 강요 | 팀 워크플로우를 프로토콜이 강제할 수 없음 — 도구가 워크플로우에 적응해야 한다
- 커밋 메시지 재기록만(notes 없이) | rebase/amend 계열 재작성에는 무방비

## Consequences

- notes 공유를 위해 doctor의 refspec 자동 설정이 선행 조건(ADR-0003).
- 승계된 원자는 `Provenance: squashed-from <sha>`로 원본과 구분 — 신뢰 등급(ADR-0005) 입력이 된다.
