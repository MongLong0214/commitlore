# 세션 인수인계 — 2026-07-26

> 새 세션이 이 문서만 읽고 즉시 이어받을 수 있게 쓴 문서다. **인계가 끝나면 삭제한다.**

---

## 0. 먼저 이것부터 — 서브에이전트 장애

이전 두 세션에서 **서브에이전트 10개가 전부 산출 0**이었다(librarian 2h08m, spec-author, bench-eng, parser-eng, readme/docs/ticket-rewriter, skill-reviewer, smoke, smoke2).

**근본 원인 확정**: `~/.claude/settings.json`의 `teammateMode`가 `"tmux"`인데 Claude Code가 tmux 밖에서 실행 중 → 에이전트마다 존재하지 않는 pane ID를 배정받고 입출력을 기다리며 영원히 정체. `team-lead`만 `in-process`라 정상 동작했던 것이 결정적 단서였다.

**조치 완료**: `teammateMode`를 `"in-process"`로 변경함(백업 `~/.claude/settings.json.bak-1785043089`). 다만 설정은 프로세스 기동 시 캐시되므로 **변경 이후 새로 시작한 세션에서만 적용된다.**

**새 세션에서 할 일**: 소형 태스크로 서브에이전트 1개를 시험 스폰해 **2분 내 파일 산출**이 나오는지 확인하라.
- 나오면 → 병렬 웨이브 가동 (아래 §4)
- 안 나오면 → 위임 포기하고 직접 구현 (이전 세션은 그렇게 진행했고 잘 됐다)

생존 판별은 프로세스 테이블로만:
```bash
ps -eo pid,etime,args | grep -- "--agent-name" | grep -v grep
```
인박스 `read:false`나 트랜스크립트 부재는 **오진 신호다**(정상 작동 중인 에이전트도 그렇게 보인다).

---

## 1. 프로젝트

**Annals** — git 커밋 trailer를 AI 코딩 에이전트의 제도적 기억으로 쓰는 프로토콜 + 도구.

- 저장소: **https://github.com/MongLong0214/annals** (PUBLIC) · 로컬 `~/projects/annals`
- 분석 보고서: https://claude.ai/code/artifact/fe440a3e-a994-42f7-ab09-618f2f4c823b
- 기한: v0.1.0 = 2026-08-23이 공식 기한이나, **오너 지시로 최대한 앞당김**("하루만에 끝내도 됨")

## 2. 오너 확정 사항 (전부 반영 완료 — 되돌리지 말 것)

1. **무료 영구** — 유료 플랜·SaaS·과금 일체 없음. 사용자 추가 비용 0. LLM 기능은 사용자의 기존 에이전트 세션 안에서 옵트인.
2. **오리지널리티** — 선행 자료 어트리뷰션 전부 제거 완료. `docs/adr/ADR-0008-protocol-identity.md`가 이름·어휘의 **정본**. 구어휘(Constraint/Rejected/Directive/Scope-risk/Reversibility/Confidence/Tested/Not-tested/Related)를 **절대 되살리지 말 것**.
3. **Codex 금지** — 모든 위임은 Claude(opus/sonnet)로만. 난이도로 모델 선택. 전역 CLAUDE.md의 boomer/codex 규정을 대체함.
4. **CTO 게이트** — 티켓 완료마다 전수 리뷰. 에이전트의 "완료" 보고는 승인이 아니다. 5항목: ①AC 증거 대조 ②빌드·테스트 직접 실행 ③적대적 검토 ④스코프 ⑤일관성.

## 3. 지금까지 완료

| 항목 | 상태 |
|---|---|
| ADR 8건 · PRD 8건 · 기능별 티켓 9파일 | ✅ |
| README 4개 언어 + CONTRIBUTING | ✅ |
| 마일스톤 5개 · 이슈 34건 (라벨·링크 포함) | ✅ |
| **T-101** `spec/SPEC.md` — 문법·어휘 16종·라우트표·검증규칙 | ✅ 커밋 `00d348d` |
| 스캐폴딩 `package.json`/`tsconfig.json`/`.gitignore` + `npm install` | ✅ |
| `src/core/types.ts` — 공용 타입 (tsc 통과) | ✅ |

**T-101에서 실측한 git 경계 동작 7가지**가 SPEC §2.1에 표로 있다(B1~B7). 파서 구현(T-201)은 이 표를 그대로 테스트로 옮기면 된다. 핵심: **`--grep`/라인 매칭 금지, `git interpret-trailers --parse`에 위임**.

## 4. 다음 작업 — 착수 순서

크리티컬 패스: `T-102 → T-201 → T-203 → T-204 → …`
독립 최우선: `T-701 → T-702` (효용 가설 검증. 실패 시 프로젝트 방향 재검토 → 오너 에스컬레이션)

| 순서 | 티켓 | 이슈 | 산출물 | 모델 |
|---|---|---|---|---|
| 1 (병렬) | **T-102** 스키마 + 픽스처 20 | #2 | `spec/schema/`, `spec/fixtures/{valid,boundary,invalid}/` | sonnet |
| 1 (병렬) | **T-103** 라우트 계약 케이스 8+ | #3 | `spec/contract-cases/*.yaml` | sonnet |
| 1 (병렬) | **T-701** AnnalsBench 하니스 | #22 | `bench/runner.ts`, `bench/tasks/`, `bench/metrics.ts` | opus |
| 2 | **T-201** 파서 (키스톤) | #4 | `src/core/{git,trailers,schema}.ts`, `src/cli.ts` | opus |
| 3 | T-202+502 / T-203+204 / T-205+501 / T-301~303 / T-403+404 | | disjoint 모듈 | 혼합 |

**웨이브 규칙**: 티켓이 아니라 **파일 소유권**으로 분할. 두 에이전트가 같은 파일을 건드리면 설계가 틀린 것. `package.json`·`src/cli.ts`·`src/core/types.ts`는 한 에이전트만 소유하고 나머지에겐 "만들지도 수정하지도 마라, 필요하면 보고하라"고 명시.

## 5. 어휘 정본 (축약 — 상세는 `spec/SPEC.md` §3)

`Limit:` `Ruled-out:`(`대안 | 이유`, 파이프 필수) `Warn:` `Blast:`(local|module|system) `Undo:`(easy|costly|permanent) `Certainty:`(firm|tentative|guess) `Verified:` `Unverified:` `Follows:`(Record-Id 참조) `Record-Id:`(`r-[a-z0-9]{6,}`) `Supersedes:` `Expires:` `Evidence:` `Provenance:` `Annals-Version:` `X-*`

거부해야 할 값 예시(픽스처용): `Blast: wide`, `Undo: clean`, `Certainty: high`, `Ruled-out: 파이프 없음`

## 6. 남은 별건

**`repo-factory` 스킬** (`~/.claude/skills/repo-factory/`) — 이 전체 흐름을 재사용 가능하게 만든 것. **미완결**.
👉 상세 현황·남은 작업·마감 절차는 **`~/.claude/skills/repo-factory/STATUS.md`** 에 정리해뒀다. 요약만 옮기면:
- 완료: `SKILL.md`(6 Phase + 불변식 7) + `references/` 4편 + `scripts/` 2개, 정상 경로 스모크 통과, 생존확인 절차 1회 정정
- 남은 것: P1 결함 2건(스크립트 raw traceback) · 미반영 갭 4건(네이밍 단계 부재, 오리지널리티 게이트 부재, 개명 비용 곡선, 아티팩트 드리프트) · 이번 세션 교훈 2건(위임 불가 시 폴백 절차, 기계 치환 함정) · 적대적 리뷰 재실행
- 마감: 위를 **한 패스로** 수정 → 스크립트 실패 경로 재시험 → `PRODUCTION READY` 판정 → `STATUS.md` 삭제

**환경 수정 이력** (이번 세션에서 적용, 참고용): `/doctor` 정리로 미사용 스킬 100개 off·플러그인 4개 비활성·MCP 4개 비활성·`defaultMode: auto` 설정. `permissions.allow`의 `Write(...)` 규칙 4건을 `Edit(...)`로 교체(Write 규칙은 파일 권한 검사에 매칭되지 않음).
