---
document_id: commitlore-production-readiness-ssot
document_version: 3.0.0
status: normative-until-superseded
evidence_snapshot_date: 2026-08-13
evidence_main_sha: 2adad4250b3a2d63830ab1c60fe94f0dba6fa0d5
evidence_release_tag: v0.8.1
canonical_repository_path: docs/PRODUCTION-READINESS-SSOT.md
companion_handoff_document_id: commitlore-github-migration-handoff
minimum_companion_handoff_version: 3.0.0
companion_handoff_filename: CommitLore_GitHub_Migration_Agent_Handoff_FINAL_REVIEWED_2026-08-13.md
supersedes:
  - commitlore-production-readiness-ssot@2.0.0
  - commitlore_final_production_readiness_a_to_z_review_2026-08-13.md
---

# CommitLore 최종 프로덕션 레디 A–Z 리뷰 및 상용화 개선 SSOT

> **역할:** 제품·기술·출시 판단의 최종 SSOT  
> **증거 고정점:** `main@2adad4250b3a2d63830ab1c60fe94f0dba6fa0d5` / 공개 릴리스 `v0.8.1`  
> **판정:** **Controlled pilot PASS / Organization-wide commercial production NO-GO**  
> **원칙:** 이미 해결된 결함은 다시 티켓화하지 않고, 아직 증명되지 않은 경계만 작업한다.

---

## 0. 문서 사용 규칙

이 문서는 두 종류의 내용을 분리한다.

| 종류 | 예시 | 실행 규칙 |
|---|---|---|
| 규범 계약 | 불변식, 완료 조건, release gate | 후속 SSOT/ADR이 명시적으로 supersede하기 전까지 유지 |
| 증거 스냅샷 | `main` SHA, PR 상태, CI 결과, 최신 릴리스 | 실행 직전 GitHub live state로 다시 확인 |

Live state가 바뀌어도 다음은 자동으로 성립하지 않는다.

- PR이 merge됐다고 이슈 계약 전체가 충족된 것은 아니다.
- CI가 green이라고 필요한 일이 실제로 실행됐다는 뜻은 아니다.
- `auto` 설정이 켜졌다고 capture가 시작됐다는 뜻은 아니다.
- MCP 등록 파일이 있다고 실제 CommitLore 서버가 응답한다는 뜻은 아니다.
- issue가 closed라고 release 또는 certification이 끝난 것은 아니다.

### 0.1 우선순위

1. 이 문서의 제품·기술 불변식
2. companion handoff의 GitHub 이식·멱등성 규칙
3. 현재 GitHub live state
4. 기존 ADR·spec·issue의 역사적 증거

### 0.2 과설계 방지 원칙

- 다음 단계가 시작되기 전 미래 단계의 세부 티켓을 미리 대량 생성하지 않는다.
- 현재 결함을 고치는 데 필요하지 않은 daemon, hosted service, 새 데이터베이스, 새 프로토콜 필드, 새 권한 계층을 추가하지 않는다.
- 기존 CLI·pending transaction·Git hook 구조를 재사용한다.
- 하나의 경계를 하나의 이슈가 소유하게 하되, 단순한 구현을 인위적으로 여러 이슈로 쪼개지 않는다.
- gate는 milestone 완료 조건으로 표현하고 별도 gate issue를 남발하지 않는다.

---

## 1. 최종 판정

### 1.1 한 문장

> CommitLore는 Git-native lifecycle decision memory의 핵심 설계와 검증은 매우 강하지만, 설치 성공의 진실성, SHA-256 object ID 계약, pre-push 네트워크 경계, authenticated directive, artifact·CI provenance, deterministic autocapture가 아직 조직 전체 기본 배포 수준에 도달하지 않았다.

### 1.2 현재 사용 가능 범위

| 사용 시나리오 | 판정 |
|---|---|
| 개인 프로젝트 dogfooding | PASS |
| 운영자가 상태와 fallback을 이해하는 OSS 여러 개 | PASS |
| 소규모 신뢰 팀 pilot | CONDITIONAL PASS |
| 조직 전체 기본 설치 | NO-GO |
| 규제·보안 민감 조직 | NO-GO |
| “모든 코딩 에이전트에서 자동 capture” 판매 | NO-GO |
| Git-native lifecycle-aware decision delivery | PASS |

### 1.3 현재 수준

| 영역 | 평가 |
|---|---:|
| 문제 정의·차별성 | 9.3/10 |
| Git source-of-truth·lifecycle | 9.2/10 |
| query/index·성능 | 9.0/10 |
| 테스트·CI breadth | 9.1/10 |
| runtime installer transaction | 8.8/10 |
| capture pipeline downstream | 8.7/10 |
| trust/authentication | 7.1/10 |
| host wiring 진실성 | 6.2/10 |
| artifact·CI provenance | 6.5/10 |
| deterministic autocapture | 5.8/10 |
| **종합 엔지니어링** | **8.5/10** |
| **상용 production readiness** | **7.0/10** |

---

## 2. 증거 스냅샷

### 2.1 저장소 기준점

- Repository: `MongLong0214/commitlore`
- Snapshot `main`: `2adad4250b3a2d63830ab1c60fe94f0dba6fa0d5`
- 공개 릴리스: `v0.8.1`
- package version: `0.8.1`
- Node floor: `>=22.23.2`
- 기본 브랜치: `main`, protected

### 2.2 스냅샷 당시 열린 PR

| PR | 스냅샷 판정 |
|---:|---|
| #610 | exact head CI green인 patch dependency update; 먼저 merge 가능 |
| #604 | schema enforcement·signature-policy propagation은 유효. PR body에서 #597 완전 종료 표현을 제거하고 rebase/CI 후 merge 가능 |
| #613 | SHA-256 방향은 맞지만 full OID와 abbreviation을 혼합. 변경 요청 |
| #609 | live diff가 0이면 superseded close |
| #579 | Vitest 2→4 major migration이며 CI 실패. close 후 별도 migration으로 재기획 |
| #580 | Node 22 지원 중 Node 26 types로 올리는 변경. close/not planned |

### 2.3 검토 한계

독립 clone은 네트워크 제약으로 실행하지 못했으며, 고정 SHA의 source·GitHub Actions 로그·PR/issue diff를 교차 검토했다. source-derived finding은 반드시 failing regression으로 재확인한 뒤 작업한다.

---

## 3. 이미 해결됐으므로 다시 티켓화하면 안 되는 항목

### 3.1 verification replay stale-stage 문제

`main@2adad425…`에는 verification 결과를 저장하지 못하면 pending transaction을 폐기하는 단일 `settle` 경로와, built MCP → verify replay → commit 경계의 회귀 테스트가 존재한다.

**판정:** 해결됨. 새 T-001/generation redesign 이슈를 만들지 않는다. 다음 release candidate에서 기존 회귀 테스트가 계속 통과하는지만 확인한다.

### 3.2 DCO/GitHub trailer 충돌

PR #611이 `Signed-off-by`·`Co-authored-by`를 CommitLore record로 오인하던 문제와 dogfood 범위를 수정했다.

**판정:** issue #612는 #611 merge를 live 확인한 뒤 close한다.

### 3.3 cold query 전체 rebuild

query가 편집 경로에서 전체 rebuild를 소유하던 문제는 bounded scan·incremental catch-up 구조로 수정됐다.

**판정:** 새 설계 티켓을 만들지 않는다.

### 3.4 runtime installer transaction

pinned checkout, runtime manifest, tracked-file verification, smoke test, atomic activation, 이전 wrapper 보존은 현재 강점이다.

**판정:** runtime installer 전체를 다시 쓰지 않는다. 남은 문제는 host wiring 결과의 진실성(#595)이다.

---

## 4. R0 — 다음 patch release blockers

R0는 **현재 사용자에게 거짓 성공, 잘못된 범위, 무한 대기, 잘못된 Git identity를 줄 수 있는 경계만** 포함한다.

### R0-01. MCP outer schema enforcement — #594 / PR #604

#### 현재 상태

PR #604는 advertised schema를 handler boundary에서 검사하고, missing·misnamed·unknown field와 누락된 `diff`를 `isError`로 바꾼다. 또한 `requireSignedDirective`를 guard 계열 경로로 전달한다.

#### 병합 계약

- PR body의 `Closes #597`을 제거한다.
- `Closes #594`와 `Partially addresses #597`로 분리한다.
- 최신 `main`에 rebase한다.
- exact-head required checks가 모두 success인지 재검증한다.
- 현재 advertised schema에서 **의도적으로 path가 optional인 query는 그대로 유지**한다. 별도 `scope: repository` 필드를 새로 도입하지 않는다.

#### 완료

PR #604 merge 후 #594를 close한다. #597은 유지한다.

### R0-02. decoded capture draft shape validation — 신규 이슈

Outer MCP schema가 `draft`를 문자열로 검증하더라도, JSON decode 후 각 record의 구조가 `DraftRecord`인지 확인되지 않으면 malformed input이 정상적인 `empty/incomplete`처럼 보일 수 있다.

#### 최소 수정

- JSON object `{ "records": [...] }`와 기존 bare array 호환은 유지한다.
- 각 record가 object인지, `trailers`와 `evidence`가 array인지 검증한다.
- trailer/evidence 원소의 필수 string field를 검증한다.
- unknown field는 허용 여부를 현재 harvest contract와 일치시킨다.
- 잘못된 draft는 `isError: true`의 caller error가 되어야 한다.
- verifier 내부에서 TypeError가 나도 stale record가 stage되지 않는 기존 회귀를 유지한다.

#### 비목표

- 새 capture protocol
- 새 JSON Schema framework
- 외부 validator 서비스

### R0-03. SHA-1/SHA-256 full object ID 계약 — 신규 이슈 + PR #613 수정

PR #613은 남은 40-char 가정을 찾았지만 `[0-9a-fA-F]{4,64}`를 full ID와 revision input에 공용으로 사용한다.

#### 불변식

- persisted/internal full OID는 SHA-1이면 정확히 40 hex, SHA-256이면 정확히 64 hex다.
- abbreviation은 명시적 CLI user-input boundary에서만 허용한다.
- abbreviation은 Git으로 unique full OID로 resolve한 뒤 내부 상태에 들어간다.
- 41–63자리 값은 full OID로 인정하지 않는다.

#### 필수 테스트

- 40·64 accept
- 4·7·39·41·63·65 reject at persisted boundary
- ambiguous prefix reject
- unknown revision reject
- SHA-1·SHA-256 real repo
- linked worktree, amend, squash, notes, pending binding

### R0-04. installer host wiring false-success — #595

#### 불변식

Installer exit 0은 요청한 host integration이 실제로 healthy이거나, 건강한 custom registration을 명시적으로 보존했음을 뜻해야 한다.

#### 최소 수정

- shell·PowerShell의 host 판단을 한 TypeScript command로 공유한다.
- command 존재·substring·디렉터리 존재를 healthy로 간주하지 않는다.
- owned registration은 exact wrapper + args `mcp`로 판단한다.
- custom registration은 live MCP initialize/serverInfo probe로 확인한다.
- host 실패가 하나라도 있으면 기본 모드 exit non-zero.
- config write는 parse → temp write → parse verify → atomic replace.

#### 비목표

runtime checkout/manifest transaction 재작성, 새로운 host 추가.

### R0-05. pre-push remote timeout — 신규 이슈

현재 pre-push는 `git fetch`·`git push`를 동기 실행하며 child timeout이 없다. 네트워크가 응답하지 않으면 fail-open catch에 도달하기 전에 사용자의 push가 멈출 수 있다.

#### 최소 수정

- hook 경로의 fetch/push에 명시적 timeout을 둔다.
- `GIT_TERMINAL_PROMPT=0`과 non-interactive SSH 정책을 사용한다.
- timeout·auth prompt·remote stall은 stderr에 한 줄을 남기고 code push를 계속한다.
- notes sync만 실패하며 branch push는 실패하지 않는다.
- 실제 bare remote와 hanging fake transport로 E2E한다.

---

## 5. R1 — broad production 전 운영 경계

R1은 controlled pilot은 가능하지만 조직 기본 배포 전에 반드시 닫아야 하는 항목이다.

### 5.1 Authenticated directive — #597

- route propagation과 signer identity binding을 분리한다.
- `signature valid`만으로 directive가 되면 안 된다.
- 실제 verified signer fingerprint/key identity가 repository allowlist에 있어야 한다.
- author header string은 display metadata이지 authentication이 아니다.
- default string mode의 `[directive]` 표현은 인증을 암시하지 않게 유지한다.

### 5.2 Canonical artifact — #605

- shipped artifact를 최소화한다. 가능하면 `dist/commitlore.mjs`와 필수 runtime assets만 canonical 대상으로 둔다.
- canonical builder를 한 가지로 고정한다.
- macOS/Linux에서 local rebuild가 다른 경우 오류가 정확한 canonical build command를 알려야 한다.
- release에는 checksum, runtime manifest, SBOM, provenance를 연결한다.

### 5.3 Workflow-bound CI verdict — #607

- check name + GitHub Actions app만으로 release/merge verdict를 인정하지 않는다.
- exact head, workflow path/ID, event, run attempt, required job conclusion을 검증한다.
- skipped·neutral·missing required job은 success가 아니다.
- branch protection과 release gate의 verdict 차이를 하나의 aggregator로 줄인다.

### 5.4 Two-clone notes E2E — #551

- clone A에서 notes record 작성·push
- clone B fresh clone에서 bootstrap 전에는 unknown/refusal
- documented bootstrap 후 동일 record delivery
- refspec 제거 후 다시 refusal

### 5.5 Live MCP identity — #572

- 등록 command가 존재하는 것과 CommitLore MCP 서버가 healthy인 것을 분리한다.
- initialize → `serverInfo.name/version` → 최소 tool set probe를 수행한다.
- custom healthy registration은 보존한다.
- dead/foreign/unverifiable registration을 `ok`로 보고하지 않는다.

### 5.6 Generated public facts — #590

- README headline numbers, Node floor, version, provenance vocabulary, compatibility facts를 하나의 generated/checkable source에서 관리한다.
- generated block 밖 숫자를 checker가 보호한다고 주장하지 않는다.
- 한국어 README와 영어 README가 동일 facts manifest를 사용한다.

---

## 6. R2 — Certified Autocapture on Claude Code

### 6.1 정확한 문제 정의

현재 capture pipeline은 downstream에서 자동화돼 있지만, capture initiation은 host/agent가 tool을 기억하고 호출하는 데 의존한다. 따라서 핵심 결함은 “수동 명령”보다 다음이다.

> eligible agent commit마다 capture assessment가 시작됐는지 증명할 수 없고, 시작되지 않은 침묵과 정상 `verified-empty`를 구분할 수 없다.

### 6.2 최소 상용 구조

```text
Claude Code가 git commit 실행 시도
        ↓
로컬 host hook이 commit intent 감지
        ↓
현재 staged tree의 capture assessment 확인
        ├─ record staged      → commit 허용
        ├─ verified-empty     → commit 허용
        └─ assessment 없음    → capture 실행을 요청하고 1회 재시도
        ↓
prepare-commit-msg / post-commit은 기존 transaction 적용·소비
```

### 6.3 반드시 지킬 경계

- host hook은 transcript를 가지고 capture를 시작한다.
- Git hook은 transcript를 추측하거나 모델을 호출하지 않는다.
- Git hook에서 네트워크·LLM·무제한 history scan을 실행하지 않는다.
- 기존 pending transaction과 staged tree binding을 재사용한다.
- `verified-empty`를 정상 terminal outcome으로 기록한다.
- MCP가 사라지면 같은 local CLI core로 fallback한다.
- 기본 모드는 bounded fail-open; enterprise strict mode는 후속 opt-in이다.
- raw transcript는 기본적으로 영구 저장하지 않는다.

### 6.4 R2 이슈 소유권

| Issue | 역할 |
|---|---|
| #511 | R2 outcome/umbrella. 코드 직접 소유하지 않음 |
| #527 | deterministic initiation과 Commit Gate 구현 |
| 신규 R2-01 | `verified-empty`, local fallback, bounded recovery 상태 계약 |
| #424 | MCP disappearance incident evidence; fallback acceptance에 연결 |
| #550 | 실제 attempt/outcome을 보여주는 `auto status` |
| #583 | consumed transaction 기반 provenance verify |
| 신규 R2-02 | 실제 설치된 Claude Code 100-commit certification |

### 6.5 Certified 조건

한 개의 명시된 Claude Code version/config에서:

- eligible agent commits: 100
- capture attempts: 100
- terminal outcomes: 100
- silent unassessed: 0
- wrong-tree/stale record: 0
- duplicate stage: 0
- hook-induced hang: 0
- MCP 장애 시 CLI fallback 성공

이 조건 전에는 “Claude Code에서 automatic capture”를 일반적 보장으로 쓰지 않는다.

---

## 7. R3·R4와 연구 — 미리 과설계하지 않는다

### 7.1 R3 Multi-host Certification

R2가 완료된 뒤 다음 순서로 host별 이슈를 생성한다.

1. Codex
2. Hermes
3. lifecycle contract가 실제로 충분한 추가 host 1개

Generic MCP-only host는 deterministic lifecycle을 증명하기 전까지 `assisted`로 표기한다. **R2 완료 전 R3 세부 이슈를 미리 생성하지 않는다.**

### 7.2 R4 Commercial Launch

R3가 완료된 뒤 다음 묶음만 계획한다.

- team policy
- fleet health·version skew·upgrade·rollback
- security response/support policy
- privacy-safe evidence export
- real-team pilot와 claim gate

#451은 R4 umbrella로 유지한다. **R3 완료 전 상용 운영 child issue를 대량 생성하지 않는다.**

### 7.3 Research

- #412 trust grading behavior study
- #548 real OCI isolation
- #549 CDEB/product separation

연구는 product R0 release를 막지 않는다. 해당 연구 결과를 공개·봉인할 때만 각 연구 gate를 요구한다.

---

## 8. A–Z 최종 체크

| 영역 | 상태 | 핵심 판정 |
|---|---|---|
| A Architecture | PASS | Git authority·derived index 구조 강함 |
| B Build | CONDITIONAL | canonical artifact 미완성 |
| C Capture | CONDITIONAL | downstream 강함, initiation 미보장 |
| D Data | PASS | lifecycle·record identity 강함 |
| E Errors | CONDITIONAL | host install·MCP malformed input false-success 잔여 |
| F Failure recovery | CONDITIONAL | bounded fallback·timeout 보강 필요 |
| G Git | CONDITIONAL | SHA-256 full OID 계약 미완성 |
| H Hooks | CONDITIONAL | recursion 수정, remote timeout 필요 |
| I Installer | CONDITIONAL | runtime 강함, host wiring 약함 |
| J Jobs/CI | CONDITIONAL | breadth 강함, workflow identity 약함 |
| K Keys/Trust | NO-GO | signer-authority binding 미완성 |
| L Lifecycle | PASS | active/superseded/expired 강함 |
| M MCP | CONDITIONAL | #604 이후 outer schema 개선, identity/fallback 남음 |
| N Notes | CONDITIONAL | two-clone seam 미검증 |
| O Observability | CONDITIONAL | operational status·ledger 필요 |
| P Performance | PASS | index와 bounded scan 근거 강함 |
| Q Query | PASS | unknown/empty 구분과 path lifecycle 강함 |
| R Release | CONDITIONAL | exact-head 강함, workflow binding 남음 |
| S Security | CONDITIONAL | threat model 강함, identity·supply-chain 보강 필요 |
| T Tests | PASS | breadth·real Git E2E 강함 |
| U Upgrade | CONDITIONAL | runtime rollback 강함, host health 약함 |
| V Versioning | PASS | package/release binding 강함 |
| W Windows | CONDITIONAL | installer coverage 강함, shared host truth 필요 |
| X Cross-platform | CONDITIONAL | capability matrix·artifact reproducibility 필요 |
| Y User experience | NO-GO | auto 설정과 실제 capture가 분리됨 |
| Z Zero-silent-failure | NO-GO | R0/R2 종료 전 충족 안 됨 |

---

## 9. 마일스톤과 최소 티켓 구성

### R0 · v0.8.2 Release Blockers

- #594 / PR #604 — outer MCP schema enforcement
- 신규 R0-02 — decoded draft shape validation
- 신규 R0-03 — Git full OID contract / PR #613
- #595 — truthful host installer
- 신규 R0-05 — pre-push timeout

### R1 · Operational Boundary

- #597, #605, #607, #551, #572, #590

### R2 · Certified Autocapture — Claude Code

- #511, #527, #424, #550, #583
- 신규 R2-01 — assessment outcome/fallback/recovery
- 신규 R2-02 — real installed certification

### R3 · Multi-host Certification

Milestone만 생성한다. R2 종료 전 세부 이슈를 만들지 않는다.

### R4 · Commercial Launch

Milestone과 #451 umbrella만 유지한다. R3 종료 전 세부 이슈를 만들지 않는다.

---

## 10. PR 최종 disposition

### #610 — MERGE_ALLOWED

- 정확한 head와 CI success를 재확인한다.
- 먼저 squash merge한다.

### #604 — MERGE_ALLOWED_AFTER_METADATA_AND_REBASE

- #610 merge 후 최신 main에 rebase한다.
- canonical dist를 다시 build한다.
- PR body를 `Closes #594`, `Partially addresses #597`로 수정한다.
- exact-head CI success 후 squash merge한다.

### #613 — CHANGES_REQUIRED

- full OID와 abbreviation 분리
- 최신 main rebase
- real SHA-1/SHA-256 matrix
- 수정 전 merge 금지

### #609 — CLOSE_SUPERSEDED

live diff가 계속 0인지 확인 후 close한다.

### #579 — CLOSE_NOT_PLANNED

현재 PR은 닫는다. Vitest 4가 필요해질 때 별도 migration issue로 시작한다.

### #580 — CLOSE_NOT_PLANNED

Node 22 runtime floor 유지 중에는 Node 26 types를 primary type environment로 사용하지 않는다.

---

## 11. Release gates

### Gate R0 — v0.8.2

- R0 issue open 0
- #604 merged with #597 still open
- #613 contract fixed and merged
- installer false-success 0
- pre-push stall bounded
- exact candidate head required checks success
- skipped·neutral·missing check를 success로 계산하지 않음

### Gate R1 — broad team pilot

- authenticated directive
- canonical artifact/provenance
- workflow-bound CI verdict
- two-clone notes E2E
- live MCP identity
- generated public facts

### Gate R2 — certified Claude Code

- 100/100 attempts and terminal outcomes
- silent unassessed 0
- MCP fallback proven
- operational status and provenance verification available

### Gate R3 — multi-host

각 host/version을 별도 certification row로 증명한다.

### Gate R4 — commercial

real-team pilot, rollback exercise, support/security policy, evidence-bound claims가 모두 완료돼야 한다.

---

## 12. 안전하게 할 수 있는 제품 주장

### 현재 가능

> CommitLore stores lifecycle-aware decision records in Git and delivers the records still relevant to the path an agent is changing.

### R2 이후 가능

> On the explicitly certified Claude Code version, every eligible agent commit receives a capture assessment automatically; CommitLore records a verified decision or a verified-empty outcome without requiring the user to ask.

### 아직 금지

- every coding agent captures automatically
- cryptographically authenticated directive by default
- enterprise production-ready
- guaranteed token or cost savings
- zero-loss decision memory
- all-platform byte-reproducible build

---

## 13. 최종 Definition of Done

### v0.8.2

R0 milestone의 모든 issue가 exact-head evidence로 닫히고 release candidate가 gate를 통과한다.

### broad production

R1 완료 후 소규모 팀에 기본 설치할 수 있다.

### certified autocapture

R2 실제 host certification이 완료되어야 `automatic`을 사용한다.

### commercial production

R3·R4 완료 전에는 organization-wide commercial production-ready라고 말하지 않는다.

---

## Appendix A. Evidence links

- Repository: https://github.com/MongLong0214/commitlore
- Release v0.8.1: https://github.com/MongLong0214/commitlore/releases/tag/v0.8.1
- PR #604: https://github.com/MongLong0214/commitlore/pull/604
- PR #610: https://github.com/MongLong0214/commitlore/pull/610
- PR #613: https://github.com/MongLong0214/commitlore/pull/613
- Issue #595: https://github.com/MongLong0214/commitlore/issues/595
- Issue #597: https://github.com/MongLong0214/commitlore/issues/597
- Issue #605: https://github.com/MongLong0214/commitlore/issues/605
- Issue #607: https://github.com/MongLong0214/commitlore/issues/607
- Issue #527: https://github.com/MongLong0214/commitlore/issues/527
- Issue #550: https://github.com/MongLong0214/commitlore/issues/550
- Issue #583: https://github.com/MongLong0214/commitlore/issues/583
- Issue #424: https://github.com/MongLong0214/commitlore/issues/424
