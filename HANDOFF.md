# 세션 인수인계 — 2026-07-26

> 이전 세션에서 서브에이전트 위임이 전면 고장나 세션을 재시작함. 새 세션이 이 문서로 이어받는다.
> **이 파일은 인수인계 전용이다. 인계가 끝나면 삭제한다.**

## 지금까지 완료된 것

### 프로젝트: Annals (`MongLong0214/annals`, PUBLIC)
git 커밋 trailer를 AI 코딩 에이전트의 제도적 기억으로 쓰는 프로토콜 + 도구. 전 계층 MIT 무료, 서버·DB·유료 플랜 없음, **git이 SSOT**.

- **분석 보고서(도시에)**: https://claude.ai/code/artifact/fe440a3e-a994-42f7-ab09-618f2f4c823b (CTO 승인 최종본)
- **문서**: ADR 8건 · PRD 8건 · 기능별 티켓 9파일 · README 4개 언어 · CONTRIBUTING
- **이슈**: 34건 (v0.1 티켓 27 + Backlog 7), 마일스톤 5개 (M1~M4 + Backlog)
- **기한**: v0.1.0 = 2026-08-23 (오너 지시로 최대한 앞당길 것 — "하루만에 끝내도 됨")

### 반드시 지켜야 할 오너 결정 (전부 확정됨)
1. **무료 영구** — 유료 플랜·SaaS·과금 일체 없음. 사용자 추가 비용 0. LLM 기능은 사용자의 기존 에이전트 세션 안에서 옵트인.
2. **오리지널리티** — 선행 자료 어트리뷰션 전부 제거 완료. `ADR-0008`이 이름·어휘의 정본. **구어휘(Constraint/Rejected/Directive/Scope-risk/Reversibility/Confidence/Tested/Not-tested/Related)를 절대 되살리지 말 것.**
3. **Codex 금지** — 모든 위임은 Claude(opus/sonnet)로만. 전역 CLAUDE.md의 boomer/codex 규정을 대체함.
4. **CTO 게이트** — 티켓 완료마다 전수 리뷰(AC 증거 대조 / 직접 빌드·테스트 실행 / 적대적 검토 / 스코프 / 일관성). 에이전트의 "완료" 보고는 승인이 아님.

### 어휘 정본 (ADR-0008 — 축약본, 상세는 문서 참조)
`Limit:` `Ruled-out:`(alt \| why) `Warn:` `Blast:`(local\|module\|system) `Undo:`(easy\|costly\|permanent) `Certainty:`(firm\|tentative\|guess) `Verified:` `Unverified:` `Follows:`(Record-Id 참조) `Record-Id:` `Supersedes:` `Expires:` `Evidence:` `Provenance:` `Annals-Version:` `X-*`

## 다음에 할 일 (M1부터)

크리티컬 패스: `T-101 → T-102 → T-201 → T-203 → T-204 → ...`
독립 최우선 트랙: `T-701 → T-702` (효용 가설 검증 — 실패 시 프로젝트 방향 재검토)

| 착수 순서 | 티켓 | 이슈 | 모델 권장 |
|---|---|---|---|
| 1 (병렬) | T-101 스펙 (`spec/SPEC.md`) | #1 | sonnet |
| 1 (병렬) | T-701 AnnalsBench 하니스 + 스캐폴딩(`package.json` 등) | #22 | opus |
| 1 (병렬) | T-201 파서 키스톤 (`src/core/`) | #4 | opus |
| 2 | T-102 스키마·픽스처 / T-103 계약케이스 | #2 #3 | sonnet |
| 3 | T-202+502 / T-203+204 / T-205+501 / T-301~303 / T-403+404 | | 혼합 |

파일 소유권 분할 필수(같은 파일 두 에이전트 금지). `package.json`·CLI 엔트리는 한 에이전트만 소유.

## ⚠️ 이전 세션의 장애 (재발 확인 필요)

**서브에이전트 8개 전부 산출 0.** librarian(2h08m), spec-author(19m), bench-eng(18m), parser-eng(13m), readme/docs/ticket-rewriter(21m), skill-reviewer(33m) — 프로세스는 살아있는데 인박스 메시지가 `read: false`로 남고 작업이 시작되지 않음.

**새 세션에서 먼저 검증할 것**: 작은 태스크로 서브에이전트 1개를 시험 스폰해 5분 내 산출이 나오는지 확인. 안 나오면 위임을 포기하고 직접 수행할 것(이전 세션은 문서 재작성을 직접 처리해 완료함).

생존 판별:
```bash
ps -eo pid,etime,args | grep -- "--agent-name" | grep -v grep
```
프로세스 존재는 필요조건일 뿐이다. **산출물이 나오는지가 진짜 판정 기준.**

## 부산물

- **`repo-factory` 스킬** (`~/.claude/skills/repo-factory/`) — 이 흐름 전체를 재사용 가능하게 만든 것. **미완결**: 적대적 리뷰 미완료 + 알려진 P1 2건(스크립트 raw traceback) + 미반영 갭 4건(네이밍 단계 부재, 오리지널리티 게이트 부재, 개명 비용 곡선, 아티팩트 드리프트). 새 세션에서 마감할 것.
