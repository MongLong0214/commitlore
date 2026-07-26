# F4 티켓 — Agent Fabric (M3)

> PRD: `docs/prd/PRD-F4-agent-fabric.md` · ADR: 0006
> 모듈: `src/mcp/server.ts`, `src/hooks/{inject,harvest,verify,guard}.ts`, `skills/`

---

## T-401 lore-mcp 서버 (M) — #12 · 의존 T-204

**구현 개요**
- `lore mcp` 서브커맨드 = stdio MCP 서버 (`@modelcontextprotocol/sdk`).
- 리소스: `lore://context/<path>` → T-204 context의 `--json` 결과.
- 툴: `lore_query(kind, path?)`, `lore_stale()`, `lore_guard(proposal, path)`.
- 네트워크 0, 저장소 루트는 프로세스 cwd 기준.

**테스트**: MCP Inspector 수동 왕복 + 자동: JSON-RPC 스텁으로 리소스/툴 호출 스냅샷.
**AC**: PRD-F4 요구 1.

---

## T-402 주입 훅 (M) — #13 · 의존 T-204, T-501

**구현 개요**
- `lore inject --path <p> [--budget <tok>]` — 결정론적 프로젝션: 활성 원자 폴드 → 고정 템플릿 요약(등급 라우팅: directive/claim/보류, 스테일 제외) → 예산 초과 시 우선순위 절단(Directive > Constraint > Rejected > 기타).
- Claude Code 연동: `lore hooks install --claude` 가 settings의 PreToolUse(Read|Edit|Write) 훅 항목을 생성(경로 추출 → inject 호출, 출력은 additionalContext).
- **결정론 보장**: LLM 호출 0, 동일 입력 → 바이트 동일 출력(캐시 키 = HEAD sha + path).

**테스트**: 동일성(2회 실행 diff 0) / 예산 절단 우선순위 / 스테일·차단 원자 미포함 / 훅 설치 멱등.
**AC**: PRD-F4 AC 1.

---

## T-403 자동 수확 초안 (L) — #14 · 의존 T-201

**구현 개요**
- `lore harvest --transcript <f> --diff <f> [--out <f>]` — transcript+diff에서 초안 원자 생성.
- 실행 주체: **사용자의 기존 에이전트 세션**(스킬/훅이 현재 세션의 모델에게 위임하는 프롬프트 계약). CLI 자체는 LLM 키를 갖지 않는다 — LLM 미가용 시 조용히 스킵(exit 0, 빈 출력).
- 초안 형식: 각 원자에 `evidence` 필드(transcript 줄 범위/diff hunk 인용) 필수 동봉 → T-404 입력.
- 커밋 직전 연결: `lore hooks install --claude`가 Stop/PreCompact 대신 **커밋 시점 스킬**(lore-commits 재작성판)에서 호출되는 구조로 단순화.

**테스트**: 고정 transcript 픽스처 → 초안 산출 계약(필드 존재·evidence 포함) / LLM 미가용 스킵 경로.
**AC**: PRD-F4 AC(수확 파이프라인) 전제 충족.

---

## T-404 수확 검증자 (M) — #15 · 의존 T-403

**구현 개요**
- `lore harvest-verify --draft <f> --transcript <f> --diff <f>` — **기계 검증**: ①evidence 인용이 실제 원문에 존재(문자열/해시 대조) ②Rejected는 기각 문맥 마커 검사 ③enum 유효(T-202 재사용). 실패 원자 폐기 + 사유 로그.
- 유계 수리: 실패 사유를 초안 생성기에 되먹임 ≤ 2회 → 최종 실패 시 원자 없이 진행(로그만, 커밋 비차단).
- maker-checker 분리: verify는 LLM 무관 결정론 검사가 1차, (옵트인) 세션 내 적대 검증 프롬프트가 2차.

**테스트**: 조작 원자(존재하지 않는 인용) 폐기 / 수리 루프 종결 / 전량 실패 시 비차단.
**AC**: PRD-F4 AC 2.

---

## T-405 lore guard (M) — #16 · 의존 T-204

**구현 개요**
- `lore guard --proposal <텍스트|파일> -- <path>` — 해당 경로 Rejected 원자와 결정론적 매치(정규화 토큰 자카드 + Constraint-Id/키워드 명중), 임계 초과 시 `{matched, sha, reason}` 경고 출력, exit 2(경고 전용 코드).
- PreToolUse 훅 모드: Edit 제안 텍스트에 적용.

**테스트**: F7 재조우 픽스처 공유 — 명중 시나리오 발화 / 무관 제안 10건 중 오탐 <1.
**AC**: PRD-F4 AC 3.

---

## T-406 스킬 3종 클린룸 재작성 (S) — #17 · 의존 T-204

**구현 개요**
- `skills/lore-commits|lore-query|lore-setup/SKILL.md` — **원 레포 텍스트 미사용(클린룸)**, 내부 동작은 전부 CLI 호출(`lore validate/context/harvest`), 스타 유도 등 마케팅 문구 0(D10).
- lore-commits는 수확 파이프라인(T-403→404) 사용 절차 포함.

**테스트**: `npx skills add`(로컬 경로) 설치 → Claude Code에서 3종 발동 스모크.
**AC**: PRD-F4 AC 4.
