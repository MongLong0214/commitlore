# ADR-0009: 프로토콜 명칭을 CommitLore로 확정

- Status: Accepted (2026-07-26, 오너 결정)
- Owner: CTO
- Supersedes: ADR-0008 §1 (명칭 `Annals`). ADR-0008의 어휘 결정(§2)은 **그대로 유효하다**.

## Context

`Annals`는 영어 발음·표기에서 원치 않는 연상을 일으킨다. 오너가 이를 문제로 제기했고, 프로젝트의 얼굴이 되는 이름으로는 실격이다. 어감 문제는 기능으로 상쇄되지 않는다 — 사람들이 입에 올리기를 꺼리는 이름은 채택률을 직접 깎는다.

오너의 최초 지시는 `GitLore`였다. 확인 결과 **npm `gitlore`가 선점돼 있고, 스쿼팅이 아니라 활성 패키지였다**:

- `gitlore@1.5.0` · 최초 공개 2026-03-15 · 최종 갱신 2026-04-14 · `nebulord-dev/gitlore`
- 설명: "Git archaeology CLI — surface churn, bus factor, hotspots, and cursed files from your repo's git history"

즉 **같은 도메인(git 히스토리를 읽는 CLI)의 살아 있는 도구와 이름이 겹친다.** 이는 ADR-0008이 `menhir`를 배제했던 것과 같은 유형의 충돌이며, npm 패키지명을 `git-lore`로 비껴가더라도 CLI 바이너리 `gitlore`가 PATH에서 충돌하고 검색 결과에서 계속 섞인다.

여기서 별도로 기록해 둘 사실이 하나 있다: `Lore`는 이 저장소의 **이전 명칭**이었고, ADR-0008이 오리지널리티 확보를 위해 걷어냈다(커밋 `ef48843`). 오너는 이 사실을 고지받은 뒤 `lore` 계열 어감을 유지하기로 결정했다. ADR-0008이 문제 삼은 것은 *선행 자료의 명칭·어휘를 계승한 상태*였고, 어휘 재유도(§2)로 그 문제는 이미 해소됐다. 어간 하나가 남는 것과 체계 전체를 물려받는 것은 다르다.

## Decision

### 1. 명칭: **CommitLore**

| 항목 | 값 | 상태 |
|---|---|---|
| npm 패키지 | `commitlore` | 미선점 (실측 404) |
| CLI 바이너리 | `commitlore` | PATH 충돌 없음 |
| GitHub 저장소 | `MongLong0214/commitlore` | 미선점 (실측 404) |
| 버전 트레일러 | `CommitLore-Version:` | — |
| notes 참조 | `refs/notes/commitlore` | — |
| 파생 인덱스 | `.git/commitlore/index.db` | — |

`commit` + `lore` = 커밋에 축적되는 구전 지식. 프로토콜의 정의 그 자체이고, 지식 단위가 커밋 단위라는 설계 사실이 이름에 그대로 들어간다.

지식 단위 명칭은 **record**로 유지한다(ADR-0008 §1). 커밋 하나가 record 하나를 남긴다.

### 2. 어휘는 건드리지 않는다

`Limit` `Ruled-out` `Warn` `Blast` `Undo` `Certainty` `Verified` `Unverified` `Follows` `Record-Id` `Supersedes` `Expires` `Evidence` `Provenance` `X-*` — 전부 ADR-0008 그대로다. 값 enum도 그대로다.

바뀌는 트레일러는 `Annals-Version:` → `CommitLore-Version:` **하나뿐**이며, 이는 어휘 변경이 아니라 명칭 파생이다. 소비자 라우트 표(SPEC §5)는 명령어 접두사만 바뀐다: `annals limits` → `commitlore limits`, `annals guard` → `commitlore guard`.

### 3. 개명 범위: 전면

문서(README 4개 언어 · ADR 9 · PRD 8 · 티켓 9) · 스펙(`spec/SPEC.md` · 스키마 · 픽스처 · 계약 케이스) · 소스(`src/`) · 패키지 메타 · GitHub 저장소명 · 이슈 34건 본문까지 한 번에 간다.

**치환은 리터럴 grep 전수 검사로 마감한다.** macOS `sed`는 `\b`(단어 경계)를 지원하지 않고, 단어 경계 정규식은 `AnnalsBench` 같은 합성어와 인라인 코드 안의 토큰을 놓친다 — 직전 개명(`ef48843` → `9f4b304` → `236748d`)이 정확히 그 이유로 세 번에 걸쳐 끝났다. 이번엔 치환 후 `grep -ri` 잔존 카운트 0을 증거로 남긴다.

## Rejected

- **`GitLore` 강행** | npm `gitlore`가 동일 도메인 활성 패키지다. 패키지명을 `git-lore`로 비껴가도 CLI 바이너리와 검색 결과에서 계속 충돌한다. ADR-0008이 `menhir`를 뺀 기준을 우리 자신에게 적용하지 않을 이유가 없다
- **`Annals` 유지** | 어감 문제는 시간이 지나도 사라지지 않고, 코드가 거의 없는 지금이 가장 싼 교체 시점이다. ADR-0008이 "구현 후 교체"를 기각한 논리가 그대로 적용된다
- **`gitchronicle`** | 충돌은 없으나 `Annals`와 의미가 겹쳐 어감 문제만 길이로 바꾼 셈이고, 오너가 원한 `lore` 계열이 아니다
- **코드·스펙만 먼저 개명하고 문서는 v0.1.0 직전에** | 문서와 코드가 서로 다른 이름을 쓰는 기간이 생긴다. 그 기간에 작성되는 모든 산출물이 드리프트의 원천이 된다

## Consequences

- ADR-0008은 §1(명칭)만 대체되고 나머지는 유효하다. 두 문서를 함께 읽어야 정체성 결정의 전모가 나온다.
- GitHub 저장소 개명 시 기존 URL은 GitHub가 리다이렉트하므로 외부 링크는 끊기지 않는다. 다만 로컬 remote는 갱신한다.
- `docs/tickets/F4-agent-fabric.md`의 MCP 툴명 `lore_query`/`lore_stale`/`lore_guard`는 이전 명칭의 잔재였다. 이번 개명에서 `commitlore_query`/`commitlore_stale`/`commitlore_guard`로 정리한다.
- 개명 근거 자체가 이 프로토콜이 기록하려는 종류의 지식이므로, 이 ADR을 남기는 커밋이 도그푸딩 사례가 된다.
