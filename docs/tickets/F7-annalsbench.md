# F7 티켓 — AnnalsBench (M1 골격·측정 / M4 어블레이션·리포트)

> PRD: `docs/prd/PRD-F7-annalsbench.md` · ADR: 0007
> 배치: `bench/runner.ts`, `bench/tasks/*.yaml`, `bench/metrics.ts`, `bench/report.ts`, 결과 `bench/results/*.jsonl`(커밋)

---

## T-701 하니스 골격 (M) — #22 · 의존 없음 [M1]

**구현 개요**
- `bench/runner.ts`: 과제 시퀀스 러너. 조건 = `annals-on | annals-off`(+M4에서 어블레이션 3조건). 과제마다 격리 워크스페이스(임시 clone), 세션 간 상태 공유는 annals 채널만.
- 과제 정의 `bench/tasks/*.yaml`: `{repo, setup(선행 커밋·기각 이력 주입), prompt, detect(재제안 판정 규칙: 금지 접근의 시그니처 문자열/AST 패턴), budget{turns, tokens}}`.
- 이중 정지: 과제당 시도 상한 + 총 토큰 캡. seed 고정, 결과 JSONL(`{task, cond, reproposed, violations, turns, tokens}`).
- 에이전트 드라이버: Claude Code headless(`claude -p`) 1종만 v0.1 지원.

**테스트**: 더미 과제 3개 on/off 왕복, JSONL 스키마 검증.
**AC**: PRD-F7 요구 1·5.

---

## T-702 재제안율 지표 + 첫 유의차 측정 (M) — #23 · 의존 T-701 [M1]

**구현 개요**
- 과제 10개 작성: "기각 이력이 있는 결정 지점 재조우" — 자체 레포 + 공개 저장소 1곳 포팅. 각 과제의 `detect` 규칙은 기계 판정(문자열/구조 매치)이어야 함 — 주관 채점 금지.
- `metrics.ts`: 재제안율 = 재제안 발생 과제 / 전체, 조건 간 차이 검정(Fisher exact — n 작음), 제약위반율·수렴시간은 계측만.
- 실행: on/off × 10과제 × 3반복(seed 변경) = 60런.

**AC**: 유의성 검정 1회 완료·수치 기록. **유의차 부재 시 즉시 오너 에스컬레이션(ADR-0001) — 결과와 무관하게 로그 커밋.**

---

## T-703 어블레이션 lite + CPAA (M) — #24 · 의존 T-702, T-402 [M4]

**구현 개요**
- 조건 3: `no-scope`(전역 덤프 주입) / `no-grade`(강등 미적용) / `no-lifecycle`(스테일 미필터) — T-402 주입기에 조건 플래그로 구현.
- CPAA = (수확+검증 토큰 합) / 수용 기록 수 — 하니스 계측에서 산출.

**AC**: 3조건 × 10과제 결과 JSONL + 조건별 재제안율·위반율 표. CTIM-Rover 노이즈 가설 방향 판정 서술.

---

## T-704 실측 리포트 + README 갱신 (S) — #25 · 의존 T-703 [M4]

**구현 개요**: `bench/report.ts` — JSONL → 마크다운 표. README "Measured results" 섹션은 이 산출물만 붙인다(수기 수치 금지, CI에서 재생성 검증).
**AC**: README 수치 전부 `bench/results/` 로그로 재현. seed 고정 재실행 일치.
