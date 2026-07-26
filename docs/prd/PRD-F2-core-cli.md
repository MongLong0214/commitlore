# PRD F2 — Core CLI (parse / validate / query / index / stale)

- Milestone: M2 (08-09) · ADR: 0002, 0003

## 목표
논문이 명세만 한 CLI를 실제로 배달한다. 오탐 0(D2), 전 히스토리 조회, 형식 오류의 기계 거부(D5), 제약 라이프사이클(D6).

## 비목표
coverage 명령(Backlog), 인터랙티브 commit 빌더(Backlog — `commitlore commit --from-json`은 포함).

## 사용자 스토리
- 에이전트로서, `commitlore context src/auth/`로 그 경로의 활성 결정사를 1초 안에 받는다.
- CI로서, `commitlore validate` 비정상 종료 코드로 기형 trailer 커밋을 거부한다.

## 요구사항
1. 파서: `git interpret-trailers --parse` 위임 + 스키마 검증. `--grep` 스캔 금지.
2. 조회: `context | limits | ruled-out | warnings` — 경로 스코프, `--follow` 기본, `--json` 출력.
3. `validate`: enum·형식·근거 규칙 검사, 위반 상세 출력(유계 수리 루프의 입력), commit-msg 훅 설치 서브커맨드.
4. 인덱스: SQLite 증분(신규 커밋만 스캔), 손상 시 `--rebuild`, 부재 시 무인덱스 폴백.
5. `stale`: Supersedes/Expires 기반 활성 집합 계산.
6. `doctor`: notes refspec·훅 설치 상태 점검/자동 구성.

## AC
- [ ] F1 적합성 스위트 + 라우트 계약 테스트 전부 통과
- [ ] 10만 커밋 합성 저장소에서 경로 조회 p50 < 100ms (인덱스 on)
- [ ] D2 오탐 재현 케이스에서 오탐 0 · D4 리네임 케이스에서 조회 성공
- [ ] `--no-index` 폴백 동작 (기능 동일, 속도만 저하)
