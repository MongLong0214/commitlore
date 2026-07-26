# CommitLore

[English](README.md) | **한국어** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

> **git 커밋 trailer를 AI 코딩 에이전트의 제도적 기억으로.**
> 영원히 무료. 서버 없음, DB 없음, 유료 플랜 없음 — **git이 유일한 진실의 원천(SSOT)입니다.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-v0.1.0_개발중-orange.svg)](https://github.com/MongLong0214/commitlore/milestones)
[![Target](https://img.shields.io/badge/v0.1.0-2026--08--23-blue.svg)](https://github.com/MongLong0214/commitlore/milestone/4)
[![Protocol](https://img.shields.io/badge/protocol-CommitLore_v2-8A2BE2.svg)](docs/adr/ADR-0001-scope-v010.md)

> ⚠️ **상태**: 프로토콜 자체는 **지금 당장** 순수 git만으로 사용할 수 있습니다([오늘 바로 쓰기](#오늘-바로-쓰기-순수-git) 참조). CLI·MCP 서버·훅·GitHub Action은 **v0.1.0(목표 2026-08-23)** 에서 배송됩니다. 이 README의 모든 주장은 지금 재현 가능하거나, 계획임이 명시돼 있습니다 — 수치는 오직 [CommitLoreBench](docs/prd/PRD-F7-commitlorebench.md) 로그에서만 나옵니다.

---

## 문제: 당신의 에이전트는 매 세션 퇴사하는 시니어 개발자다

이제 커밋의 상당수를 AI 에이전트가 작성합니다. 작업 중의 에이전트는 결정 맥락 전체 — 발견한 제약, 시도했다가 기각한 대안, 의도적으로 테스트하지 않은 것 — 를 쥐고 있습니다. 그리고 세션이 끝나면 컨텍스트 창은 죽고 **diff만 살아남습니다**.

다음 세션은(다음 에이전트든, 동료든) 모든 것을 다시 유도합니다 — 그리고 **3주 전에 기각된 바로 그 접근을 다시 제안**합니다. 기각됐다는 사실도, 그 이유도, 어디에도 기록되지 않았기 때문입니다.

이것은 40년간 *설계 근거 캡처 문제*라 불리며 미해결로 남아 있었습니다. 이유는 하나 — 인간은 근거를 기록하는 비용을 지불하지 않기 때문입니다. **에이전트는 이 경제학을 뒤집습니다.** 커밋 시점의 에이전트는 근거를 이미 컨텍스트에 들고 있고, 직렬화 비용은 토큰 몇백 개입니다. CommitLore는 그것을 *어디에 둘 것인가*에 대한 프로토콜입니다.

## 세 줄 요약

1. **캡처는 공짜** — 에이전트는 이유를 이미 알고 있으므로, 어차피 만들던 커밋에 구조화된 *git trailer*로 적습니다. 근거를 인용하지 못하는 trailer는 검증자가 폐기합니다.
2. **소비는 pull이 아니라 push** — 에이전트가 파일을 만지는 순간, *그 경로*의 활성 제약과 과거 기각 이력이 자동 주입됩니다. 아무도 조회를 기억할 필요가 없습니다.
3. **git이 유일한 진실** — 기록는 커밋 메시지와 `refs/notes/commitlore`에 삽니다. 나머지(인덱스·대시보드)는 전부 버려도 되는 파생 캐시입니다. `git clone` 하나로 기억 전체가 이동합니다.

## 실제 모습

```text
Prevent silent session drops during long-running operations

The auth service returns inconsistent status codes on token
expiry, so the interceptor catches all 4xx responses and
triggers an inline refresh.

Limit: Auth service does not support token introspection
Record-Id: r-4b7e21
Ruled-out: Extend token TTL to 24h | security policy violation
Ruled-out: Background refresh on timer | race condition
Certainty: firm
Blast: module
Undo: easy
Warn: 4xx handling is intentionally broad
  -- do not narrow without verifying upstream behavior
Verified: Single expired token refresh (unit)
Unverified: Auth service cold-start > 500ms behavior
CommitLore-Version: 2.0.0
```

이건 평범한 git 커밋입니다. 작성에 도구가 필요 없고 git이 스스로 파싱합니다 — trailer는 git 네이티브 기능입니다(`Signed-off-by`, Gerrit의 `Change-Id`, Conventional Commits footer가 같은 메커니즘).

### Protocol v2 어휘

| Trailer | 용도 | 소비처 |
|---|---|---|
| `Limit:` | 결정을 형성한 외부 제약 | 주입, `commitlore limits` |
| `Record-Id:` | 안정적 신원 — 승계·폐기의 앵커 | 라이프사이클 폴드 |
| `Ruled-out:` | `대안 \| 이유` — 시도했다가 버린 것 | **`commitlore guard`** (재제안 차단) |
| `Certainty:` | `firm` \| `tentative` \| `guess` | 리뷰 라우팅 |
| `Blast:` | `local` \| `module` \| `system` | 승인 게이트 라우팅 |
| `Undo:` | `easy` \| `costly` \| `permanent` | 승인 게이트 라우팅 |
| `Warn:` | 미래 수정자를 위한 경고 | 주입 (신뢰 등급 적용) |
| `Verified:` / `Unverified:` | 검증한 것 / 안 한 것 | 커버리지 조회 |
| `Follows:` | 결정 사슬을 잇는 커밋 링크 | 컨텍스트 조립 |
| `Supersedes:` | 기존 Record-Id 폐기 | **스테일 엔진** |
| `Expires:` | 제약이 끝나는 날짜·조건 | 스테일 엔진 |
| `Evidence:` | 주장→증거 링크 (`경로#앵커`) | 수확 검증자 |
| `Provenance:` | `authored` \| `inherited <sha>` \| `reconstructed` | **신뢰 등급** |
| `CommitLore-Version:` / `X-*` | 신원·버전·확장 | 도구 |

설계 규칙(["죽은 필드 금지"](docs/adr/ADR-0006-push-injection.md)): 모든 trailer는 소비자 라우트(쿼리·게이트·주입 규칙)를 최소 1개 갖습니다. 아무도 읽지 않는 어휘는 스펙에서 삭제됩니다.

## 오늘 바로 쓰기 (순수 git)

프로토콜에는 도구가 전혀 필요 없습니다. 커밋에 trailer를 쓰고(에이전트 지침에 맡겨도 됩니다), git으로 조회하세요:

```bash
# 제약 값 추출, 기계 판독 — git 네이티브 trailer 파서
git log --format='%h %(trailers:key=Limit,valueonly,separator=%x3B)'

# 커밋 하나의 전체 trailer 블록 파싱
git log -1 --format=%B <sha> | git interpret-trailers --parse

# 특정 경로를 거친 제약들 (리네임 추적)
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

> 주의: `--grep`이 아니라 `%(trailers:...)`를 쓰세요. 텍스트 grep은 본문 산문을 오탐하고 멀티라인 폴딩에서 깨집니다 — [이 실패 모드를 직접 재현](docs/tickets/F2-core-cli.md)했고, CLI가 존재하는 이유 중 하나가 이것을 원천 차단하는 것입니다.

## v0.1.0이 배송하는 것 (2026-08-23)

| 계층 | 배달물 | 마일스톤 |
|---|---|---|
| **L0 Protocol** | `SPEC.md`, JSON Schema, 적합성 픽스처, 라우트 계약 테스트 | [M1](https://github.com/MongLong0214/commitlore/milestone/1) |
| **L1 Core CLI** | `commitlore validate / context / limits / ruled-out / warnings / stale / index / doctor` — SQLite 증분 인덱스, `--no-index` 폴백, 10만 커밋 p50 < 100ms 목표 | [M2](https://github.com/MongLong0214/commitlore/milestone/2) |
| **L1 생존** | `commitlore squash-preserve`(squash 병합 승계), `refs/notes/commitlore` 미러(rebase 생존), `--follow` 기본 | [M2](https://github.com/MongLong0214/commitlore/milestone/2) |
| **L2 Agent Fabric** | `commitlore mcp`(MCP 서버), 자동 주입 훅(경로 스코프·예산·결정론), transcript 수확 + **근거 검증자**, `commitlore guard`, 클린룸 스킬 | [M3](https://github.com/MongLong0214/commitlore/milestone/3) |
| **L3 Trust** | provenance × lifecycle 등급, **Warn 강등**(미검증 지시는 명령이 아닌 *주장*으로만 렌더), 인젝션 휴리스틱, secret guard | [M3](https://github.com/MongLong0214/commitlore/milestone/3) |
| **L4 Org** | GitHub Actions: PR lint + 활성 제약 코멘트, squash 승계 자동화 — *당신의* CI에서 구동, 외부 호출 0 | [M4](https://github.com/MongLong0214/commitlore/milestone/4) |
| **L5 CommitLoreBench** | 재제안율(CommitLore on/off), 노이즈 어블레이션, 수용 기록당 비용 — README의 모든 수치는 로그에서 재생성 | [M1](https://github.com/MongLong0214/commitlore/milestone/1) / [M4](https://github.com/MongLong0214/commitlore/milestone/4) |

전체 계획: [ADR](docs/adr/) · [PRD](docs/prd/) · [티켓 스펙](docs/tickets/TICKETS.md) · [이슈](https://github.com/MongLong0214/commitlore/issues)

## 그냥 이거 쓰면 안 되나?

| 대안 | 왜 부족한가 |
|---|---|
| **ADR / 위키 / Notion** | 별도 파일은 코드와 어긋나며 부패합니다. trailer는 diff와 같은 커밋 객체에 살아서 desync가 구조적으로 불가능하고, `git clone`이 함께 나릅니다. |
| **Slack/문서 RAG** | 낮은 신호의 산출물을 읽기 시점에 검색합니다. CommitLore는 쓰기 시점에 고신호 지식을 *생성*해 그 코드에 결합합니다. |
| **에이전트 메모리 프레임워크** (벡터 스토어) | 무큐레이션 에피소드 메모리는 SE 에이전트 성능을 실측으로 *해칩니다*(노이즈). CommitLore 기록는 타입드·근거 검증·경로 스코프·수명 관리 — 각각이 공개된 실패 모드에 대한 직접 응답입니다. |
| **정적 컨텍스트 파일** (CLAUDE.md / AGENTS.md) | 전역 덤프, 엇갈리는 실증 결과. CommitLore는 *경로별*·*등급별*·*활성만* 토큰 예산 안에서 주입합니다. |
| **지식베이스 SaaS** | 조직의 결정사가 남의 DB에 살 이유가 없습니다. 여기엔 죽을 서버도 해지할 구독도 없습니다 — 저장소가 곧 데이터베이스입니다. |

## 보안 모델 (정직한 버전)

커밋 메시지는 에이전트의 지시 채널이 되고, 그것은 곧 인젝션 표면이 된다는 뜻입니다. v0.1은 정직한 최소 방어를 배송합니다: **미검증 `Warn:`는 모든 주입·조회 출력에서 "주장"으로 강등**(외부 기여는 무조건 강등), 인젝션 패턴 휴리스틱이 적대 기록를 격리, secret guard가 자격증명의 영구 각인을 차단합니다. 암호학적 서명(sigstore)은 [계획됨](https://github.com/MongLong0214/commitlore/issues/28) — 등급 모델은 서명이 소비자를 깨지 않고 끼워지도록 설계돼 있습니다.

## 설계 원칙

- **사용자 비용 0, 영원히.** MIT, 유료 티어 없음, 텔레메트리 없음, 서버 없음. LLM 의존 기능(수확·backfill)은 이미 쓰고 있는 에이전트 세션 안에서 옵트인으로만. 코어 경로 — parse·query·inject·guard — 는 결정론적이며 LLM 무관.
- **근거 없는 기록는 없다.** 수확 검증자는 transcript나 diff를 인용하지 못하는 trailer를 폐기합니다. 없는 기록가 거짓 기록보다 낫습니다.
- **워크플로우는 협상 대상이 아니다.** squash·rebase·리네임 — 지식이 당신의 워크플로우를 살아남아야지, 워크플로우가 도구에 맞춰선 안 됩니다.
- **수치 아니면 침묵.** 이 README는 `bench/results/`에서 재현되는 측정값만 인용합니다.

## FAQ

**정말 무료인가요?** 네 — 전부, 영원히, MIT입니다. 클라우드 버전은 없고 계획도 없습니다. 지속가능성은 판매가 아니라 표준 채택에서 옵니다([ADR](docs/adr/ADR-0001-scope-v010.md)).

**어떤 에이전트와 호환되나요?** 셸을 실행할 수 있는 무엇이든 오늘 프로토콜을 읽을 수 있습니다. v0.1.0 통합 대상: Claude Code(훅+스킬), 그리고 `commitlore mcp`를 통한 모든 MCP 지원 에이전트. 커밋 포맷 자체는 커밋을 쓰는 모든 에이전트 — 그리고 사람 — 과 호환됩니다.

**저희는 전부 squash-merge 하는데요?** 기본 상태로는 trailer가 파괴됩니다 — 저희가 직접 재현했습니다. 그래서 `commitlore squash-preserve` + notes 미러 + GitHub Action이 존재합니다([ADR-0004](docs/adr/ADR-0004-workflow-survival.md)).

**대형 저장소는요?** 인덱스는 `.git/commitlore/` 아래의 증분 SQLite 캐시로, 명령 한 줄로 재구축되고 절대 커밋되지 않습니다. 목표: 10만 커밋에서 경로 조회 p50 < 100ms — 약속이 아니라 CI에서 측정합니다.

**Conventional Commits와 같이 쓸 수 있나요?** 됩니다. CommitLore trailer는 git footer이고, Conventional Commits가 `BREAKING CHANGE`에 쓰는 것과 같은 메커니즘입니다. `feat:` / `fix:` 제목 줄은 그대로 두고 본문 아래에 trailer를 붙이면 commitlint·semantic-release가 그대로 동작합니다.

## 기여하기

스펙(F1)이 가장 먼저 착지합니다 — 적합성 스위트가 곧 계약이므로, 대안 구현을 환영하며 테스트로 검증 가능합니다. [good first issue](https://github.com/MongLong0214/commitlore/issues)에서 시작하고, "왜"는 [ADR](docs/adr/)에서 읽으세요. 이 저장소의 히스토리 자체가 프로토콜을 도그푸딩합니다: 여기서 `git log --format='%h %(trailers:key=Ruled-out,valueonly)'`가 실제로 동작합니다.

## 라이선스

[MIT](LICENSE)
