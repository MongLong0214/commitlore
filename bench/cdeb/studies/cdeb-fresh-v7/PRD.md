---
document_id: commitlore-cdeb-fresh-v7-r1-final-effect-trial-ssot
document_version: 1.0.0
document_date: 2026-08-24
repository: MongLong0214/commitlore
audit_main_sha: cfb25520c2a453ee09401de80177b17f3a54536c
new_study_id: cdeb-fresh-v7
preregistration_revision: r1
status: implementation-and-conditionally-execution-authorized
supersedes_pre_execution_draft: COMMITLORE_CDEB_FRESH_V7_FINAL_EFFECT_TRIAL_SSOT_PRD_2026-08-24.md
supersession_reason:
  - correct executable dist identity
  - correctly classify oracle as a V7 pre-execution artifact
measured_product_effect_rows_at_revision: 0
randomized_benchmark_episodes_at_revision: 0
research_line_finality: final-effect-trial-no-automatic-v8
human_owner_count: 1
external_people_required: 0
evidence_tier: author-operated-multi-agent-internally-replicated
predecessor: cdeb-fresh-v6
predecessor_verdict: TERMINAL_HOLD_FINAL
fixed_repositories:
  - agent-operator-score
  - gitseed
fixed_tasks:
  agent-operator-score: 8
  gitseed: 9
  total: 17
repeats_per_arm_per_task: 10
expected_measured_episodes: 340
primary_product_release_tag: v1.2.0
primary_product_release_commit: 90a8b212e1db70cccf69fbf48415b9c036b2d854
primary_product_tag_object: 557e6cd506c79eb5d2731885e3c544fa85f0384a
primary_product_dist_artifact: dist/commitlore.mjs
primary_product_dist_sha256_measured: a0c542977f048e6b5163f581d2e4a53963b2d9845467af8949fa105b8bc0e528
predecessor_declared_dist_sha256: 318e16612206ae0aa3732033127b2937276ce2f142872c33a91ec04a33133b91
predecessor_declared_digest_matches_measured: false
oracle_owner_study: cdeb-fresh-v7
oracle_freeze_required_before_measured_execution: true
source_snapshot_cutoff: 2026-08-20T22:08:19Z
---

# CommitLore CDEB-Fresh v7-r1 Final Effect Trial — End-to-End SSOT

> **이번 문서가 최종 authority다.**
>
> 이전 V7 draft는 measured product-effect episode가 0인 pre-execution 상태에서 두 가지 모순이 발견되어 supersede한다.
>
> ```text
> 1. 실제 v1.2.0 dist/commitlore.mjs digest는 a0c54297...인데
>    이전 문서가 318e1661...을 executable identity로 사용했다.
>
> 2. V6에는 frozen product-effect oracle이 존재하지 않는데
>    이전 문서가 V6 oracle을 immutable input으로 재사용한다고 적었다.
> ```
>
> V7-r1은 두 문제를 수정한다.
>
> ```text
> Product executable identity
> → measured a0c54297...로 pin
> → predecessor-declared 318e1661...은 deviation history로 보존
>
> Oracle
> → V7 PR-A에서 17개 candidate별로 새로 설계·구현·red-team
> → ORACLE_FROZEN transition 이후에만 immutable
> ```
>
> 이번 연구는 정확히 17개 fixed task에서 automatic target-decision delivery의 제품 효과를 340회 측정하고 종료한다.
>
> Positive를 강제하지 않는다.
>
> ```text
> PUBLISHED_POSITIVE
> PUBLISHED_QUALIFIED
> PUBLISHED_NULL
> PUBLISHED_NEGATIVE
> TERMINAL_HOLD_FINAL
> ```
>
> 중 어느 상태든 evidence와 함께 terminalize하면 완료다.
>
> **자동 V8은 없다.**

---

## 0. Owner decisions and correction authority

### 0.1 V6의 final-study 상태를 명시적으로 override한다

V6는 `TERMINAL_HOLD_FINAL`로 종료됐고 successor를 자동 생성하지 않도록 잠겼다.

Owner는 이 V7-r1 SSOT를 전달함으로써 별도 new-study decision을 내린다.

```text
new study id:
cdeb-fresh-v7

V6:
read-only historical evidence

V7:
final product-effect trial
```

V6를 재개하거나 V6 floor를 수정하지 않는다.

### 0.2 이전 V7 draft는 실행 authority가 아니다

이전 draft는 다음 이유로 superseded pre-execution artifact다.

```text
incorrect dist identity
nonexistent V6 oracle reuse
```

Measured rows와 randomized benchmark episodes가 0이므로 이 수정은 outcome-aware amendment가 아니다.

Repository에는 다음을 명시적으로 기록한다.

```text
deviation kind:
PRE_EXECUTION_IDENTITY_AND_ORACLE_BOUNDARY_CORRECTION

old V7 draft:
historical, non-governing

V7-r1:
sole current execution authority
```

### 0.3 이번 연구는 최종 effect trial이다

다음은 금지한다.

```text
새 corpus 탐색
새 repository 추가
17개 task 교체
표본 floor 때문에 실행 취소
power 부족을 이유로 effect trial 미실행
automatic V8 설계
```

Scientific integrity failure는 `TERMINAL_HOLD_FINAL`로 닫는다.

Wide/null/negative result는 publication category로 닫는다.

---

## 1. Authoritative starting state

작업 시작 시 live repository에서 다음을 검증한다.

```text
main:
cfb25520c2a453ee09401de80177b17f3a54536c
또는 그 이후의 non-CDEB drift가 반영된 최신 main

cdeb-fresh-v6:
verdict = TERMINAL_HOLD_FINAL
measured product-effect rows = 0
TASK_BUILDABLE = 17
AOS = 8
gitseed = 9

ACTIVE-STUDY:
active_study_id = null
last_terminal_study_id = cdeb-fresh-v6
```

Main이 이동했더라도 다음 V6 artifact가 byte-identical이면 진행 가능하다.

```text
V6 RESULT
V6 buildability summary
V6 dispositions
V6 task freeze manifest
V6 task prompts
V6 task-specific acceptance
V6 registered regression acceptance
V6 base verification
V6 Good A / Good B controls
V6 Bad A controls
V6 semantic violation judgements
V6 firewall/task-authoring evidence
V6 snapshots
V6 product-lock evidence
```

**V6 oracle과 V6 near-miss는 required predecessor input 목록에 존재하지 않는다.**

V6 historical artifact를 V7 결과에 맞춰 수정하지 않는다.

---

## 2. Exact fixed benchmark population

V7 population은 V6 `buildability/summary.json`에서 `TASK_BUILDABLE`로 확정된 정확히 다음 17개다.

### 2.1 agent-operator-score — 8

```text
v4-002ffd1e428c572a
v4-34aef026d81c2f6b
v4-8f24735524874167
v4-9b42b1951da730e1
v4-c61d7c943edd8cff
v4-ce2adee3c134ab03
v4-dd4a74ba2b628991
v4-e7587b2b65750306
```

### 2.2 gitseed — 9

```text
v4-0ecd7426eebc1cab
v4-377f04276465b59d
v4-77e1745655a235ce
v4-84cd6d391ac2fa6d
v4-8fc3d2ec14b1c078
v4-cadfb63755c3f504
v4-ed878960135ff45a
v4-f3c960a48273132c
v4-f901052615fa3aee
```

### 2.3 No selection discretion

금지:

```text
17개 중 일부만 선택
새 task 추가
V6 탈락 task 복원
oracle 난이도로 제외
CommitLore가 이길 것 같은 task 우선
repository 수를 맞추기 위한 교체
```

Artifact integrity가 깨진 candidate는 대체하지 않는다.

Mandatory V6 input이 복원 불가능하면 `TERMINAL_HOLD_FINAL`이다.

---

## 3. Artifact ownership matrix

이 절은 V6와 V7의 artifact 책임을 명확히 분리한다.

### 3.1 Immutable V6 inputs

V7이 byte-identical input으로 가져오는 것:

```text
candidate ID
repository ID
decision audit anchor
task prompt
task-specific acceptance
registered regression acceptance
base verification
Good A
Good B
Bad A
Bad B — 실제 존재하는 경우만
semantic violation judgement for imported Bad controls
firewall/task-authoring evidence
snapshot identity
product tag/commit evidence
```

수정 금지:

```text
V6 task
V6 acceptance
V6 control patch
V6 semantic judgement
V6 snapshot
V6 repository selection
```

### 3.2 New V7 pre-execution artifacts

V7 PR-A가 새로 만드는 것:

```text
candidate-specific oracle specification
candidate-specific deterministic oracle implementation
oracle manifest and hashes
fresh boundary near-miss
alternate-shape violation probe
oracle deterministic-replay evidence
oracle mutation tests
independent oracle red-team report
ORACLE_FROZEN transition
corrected V7 product lock
ON/SUPPRESSED manipulation implementation
runtime/model lock
synthetic technical smoke evidence
340-assignment schedule
analysis simulation evidence
```

### 3.3 New measured artifacts

V7 execution이 새로 만드는 것:

```text
340 agent sessions
340 trajectories/events
340 final trees
340 normalized ITT rows
row seal
STAT-A
STAT-B
re-explanation audit
claim-gate result
RESULT
```

### 3.4 Oracle mutability boundary

```text
before ORACLE_FROZEN:
spec/implementation repair allowed
only pre-execution control/red-team evidence may guide repair
all revisions logged

after ORACLE_FROZEN:
oracle/spec/threshold/predicate modification forbidden
```

Measured product-effect outcome은 oracle construction에 절대 사용하지 않는다.

---

## 4. Primary causal question

> **Across the exact 17 frozen V6 TASK_BUILDABLE tasks, does automatic delivery of the candidate-relevant CommitLore decision before the first relevant mutation increase Decision-Safe First-Pass Success relative to suppressing that automatic target-decision delivery?**

한국어:

> **V6에서 고정한 17개 decision-sensitive task에서 관련 CommitLore decision을 첫 relevant mutation 전에 자동 전달하면, 그 target decision의 자동 전달을 억제했을 때보다 task를 정상 완료하면서 repository decision을 지킬 확률이 높아지는가?**

---

## 5. Claim population and limits

### 5.1 Primary population

> **The exact 17 frozen decision-sensitive tasks constructed from naturally recorded repository decisions in agent-operator-score and gitseed at the V6 snapshots.**

### 5.2 Inference target

```text
17 tasks:
fixed finite benchmark population

10 repetitions per arm:
stochastic execution replication
```

Primary uncertainty는 동일한 17개 task에서 pinned agent 실행이 반복될 때의 variability를 나타낸다.

### 5.3 Evidence tier

정확한 표현:

> **Author-operated, multi-agent internally replicated final effect trial.**

금지:

```text
external independent validation
industry-wide benchmark
all-repository causal proof
all-agent causal proof
objective architecture optimality proof
```

### 5.4 No superpopulation overclaim

금지:

```text
all CommitLore decisions
all repositories
all teams
all coding agents
```

README/result에는:

```text
17 tasks
2 author-operated repositories
one pinned model/harness
CommitLore v1.2.0
```

을 명시한다.

---

## 6. Treatment arms

### 6.1 Common path

두 arm 모두 실제 frozen CommitLore shipping hook/injector를 실행한다.

동일:

```text
repository snapshot
task
agent/model
system prompt
tools
permissions
runtime
budgets
fresh-session/worktree
ordinary Git history
raw hook invocation
raw CommitLore candidate qualification
non-target payload blocks
```

### 6.2 TARGET-DELIVERY ON

Expected target decision block의:

```text
ruling
reason
scope
lifecycle
```

가 first relevant mutation 전에 model-visible payload에 포함된다.

### 6.3 TARGET-DELIVERY SUPPRESSED

같은 raw shipping payload를 생성한 뒤 structured identity로 candidate target block만 제거한다.

필수:

```text
target block absent
unrelated blocks byte-identical
hook/injector execution preserved
framing preserved
```

Text regex로 target block을 선택하지 않는다.

### 6.4 Estimand

연구가 추정하는 것:

> **total effect of automatic candidate-relevant decision delivery**

포함:

```text
semantic content
salience
target payload token load
```

추정하지 않는 것:

```text
semantic content alone
hook installation overhead
knowledge access vs no access
```

### 6.5 Natural discovery

SUPPRESSED agent가 ordinary Git을 자율 탐색해 decision을 발견하는 것은 허용한다.

```text
manual_discovery = true
```

로 기록하며 automatic payload leak로 보지 않는다.

---

## 7. Product and snapshot identity

### 7.1 Corrected product identity

Primary product:

```text
release tag:
v1.2.0

tag object:
557e6cd506c79eb5d2731885e3c544fa85f0384a

tag resolves to commit:
90a8b212e1db70cccf69fbf48415b9c036b2d854

artifact:
dist/commitlore.mjs

measured SHA-256:
a0c542977f048e6b5163f581d2e4a53963b2d9845467af8949fa105b8bc0e528
```

V7 runtime verification은 `a0c542...`와 비교한다.

### 7.2 Preserved predecessor mismatch

Historical declared digest:

```text
318e16612206ae0aa3732033127b2937276ce2f142872c33a91ec04a33133b91
```

는 삭제하지 않고 다음 deviation으로 기록한다.

```text
kind:
PRE_EXECUTION_PRODUCT_DIST_IDENTITY_CORRECTION

facts:
tag and commit matched
measured dist digest was a0c542...
predecessor declared digest was 318e166...
measured product-effect rows were 0 when corrected
```

### 7.3 Product-lock verification procedure

PR-A에서 exact tag object를 materialize하고:

```text
git tag identity
resolved commit
dist file path
dist file bytes
SHA-256
```

를 새 V7 `product-lock.json`에 기록한다.

다음 중 하나면 HOLD:

```text
tag mismatch
commit mismatch
artifact missing
measured digest != a0c542...
```

### 7.4 Repository snapshots

V6 exact AOS/gitseed sealed bundles와 snapshot commits를 사용한다.

새 snapshot 금지.

V7 snapshot manifest는:

```text
bundle SHA-256
snapshot commit
tree OID
refs digest
notes policy
V6 source manifest digest
```

를 재검증한다.

---

## 8. Owner conditional execution authorization

이 SSOT를 agent에게 전달하는 행위는 다음을 조건부 승인한다.

```text
V7 creation
17-task immutable import
17-oracle construction
17 near-miss construction
17 alternate-violation probe attempts
oracle red-team and freeze
manipulation/runtime/schedule readiness
340 measured episodes
row seal
independent analysis
publication
terminal cleanup
```

Green gate는 자동 진행한다.

Owner에게 질문 가능한 경우:

```text
GitHub write/merge permission unavailable
Codex/provider credential unavailable
hard billing/usage limit
external provider outage beyond registered policy
```

다음 방법론 질문은 이미 결정됐다.

```text
oracle을 V7에서 만들지
near-miss가 필요한지
alternate violation을 몇 번 시도할지
17개를 전부 사용할지
pilot을 넣을지
repeat count
statistics
headline gate
```

---

## 9. Isolated roles

| Role | Responsibility | Forbidden input |
|---|---|---|
| ORCHESTRATOR | state/PR/gates | interim aggregate effect |
| BENCHMARK-IMPORTER | V6 immutable import | measured outcomes |
| ORACLE-SPEC-A | independent policy/oracle spec | arm/outcomes |
| ORACLE-SPEC-B | independent policy/oracle spec | ORACLE-SPEC-A output |
| ORACLE-IMPLEMENTER | deterministic evaluator | arm/transcript |
| NEAR-MISS-BUILDER | close compliant boundary probe | corpus/result targets |
| ALT-VIOLATION-BUILDER | distinct violation probe | treatment outcomes |
| SEMANTIC-JUDGE-A/B | violation/non-violation | floors, arm, outcomes |
| ORACLE-REDTEAM | false positive/negative attack | arm/outcomes |
| RANDOMIZATION-CUSTODIAN | schedule | semantic result |
| RUN-OPERATOR | episode execution | aggregate effect |
| STAT-A | primary analysis | desired headline |
| STAT-B | independent analysis | STAT-A code/narrative |
| PATCH-A/B | re-explanation | arm/payload/transcript |
| CLAIM-GATE | mechanical publication | subjective preference |

Possible paired roles use different model families.

If unavailable, use fresh isolated sessions and disclose `internally replicated`.

---

## 10. State machine

```text
V6_TERMINAL_CHECK
→ V7_DRAFT
→ BENCHMARK_IMPORTED
→ PRODUCT_IDENTITY_LOCKED
→ ORACLE_CONSTRUCTION
→ ORACLE_REDTEAM
→ ORACLE_FROZEN
→ MANIPULATION_LOCKED
→ RUNTIME_LOCKED
→ SYNTHETIC_SMOKE_PASS
→ SCHEDULE_FROZEN
→ EXECUTION_READY
→ CONFIRMATORY_RUNNING
→ ROWS_SEALED
→ ANALYSIS_COMPLETE
→ PUBLISHED_POSITIVE
 | PUBLISHED_QUALIFIED
 | PUBLISHED_NULL
 | PUBLISHED_NEGATIVE
 | TERMINAL_HOLD_FINAL
```

각 transition은 append-only ledger에:

```text
actor
timestamp
input artifacts and hashes
output artifacts and hashes
checks
deviations
```

를 기록한다.

---

## 11. Repository layout

```text
bench/cdeb/studies/cdeb-fresh-v7/
├── PRD.md
├── PREREGISTRATION.md
├── study.json
├── STATUS.json
├── transitions.jsonl
├── deviations.jsonl
├── benchmark-manifest.json
├── product-lock.json
├── snapshot-lock.json
├── roles/
│   └── manifest.json
├── oracle/
│   ├── specs/
│   ├── implementations/
│   ├── near-misses/
│   ├── alternate-violations/
│   ├── semantic-judgements/
│   ├── deterministic-replays.jsonl
│   ├── mutation-results.jsonl
│   ├── redteam-report.md
│   └── freeze-manifest.json
├── manipulation/
├── runtime/
├── preflight/
├── schedule/
├── rows/
├── analysis/
└── RESULT.md
```

---

## 12. Benchmark import and integrity

### 12.1 Manifest fields

각 candidate:

```text
candidate ID
repository
task path/hash
task-specific acceptance path/hash
regression acceptance configuration/hash
base verification
Good A path/tree/hash
Good B path/tree/hash
Bad A path/tree/hash
Bad B path/tree/hash if present
semantic judgement path/hash
firewall manifest hash
snapshot/product references
V6 disposition
```

**Oracle와 near-miss는 V6 import field가 아니다.**

### 12.2 Integrity rules

```text
exactly 17
AOS 8
gitseed 9
all V6 disposition = TASK_BUILDABLE
no unknown candidate
no duplicated candidate
all required hashes match
```

Failure means `TERMINAL_HOLD_FINAL`.

### 12.3 V6 control replay before oracle

V6 controls를 수정하지 않고 replay한다.

Require:

```text
Base:
task acceptance FAIL
regression baseline-equivalent

Good A:
task PASS
regression PASS

Good B:
task PASS
regression PASS

Bad A:
task PASS
regression PASS
semantic VIOLATION_CONFIRMED
```

이 단계는 V7 oracle을 사용하지 않는다.

Replay failure는 artifact/environment integrity failure다.

Control을 repair하거나 candidate를 replace하지 않는다.

---

## 13. V7 oracle construction

### 13.1 Oracle purpose

Oracle은 experimental final tree가 recorded decision을 위반했는지 deterministic하게 판정한다.

Primary oracle은 runtime LLM judge가 아니다.

우선순위:

```text
black-box behavior
public API/CLI
AST/structured parse
typed structural predicate
semantic structural predicate
lexical predicate only for inherently lexical decisions
```

### 13.2 Oracle input boundary

Oracle may read:

```text
final tree
frozen candidate-specific oracle spec
```

Oracle may not read:

```text
arm
delivery log
transcript
token usage
agent explanation
record citation
manual discovery
aggregate effect
```

### 13.3 Independent spec extraction

ORACLE-SPEC-A와 ORACLE-SPEC-B가 독립적으로 다음을 작성한다.

```text
ruled-out behavior
reason
scope
lifecycle
minimal violation boundary
compliance boundary
observable evidence in final tree
known aliases/alternate forms
false-positive risks
false-negative risks
```

둘이 semantic boundary에 합의해야 한다.

Disagreement:

```text
third fresh adjudication
```

Unresolved ambiguity:

```text
TERMINAL_HOLD_FINAL
```

17-task population을 줄이거나 교체하지 않는다.

### 13.4 Deterministic implementation

ORACLE-IMPLEMENTER는 합의된 spec만 사용한다.

금지:

```text
V6 Bad A exact diff hash만 탐지
candidate-specific filename 하나만 탐지
record 문구 keyword 존재만으로 violation 판정
```

Oracle manifest에는:

```text
spec hash
implementation hash
dependencies
entrypoint
expected input/output schema
failure modes
```

를 기록한다.

---

## 14. Mandatory boundary probes

각 candidate는 다음 probe matrix를 가진다.

### 14.1 Imported mandatory controls

```text
Base:
oracle false

Good A:
oracle false

Good B:
oracle false

Bad A:
oracle true
```

### 14.2 Fresh V7 near-miss — mandatory

Near-miss는:

> **위반과 구조·어휘·API 사용이 가까우나 frozen semantic boundary상 실제 위반은 아닌 final tree**

다.

필수:

```text
fresh V7 artifact
V6 control bytes 복사 금지
two blind semantic judges = NOT_A_VIOLATION
oracle = false
valid evaluable final tree
```

Strongly preferred:

```text
task acceptance PASS
regression acceptance PASS
```

두 acceptance를 통과하지 못해도 oracle-only boundary probe로 사용할 수 있다.

이 경우:

```text
near_miss_functionally_passing = false
```

를 limitation으로 기록한다.

Near-miss를 만들지 못하면 oracle false-positive boundary를 검증할 수 없으므로 `TERMINAL_HOLD_FINAL`.

### 14.3 Alternate-shape violation probe — mandatory attempt

Bad A와 다른 conceptual shape를 시도한다.

Shape registry:

```text
replacement
additive-coexistence
opt-in-configurable
alternate-integration-boundary
versioned-path
```

Bad A shape를 제외하고 deterministic hash ranking으로 첫 shape를 선택한다.

첫 시도가 semantic violation이 아니면 ranking의 다음 shape를 한 번 더 시도한다.

Maximum:

```text
2 fresh attempts per candidate
```

Outcomes:

#### A. Valid alternate violation constructed

```text
two blind semantic judges = VIOLATION_CONFIRMED
oracle = true
```

Task/regression도 PASS하면:

```text
Bad B
```

로 기록한다.

Acceptance를 통과하지 못해도:

```text
oracle-only alternate violation probe
```

로 유효하다.

#### B. No valid alternate violation after two attempts

```text
ALTERNATE_VIOLATION_NOT_CONSTRUCTED
```

로 기록하고 candidate를 제외하지 않는다.

이것은 limitation이지 eligibility gate가 아니다.

### 14.4 Why alternate failure is not HOLD

V6가 각 candidate에 최소 하나의 functionally passing confirmed Bad A를 이미 확정했다.

V7의 목적은 second bad path의 존재를 새 eligibility condition으로 추가하는 것이 아니라 oracle의 shape-specific overfit을 공격하는 것이다.

---

## 15. Oracle validation and freeze

### 15.1 Mandatory classification matrix

각 candidate:

```text
Base       false
Good A     false
Good B     false
Bad A      true
Near miss  false
Alternate valid violation, if constructed  true
```

### 15.2 Determinism

동일 tree에서:

```text
30 repeated oracle evaluations
```

이 byte-identical result를 생성해야 한다.

### 15.3 Mutation tests

최소:

```text
remove one load-bearing detection branch
→ mandatory positive control must fail

broaden one predicate toward keyword/filename overmatch
→ Good or near-miss must fail

alter scope handling
→ scoped control must fail
```

Mutation이 target property에 도달하지 못하면 PASS로 세지 않는다.

### 15.4 Independent oracle red-team

Fresh ORACLE-REDTEAM이 공격한다.

```text
renamed symbol
wrapper/alias
indirection
optional/configurable path
dead code
comment/string keyword
partial implementation
alternate file boundary
generated artifact
near-miss vocabulary
multiple implementation shapes
```

Red-team은 arm/outcomes를 보지 않는다.

### 15.5 Freeze gate

17개 전부:

```text
mandatory matrix PASS
30× determinism PASS
mutation tests PASS
unresolved false positive = 0
unresolved false negative = 0
P0/P1 = 0
```

이면:

```text
ORACLE_FROZEN
```

transition을 기록한다.

이후:

```text
oracle spec 변경 금지
implementation 변경 금지
threshold 변경 금지
near-miss/positive control 재정의 금지
```

한다.

Failure:

```text
TERMINAL_HOLD_FINAL
```

다른 candidate로 교체하지 않는다.

---

## 16. No benchmark pilot

17개 중 일부를 pilot으로 소비하지 않는다.

Measured design:

```text
17 tasks
× 2 arms
× 10 repetitions
= 340 episodes
```

Pre-execution에는:

```text
oracle construction/validation
all-task manipulation preflight
synthetic non-benchmark agent smoke
analysis simulation
```

만 수행한다.

---

## 17. Manipulation construction and freeze

### 17.1 Raw payload

각 candidate/frozen tree에서 actual v1.2.0 shipping hook/injector로 raw payload를 생성한다.

### 17.2 Structured target mapping

Candidate target decision을:

```text
decision audit anchor
natural Record-Id where present
source commit/ordinal
scope/lifecycle
structured payload block identity
```

로 mapping한다.

Regex-only selection 금지.

### 17.3 ON check

```text
target ruling visible
target reason visible
scope correct
lifecycle current
first-mutation delivery surface available
```

### 17.4 SUPPRESSED check

```text
target block absent
target ruling/reason absent
unrelated payload blocks byte-identical
hook/injector still executed
```

### 17.5 Freeze

17개 전부 PASS 후:

```text
MANIPULATION_LOCKED
```

한다.

---

## 18. Experimental agent and runtime lock

### 18.1 Harness

```text
Codex CLI
```

### 18.2 Model identity

```text
current authenticated stable Codex CLI default
→ 3 metadata probes
→ concrete model ID agreement
→ explicit pin if supported
→ every measured row re-verifies ID
```

Model drift:

```text
TERMINAL_HOLD_FINAL
```

### 18.3 Freeze fields

```text
CLI version
executable digest
resolved model ID
system/config observability
tools/permissions
runtime/container identity
network policy
product dist digest = a0c542...
hook/manipulation digest
task/acceptance/oracle manifests
budgets
fresh-session/worktree rules
row schema
analysis code
scheduler
```

### 18.4 Budget

```text
wall clock: 1800 seconds
meaningful turns: 60
tool calls: 80
fresh HOME/session/worktree: required
cross-run memory: forbidden
web: disabled
dependency installation: disabled
manual CommitLore query tools: disabled
ordinary Git: available
```

---

## 19. Hidden evaluation boundary

Experimental agent receives only:

```text
task prompt
frozen repository worktree
normal allowed tools
arm-specific model-visible payload
```

Experimental agent must not receive:

```text
candidate ID
V6/V7 benchmark metadata
controls
semantic judgements
hidden task acceptance source
regression evaluator internals
oracle source/spec
decision anchor
Bad patch
Good patch
CommitLore repository checkout
```

Task acceptance, regression acceptance, and oracle run after agent completion in evaluator-only mounts.

---

## 20. Synthetic technical smoke

Dedicated non-benchmark fixture에서:

```text
1 ON Codex session
1 SUPPRESSED Codex session
```

을 실행한다.

Validate:

```text
fresh HOME/session/worktree
hook execution
target payload presence/absence
event capture
final tree capture
hidden evaluator invocation
row atomic write/readback
runtime/model identity
```

이 row는 product-effect row가 아니다.

Failure:

```text
TERMINAL_HOLD_FINAL
```

---

## 21. Analysis simulation

Measured row 전에 synthetic datasets로 증명한다.

```text
known positive
exact null
known negative
completion degradation
post-start failures
SUPPRESSED FVR = 0
repository weighting
paired-block bootstrap
randomization label swap
headline gate single-condition failure
```

No benchmark outcome may exist.

---

## 22. Confirmatory schedule

### 22.1 Fixed size

```text
17 tasks
× 2 arms
× 10 repetitions
= 340 unique assignments
```

### 22.2 Pairing

Unit:

```text
candidate × repetition
```

각 unit은 ON/SUPPRESSED 한 쌍을 가진다.

### 22.3 Schedule seed

```text
SHA256(
  benchmark_manifest_digest
  + oracle_freeze_manifest_digest
  + manipulation_lock_digest
  + runtime_lock_digest
  + preregistration_commit_sha
)
```

### 22.4 Ordering

```text
10 rounds
each round includes all 17 candidates
candidate order randomized per round
arm order randomized within pair
pair arms temporally close
```

### 22.5 Concurrency

```text
max active episodes = 2
max active episode per repository = 1
same candidate pair concurrent = forbidden
```

### 22.6 No interim analysis

Execution 중 금지:

```text
DSFPS aggregate
FVR aggregate
arm comparison
candidate replacement
early stopping
```

운영 dashboard는 counts/durability/runtime identity만 본다.

---

## 23. Episode protocol

각 assignment:

```text
1. frozen bundle에서 fresh worktree 생성
2. fresh HOME/config/session 생성
3. exact model/runtime verify
4. task만 제공
5. JIT arm assignment 적용
6. shipping hook/injector 실행
7. ON 또는 structured target suppression
8. event/tool/model metadata 기록
9. agent 실행
10. final tree/diff freeze
11. hidden task acceptance
12. frozen regression acceptance
13. frozen V7 oracle
14. normalized ITT row 생성
15. atomic write/readback/hash
16. worktree 폐기
```

First relevant mutation은 frozen path-scope mutation event로 operationalize하고 timestamp를 저장한다.

---

## 24. Retry and missingness

Meaningful start:

```text
first model token
first tool call
first agent-authored action
```

Pre-start arm-independent infrastructure failure:

```text
maximum 2 retries
```

Post-start:

```text
no retry
row retained
```

다음은 exclusion하지 않는다.

```text
timeout
non-completion
task failure
regression failure
revival
not-evaluable
post-start provider failure
```

10 consecutive pre-start provider failures:

```text
pause
resume unchanged after recovery
```

---

## 25. Outcomes

### 25.1 Functional pass

```text
functional_pass =
task_acceptance_pass
AND regression_acceptance_pass
```

### 25.2 Primary — DSFPS

```text
DSFPS =
completed
AND functional_pass
AND revival == false
```

모든 started/assigned episode가 ITT denominator에 남는다.

### 25.3 Key secondary — FVR

```text
FVR =
functional_pass
AND revival == true
```

### 25.4 Safety

```text
completion
task acceptance
regression acceptance
functional pass
timeout
not-evaluable
provider/harness failure
```

### 25.5 Manipulation

```text
ON delivery success
SUPPRESSED automatic leak
manual Git discovery
stale-as-current
wrong-tree delivery
delivery timing
```

### 25.6 Cost

```text
input/output tokens
cache categories
turns
tool calls
files read
wall time
Token Tax per Prevented Revival
```

---

## 26. Row durability

Unique key:

```text
candidate_id + repetition + arm
```

Expected exact key count:

```text
340
```

Write protocol:

```text
temp write
fsync
atomic rename
readback
schema validation
SHA-256
manifest append
```

Analysis refuses:

```text
missing key
duplicate key
unexpected key
runtime/model mismatch
row hash mismatch
```

---

## 27. Statistical estimand

Candidate:

```text
d_c =
mean_10(DSFPS_ON)
-
mean_10(DSFPS_SUPPRESSED)
```

Repository:

```text
D_AOS = mean_8(d_c)
D_gitseed = mean_9(d_c)
```

Overall:

```text
Delta =
0.5 * D_AOS
+
0.5 * D_gitseed
```

Repositories와 17 tasks는 fixed다.

---

## 28. Primary confidence interval

Primary paired-block bootstrap:

```text
within each candidate:
resample 10 paired repetition blocks

keep all 17 candidates fixed
keep both repositories fixed
100,000 replicates
fixed seed
percentile 95% interval
```

Interpretation:

> execution-repeat uncertainty for the exact 17-task benchmark.

Repositories 또는 candidates를 primary bootstrap에서 resample하지 않는다.

---

## 29. Randomization inference

Candidate × repetition pair에서 ON/SUPPRESSED labels를 swap한다.

```text
1,000,000 Monte Carlo permutations
two-sided
fixed seed
```

---

## 30. Task-population sensitivity

Secondary only:

```text
resample candidates within repository
keep repositories fixed
50,000 replicates
```

더 넓은 superpopulation proof로 표현하지 않는다.

---

## 31. FVR and RBDR

```text
RBDR =
1 - FVR_ON / FVR_SUPPRESSED
```

Report:

```text
raw counts
rates
absolute difference
relative reduction
95% interval
```

`FVR_SUPPRESSED = 0`이면 RBDR undefined.

---

## 32. Safety/noninferiority

```text
completion ON-SUPPRESSED lower 95% bound > -5pp
functional-pass ON-SUPPRESSED lower 95% bound > -5pp
```

Revival 감소가 completion/functionality 저하로 발생하면 strong product claim 금지.

---

## 33. Independent analysis

STAT-A와 STAT-B:

```text
same sealed rows
same frozen formulas
independent implementation
fresh sessions
different model family where available
```

STAT-B는 seal 전에 STAT-A code/narrative를 보지 않는다.

Match:

```text
raw counts exact
point estimates <= 1e-12
interval quantiles <= 1e-6
claim gate identical
```

Unresolved mismatch:

```text
TERMINAL_HOLD_FINAL
```

평균내기 금지.

---

## 34. Blind re-explanation audit

Input:

```text
task
final diff
redacted policy summary
```

Blind to:

```text
arm
payload
Record-Id
delivery log
transcript
tokens
```

Question:

> 이 patch를 승인하려면 이미 기록된 decision을 reviewer가 다시 설명해야 하는가?

PATCH-A:

```text
all evaluable final trees
```

PATCH-B:

```text
A=yes all
A=no deterministic 25% sample
```

Disagreement는 third fresh adjudication.

Primary oracle를 변경하지 않는다.

---

## 35. Strong README claim gate

다음 모두 통과해야:

```text
[ ] DSFPS Delta primary 95% CI lower bound > 0
[ ] randomization p < 0.05
[ ] FVR ON-SUPPRESSED 95% CI upper bound < 0
[ ] RBDR point >= 50%
[ ] RBDR lower 95% bound >= 20%
[ ] SUPPRESSED raw FVR events >= 10
[ ] completion lower bound > -5pp
[ ] functional-pass lower bound > -5pp
[ ] AOS point effect > 0
[ ] gitseed point effect > 0
[ ] leave-one-candidate-out sign reversal = 0
[ ] overall ON delivery >= 95%
[ ] every candidate ON delivery >= 80%
[ ] SUPPRESSED automatic target leak = 0
[ ] stale-as-current = 0
[ ] wrong-tree delivery = 0
[ ] all 340 rows sealed
[ ] STAT-A/B mismatch = 0
[ ] unresolved P0/P1 = 0
```

통과 시:

> **R% fewer repeated bad decisions.**

Footnote:

> Exact 17 frozen decision-sensitive tasks in two author-operated repositories; one pinned Codex model/harness; CommitLore v1.2.0 (`dist/commitlore.mjs` SHA-256 `a0c542...`); automatic candidate-relevant delivery versus structured suppression.

---

## 36. Publication categories

```text
PUBLISHED_POSITIVE
PUBLISHED_QUALIFIED
PUBLISHED_NULL
PUBLISHED_NEGATIVE
TERMINAL_HOLD_FINAL
```

Wide/null interval은:

> no detectable effect under this exact design

이지 universal no-effect proof가 아니다.

---

## 37. Publication artifacts

항상 공개:

```text
RESULT.md
normalized rows
row seal
benchmark manifest
product/snapshot lock
oracle specs/implementations/freeze manifest
near-miss/alternate-probe index
oracle red-team
manipulation/runtime/schedule manifests
analysis plan and code
STAT-A/B
candidate/repository effects
safety/cost
re-explanation audit
claim-gate result
deviations
limitations
reproduction instructions
```

README strong headline은 gate 통과 시에만 수정한다.

---

## 38. Execution PR plan

### PR-A — Identity correction, benchmark import, and oracle freeze

포함:

```text
V7-r1 SSOT/preregistration
pre-execution correction deviation
exact 17 import
corrected product lock a0c542...
snapshot lock
V6 control replay
17 independent oracle specs
17 deterministic oracle implementations
17 fresh near-misses
up to 34 alternate-violation attempts
semantic judgements
30× deterministic replay
mutation tests
independent oracle red-team
ORACLE_FROZEN
```

금지:

```text
benchmark model episode
product-effect row
runtime schedule
```

Merge gate:

```text
all mandatory V6 inputs valid
all 17 oracle mandatory matrices pass
near-miss 17/17
oracle determinism/mutation/red-team pass
P0/P1 = 0
CI green
```

### PR-B — Manipulation, runtime, synthetic smoke, schedule freeze

포함:

```text
ON/SUPPRESSED manipulation lock
Codex/model/runtime lock
hidden evaluator boundary
synthetic non-benchmark agent smoke
analysis simulation
340-assignment schedule
expected-row manifest
readiness red-team
EXECUTION_READY
```

금지:

```text
benchmark product-effect episode
```

Merge gate:

```text
17 payload checks pass
synthetic smoke pass
runtime/model frozen
analysis simulation pass
schedule exactly 340
P0/P1 = 0
CI green
```

### PR-C — 340 episodes, analysis, publication, closure

한 execution branch에서 전체 schedule을 수행한다.

Checkpoint commits는 허용하지만 중간 effect PR은 만들지 않는다.

포함:

```text
340 rows
row seal
STAT-A/B
re-explanation audit
claim gate
RESULT
README conditional update
terminal STATUS
ACTIVE-STUDY null
```

Branch protection 우회 금지.

---

## 39. Readiness red-team

### PR-A oracle red-team

공격:

```text
oracle overfit to Bad A exact diff
keyword/filename false positive
wrapper/alias false negative
optional/configurable false negative
near-miss false positive
alternate violation false negative
scope/lifecycle error
oracle reading forbidden metadata
mutation not reaching property
```

### PR-B execution red-team

공격:

```text
target suppression removes too much/little
hook execution asymmetry
manual discovery counted as leak
model alias drift
schedule bias
post-start retry loophole
row loss/duplication
analysis resampling wrong units
headline overgeneralization
```

P0/P1 unresolved이면 HOLD.

---

## 40. Mandatory tests

최소:

```text
exact 17 IDs and 8/9 counts
non-TASK_BUILDABLE candidate refused
V6 task/acceptance/control modification refused
old dist digest cannot satisfy runtime lock
measured a0c542 digest required
V7 oracle construction allowed before ORACLE_FROZEN
V7 oracle modification refused after ORACLE_FROZEN
Base/Good A/Good B/Bad A mandatory classification
near-miss false for all 17
valid alternate violation true when constructed
alternate-not-constructed is limitation, not exclusion
30× deterministic oracle
oracle mutation controls
oracle forbidden-input check
target structured removal
unrelated payload preservation
ON target missing detection
SUPPRESSED target leak detection
manual discovery not automatic leak
synthetic smoke row isolated from product rows
model/runtime drift detection
340 unique assignments
10 repeats per arm per candidate
no interim endpoint aggregation
post-start failures remain ITT
paired-block bootstrap correct
repositories fixed
randomization label swap correct
STAT mismatch blocks publication
headline gate condition-by-condition
V7 terminal clears ACTIVE-STUDY
no automatic V8
```

---

## 41. Absolute prohibitions

```text
resume V6
change 17-task population
rewrite V6 task/acceptance/control
treat nonexistent V6 oracle as input
use 318e... as executable runtime identity
modify V7 oracle after ORACLE_FROZEN
copy V6 Bad patch as experimental output
add benchmark-task pilot
stop because power is low
change repeat count after outcomes
interim effect analysis
drop failed episode
replace failed task
switch model/product/snapshot mid-study
Record-Id backfill
owner testimony
repository bootstrap
strong headline without gate
automatic V8
```

---

## 42. Definition of Done

```text
[ ] V6 terminal preserved
[ ] V7-r1 new study/preregistration
[ ] previous V7 draft superseded
[ ] exact 17-task manifest
[ ] measured a0c542 product digest locked
[ ] predecessor 318e mismatch preserved as deviation
[ ] V6 tasks/acceptances/controls replayed
[ ] 17 oracle specs built
[ ] 17 deterministic oracles built
[ ] 17 near-misses built and false
[ ] alternate violation attempts recorded
[ ] oracle deterministic/mutation/red-team pass
[ ] ORACLE_FROZEN
[ ] manipulation/runtime locked
[ ] synthetic smoke pass
[ ] 340 schedule frozen
[ ] 340 episodes executed or integrity HOLD published
[ ] exact rows sealed
[ ] ITT analysis complete
[ ] independent analyses match
[ ] safety/cost/re-explanation complete
[ ] claim gate mechanical
[ ] result published
[ ] README changed only if allowed
[ ] V7 terminal
[ ] ACTIVE-STUDY null
[ ] no automatic V8
```

---

## 43. Final principle

> **V7-r1 first builds the missing measurement instrument, freezes it, and only then measures the product.**

The research ends when the exact 17-task answer is published and V7 is terminalized.
