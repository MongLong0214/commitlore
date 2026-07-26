# F3 티켓 — 워크플로우 생존 (M2)

> PRD: `docs/prd/PRD-F3-workflow-survival.md` · ADR: 0004
> 모듈: `src/core/notes.ts`, `src/core/squash.ts` (+ doctor 확장)

---

## T-301 notes 미러 모듈 + doctor refspec (M) — #9 · 의존 T-201

**구현 개요**
- `notes.ts`: `writeRecord(sha, trailers)` / `readRecord(sha)` — `git notes --ref=commitlore add|show`, 기록 직렬화는 T-201 canonical 포맷 재사용.
- 조회 엔진(T-204)에 notes 소스 병합(커밋 trailer와 dedupe — Record-Id 또는 내용 해시).
- `commitlore doctor`: ①notes fetch refspec(`+refs/notes/commitlore:refs/notes/commitlore`) 점검·자동 추가 ②push 안내 ③훅 설치 상태 ④인덱스 건강.

**테스트**: 임시 원격(bare repo)으로 clone A/B 왕복 — A 기록→push→B doctor→fetch→조회 성공.
**AC**: PRD-F3 AC 3.

---

## T-302 commitlore squash-preserve (L) — #10 · 의존 T-301

**구현 개요**
- `commitlore squash-preserve <base>..<head> [--target <merge-sha>|--message-file <f>]`
  1. 범위 커밋들의 기록 수집(T-201) → Record-Id/내용 해시 dedupe → 충돌(같은 Id 상반 값) 시 최신 우선 + 경고
  2. `--message-file`: 병합 커밋 메시지 초안에 정식 trailer 블록 재기록(로컬 squash·GitHub 병합 메시지 편집 모두 지원)
  3. `--target`: 병합 커밋 SHA의 notes에 기록 부착(`Provenance: inherited <원본sha>` 개별 표기)
- Action(T-602)에서 재사용할 수 있게 코어 로직은 함수로 분리.

**테스트**: D3 재현 스크립트를 그대로 테스트화 — squash 후 `constraints -- <path>` 성공 / `rebase -i` 재작성 후 notes 경유 생존 / dedupe·충돌 케이스.
**AC**: PRD-F3 AC 1·2.

---

## T-303 --follow 정확도 회귀 (S) — #11 · 의존 T-204

**구현 개요**: 리네임 체인 픽스처 저장소(a.ts→b.ts→c/d.ts 2단), 조회 회귀 테스트 고정.
**AC**: D4 단일 + 2단 리네임 모두 기록 도달. `--follow` 미지원 경로(다중 경로 인자) 시 명시 경고.
