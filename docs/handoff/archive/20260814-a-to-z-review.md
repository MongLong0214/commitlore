> **Historical snapshot. Not current operating guidance.** Kept for the reasoning
> in it; `docs/PRODUCTION-READINESS-SSOT.md` owns the shipped product contract.

---
document_id: commitlore-final-a-to-z-review-and-improvement-plan
document_version: 4.1.0
review_date: 2026-08-14
review_type: pinned-source-and-live-github-review
repository: MongLong0214/commitlore
evidence_main_sha: b578ca9890aa4ddb264ebd0f94968aa08636e00e
evidence_release_tag: v0.8.2
status: final-review-snapshot
normative_status: non-normative-until-adopted
supersedes_review_snapshots:
  - commitlore-final-a-to-z-review-2026-08-13
---

# CommitLore 최종 A–Z 전수 리뷰 및 개선안

> **검토 기준점:** `main@b578ca9890aa4ddb264ebd0f94968aa08636e00e` / 공개 릴리스 `v0.8.2`  
> **최종 판정:** **Git-native decision delivery PASS / Controlled pilot CONDITIONAL PASS / Organization-wide production NO-GO**  
> **핵심 결론:** 코어 프로토콜과 Git lifecycle 구현은 매우 강하다. 현재 가장 큰 위험은 코드 알고리즘이 아니라 **CLI·Git hook·Claude plugin·Codex plugin·MCP server·SQLite index가 서로 다른 빌드와 스키마를 실행할 수 있는 runtime convergence 결함**이다.  
> **문서 성격:** 현재 상태를 고정한 독립 리뷰 스냅샷이다. 저장소의 기존 규범 SSOT를 자동으로 대체하지 않으며, 채택 시 `docs/PRODUCTION-READINESS-SSOT.md`가 명시적으로 supersede해야 한다.

---

## 0. 한눈에 보는 최종 결론

CommitLore는 더 이상 “흥미로운 개인용 Git trailer 도구” 수준이 아니다. 다음 요소는 이미 상용 개발도구에 가까운 품질을 보인다.

- Git이 결정하는 trailer 문법을 그대로 따르는 프로토콜
- commit message와 `refs/notes/commitlore`를 권위 저장소로 두는 Git-native 모델
- rename·squash·amend·worktree·SHA-1/SHA-256을 고려한 lifecycle
- index를 폐기 가능한 derived cache로 취급하는 설계
- transcript·diff·HEAD·tree·policy를 묶는 capture transaction
- model이 만든 인용을 model에게 다시 확인시키지 않는 deterministic maker–checker
- history unavailable, notes unfetched, scan partial, genuine empty를 서로 다른 상태로 표현하는 fail-closed query
- timeout·non-interactive·fail-open을 적용한 Git hook
- exact candidate SHA, workflow run, job attempt, tag binding까지 검증하는 릴리스 게이트
- 실험적 guard의 낮은 precision/recall을 숨기지 않는 제품 정직성

그러나 **현재 설치된 한 머신에서 하나의 CommitLore가 실행된다는 보장이 없다.** 실제 보고에서는 PATH CLI는 `0.8.2`, Git hook pin은 `0.8.0`, Claude plugin cache는 `0.8.0`, Codex plugin cache는 `0.8.2`, MCP capture는 존재하지 않는 `0.6.0/spec/SPEC.md`를 찾았다. 같은 record가 CLI에서는 `directive`, MCP에서는 `claim`으로 읽히고, v4 index를 v3 reader가 반복해서 full scan으로 읽는 증상도 나왔다.

따라서 현재 제품의 정확한 위치는 다음과 같다.

| 사용 범위 | 판정 | 이유 |
|---|---|---|
| Git history에서 decision context 조회 | **PASS** | query·lifecycle·rename·partial-state 모델이 강함 |
| 개인 프로젝트 CLI 사용 | **PASS** | 운영자가 fallback과 경고를 이해할 수 있음 |
| 여러 OSS의 통제된 dogfooding | **CONDITIONAL PASS** | runtime skew를 doctor와 수동 점검으로 관리해야 함 |
| 소규모 신뢰 팀 pilot | **CONDITIONAL PASS** | directive 인증과 자동 capture를 강한 권한으로 사용하지 않아야 함 |
| Claude Code에서 설치 후 자동 capture | **NO-GO** | initiation·verified-empty·fallback·100-commit certification 미완료 |
| 여러 coding-agent host의 동일 자동 capture | **NO-GO** | host별 lifecycle과 runtime identity가 인증되지 않음 |
| authenticated directive 자동 집행 | **NO-GO** | author string과 valid signature가 승인된 signer identity로 결합되지 않음 |
| 조직 전체 기본 설치 | **NO-GO** | runtime convergence, artifact reproducibility, 운영 상태 진실성 미완료 |
| 보안·규제 민감 조직 | **NO-GO** | signer authorization·provenance audit·rollback evidence 미완료 |

---

## 1. 검토 범위와 방법

### 1.1 고정 증거

- Repository: [`MongLong0214/commitlore`](https://github.com/MongLong0214/commitlore)
- Main: [`b578ca9890aa4ddb264ebd0f94968aa08636e00e`](https://github.com/MongLong0214/commitlore/commit/b578ca9890aa4ddb264ebd0f94968aa08636e00e)
- Latest release: [`v0.8.2`](https://github.com/MongLong0214/commitlore/releases/tag/v0.8.2)
- Open PRs at snapshot: [`#636`](https://github.com/MongLong0214/commitlore/pull/636), [`#637`](https://github.com/MongLong0214/commitlore/pull/637)
- Merged during review: [`#628`](https://github.com/MongLong0214/commitlore/pull/628) → current `main`
- Production-readiness milestones: R0–R4
- Active release-tag ruleset: `v*` update·deletion denied, bypass actor 없음
- Snapshot transition: review 도중 #628이 merge되어 `main`이 `5fcae0c5…`에서 `b578ca98…`로 이동했다. 차이는 `test/two-clone-notes.test.ts` 추가뿐이며 runtime source 결론은 변하지 않는다. 최종 문서는 새 SHA를 기준으로 고정했다.
- Exact-head CI state: 새 `main` push CI는 최종 증거 캡처 시 일부 platform job이 성공했고 Node 22/24 jobs는 진행 중이었다. 따라서 이 문서는 `b578ca98…`의 **최종 full-green을 주장하지 않는다**; 직전 main과 #628 PR head의 required CI success, 그리고 새 push의 현재 상태를 분리해 본다.

### 1.2 읽은 영역

- `src/core`, `src/commands`, `src/hooks`, `src/mcp`
- `spec/SPEC.md`, schema·fixtures·contract cases
- installer와 plugin manifests
- Claude/Codex skill·hook·MCP registration
- SQLite index와 notes mirror
- doctor registry와 개별 health checks
- CI·release workflows와 branch/tag protection
- benchmark preregistration·verdict·README number checker
- 공개 README·compatibility·security·production-readiness SSOT
- 현재 open issue·PR·milestone과 최근 field report

### 1.3 증거 등급

| 등급 | 의미 |
|---|---|
| **CONFIRMED** | 코드와 실제 field reproduction 또는 executable regression이 함께 존재 |
| **SOURCE-CONFIRMED** | 고정 SHA 코드에서 직접 확인되며 동작 경로가 명확함 |
| **REASONED** | 코드 구조상 강하게 추론되지만 독립 실행 회귀가 더 필요함 |
| **LIVE-STATE** | GitHub API에서 현재 PR·issue·CI·ruleset 상태를 확인 |

### 1.4 검토 한계

검토 환경에서 외부 네트워크를 사용하는 독립 clone과 전체 테스트 재실행은 수행하지 못했다. 대신 고정 SHA의 source, GitHub Actions exact-head 결과, release gate, issue reproduction, PR patch를 교차 검토했다. 따라서 이 문서에서 새로 제안하는 source-derived finding은 구현 전에 반드시 **현재 main을 실패시키는 regression test**로 재현해야 한다.

## 1.5 현재 열린 PR 선행 리뷰

### PR #636 — Doctor MCP live identity probe

**현재 판정: CHANGES REQUESTED.** 방향은 맞다. installer에 있던 probe를 `src/core/mcp-probe.ts`로 공유하고 doctor가 initialize·serverInfo·tools/list를 실행하는 것은 #572의 핵심을 해결한다. 그러나 현재 head `8e8867e…`의 CI는 실패 상태이며, source patch에는 더 중요한 의미 불일치가 남아 있다.

- probe가 요구하는 minimum tools는 `commitlore_query`와 `commitlore_before_change`뿐이다.
- 그런데 doctor message는 이를 근거로 “host가 unattended capture를 시작할 수 있다”고 말한다.
- `prepare_capture`, `verify_capture`, `stage_capture`가 없는 오래된 read-only server도 healthy initiator로 통과한다.
- tools/list에 capture tool이 있어도 `SPEC.md` asset이 없으면 실제 prepare는 실패할 수 있으므로 #633/#635의 asset health까지는 증명하지 못한다.
- PR base가 merge 전 `5fcae0c5…`이므로 현재 main에 rebase가 필요하다.

**필수 수정:** check title이 unattended initiator라면 capture 3-tool set과 asset readiness를 검증한다. read-delivery health만 검증하려면 doctor message와 evidence key를 그 수준으로 낮춘다. #572는 live MCP identity issue이고 #635는 broader runtime convergence issue이므로, #636 하나가 #635까지 닫는 것으로 표현하면 안 된다.

### PR #637 — Canonical artifact manifest

**현재 판정: CONDITIONAL APPROVE.** canonical Linux/amd64 builder, source/artifact SHA-256 inventory, CI·release verification, actionable contributor command를 추가하는 방향은 정확하다. 다만 snapshot 시점에 mergeable=false이고 CI는 진행 중이며 다음 계약이 남아 있다.

- builder image가 mutable tag `node:24-bookworm`이다. 장기 재현성을 주장하려면 image digest를 고정하거나 manifest에 resolved digest를 기록해야 한다.
- PR은 legacy sidecar 최소화, SBOM, signing/provenance를 명시적으로 제외하면서 `Closes #605`라고 한다. #605의 현재 SSOT contract를 그대로 유지한다면 `Partially addresses #605`가 맞다.
- `runtimeAssets`는 bundle 하나이지만 artifact checksum은 전체 `dist/` 273개 sidecar를 포함한다. 이 구분은 문서와 release evidence에서 명확해야 한다.
- source input aggregate와 release exact SHA가 실제로 결합되는지 release regression으로 고정해야 한다.
- 현재 main에 rebase하고 exact-head CI를 다시 통과해야 한다.

이 두 PR은 이 리뷰가 제안하는 방향과 일치하지만, 아직 `main` 증거가 아니므로 해당 finding 점수는 해결된 것으로 올리지 않았다.

---

CI green은 중요한 증거지만 다음을 자동으로 뜻하지 않는다.

- 실제 사용자의 오래된 plugin cache가 최신 버전으로 수렴했다.
- 장시간 살아 있는 MCP process가 업그레이드 후 재시작됐다.
- 한 host의 성공이 다른 host에서도 재현된다.
- issue가 closed됐다는 사실만으로 field symptom이 사라졌다.
- benchmark가 독립적 외부 검증을 받았다.

---

## 2. 종합 점수

| 영역 | 점수 | 판정 |
|---|---:|---|
| 문제 정의·차별성 | **9.4/10** | Git-native lifecycle decision memory라는 중심이 선명함 |
| 프로토콜·문법 | **9.3/10** | Git parser 위임, identity·lifecycle·provenance가 강함 |
| Git lifecycle·rewrite survival | **9.3/10** | rename·squash·notes·worktree·OID 경계를 폭넓게 다룸 |
| Query·index | **9.1/10** | false-empty 방어와 partial-state 표현이 특히 우수함 |
| Capture core correctness | **9.2/10** | deterministic verification과 staged-state binding이 강함 |
| Hook 안전성 | **9.0/10** | fail-open·timeout·non-interactive·재귀 방어 적용 |
| Installer transaction | **8.8/10** | live MCP probe·atomic config·pinned checkout이 강함 |
| 테스트·CI | **9.4/10** | 플랫폼·Git·installer·conformance·release 경계가 넓음 |
| Release integrity | **9.3/10** | exact SHA·workflow evidence·tag immutability를 결합 |
| Observability·doctor | **7.7/10** | 구조는 강하지만 MCP current identity와 capture outcome이 비어 있음 |
| Runtime convergence | **5.8/10** | 현재 가장 큰 production blocker |
| Trust·authentication | **7.1/10** | fail-closed grading은 좋지만 승인 signer binding이 없음 |
| Automatic capture | **6.2/10** | 엔진은 있으나 deterministic initiation·terminal assessment 미완료 |
| Public facts·documentation integrity | **6.9/10** | 정직한 문서가 많지만 수치·호환성·SSOT drift 존재 |
| 실험·benchmark | **8.2/10** | preregistration과 한계 공개는 강함, 독립성은 부족 |
| UX·operability | **7.3/10** | 진단 문구는 좋으나 설치 surface와 상태 모델이 복잡함 |
| **종합 엔지니어링** | **8.9/10** | 상위 Senior~Lead급 개발도구 엔지니어링 |
| **현재 제품 완성도** | **7.7/10** | 강한 advanced beta / controlled pilot |
| **조직 전체 production readiness** | **NO-GO** | runtime·trust·autocapture certification 선행 필요 |

### 점수 해석

`8.9`는 “버그가 거의 없다”는 뜻이 아니다. 오히려 CommitLore가 다루는 문제의 난도와 방어 범위가 높아, 남은 문제가 **프로세스 경계·버전 수렴·권위 의미·실제 host lifecycle** 같은 어려운 영역으로 이동했다는 뜻이다.

---

## 3. 가장 강한 부분

### 3.1 False empty를 제품 위험으로 이해한다

대부분의 개발도구는 실패를 빈 배열로 돌려도 큰 문제가 없다고 본다. CommitLore에서는 빈 결과가 “아무 제약이 없다”로 읽히므로 가장 위험한 거짓말이 된다. 현재 query는 다음을 분리한다.

- Git history를 읽을 수 없음
- unborn repository의 genuine empty
- shallow history
- notes mirror가 아직 fetch되지 않음
- scan budget이 끝나 일부 commit을 못 읽음
- 실제로 active record가 없음

이 구분은 프로젝트의 가장 중요한 품질 자산이다.

### 3.2 Capture가 model output을 신뢰하지 않는다

Capture는 transcript와 staged diff의 hash를 prepare 시점에 묶고, draft evidence quote가 실제 source에 존재하는지 deterministic verifier가 확인한다. `Ruled-out`은 단순 언급이 아니라 rejection context까지 요구하고, verification result를 저장하지 못하면 기존 verified payload를 남기지 않는 settle 경로를 사용한다.

### 3.3 Git을 억지로 재구현하지 않는다

Trailer parsing, revision resolution, path history, object identity 등 Git이 답할 수 있는 질문은 Git에 묻는다. 이것은 장기 호환성에 유리하다.

### 3.4 Index가 권위가 아니다

SQLite는 언제든 폐기·재생성할 수 있는 cache이며 scan path와 동일한 답을 내야 한다. classifier semantics가 바뀔 때도 schema version을 올려 rebuild하도록 개선됐다.

### 3.5 릴리스 게이트가 매우 강하다

현재 release workflow는 tag 이름을 계속 재해석하지 않고 event SHA를 canonical commit으로 고정한다. main ancestry, package/tag/runtime version, exact-head CI workflow evidence, fresh clone install, live tag binding이 모두 성공해야 publish job이 시작된다. release write 권한도 마지막 job에만 있다.

### 3.6 약한 기능을 강한 기능처럼 팔지 않는다

Guard는 precision 44.8%, recall 22.0%의 experimental advisory로 명시되고, empty match가 안전 verdict가 아니라는 점을 공개한다. M5 benchmark도 한 모델·한 harness·synthetic task라는 한계를 기록한다.

---

# 4. A–Z 전수 리뷰

## A — Architecture

### 현재 상태

구조는 `commands → core → git/filesystem`, `mcp → shared core`, `hooks → shared core`로 분리돼 있다. doctor는 registry와 개별 check module로 분해됐고, capture도 prepare·verify·stage·pending으로 나뉜다.

### 강점

- CLI와 MCP가 동일 query renderer와 capture core를 재사용한다.
- index, notes, lifecycle, grade의 책임 경계가 비교적 분명하다.
- 신규 기능이 command entrypoint 하나에 몰리지 않는다.
- ADR이 단순 기록이 아니라 구현 불변식을 설명한다.

### 약점

- 논리적 단일 제품이 여러 설치 surface와 cache에 복제된다.
- architecture diagram보다 **runtime identity graph**가 필요한 단계다.
- `mcp/server.ts`, `index-db.ts`, release workflow 등 일부 파일은 책임이 많이 쌓였다. 지금 당장 분할 자체가 목표가 되어서는 안 되지만, 다음 변경이 경계를 더 넓히면 extraction이 필요하다.

### 판정

**PASS.** 구조 자체보다 배포된 여러 copy의 수렴이 문제다.

### 개선

새 서비스나 daemon을 추가하지 말고, 하나의 shared `runtimeIdentity()` 함수와 비교 가능한 JSON envelope을 모든 실행 surface가 사용하게 한다.

---

## B — Boundaries

### 현재 상태

CommitLore는 다음 경계를 명시적으로 구분한다.

- Git truth vs derived index
- claim vs directive vs blocked
- capture maker vs checker
- local read path vs networked sync path
- user input revision vs canonical full object ID
- clean empty vs unavailable/unfetched/partial

### 강점

이 프로젝트는 오류 처리보다 **잘못된 의미의 성공**을 더 위험하게 본다. installer false-success, MCP malformed-as-empty, index unavailable-as-empty를 반복해서 제거한 방향은 올바르다.

### 약점

현재 가장 큰 boundary 누락은 “이 command가 CommitLore라는 이름으로 실행됨”과 “이 command가 **내가 기대한 동일 build**임” 사이이다.

### 판정

**CONDITIONAL PASS.** 논리 경계는 강하지만 runtime identity 경계가 빠졌다.

---

## C — Capture

### 현재 상태

Capture는 prepare → draft → verify → stage → prepare-commit-msg apply → post-commit consume 흐름이다. HEAD, staged diff hash, tree OID, policy identity, expiration, nonce를 묶는다.

### 강점

- 모델이 source 밖의 문장을 만들면 버린다.
- 잘못된 draft shape를 normal empty로 취급하지 않는다.
- verify 결과 저장 실패가 stale verified state를 남기지 않는다.
- stage 시점과 commit 시점에 상태를 재검증한다.
- 대부분의 commit이 record를 만들지 않는 것이 정상이라는 noise budget 원칙이 있다.

### 약점

- 엔진은 있으나 ordinary commit이 capture assessment를 deterministic하게 시작하지 않는다.
- host가 skill을 선택하지 않으면 미실행과 verified-empty가 같은 “아무것도 없음”으로 남는다.
- MCP prepare가 stale package root의 asset을 읽으면 전체 pipeline이 첫 단계에서 막힌다.
- `Provenance: drafted` trailer만으로 pipeline이 실제 실행됐음을 증명할 수 없다.
- CLI fallback은 존재하지만 transcript·draft file orchestration을 host가 해줘야 한다.

### 판정

**Capture engine PASS / Automatic capture NO-GO.**

### 개선

R2에서 모든 eligible agent commit이 다음 terminal assessment 중 하나를 남기게 한다.

```text
record-staged | verified-empty | failed | degraded
```

미실행은 terminal state가 아니다. raw transcript는 기본적으로 저장하지 않고 attempt/outcome만 privacy-safe ledger에 기록한다.

---

## D — Delivery

### 현재 상태

CLI query, MCP resources/tools, Claude PreToolUse injection이 delivery surface다. `withholdBlocked`는 blocked payload를 agent에게 전달하지 않는다.

### 강점

- query와 MCP가 동일 JSON rendering을 재사용한다.
- pre-edit delivery는 offline/local이다.
- guard confidence가 path context confidence로 전염되지 않도록 분리됐다.
- blocked record는 identity는 남기고 payload는 숨긴다.

### 약점

- Claude hook, Codex plugin, repository MCP, PATH CLI가 서로 다른 version을 실행할 수 있다.
- 같은 record의 trust grade가 access path별로 달라질 수 있다는 field report가 존재한다.
- compatibility 표의 “automatic capture”는 설치 가능성과 실제 commit coverage가 섞여 읽힐 수 있다.

### 판정

**Core delivery PASS / Installed delivery consistency HOLD.**

---

## E — Evidence

### 현재 상태

Capture evidence는 transcript·diff quote, source 종류, locator를 포함하고 verifier가 source 존재 여부를 확인한다. benchmark는 preregistration과 result artifact를 남긴다.

### 강점

- “모델이 모델을 검증”하지 않는다.
- `Verified:`를 단순 transcript 읽기로 생성하지 못하게 한다.
- record보다 false record를 더 위험하게 본다.
- field issue가 구체적인 command·path·version을 남긴다.

### 약점

- `Provenance: drafted`는 누구나 손으로 입력할 수 있어 pipeline proof가 아니다.
- README headline number와 generated block이 다른 denominator를 사용한다.
- benchmark의 same repository·same owner·same CI·same reviewer 구조는 독립성 증거가 아니다.

### 판정

**Record evidence strong / Operational provenance incomplete.**

### 개선

`commitlore provenance verify --range` 같은 read-only audit command로 commit의 `drafted` trailer와 consumed transaction evidence를 결합한다. 결과는 최소한 `backed`, `unverified`, `missing-trailer`, `verified-empty`를 분리한다.

---

## F — Filesystem & Persistence

### 현재 상태

Pending state는 Git path를 사용해 worktree별로 분리되고, lock은 `O_EXCL`, write는 temp file + rename 방식이다. installed assets는 package root 기준으로 읽는다.

### 강점

- repository working tree가 아니라 Git administrative path에 transaction을 둔다.
- worktree 간 pending collision을 피한다.
- lock과 atomic replacement를 사용한다.
- raw transcript 대신 source hash와 verified record를 저장하는 방향이다.

### 약점

- stale process가 삭제된 plugin cache 또는 존재하지 않는 version directory를 package root로 계산한 field report가 있다.
- asset가 없는데 MCP server는 정상 시작하고 capture tool을 광고한 뒤 call 시점에 실패한다.
- 여러 install root의 retention 정책과 active reference가 한눈에 보이지 않는다.

### 판정

**Local transaction persistence PASS / Installed asset resolution P0.**

### 개선

서버 시작 시 최소 asset manifest를 preflight한다. 실패 시 두 선택 중 하나만 허용한다.

1. 서버 전체가 명확한 오류로 시작을 거부한다.
2. read-only query surface만 degraded mode로 제공하고 capture tool은 광고하지 않는다.

“tool은 존재하지만 첫 호출이 ENOENT”인 상태는 금지한다.

---

## G — Git Semantics

### 현재 상태

Git trailer parser 위임, SHA-1/SHA-256 full ID, revision resolution, rename following, global lifecycle fold, squash preservation, notes mirror를 구현한다.

### 강점

- abbreviation과 persisted full OID를 분리했다.
- 40/64자 full object ID만 canonical identity로 인정한다.
- path-scoped query에서도 lifecycle retirement는 repository global stream으로 계산한다.
- merge commit의 first-parent diff를 고려한다.
- DCO·Co-authored-by를 CommitLore record로 오인하지 않는다.

### 약점

- Git notes fetch/sync는 일반 사용자가 이해하기 어려운 운영 surface다.
- `refs/notes/*:refs/notes/*`는 CommitLore 한 ref보다 넓다. 현재 동작을 깨는 결함은 아니지만 최소 권한 원칙상 exact refspec 검토 가치가 있다.

### 판정

**PASS.** 프로젝트의 핵심 강점이다.

---

## H — Hooks

### 현재 상태

`commit-msg`, `prepare-commit-msg`, `post-commit`, `pre-push`, Claude PreToolUse hook이 있다. 기존 hook은 foreign이면 덮어쓰지 않고 chain 또는 refusal 정책을 사용한다.

### 강점

- capture enrichment 실패가 commit이나 branch push를 막지 않는다.
- pre-push remote child에 timeout과 non-interactive 환경을 적용한다.
- notes 내부 push는 `--no-verify`로 recursion을 방지한다.
- commit-msg diagnostic은 trailer가 Git parser에 인식되지 않은 이유를 정확히 알려준다.
- hook target containment와 symlink 방어가 있다.

### 약점

- hook body가 같아도 recorded CLI target이 바뀌었는데 “unchanged”라고 출력한다.
- Git hook pin이 release upgrade 뒤 오래된 install을 계속 가리킬 수 있다.
- PreToolUse version check는 있지만 MCP process·Codex cache와 하나의 상태로 합쳐지지 않는다.

### 판정

**Safety PASS / Upgrade convergence HOLD.**

---

## I — Index

### 현재 상태

`node:sqlite` 기반 derived index, schema v4, FTS5 candidate prefilter, scan fallback, classifier semantics 변경 시 rebuild를 사용한다.

### 강점

- index import failure가 validate·guard 같은 비-index command를 죽이지 않는다.
- schema mismatch와 corruption을 cache rebuild 문제로 취급한다.
- scan과 SQL의 Unicode substring semantics를 맞춘다.
- path/trailer cardinality 폭증을 normalization으로 피한다.
- budgeted cold build가 partial state를 명시한다.

### 약점

- 현장에서는 v4 index를 v3 reader가 만나 매 query full scan으로 fallback하는 상태가 보고됐다.
- newer index를 older long-lived process가 읽는 경우 자동 수렴이 아니라 영구 degradation이 된다.

### 판정

**Implementation PASS / Multi-runtime operation P0.**

### 개선

Index metadata에 writer runtime identity를 기록하고, current reader와 mismatch가 나면 다음을 명확히 분리한다.

- reader가 더 새로움: derived cache 삭제 후 rebuild
- reader가 더 오래됨: stale runtime임을 명시하고 process restart/upgrade를 요구
- 같은 version인데 schema가 다름: installation integrity failure

무한 fallback은 허용하지 않는다.

---

## J — JSON & MCP

### 현재 상태

MCP stdio server는 stdout을 JSON-RPC 전용으로 보호하고, advertised JSON Schema를 handler boundary에서 재사용해 validation한다. repository 밖 path escape를 거부한다.

### 강점

- unknown·missing·misnamed argument를 caller error로 처리한다.
- decoded capture draft shape도 다시 확인한다.
- query와 before-change가 local data만 사용한다.
- serverInfo version을 package manifest에서 읽는다.
- malformed request와 genuine empty를 구분한다.

### 약점

- repository `.mcp.json`의 상대 `./dist/commitlore.mjs`와 `cwd: "."`는 host launch root에 민감하다.
- serverInfo version만으로 package root·entrypoint·index schema를 비교할 수 없다.
- doctor는 registration string을 보고 “ours”라고 판단하지만 실제 initialize/tools probe를 수행하지 않는다.
- session root가 다른 multi-repo 작업에서는 repository MCP discovery가 되지 않을 수 있다.

### 판정

**Protocol boundary PASS / Discovery·identity P0.**

---

## K — Knowledge Lifecycle

### 현재 상태

`Record-Id`, `Follows`, `Supersedes`, `Expires`, notes mirror, identity collision, lifecycle fold를 제공한다.

### 강점

- commit SHA가 아니라 rewrite-stable record identity를 사용한다.
- supersession은 path 밖 commit에서도 전역 적용된다.
- notes와 commit message의 동일 record를 logical identity로 결합한다.
- ambiguous identity collision payload를 숨긴다.
- 삭제 대신 supersession을 사용해 역사성을 유지한다.

### 약점

- unattended noise가 쌓이면 immutable history 비용이 커진다.
- promotion은 새 authored record가 drafted record를 supersede해야 하므로 UX가 아직 없다.
- stale condition review의 조직 운영 흐름은 제품보다 문서에 가깝다.

### 판정

**PASS.** 다만 R2 certification에서 silence rate와 false-positive record rate를 함께 측정해야 한다.

---

## L — Logging & Observability

### 현재 상태

Doctor는 16개 check를 runtime·transport·capture·delivery·history·index로 분류한다. MCP lifecycle start/exit/crash log와 pending backlog도 있다.

### 강점

- check registry가 machine-readable하고 partial selection을 지원한다.
- dependency 때문에 실행하지 못한 check를 skipped/blocked로 구분한다.
- stale PreToolUse version과 CLI version을 비교한다.
- MCP crash·unfinished process 흔적을 남긴다.

### 약점

- `auto status`는 policy가 켜졌는지 답하지만 실제 attempt/outcome coverage를 답하지 못한다.
- current MCP registration을 live probe하지 않는다.
- CLI·hook·Claude·Codex·MCP·index identity를 한 report에서 비교하지 않는다.
- past lifecycle log가 현재 host tool availability를 복구하지는 못한다.

### 판정

**Good foundation / Operational truth incomplete.**

---

## M — Multi-host

### 현재 상태

Claude Code plugin, Codex plugin, Hermes integration, generic MCP registration을 제공한다. compatibility 문서에 tested/assisted 상태가 있다.

### 강점

- host-owned state를 직접 임의 수정하지 않고 host CLI를 사용하는 경로가 있다.
- Codex marketplace source가 foreign이면 설치를 거부한다.
- installer custom registration을 보존하면서 live MCP probe한다.
- R3 상세 티켓을 R2 전 미리 만들지 않는 로드맵 규율이 있다.

### 약점

- “MCP를 지원한다”와 “commit lifecycle hook을 제공한다”는 다른 능력인데 표에서 쉽게 섞인다.
- 한 host가 여러 repository를 다루는 session-root 모델이 인증되지 않았다.
- Claude와 Codex plugin cache update semantics가 서로 다르고 한 상태로 수렴하지 않는다.
- 현재 실제 자동 capture certification은 어떤 host에도 없다.

### 판정

**Assisted multi-host PASS / Certified multi-host NO-GO.**

---

## N — Notes

### 현재 상태

Notes mirror는 rewrite survival을 담당한다. availability는 `present | absent | unfetched`로 구분하고, sync는 scratch ref로 fetch한 뒤 fast-forward 또는 union merge한다.

### 강점

- forced fetch가 local record를 덮어쓰던 결함을 제거했다.
- remote와 local이 diverge하면 손실 없는 `cat_sort_uniq` merge를 시도한다.
- notes sync 실패가 branch push를 막지 않는다.
- fresh clone에서 notes 미수신을 clean empty로 말하지 않는다.

### 약점

- merged PR #628은 real bare remote와 two-clone을 사용하지만 공식 bootstrap command를 실행하지 않는다.
- query result는 검증하지만 실제 PreToolUse injection delivery까지 검증하지 않는다.
- timeout warning이 pending notes 존재 여부와 retry action을 구분하지 않는다.

### 판정

**Core design PASS / User journey closure incomplete.**

---

## O — Operations & Doctor

### 현재 상태

`init`, `doctor`, `auto status`, `hooks status`, `pending`, `sync`, installer summary가 운영 surface다.

### 강점

- installer exit 0의 의미를 host별 healthy 결과로 강화했다.
- doctor check 구조가 확장 가능하다.
- foreign hook/config를 함부로 덮어쓰지 않는다.
- fix action과 read-only diagnosis를 분리한다.

### 약점

- 업그레이드 후 모든 실행 surface를 다시 가리키게 하는 convergence command가 없다.
- stale plugin cache와 long-lived process에 대한 단일 remediation이 없다.
- R0 milestone은 issue 0인데 milestone 자체가 open이다.
- 기존 production-readiness SSOT가 v0.8.1·과거 main을 가리킨다.

### 판정

**Controlled operation possible / Fleet operation NO-GO.**

---

## P — Packaging & Plugins

### 현재 상태

Plugin-first, Node-only distribution이다. repository에는 committed `dist/`와 `spec/`가 있고 installer는 pinned checkout과 stable wrapper를 사용한다. release에는 binary asset이 없다.

### 강점

- native dependency를 제거하고 Node LTS builtin SQLite를 사용한다.
- installer는 tracked runtime assets와 version을 검증하고 atomic activation한다.
- Codex marketplace origin을 확인해 name collision 공급망 위험을 막는다.
- plugin cache를 직접 쓰지 않고 host CLI를 사용한다.

### 약점

- 같은 source를 macOS와 Linux에서 build하면 committed `dist/` bytes가 달라지는 이슈가 열려 있다.
- contributor error는 canonical Linux builder를 설명하지 않는다.
- Claude·Codex cache에 서로 다른 release가 남을 수 있다.
- Codex plugin metadata의 privacy/terms URL이 `dev` branch의 `LICENSE`를 가리켜 의미가 틀리다.
- `curl .../main/install.sh | sh`는 bootstrap 첫 단계가 mutable main에 의존한다. installer 내부 pinning이 강해도 최초 script 자체의 provenance는 별도다.

### 판정

**Installer logic strong / Reproducible artifact and cache convergence HOLD.**

---

## Q — Query & Retrieval

### 현재 상태

`context`, `limits`, `ruled-out`, `warnings`, MCP resource/tool이 shared query engine을 사용한다.

### 강점

- one-path rename follow
- global lifecycle fold
- index/scan equivalence
- notes availability·history availability·unread commits typed output
- blocked payload withholding
- configured trust policy propagation
- bounded consumer latency

### 약점

- multi-path query는 rename follow를 하지 않으며 진단이 필요하다.
- old process/index schema skew가 성능을 지속적으로 무너뜨릴 수 있다.
- benchmark 숫자와 공개 headline의 drift 때문에 현재 성능 수치를 문서에서 그대로 신뢰하기 어렵다.

### 판정

**PASS.** 가장 제품화가 잘 된 영역 중 하나다.

---

## R — Reliability & Concurrency

### 현재 상태

Pending file lock, atomic write, staged-state binding, hook fail-open, network timeout, index lock과 retry가 있다.

### 강점

- verify replay와 stale-stage 결함을 회귀로 막았다.
- concurrent prepare/verify에 nonce lock을 사용한다.
- failed commit 뒤 `applied` transaction retry를 고려한다.
- temporary Git index를 진단한다.
- remote hang이 branch push를 무기한 멈추지 않는다.

### 약점

- process 단위 concurrency보다 **version 단위 concurrency**가 남았다. 오래된 MCP, 새 CLI, 중간 hook이 동시에 정상처럼 보인다.
- timeout 2초는 fail-open에는 적절하지만 고부하 환경에서 false warning을 낼 수 있다.
- crash-safe durability 수준은 local developer tool에 맞지만 enterprise ledger 수준으로 과장하면 안 된다.

### 판정

**In-process reliability PASS / Cross-runtime reliability P0.**

---

## S — Security & Trust

### 현재 상태

Records는 trust grading을 거치고 injection pattern은 block할 수 있다. `trustedauthor`는 Git config author string policy이며 optional signed mode는 Git `%G? == G`를 요구한다.

### 강점

- unknown provenance와 drafted/reconstructed record를 claim으로 제한한다.
- unsigned record는 signed-required mode에서 directive가 되지 않는다.
- path escape·NUL·shell interpolation을 방어한다.
- stdio stdout contamination을 막는다.
- query path는 network를 사용하지 않는다.
- custom plugin marketplace origin을 확인한다.

### 중대 약점

- author string은 commit 작성자가 위조할 수 있고 코드도 이를 명시한다.
- valid signature는 “누군가 서명했다”만 증명하고 repository가 승인한 signer인지 결합하지 않는다.
- README·SECURITY·MCP instruction에서 `[directive]`를 읽는 사람이 authentication으로 오해할 여지가 있다.
- SECURITY 문서의 vulnerability boundary와 현재 intentionally unauthenticated policy mode가 일관되지 않다.
- CLI와 MCP가 다른 runtime을 사용하면 trust grade가 달라질 수 있다.

### 판정

**Advisory use PASS / Authenticated authority NO-GO.**

### 개선

새 PKI를 만들지 않는다. Git이 제공하는 verified signer fingerprint/key identity를 repository allowlist와 비교하는 최소 binding만 추가한다.

필수 acceptance:

- valid signature + unapproved signer → claim
- forged author header → claim
- approved signer + authored provenance → directive
- commit·notes·CLI·MCP·inject 모든 route 동일 grade
- default author-string mode는 “authenticated”라는 표현을 사용하지 않음

---

## T — Testing & CI

### 현재 상태

Node 22.23.2/24, Linux/macOS Git matrix, shell/PowerShell/macOS/Alpine installer, typecheck, dist drift, conformance, dogfood, audit, benchmark schema, README checks가 있다.

### 강점

- PR required checks가 platform·runtime·installer를 폭넓게 다룬다.
- exact-head CI gate가 workflow path/ID, event, run attempt, job set을 검증한다.
- release install gate가 fresh clone에서 shipped bundle을 직접 실행한다.
- negative control을 중요하게 취급한다.
- test-only PR도 real Git remote/clone을 사용한다.

### 약점

- actual Claude/Codex host lifecycle certification은 없다.
- plugin cache upgrade·long-lived MCP restart·multi-repo session은 CI가 재현하지 않는다.
- committed dist cross-platform reproducibility가 깨져 있다.
- README checker가 모든 public fact를 소유하지 않는다.
- benchmark 실행과 판정이 같은 저장소·owner·CI 경계 안에 있다.

### 판정

**Repository CI excellent / Environment certification incomplete.**

---

## U — UX

### 현재 상태

README는 plugin install, shell install, read/query, capture, limitations를 모두 설명한다. diagnostics는 구체적이고 fail-open 여부를 명시한다.

### 강점

- trailer blank-line 오류처럼 원인과 해결 위치를 정확히 알려준다.
- `claim`, `directive`, `blocked` legend를 제공한다.
- guard의 한계를 숨기지 않는다.
- capture는 “most commits produce nothing”을 반복해 noise를 억제한다.

### 약점

- 설치 surface가 plugin, shell, PowerShell, repository MCP, host-global MCP, hook pin으로 많다.
- “auto”, “unattended”, “suggest”, “skill initiator”, “ordinary commit”의 차이는 일반 사용자가 이해하기 어렵다.
- README가 제품 소개·운영 manual·protocol summary·benchmark report 역할을 동시에 한다.
- 성공적으로 설치됐지만 어느 runtime이 실제로 실행되는지 알기 어렵다.

### 판정

**Expert UX good / Mainstream UX not ready.**

### 개선

README 첫 화면은 세 질문만 답하게 한다.

1. 무엇을 해결하는가?
2. 설치 후 자동으로 되는 것과 안 되는 것은 무엇인가?
3. 현재 상태를 한 명령으로 어떻게 확인하는가?

세부 protocol·benchmark·host matrix는 별도 문서로 이동한다.

---

## V — Versioning & Upgrade

### 현재 상태

package version, release tag, installer checkout, wrapper, hook pin, plugin cache, MCP process, index schema가 각각 version을 가진다.

### 강점

- installer는 versioned checkout을 유지해 rollback 기반이 있다.
- hook status는 recorded CLI version skew를 일부 탐지한다.
- plugin version 비교 check가 있다.
- release tag와 package version을 gate에서 비교한다.

### 치명적 약점

이 모든 version이 **한 번에 같은 것으로 수렴한다는 계약이 없다.** 현재 field report가 이를 직접 증명한다.

### 판정

**P0 release blocker.**

### 개선

다음 shared runtime identity를 만든다.

```json
{
  "schema": "commitlore_runtime_identity.v1",
  "version": "0.8.x",
  "protocol_version": "2.0",
  "entrypoint_realpath": ".../dist/commitlore.mjs",
  "entrypoint_sha256": "...",
  "package_root": "...",
  "index_schema": 4,
  "node_version": "22.x",
  "asset_health": "ok"
}
```

모든 surface가 완전히 같은 JSON을 노출할 필요는 없지만 위 필드를 비교할 수 있어야 한다. `doctor`는 PATH CLI, recorded hook, Claude hook, Codex plugin/MCP registration, live MCP server, index writer를 하나의 convergence report로 묶는다.

---

## W — Workflow & Release

### 현재 상태

Tag push만 release를 시작하고, immutable ruleset과 live tag binding을 사용한다. release asset은 없으며 source checkout이 artifact다.

### 강점

- manual/scheduled/branch push release 없음
- event SHA canonicalization
- main ancestry
- exact-head workflow/job evidence
- fresh clone gate
- publish-only write permission
- full SHA pinned actions
- tag update/deletion no bypass

### 약점

- source checkout에 committed dist가 포함되므로 reproducibility 문제가 supply-chain 문제로 이어진다.
- SBOM·source-to-dist checksum·attestation은 아직 canonical artifact 계약으로 닫히지 않았다.
- release 직후 실제 Claude/Codex marketplace cache가 새 version을 받는지 검증하지 않는다.

### 판정

**Release orchestration PASS / Artifact provenance conditional.**

---

## X — eXperiments & Benchmark

### 현재 상태

Guard corpus, CDEB, M5 re-proposal benchmark, preregistration, provenance checker가 있다.

### 강점

- M5는 사전 등록한 direction과 threshold를 공개했다.
- 예상 magnitude가 틀렸다는 점도 숨기지 않았다.
- truncation imbalance와 rerun shard를 기록했다.
- 한 모델·한 harness·synthetic tasks라는 제한을 명시했다.
- guard는 기준 미달이라 default blocker로 승격하지 않았다.

### 약점

- M5 public headline과 generated block denominator가 충돌한다.
- 같은 owner가 task, harness, analysis, repository, CI, report를 통제한다.
- synthetic task의 외적 타당성이 제한된다.
- `[claim]` 결과를 `[directive]` 또는 다른 host/model로 일반화할 수 없다.

### 판정

**Strong internal evidence / Independent validation pending.**

---

## Y — Yield & Performance

### 현재 상태

Index, FTS candidate filter, one-pass scan, 3초 consumer budget, partial diagnostics, pre-push timeout을 사용한다.

### 강점

- cold query가 영구 full scan이 되지 않게 index를 생성한다.
- incomplete answer를 complete처럼 출력하지 않는다.
- performance optimization이 semantic equivalence 위에 놓인다.
- hook network path를 bounded한다.

### 약점

- stale reader/index mismatch가 index 이점을 영구적으로 잃게 한다.
- README의 일부 latency·scale 숫자는 public fact checker 범위 밖이다.
- multi-host startup/capture latency는 인증되지 않았다.

### 판정

**Architecture good / Public performance claims need cleanup.**

---

## Z — Zero-gap Production Readiness

Production ready는 각 기능이 개별적으로 존재하는 상태가 아니라 다음 chain이 끊기지 않는 상태다.

```text
install
→ exact runtime selected
→ host loads it
→ context delivered
→ eligible commit assessed
→ record or verified-empty terminal outcome
→ commit binding preserved
→ notes shared
→ next clone receives it
→ next agent reads same trust grade
→ upgrade converges every surface
→ rollback is exercised
```

현재 끊기는 지점은 다음이다.

- exact runtime selected: **FAIL**
- host loads current build: **UNPROVEN**
- eligible commit assessed: **FAIL/UNPROVEN**
- verified-empty terminal state: **MISSING**
- next clone notes bootstrap: **PR IN PROGRESS**
- same trust grade on every route: **FIELD FAILURE**
- upgrade convergence: **FAIL**
- authenticated directive: **MISSING**
- real-team rollback exercise: **MISSING**

### Z 판정

> **Organization-wide production NO-GO.**  
> 코어 기능 부족 때문이 아니라 end-to-end runtime·host·upgrade chain이 아직 닫히지 않았기 때문이다.

---

# 5. 발견사항 등록부

## Severity 정의

| 등급 | 의미 |
|---|---|
| **P0** | 다음 patch release 전에 닫아야 하며 잘못된 권위·capture 불능·상시 degradation을 만들 수 있음 |
| **P1** | controlled pilot은 가능하지만 조직 기본 배포 전에 반드시 해결 |
| **P2** | 운영 마찰·문서 신뢰·유지보수 문제, 계획된 release에서 해결 |
| **P3** | opportunistic improvement, 현재 설계를 흔들 이유는 없음 |

## 요약

| ID | Severity | Finding | 기존 이슈 |
|---|---|---|---|
| F-001 | **P0** | Runtime identity와 upgrade convergence 부재 | #629, #631, #633, #634, #635 |
| F-002 | **P0** | MCP가 required asset이 없는 capture tool을 healthy처럼 광고 | #633, #635 |
| F-003 | **P0/P1** | CLI·MCP route 간 trust grade 불일치 | #631, #635 |
| F-004 | **P1** | Approved signer identity binding 없음 | #597 |
| F-005 | **P1** | Deterministic capture initiation과 terminal assessment 없음 | #511, #527, #618, #619 |
| F-006 | **P1** | `auto status`가 실제 capture health를 말하지 못함 | #550 |
| F-007 | **P1** | Doctor가 repository MCP command를 live-verify하지 않음 | #572 |
| F-008 | **P1** | Multi-repo/session-root capture orchestration 미완료 | #630 |
| F-009 | **P1** | `drafted` trailer가 pipeline proof가 아님 | #583 |
| F-010 | **P1** | Committed dist가 OS-dependent | #605 |
| F-011 | **P1** | README headline·generated metrics·vocabulary drift | #590 |
| F-012 | **P1** | Notes fresh-clone official journey E2E 미완료 | #551 closed by merged PR #628, acceptance 재검토 필요 |
| F-013 | **P1** | Canonical SPEC의 guard route 표현이 non-blocking ADR과 충돌 | 신규 또는 #590 범위 확장 |
| F-014 | **P1** | Release artifact checksum/SBOM/provenance 계약 미완료 | #605 |
| F-015 | **P2** | pre-push timeout 메시지가 pending 여부와 retry를 구분하지 않음 | #632 |
| F-016 | **P2** | hooks install의 “unchanged”가 config repoint를 숨김 | #629 |
| F-017 | **P2** | Compatibility prose가 실제 plugin resolution·OS prerequisite와 drift | #590 또는 별도 doc issue |
| F-018 | **P2** | Codex plugin privacy/terms URL이 LICENSE/dev branch를 가리킴 | 신규 작은 issue |
| F-019 | **P2** | Production SSOT와 milestone state stale | 운영 정리 |
| F-020 | **P2** | Benchmark independent reproduction 미완료 | #548, #549 |
| F-021 | **P3** | Notes fetch refspec가 exact CommitLore ref보다 넓음 | 선택적 |
| F-022 | **P3** | README가 소개·manual·protocol·research report를 모두 담당 | 문서 IA |

---

## F-001 — Runtime identity와 upgrade convergence 부재

**등급:** P0 · CONFIRMED

### 증거

실제 환경에서 다음 version이 동시에 살아 있었다.

```text
PATH CLI            0.8.2
Git hook pin        0.8.0
Claude plugin cache 0.8.0
Codex plugin cache  0.8.2
MCP asset lookup    0.6.0 또는 dev-<hash>
Index writer        schema v4
MCP reader          schema v3
```

### 영향

- capture prepare가 ENOENT로 완전히 막힘
- 같은 record의 trust가 CLI와 MCP에서 다름
- index가 항상 full scan fallback
- 최근 보안·정확성 fix가 일부 surface에 적용되지 않음
- 사용자에게는 모두 `commitlore`라는 같은 이름으로 보임

### 최소 해결

1. shared runtime identity 생성
2. installer·hook·plugin·MCP가 실행한 identity를 수집
3. doctor에서 mismatch를 한 report로 출력
4. upgrade 후 cache/session restart action을 구체적으로 안내
5. old index/reader mismatch를 자동 또는 명시적으로 수렴
6. clean install·upgrade·rollback E2E

### 완료 조건

```text
CLI identity == hook identity == live MCP identity == plugin identity
```

단순 version string이 아니라 entrypoint와 package root까지 같아야 한다.

---

## F-002 — Unusable capture tool advertisement

**등급:** P0 · CONFIRMED

MCP server는 query tool을 정상 제공하면서 prepare가 필요한 `spec/SPEC.md`는 존재하지 않는 root를 가리켰다. 사용자는 tools/list에서 capture capability를 보고 실제 첫 호출에서 실패한다.

### 완료 조건

- startup preflight가 package manifest, SPEC, schema를 확인
- capture assets가 없으면 capture tools를 ready로 광고하지 않음
- degraded read-only mode를 택하면 serverInfo/diagnostic에 명시
- ENOENT raw path 대신 current runtime identity와 reinstall/restart action 제공

---

## F-003 — Route 간 trust grade 불일치

**등급:** P0 · CONFIRMED FIELD REPORT

같은 repository, path, record, 시점에서 CLI는 `directive`, MCP는 `claim`을 반환했다. 현재 source에서는 shared query path를 사용하므로 가장 유력한 원인은 stale runtime이다. 원인이 무엇이든 access path에 따라 권위 의미가 달라지는 상태는 허용할 수 없다.

### 완료 조건

- fixture 하나를 CLI·MCP resource·MCP query·inject·before-change로 읽고 grade byte-equivalence 확인
- runtime identity도 함께 assertion
- mismatch 시 claim으로 조용히 downgrade하지 말고 health error를 표면화

---

## F-004 — Authenticated signer binding

**등급:** P1, 단 directive 자동 집행 제품에는 P0

현재 signed-required mode는 author string allowlist와 Git signature validity를 독립적으로 본다. 승인된 maintainer key가 서명했는지 확인하지 않는다.

### 완료 조건

- repository config가 승인 signer fingerprint/key identity를 명시
- valid but unapproved signer는 claim
- forged author header는 claim
- approved signer만 directive
- notes와 commit route 동일
- default author-string mode는 `policy directive`, `configured-author claim` 등 인증이 아닌 표현으로 문서화

---

## F-005/F-006 — Automatic capture terminal state와 운영 진실

**등급:** P1

Policy enablement, MCP registration, capture initiation, verification, staging, commit application은 서로 다른 단계다. 현재 `auto status`는 이 chain을 하나의 health로 보여주지 못한다.

### 완료 조건

- eligible commit마다 attempt id
- terminal outcome 필수
- `verified-empty` first-class state
- changed tree가 이전 assessment 무효화
- timeout/crash는 bounded degraded state
- raw transcript 저장 없음
- `auto status`가 coverage와 last outcome을 표시

---

## F-007 — Doctor MCP live probe

**등급:** P1 · PR #636 진행 중, 현재 CI 실패

Installer에는 이미 initialize + serverInfo + tools/list probe가 있다. Doctor는 같은 수준의 identity 검증을 하지 않는다.

### 개선

`probeMcp`를 installer 전용 파일에서 shared core로 옮기고 doctor가 다음을 기록한다.

```text
command, args, cwd
serverInfo.name, serverInfo.version
minimum tools
runtime package root/hash
probe latency
```

custom wrapper는 덮어쓰지 않되 `custom-verified`로 별도 표시한다.

---

## F-008 — Multi-repo/session-root capture

**등급:** P1

현재 main에는 `commitlore capture` CLI가 있으므로 #630의 “CLI equivalent 없음” 문구는 stale하다. 실제 문제는 host가 session transcript와 repository cwd를 CLI fallback에 전달하고, session root와 edited repository가 다를 때 올바른 runtime을 선택하는 orchestration이다.

### 완료 조건

- session root A에서 repo B를 편집·commit
- B의 policy·Git state·pending path를 사용
- MCP discovery 실패 시 bounded CLI fallback
- transcript가 다른 repo로 교차되지 않음
- 결과는 B에만 기록

---

## F-009 — Provenance audit

**등급:** P1

`Provenance: drafted`는 grading 힌트이지 pipeline attestation이 아니다.

### 완료 조건

`provenance verify --range`가 consumed pending transaction과 commit SHA를 join하고, ledger가 없는 clone에서는 “unverified”라고 말한다. trailer text만 보고 backed라고 판정하면 안 된다.

---

## F-010/F-014 — Canonical artifact와 provenance

**등급:** P1 · PR #637 진행 중, snapshot 시 CI 진행·mergeable=false

Committed `dist/`가 Linux builder bytes이고 macOS build와 다르다는 field measurement가 있다.

### 완료 조건

- canonical builder를 명시
- 가능한 경우 cross-platform deterministic build
- 불가능하면 reproducible container/CI command와 정확한 contributor error
- source SHA, dist hash, manifest, SBOM, provenance를 release에 결합
- fresh clone install gate가 그 hash를 사용

새 binary matrix나 registry를 추가할 필요는 없다. 현재 source-checkout distribution을 더 검증 가능하게 만드는 문제다.

---

## F-011/F-013/F-017 — Public truth SSOT

**등급:** P1

현재 README checker는 generated benchmark block과 몇 가지 statistic pattern만 소유한다. headline rate·fraction·latency·version·Node floor·vocabulary value·compatibility prose는 drift할 수 있다. 또한 SPEC §5의 guard route가 “blocks re-proposal”이라고 표현하지만 accepted ADR은 non-blocking experimental advisory다.

### 완료 조건

- 모든 headline metric을 generated block 안으로 이동하거나 hand-maintained라고 명시
- denominator 하나로 수렴
- vocabulary key뿐 아니라 value grammar도 checker가 비교
- package version·Node floor·protocol version·host status를 generated facts에서 렌더링
- SPEC의 guard behavior를 advisory로 수정
- EN/KO/JA/ZH README 동일 source 사용

---

## F-012 — Notes official journey E2E

**등급:** P1

PR #628은 review 도중 merge됐고 #551도 completed로 닫혔다. 테스트는 real bare remote와 두 clone을 사용해 bootstrap 전 refusal, refspec fetch 후 query visibility, refspec/local mirror 제거 후 refusal, commit-message record의 독립성을 잘 고정한다. 그러나 #551의 acceptance 전체와 비교하면 두 seam이 여전히 빠져 있다.

1. 직접 `git config --add remote.origin.fetch`를 호출하며 문서화된 `doctor --fix`/bootstrap command 자체를 실행하지 않는다.
2. `runQuery()` 결과만 확인하며 실제 PreToolUse/buildInjection delivery를 확인하지 않는다.

따라서 **코드 merge는 유효하지만 issue closure는 과도하다.** #551을 reopen해 남은 두 acceptance를 같은 issue에서 닫거나, SSOT contract를 의도적으로 query-boundary 수준으로 낮추는 명시적 supersession이 필요하다. 새 중복 issue를 만드는 것보다 #551 reopen이 낫다.

---

## F-015/F-016 — 작은 운영 마찰

**등급:** P2

- notes mirror timeout 시 local pending note가 없는 경우 “publish 실패”처럼 들리지 않게 구분
- `commitlore sync` 재시도 action 또는 다음 push 자동 retry 사실 표시
- hook file은 unchanged지만 target config가 바뀌면 “repointed v0.8.0 → v0.8.x” 출력

---

## F-018 — Plugin policy metadata

**등급:** P2

Codex plugin metadata의 `privacyPolicyURL`, `termsOfServiceURL`이 `blob/dev/LICENSE`를 가리킨다. LICENSE는 privacy policy나 terms가 아니며 `dev`는 canonical release branch도 아니다.

### 개선

- 실제 `PRIVACY.md`, `TERMS.md`가 없다면 해당 field를 제거할 수 있는지 host schema 확인
- 필요하다면 최소 local/offline data handling policy를 작성
- 링크는 immutable tag 또는 main canonical path 사용

---

## F-019 — SSOT·milestone hygiene

**등급:** P2

- R0 milestone은 open issue 0인데 open 상태
- production-readiness SSOT는 과거 main과 v0.8.1을 snapshot으로 사용
- #629–#635 일부가 milestone 없이 흩어짐

### 개선

새 대형 기획서를 또 만들지 말고 기존 SSOT의 evidence snapshot만 4.0으로 갱신한다. 규범 불변식은 유지하고 현재 live state·완료 항목·runtime convergence root cause만 반영한다.

---

## F-020 — Benchmark independence

**등급:** P2, 외부 마케팅 claim에는 P1

M5는 내부 실험으로는 매우 좋다. 그러나 독립적인 benchmark라고 부르려면 task pack, harness, run logs, evaluator를 외부가 재현하거나 holdout을 별도 관리해야 한다.

### 개선

- frozen task pack hash
- immutable harness commit
- raw run artifact provenance
- external rerun instructions
- 최소 1개 다른 model/host
- independent reviewer 또는 blind holdout

---

# 6. 다음 패치 릴리스 개선안

다음 patch는 기능 확장이 아니라 **한 설치가 하나의 제품으로 수렴하도록 만드는 release**여야 한다.

## RB-1. Runtime identity contract

### 범위

- shared identity function
- CLI JSON exposure
- MCP serverInfo/health exposure
- hook/plugin probe integration
- index schema/writer identity

### 비목표

- daemon
- hosted registry
- auto-update service
- 새 database
- generic fleet control plane

### RED test

0.8.0 hook·plugin·MCP process가 있는 fixture에 current build를 설치했을 때 doctor가 모두 green이면 실패해야 한다.

### PASS

- 모든 surface current identity
- stale surface는 정확한 remediation
- deleted package root 탐지
- long-lived process restart 필요 표시

---

## RB-2. MCP asset preflight와 doctor live probe

### 범위

- package manifest, SPEC, schema 존재·readability 확인
- initialize + tools/list probe shared implementation
- capture tool readiness와 query-only degraded mode 구분

### RED test

SPEC directory를 제거한 설치가 tools/list에서 정상 capture tool을 광고하면 실패.

---

## RB-3. Runtime-skew trust/index regression

### 범위

- 동일 record의 route equivalence
- v3/v4 index mismatch convergence
- stale process message

### RED test

- CLI directive / MCP claim fixture
- newer index + older reader fixture
- same package version + different index schema fixture

---

## RB-4. Public contract correction

다음 runtime patch와 함께 최소한 다음 문서는 현재 사실로 맞춘다.

- SPEC guard advisory wording
- compatibility plugin resolution 설명
- current release/main snapshot
- `commitlore capture` CLI 존재에 맞춘 #630 설명
- plugin policy URLs

이는 대형 문서 리라이트가 아니라 false fact 제거다.

---

# 7. R1 — Broad production 전 운영 경계

R1은 다음 여섯 결과만 소유하게 정리한다.

1. **Authenticated signer binding** — #597
2. **Canonical reproducible artifact** — #605
3. **CI/public facts SSOT** — #590
4. **Notes fresh-clone journey** — #551 reopen 검토 / merged PR #628 후속 acceptance
5. **Live MCP health and runtime convergence** — #572 + #635 umbrella
6. **Compatibility claims evidence** — host·OS·capability matrix

### R1 Exit

- CLI·hook·plugin·MCP identity 일치
- approved signer만 directive
- fresh clone notes unknown/receive behavior E2E
- public metric·version·vocabulary 충돌 CI 불가
- canonical builder와 source-to-dist hash 존재
- 모든 advertised host row가 `tested | assisted | unsupported | unknown` 중 하나이며 근거 링크 보유

---

# 8. R2 — Certified Autocapture: Claude Code

R2는 기능 개발보다 **한 exact host version에서 100% terminal assessment를 증명하는 단계**다.

## 실행 순서

1. #527 deterministic initiator
2. #618 verified-empty + local fallback
3. #550 operational status
4. #583 provenance verification
5. #424 MCP loss/restart fallback
6. #619 exact Claude version 100-commit certification
7. #511 umbrella close

## Certification matrix

- important change
- trivial change
- changed staged tree
- MCP disconnect
- stale plugin cache
- process restart
- direct human commit
- amend
- pathspec/temporary index
- linked worktree
- session root와 repo root 불일치
- no-network/offline

## Pass criteria

```text
eligible commits             100
capture attempts             100
terminal outcomes            100
silent unassessed              0
wrong-tree                     0
stale attach                    0
duplicate stage                 0
hook hang                       0
raw transcript in report        0
```

실패가 1개라도 있으면 “Claude Code에서 automatic capture” claim은 certified가 아니라 assisted다.

---

# 9. R3 — Host별 인증

R2가 닫히기 전에 상세 구현 티켓을 만들지 않는다.

각 host는 독립 row다.

| Host | 필요한 증거 |
|---|---|
| Claude Code | lifecycle hook + exact version certification |
| Codex | plugin cache·MCP lifecycle·commit intent certification |
| Hermes | plugin install·session cwd·fallback certification |
| Generic MCP | read/capture tools만 assisted, commit initiation은 별도 |

한 host의 MCP protocol compatibility를 다른 host의 commit lifecycle evidence로 일반화하지 않는다.

---

# 10. R4 — Commercial Launch

다음이 모두 있어야 한다.

- real-team pilot
- support policy
- security response process
- upgrade and rollback runbook
- exercised rollback evidence
- compatibility lifecycle policy
- data handling/privacy statement
- incident telemetry without raw transcript
- release channel and deprecation policy

R4 전에 billing, hosted dashboard, organization control plane을 만들지 않는다.

---

# 11. 권장 GitHub 정리

## 11.1 기존 이슈를 재사용한다

| Root cause | 권장 owner issue | 처리 |
|---|---:|---|
| Runtime convergence | **#635 umbrella** | #633 symptom 통합, #631/#634 acceptance 연결 |
| MCP live health | #572 / PR #636 | shared probe 방향은 맞지만 capture tool·asset readiness 보강 |
| Session-root fallback | #630 | “CLI 없음” 문구 수정, orchestration으로 재정의 |
| Hook repoint message | #629 | P2로 R1 배치 |
| Timeout wording | #632 | P2로 R1 배치 |
| Trust auth | #597 | 유지 |
| Public facts | #590 | 범위 유지, SPEC/compatibility drift 연결 |
| Artifact | #605 / PR #637 | canonical manifest는 유효, full contract와 `Closes` 범위 정렬 |
| Notes clone | #551 | merged #628의 누락 acceptance 때문에 reopen 또는 contract supersede |

같은 root cause에 신규 이슈를 여러 개 더 만들지 않는다.

## 11.2 상태 정리

- R0 milestone: exit evidence 확인 후 close
- #633: #635에서 clean-install root cause와 regression이 확보되면 duplicate/superseded 처리
- #631/#634: symptom acceptance는 유지하되 implementation은 #635 root cause PR 하나가 소유 가능
- #630: current main에 CLI capture가 있으므로 issue 본문 status note 추가
- #551/#628: merge는 유지하되 공식 bootstrap + injection E2E가 빠졌으므로 #551 reopen 또는 contract supersede
- R3/R4: 현재처럼 세부 issue 생성을 보류

---

# 12. 구현 티켓 수준의 완료 조건

## 12.1 Runtime identity

```text
Given current CLI and stale hook/plugin/MCP installs
When doctor runs
Then it prints every surface, version, entrypoint and package root
And no stale surface is reported ok
And one documented repair sequence converges them
```

## 12.2 Upgrade E2E

```text
install v0.8.0
wire hooks + Claude + Codex + MCP
start an MCP session
create v3 index
upgrade to current
verify stale session is detected
restart host
verify all identities current
verify index rebuilt/current
verify prepare/verify/stage works
verify query grades match CLI/MCP/inject
```

## 12.3 Missing asset

```text
remove spec/SPEC.md from selected runtime
start MCP
expect startup refusal or explicit query-only degraded mode
expect capture tools unavailable
expect no raw ENOENT presented as normal capture outcome
```

## 12.4 Trust

```text
trusted author + unsigned                 => claim when signing required
trusted author + valid unapproved signer  => claim
forged trusted author + valid other key   => claim
approved signer + authored provenance     => directive
same result on commit and notes routes
```

## 12.5 Autocapture

```text
host receives commit intent
host captures exact repository transcript context
prepare binds current staged tree
verify produces accepted or empty
stage/apply/consume or verified-empty
status shows terminal result
MCP loss falls back once, bounded
commit never hangs
```

## 12.6 Public facts

```text
change package version, Node floor, protocol vocabulary, benchmark denominator
without regenerating docs
=> CI fails with exact owning source
```

---

# 13. 과설계 금지선

다음은 현재 문제를 해결하지 않으므로 금지한다.

- background daemon
- hosted coordination service
- 새 권한 계층
- 별도 organization database
- index를 authoritative store로 승격
- Git notes를 강제 fetch로 덮어쓰기
- query path에 network call 추가
- generic host abstraction을 R2 전에 설계
- 자동 key enrollment 또는 자체 PKI
- 모든 capture event에 raw transcript 저장
- 기능별 gate issue 남발
- R3/R4 세부 ticket 선생성
- runtime convergence를 해결한다며 plugin cache를 직접 임의 수정

현재 구조를 재사용한다.

```text
shared core
existing doctor registry
existing installer MCP probe
existing pending transaction
existing Git hooks
existing CLI capture fallback
existing milestones
```

---

# 14. 공개 메시지 권고

## 지금 말해도 되는 것

- Git-native lifecycle-aware decision memory
- active decision context를 path-scoped로 agent에게 전달
- Git history와 notes를 권위 source로 사용
- malformed·unavailable·unfetched를 empty와 구분
- preregistered M5에서 한 model/harness/synthetic task 조건하에 re-proposal 감소 관찰
- guard는 experimental advisory

## 아직 말하면 안 되는 것

- 모든 coding agent에서 automatic capture
- 설치만 하면 모든 commit이 assessment됨
- cryptographically authenticated directives by default
- organization-wide production ready
- independent benchmark proven
- every host on Windows/macOS/Linux fully supported
- token savings proven

## 권장 한 문장

> CommitLore carries the reasoning behind code through Git and delivers it to the next coding agent; automatic capture is being certified host by host.

---

# 15. 최종 출시 판정표

| Gate | 현재 | Broad production 요구 |
|---|---|---|
| Protocol grammar | PASS | 유지 |
| Git lifecycle | PASS | 유지 |
| Query correctness | PASS | runtime equivalence 회귀 추가 |
| Index | CONDITIONAL | stale reader/writer 수렴 |
| Capture core | PASS | asset preflight |
| Capture initiation | FAIL | deterministic host initiator |
| Verified-empty | MISSING | first-class terminal state |
| MCP health | CONDITIONAL | live identity probe |
| Runtime convergence | FAIL | all surfaces same identity |
| Notes clone | PARTIAL | official bootstrap + injection E2E |
| Trust auth | FAIL | approved signer binding |
| Installer | PASS/CONDITIONAL | plugin cache convergence |
| Artifact reproducibility | FAIL | canonical builder/hash/SBOM |
| CI | PASS | host lifecycle certification 추가 |
| Release gate | PASS | artifact provenance 결합 |
| Public facts | FAIL | generated SSOT |
| Claude autocapture certification | NOT RUN | 100/100 terminal outcomes |
| Multi-host certification | NOT STARTED | host별 인증 |
| Real-team pilot | NOT RUN | rollback 포함 |

---

# 16. 최종 결론

CommitLore의 코어는 매우 높은 수준이다. 특히 다음 세 가지는 일반적인 개인 OSS를 넘어선다.

1. **의미가 틀린 성공을 가장 위험하게 취급한다.**
2. **Git·model·cache·network 각각의 권위 범위를 명시한다.**
3. **실험 결과와 실패 경계를 숨기지 않는다.**

현재 발목을 잡는 것은 기능 부족이 아니다. 하나의 제품이 여러 설치 surface로 복제되면서 **무엇이 실제로 실행 중인지 증명하지 못하는 운영 일관성**이다. 이 문제를 닫지 않은 채 R2 자동 capture나 R3 multi-host를 확장하면, 더 많은 host에서 더 많은 stale runtime을 만드는 결과가 된다.

따라서 가장 올바른 순서는 다음이다.

```text
runtime convergence
→ MCP/current identity truth
→ R1 trust·artifact·public facts·notes
→ R2 Claude Code deterministic autocapture certification
→ R3 host-by-host certification
→ R4 commercial operation
```

### 최종 점수

```text
엔지니어링 수준          8.9 / 10
핵심 프로토콜            9.3 / 10
Query·lifecycle          9.2 / 10
Capture engine           9.2 / 10
CI·release               9.3 / 10
Runtime convergence      5.8 / 10
Authenticated trust      7.1 / 10
Automatic capture        6.2 / 10
현재 제품 완성도          7.7 / 10
조직 전체 production     NO-GO
```

### 최종 한 문장

> **CommitLore는 이미 강한 Git-native decision-memory engine이지만, 다음 단계는 기능을 더 만드는 것이 아니라 모든 실행 surface가 같은 build·같은 trust·같은 state를 말하도록 수렴시키는 것이다.**

---

# Appendix A. 핵심 증거 링크

## Source

- [Protocol SPEC](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/spec/SPEC.md)
- [Query engine](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/core/query.ts)
- [Index](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/core/index-db.ts)
- [Notes](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/core/notes.ts)
- [Notes sync](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/core/sync.ts)
- [Capture prepare](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/core/capture-prepare.ts)
- [Capture verify](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/core/capture-verify.ts)
- [Capture stage](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/core/capture-stage.ts)
- [Pending transaction](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/core/pending.ts)
- [MCP server](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/mcp/server.ts)
- [MCP argument validator](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/mcp/validate-args.ts)
- [Trust policy](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/core/trusted-authors.ts)
- [Grading](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/core/grade.ts)
- [Doctor registry](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/commands/doctor/registry.ts)
- [Installer host probe](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/src/commands/installer-hosts.ts)
- [Claude commit skill](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/skills/commitlore-commits/SKILL.md)
- [CI workflow](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/.github/workflows/ci.yml)
- [Release workflow](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/.github/workflows/release.yml)
- [Compatibility matrix](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/docs/COMPATIBILITY.md)
- [Current production-readiness SSOT](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/docs/PRODUCTION-READINESS-SSOT.md)

## Current pull requests

- [#636 Doctor live MCP probe — CI failure, capture readiness gap](https://github.com/MongLong0214/commitlore/pull/636)
- [#637 Canonical artifact manifest — CI in progress, contract scope gap](https://github.com/MongLong0214/commitlore/pull/637)
- [#628 Two-clone notes test — merged into current main](https://github.com/MongLong0214/commitlore/pull/628)

## Primary issues

- [#635 runtime/plugin/MCP version divergence](https://github.com/MongLong0214/commitlore/issues/635)
- [#634 index schema reader/writer mismatch](https://github.com/MongLong0214/commitlore/issues/634)
- [#633 missing dev asset root](https://github.com/MongLong0214/commitlore/issues/633)
- [#631 CLI/MCP trust mismatch](https://github.com/MongLong0214/commitlore/issues/631)
- [#630 multi-repo session-root capture](https://github.com/MongLong0214/commitlore/issues/630)
- [#597 signer authority](https://github.com/MongLong0214/commitlore/issues/597)
- [#572 MCP doctor identity](https://github.com/MongLong0214/commitlore/issues/572)
- [#605 reproducible dist](https://github.com/MongLong0214/commitlore/issues/605)
- [#590 public facts drift](https://github.com/MongLong0214/commitlore/issues/590)
- [#551 two-clone notes journey — closed, acceptance 재검토](https://github.com/MongLong0214/commitlore/issues/551)
- [#527 deterministic initiation](https://github.com/MongLong0214/commitlore/issues/527)
- [#550 operational auto status](https://github.com/MongLong0214/commitlore/issues/550)
- [#583 provenance verification](https://github.com/MongLong0214/commitlore/issues/583)
- [#618 verified-empty and fallback](https://github.com/MongLong0214/commitlore/issues/618)
- [#619 Claude certification](https://github.com/MongLong0214/commitlore/issues/619)

## Research

- [M5 verdict](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/bench/VERDICT-M5.md)
- [Guard advisory ADR](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/docs/adr/ADR-0020-guard-is-an-experimental-advisory.md)
- [Unattended capture ADR](https://github.com/MongLong0214/commitlore/blob/b578ca9890aa4ddb264ebd0f94968aa08636e00e/docs/adr/ADR-0030-capture-runs-unattended-and-an-unread-record-cannot-direct.md)

---

# Appendix B. Release 전 최종 체크리스트

## Patch release

- [ ] Runtime identity shared contract
- [ ] CLI/hook/Claude/Codex/MCP/index convergence report
- [ ] Missing capture asset startup regression
- [ ] CLI/MCP trust equivalence regression
- [ ] index schema mismatch convergence
- [ ] doctor live MCP probe
- [ ] exact remediation for stale session/cache
- [ ] SPEC guard wording corrected
- [ ] compatibility false facts corrected
- [ ] exact-head required CI success
- [ ] clean install + upgrade + rollback E2E

## R1

- [ ] approved signer binding
- [ ] canonical artifact builder/hash/SBOM/provenance
- [ ] README public facts generated SSOT
- [ ] official notes bootstrap + injection E2E
- [ ] host/OS capability evidence matrix

## R2

- [ ] deterministic initiator
- [ ] verified-empty
- [ ] attempt/outcome ledger
- [ ] operational auto status
- [ ] MCP loss local fallback
- [ ] provenance verify
- [ ] exact Claude Code 100-commit certification

## Commercial

- [ ] real-team pilot
- [ ] exercised rollback
- [ ] support and security response policy
- [ ] privacy/data handling statement
- [ ] compatibility/deprecation policy
- [ ] organization-wide claim approved only after evidence
