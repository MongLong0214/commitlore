# F1 티켓 — Protocol v2 스펙 + 적합성 스위트 (M1)

> PRD: `docs/prd/PRD-F1-protocol-spec.md` · ADR: 0001, 0005, 0006
> 저장소 배치: `spec/SPEC.md`, `spec/schema/record.schema.json`, `spec/fixtures/`, `spec/contract-cases/`

---

## T-101 SPEC.md: 문법 + 어휘 + enum 정본 (M) — #1

**목적**: 누가 구현해도 같은 동작이 나오는 단일 정본.

**구현 개요**
- `spec/SPEC.md` 구성: ①개요 ②문법(EBNF — git interpret-trailers 호환 서브셋, 멀티라인 폴딩 = 연속줄 선행 공백) ③어휘표 ④enum 정본 ⑤확장(`X-`) ⑥소비자 라우트 표 ⑦버저닝(`CommitLore-Version: 2.0`).
- 어휘 16종과 값 문법:
  - 결정 맥락: `Limit` `Ruled-out`(`alt | reason` 필수) `Warn` `Certainty`(firm|tentative|guess) `Blast`(local|module|system) `Undo`(easy|costly|permanent) `Verified` `Unverified` `Follows`(Record-Id 참조)
  - 신원·수명·근거: `CommitLore-Version`(semver) `Record-Id`(`r-[a-z0-9]{6,}`) `Supersedes`(Record-Id) `Expires`(`YYYY-MM-DD | 조건서술`) `Evidence`(경로#앵커 또는 URL) `Provenance`(authored|inherited <sha>|reconstructed|unknown)
- **소비자 라우트 표(죽은 필드 금지)**: 어휘마다 {소비 라우트, 산출 행동} 1개 이상 명기. 예: `Blast=system ∧ Undo=permanent → 승인 게이트 라우팅(F5/F6)`, `Ruled-out → commitlore guard 매치(F4)`, `Supersedes/Expires → stale 폴드(F2)`.

**세부 작업**
- [ ] EBNF 초안 → `git interpret-trailers --parse` 실동작과 대조(경계: 콜론 뒤 공백, 폴딩, 중복 키)
- [ ] enum 값이 행동을 지시하는 단어인지 확인(ADR-0008 설계 결정 3)
- [ ] 라우트 표 작성 + 소비자 없는 어휘 0 확인

**테스트/검증**: SPEC 예제 블록 전부를 T-102 픽스처에 수록해 기계 검증되게 함.
**AC**: PRD-F1 요구 1~4. 어휘표 라우트 열 빈 칸 0.

---

## T-102 JSON Schema + 파서 왕복 픽스처 (M) — #2 · 의존 T-101

**목적**: 스펙의 기계 검증 형태.

**구현 개요**
- `spec/schema/record.schema.json` — 기록(파싱된 trailer 집합) 스키마. draft 2020-12.
- `spec/fixtures/valid/*.txt`(10) `boundary/*.txt`(5) `invalid/*.txt`(5) + 기대 JSON `*.expected.json`.
- 필수 케이스: 멀티라인 Warn 폴딩 / 반복 Limit / `Ruled-out` 파이프 규칙 / 본문 산문 내 유사 trailer(비-trailer 판정, D2) / D1 드리프트 어휘(`wide`,`migration-needed`) 거부 / `Certainty: yes` 거부 / X- 확장 통과.
- 왕복 규약: parse→canonical serialize→parse 결과 동일(JSON 비교).

**AC**: 픽스처 20개, `ajv` CLI로 스키마 검증 통과 스크립트(`spec/verify.sh`) 포함.

---

## T-103 라우트 계약 테스트 케이스 정의 (S) — #3 · 의존 T-101

**목적**: 구현체 간 동작 동등성을 문서가 아니라 케이스로 보증.

**구현 개요**
- `spec/contract-cases/*.yaml` — `{given: [기록들], when: <라우트>, expect: <산출>}` 형식.
- 케이스 8+:
  1. stale: Supersedes로 폐기된 제약 비활성
  2. stale: Expires(날짜) 경과 비활성
  3. stale: 조건 서술 Expires는 활성 유지 + 플래그
  4. stale: 동일 Record-Id 최신 우선
  5. 강등: `Provenance: unknown`의 Warn → claim
  6. 강등: 외부 기여 커밋 Warn → claim (신뢰 committer여도)
  7. 라우팅: `Blast: broad ∧ Undo: difficult` → `needs-approval` 플래그
  8. 라우팅: reconstructed 기록는 주입 시 항상 claim

**AC**: F2(T-205)·F5(T-501)가 이 YAML을 직접 로드해 테스트로 실행 가능한 구조.
