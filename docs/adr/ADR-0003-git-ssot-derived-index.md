# ADR-0003: git = SSOT, 그 외 전부 파생물

- Status: Accepted (2026-07-26, 오너 확인 "git 이력을 SSOT로")

## Context

지식 원자의 진실 저장소를 어디에 둘 것인가. 오너 원칙: DB 없음, 서버 없음, 사용자 비용 0.

## Decision

- **진실 집합 = {커밋 trailer, git notes(`refs/notes/annals`)}** — 전부 git 객체. clone과 함께 이동하고 서버 소멸 시에도 무손실.
- SQLite 인덱스(L1)는 **재생성 가능한 파생 캐시**: `annals index --rebuild` 한 줄로 전체 재구축. 인덱스 파일은 `.git/annals/index.db`에 두고 커밋하지 않는다.
- 조직 뷰(그래프·대시보드)는 CI 정적 산출물 — v0.1 범위 밖(Backlog).
- 승인 대기 등 durable 상태는 자체 저장소를 만들지 않고 GitHub PR(라벨·체크·코멘트)을 상태 머신으로 사용, 결과는 병합 커밋 trailer/notes로 재각인.

## Ruled-out

- 자체 DB/서버에 기록 적재 | SSOT 이중화 → 동기화·부패 문제 재발(ADR/위키·ProjectMem의 실패 지점), 비용 0 원칙 위반
- 인덱스를 저장소에 커밋 | 머지 충돌 유발, 파생물은 커밋하지 않는 게 원칙

## Consequences

- `annals doctor`가 notes fetch refspec(`+refs/notes/annals:refs/notes/annals`) 설정을 점검·자동 구성해야 한다 (git notes는 기본 fetch 대상이 아님 — T-301).
- 인덱스 손상은 장애가 아니라 재빌드 사유다. 모든 조회 명령은 인덱스 부재 시 폴백 경로를 가진다.
