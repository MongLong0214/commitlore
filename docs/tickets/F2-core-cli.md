# F2 티켓 — Core CLI (M2)

> PRD: `docs/prd/PRD-F2-core-cli.md` · ADR: 0002, 0003
> 패키지 구조(정본):
> ```
> src/cli.ts            # commander 엔트리 (bin: commitlore)
> src/core/git.ts       # git 자식프로세스 래퍼 (interpret-trailers/log/notes)
> src/core/trailers.ts  # parse/serialize 왕복
> src/core/schema.ts    # ajv 로더 (spec/schema 사용)
> src/core/index-db.ts  # better-sqlite3 + 폴백
> src/core/query.ts     # 조회 4종 공용 엔진
> src/core/stale.ts     # 활성 집합 폴드
> src/core/doctor.ts
> test/                 # vitest, spec/fixtures·contract-cases 로드
> ```

---

## T-201 파서 모듈 (M) — #4 · 의존 T-102

**구현 개요**
- `trailers.ts`: `parseCommitMessage(msg): Trailer[]` — 내부에서 `git interpret-trailers --parse --no-divider` 호출(입력 stdin), 출력에 스키마 검증 적용. `serializeTrailers(trailers): string`(canonical 순서: 어휘표 순).
- `git.ts`: `execGit(args, {stdin})` 래퍼 — 실패 시 구조화 에러(코드·stderr).
- 금지: `--grep` 기반 판정, 자체 정규식 trailer 파싱(폴딩·경계는 git에 위임).

**테스트**: F1 픽스처 20 전수 + 왕복 동일성.
**AC**: 픽스처 전수 통과. 코드 내 `--grep` 0건(테스트로 grep 검사).

---

## T-202 commitlore validate + commit-msg 훅 (M) — #5 · 의존 T-201

**구현 개요**
- `commitlore validate [--message-file <f> | --commit <sha> | --range a..b]` — 위반을 `{line, rule, got, want}` JSON으로 출력(유계 수리 루프의 입력 형식), exit 1.
- `commitlore hooks install|uninstall` — `.git/hooks/commit-msg` 셸 스텁 생성(기존 훅 보존: 체이닝), 멱등.

**테스트**: invalid 픽스처 전수 차단 / valid 통과 / 훅 설치→커밋 시나리오(임시 저장소) / 이중 설치 멱등.
**AC**: PRD-F2 요구 3.

---

## T-203 SQLite 증분 인덱스 + 폴백 (L) — #6 · 의존 T-201

**구현 개요**
- 스키마: `trailers(id, commit_sha, key, value, path, committed_at, provenance, source)` + `meta(last_indexed_sha)` + FTS5(value).
- 증분: `git rev-list <last>..HEAD` 신규분만 `--format=%H%x00%(trailers)` 배치 파싱. 경로는 `--name-only` 결합.
- notes 기록(`refs/notes/commitlore`)도 source='notes'로 동일 테이블 수용(T-301 연동 지점 인터페이스만 선정의).
- `commitlore index [--rebuild]` / 조회 시 자동 증분 / `--no-index` 폴백(rev-list 직스캔, 동일 결과).
- 저장 위치 `.git/commitlore/index.db` (커밋 금지 — ADR-0003).

**테스트**: 합성 저장소 생성 스크립트(10만 커밋, 1% trailer) + 벤치(p50<100ms) / rebuild 동일성(전후 dump diff 0) / 폴백 결과 동일성.
**AC**: PRD-F2 요구 4 + AC 2·4.

---

## T-204 조회 명령 4종 (M) — #7 · 의존 T-203

**구현 개요**
- `commitlore context|limits|ruled-out|warnings [-- <path>] [--json] [--all-history]`
- 공용 엔진 `query.ts`: 경로 스코프(`--follow` 기본, 경로 미지정 시 저장소 전체 최근 N), stale 필터(T-205), 등급 필드 동봉(T-501 인터페이스 예약).
- `context`는 4종 통합 + 활성 요약 헤더.

**테스트**: D2 오탐 재현 케이스(산문 유사 trailer) 오탐 0 / D4 리네임 후 조회 성공 / `--json` 스키마 스냅샷.
**AC**: PRD-F2 AC 3.

---

## T-205 stale 엔진 v0 (M) — #8 · 의존 T-201

**구현 개요**
- `stale.ts`: 기록 스트림(시간순) → 폴드: Record-Id별 최신 상태, Supersedes 적용, Expires(날짜) 판정, 조건 서술은 활성+`review` 플래그.
- `commitlore stale [--json]`: 폐기·만료·리뷰 대상 목록.

**테스트**: `spec/contract-cases/stale-*.yaml` 직접 로드 실행(케이스 1~4).
**AC**: 계약 케이스 전수 통과.
