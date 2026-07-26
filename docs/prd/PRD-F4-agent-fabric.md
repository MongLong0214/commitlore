# PRD F4 — Agent Fabric (MCP · 주입 · 수확+검증자 · guard · skills)

- Milestone: M3 (08-16) · ADR: 0006

## 목표
pull을 push로 뒤집는다(D8) + 캡처를 공짜로 만든다(D5·Grudin 역전). 이 기능이 제품의 심장이다.

## 비목표
GCC류 세션 메모리 통합(Backlog), 임베딩 검색(Backlog).

## 사용자 스토리
- Claude Code 사용자로서, 파일을 열면 그 경로의 활성 제약 요약이 자동으로 컨텍스트에 도착한다 — 아무것도 기억할 필요 없다.
- 커밋 시 에이전트가 결정 맥락 초안을 만들고, 검증자가 근거 없는 원자를 버린 뒤, 나는 승인만 한다.
- 기각된 접근을 다시 제안하면 `lore guard`가 실행 전에 "abc1234에서 '경합 조건'으로 기각됨"을 보여준다.

## 요구사항
1. `lore mcp`: 리소스 `lore://context/<path>` + 조회 툴 세트 (stdio).
2. 주입 훅: Claude Code PreToolUse(Read|Edit|Write) → 경로 스코프 결정론적 프로젝션 주입. 예산 상한(기본 800 토큰 상당) + 등급 라우팅(ADR-0005) + 스테일 제외.
3. 자동 수확: Stop/커밋 직전 훅 → transcript에서 초안 trailer 생성(사용자의 기존 에이전트 세션 활용, 별도 API 비용 없음).
4. 수확 검증자: 각 trailer에 transcript/diff 근거 인용 필수, 인용 검증 실패 시 폐기. 유계 수리 ≤ 2회 후 원자 없이 커밋 + 로그.
5. `lore guard`: 제안 텍스트 ↔ 경로의 Rejected 원자 결정론적 매치(키워드+Constraint-Id) 경고.
6. 스킬 3종(commits/query/setup) 클린룸 재작성 — 내부는 전부 CLI 호출, 마케팅 문구 없음(D10).

## AC
- [ ] 훅 설치 후 파일 편집 시나리오에서 주입 발생·예산 준수·스테일 미주입 검증
- [ ] 수확→검증 파이프라인에서 근거 없는 조작 원자가 기계적으로 폐기되는 테스트
- [ ] guard가 기각 이력 재제안 시나리오에서 경고 발화(LoreBench 재제안율 지표와 동일 픽스처)
- [ ] 스킬 3종이 skills 디렉토리 규격으로 설치·동작
