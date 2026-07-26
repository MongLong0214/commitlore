# Tickets — v0.1.0 (기한 2026-08-23)

> 형식: ID · 제목 · (사이즈) · 의존성. 상세 AC는 각 항목 아래. 마일스톤·에픽은 GitHub Issues와 1:1.

## F1 · Protocol v2 스펙 — M1

### T-101 SPEC.md: 문법 + 어휘 + enum 정본 (M) — 의존 없음
EBNF, trailer 어휘 16종(v1 9 + v2 7), enum 정본, 멀티라인 폴딩, `X-` 네임스페이스, **어휘별 소비자 라우트 표**(죽은 필드 금지).
AC: PRD-F1 요구 1·2·3·4 충족. 어휘표 라우트 열 빈 칸 0.

### T-102 JSON Schema + 파서 왕복 픽스처 (M) — T-101
스키마 1본 + 픽스처 20개(정상 10·경계 5·거부 5), 왕복(parse→serialize→parse) 동일성 규약.
AC: 픽스처가 스키마로 기계 검증됨. 거부 픽스처에 D1 드리프트 어휘(`wide`, `migration-needed`) 포함.

### T-103 라우트 계약 테스트 케이스 정의 (S) — T-101
stale 판정 4케이스, Directive 강등 2케이스(외부 기여 포함), 승인 라우팅 2케이스 — 입력 원자 집합과 기대 출력의 표.
AC: 케이스 ≥ 8, F2/F5 구현이 이 표를 테스트 코드로 옮길 수 있는 수준의 구체성.

## F2 · Core CLI — M2

### T-201 파서 모듈 (M) — T-102
`git interpret-trailers --parse` 위임 + 스키마 검증 + 왕복 직렬화.
AC: F1 픽스처 전수 통과. `--grep` 미사용.

### T-202 lore validate + commit-msg 훅 (M) — T-201
위반 상세 출력(수리 루프 입력 형식), 비정상 종료 코드, `lore hooks install`.
AC: 거부 픽스처 전수 차단. 훅 설치·해제 멱등.

### T-203 SQLite 증분 인덱스 + 폴백 (L) — T-201
`.git/lore/index.db`, rev-list 증분, `--rebuild`, `--no-index` 폴백.
AC: 합성 10만 커밋 p50 < 100ms. 인덱스 삭제 후 rebuild 결과 동일성. 폴백 기능 동일.

### T-204 조회 명령 4종 (M) — T-203
`context|constraints|rejected|directives`, 경로 스코프, `--follow` 기본, `--json`.
AC: D2 오탐 0 · D4 리네임 조회 성공 재현 케이스 통과.

### T-205 stale 엔진 v0 (M) — T-201
Supersedes/Expires 폴드로 활성 집합 계산, `lore stale` 출력.
AC: T-103 stale 계약 케이스 전수 통과.

## F3 · 워크플로우 생존 — M2

### T-301 notes 미러 모듈 + doctor refspec (M) — T-201
`refs/notes/lore` 읽기/쓰기, 조회 경로에 notes 병합, `lore doctor`의 fetch refspec 자동 구성.
AC: PRD-F3 AC 3(clone→doctor→왕복 동기화).

### T-302 lore squash-preserve (L) — T-301
집계→병합 커밋 trailer 재기록 + notes 부착, Constraint-Id/해시 dedupe, `Provenance: squashed-from`.
AC: D3 재현 시나리오에서 병합 후 조회 성공. rebase 재작성 후 notes 경유 생존.

### T-303 --follow 정확도 검증 (S) — T-204
리네임 체인(2단) 픽스처, 경로 이력 조회 회귀 테스트.
AC: D4 케이스 + 2단 리네임 통과.

## F4 · Agent Fabric — M3

### T-401 lore-mcp 서버 (M) — T-204
stdio MCP: 리소스 `lore://context/<path>` + 조회 툴. 
AC: MCP Inspector로 리소스·툴 왕복 검증.

### T-402 주입 훅 (M) — T-204, T-501
PreToolUse(Read|Edit|Write) → 결정론적 프로젝션 주입, 예산 상한, 등급 라우팅, 스테일 제외.
AC: PRD-F4 AC 1. 동일 입력 → 바이트 동일 프로젝션(결정론).

### T-403 자동 수확 초안 (L) — T-201
transcript → trailer 초안(사용자 세션 내 실행), 커밋 직전 훅 연결.
AC: 데모 세션에서 초안 생성. LLM 미가용 시 조용히 스킵(차단 없음).

### T-404 수확 검증자 (M) — T-403
근거 인용 기계 검증, fail-explicit 폐기, 유계 수리 ≤ 2회.
AC: 조작 원자(근거 없는 Constraint) 폐기 테스트. PRD-F4 AC 2.

### T-405 lore guard (M) — T-204
제안 텍스트 ↔ 경로 Rejected 원자 결정론적 매치 경고.
AC: 재제안 픽스처(F7과 공유)에서 경고 발화, 무관 제안 오탐 < 1/10.

### T-406 스킬 3종 클린룸 재작성 (S) — T-204
commits/query/setup — 내부 전부 CLI 호출, 마케팅 문구 0.
AC: skills 규격 설치·동작. 원 레포 텍스트 미사용(클린룸).

## F5 · Trust 최소분 — M3

### T-501 등급 모델 + Directive 강등 (M) — T-205
provenance×lifecycle 등급 필드, 주입·JSON 출력의 directive/claim 분리, 외부 기여 무조건 강등, 인젝션 휴리스틱 제외 목록.
AC: T-103 강등 계약 케이스 + 인젝션 픽스처 5종 차단/강등.

### T-502 secret guard (S) — T-202
pre-commit 스캔(자격증명·토큰·내부 URL 패턴 서브셋).
AC: secret 픽스처 차단, 정상 커밋 통과.

## F6 · Org Action — M4

### T-601 Action: PR lint + 활성 제약 코멘트 (M) — T-202, T-204
validate 결과 + 대상 경로 활성 제약 요약을 PR 코멘트로. 외부 전송 0.
AC: PRD-F6 AC 검증 로그.

### T-602 Action: squash 승계 자동화 (M) — T-302, T-601
병합 이벤트 → squash-preserve + notes push.
AC: 데모 저장소 E2E(PR→코멘트→squash→main 조회) 1회 로그.

## F7 · LoreBench — M1 / M4

### T-701 하니스 골격 (M) — 의존 없음 [M1]
on/off 러너, 세션 격리, JSONL 결과, seed 고정, 이중 정지.
AC: 더미 과제 3개 왕복 실행.

### T-702 재제안율 지표 + 첫 측정 (M) — T-701 [M1]
재조우 과제 10개, 재제안율 산출 + 유의성 검정.
AC: PRD-F7 AC 1. **유의차 부재 시 즉시 오너 에스컬레이션(ADR-0001).**

### T-703 어블레이션 lite + CPAA (M) — T-702, T-402 [M4]
스코프/등급/라이프사이클 제거 3조건 + CPAA 산출.
AC: PRD-F7 AC 2.

### T-704 실측 리포트 + README 갱신 (S) — T-703 [M4]
AC: README 수치 전부 하니스 로그로 재현 가능.

## F8 · Backfill MVP — M4 (스트레치)

### T-801 backfill MVP (L) — T-301, T-404
커밋(+PR 옵트인) → 재구성 원자(notes, `Provenance: reconstructed`), 검증자 필수, 이중 정지.
AC: PRD-F8 AC. 릴리스 비차단.

## 릴리스 — M4

### T-901 v0.1.0 릴리스 (S) — T-601, T-704
npm publish, 태그, 릴리스 노트(실측 수치), 공개 전환 체크리스트(오너 승인 후 `gh repo edit --visibility public`), skills.sh 등록.
AC: `npx lore --version` 동작. 공개 전환은 오너 승인 게이트.

---

## Backlog (post-v0.1, 마일스톤 Backlog)

- B-01 sigstore/gitsign 실서명 신뢰 등급 (ADR-0005 확장)
- B-02 조직 결정 그래프 (cross-repo, CI 정적 생성)
- B-03 CI 정적 대시보드 (결정 부채·Not-tested 백로그·Confidence 추이)
- B-04 임베딩 검색 옵션 계층
- B-05 `lore coverage` 명령
- B-06 `Anchor:` 심볼 수준 앵커링
- B-07 인터랙티브 `lore commit` 빌더 · Expires 자동 알림
