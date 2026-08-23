---
document_id: commitlore-cdeb-fresh-v6-final-end-to-end-ssot
document_version: 1.0.0
document_date: 2026-08-23
repository: MongLong0214/commitlore
audit_main_sha: dffde923705632b352beb1a04e58c1fe11c01ce9
pending_predecessor_terminal_pr: 849
new_study_id: cdeb-fresh-v6
status: implementation-and-conditionally-execution-authorized
research_line_finality: final-planned-study-no-automatic-v7
human_owner_count: 1
external_people_required: 0
evidence_tier: author-operated-multi-agent-internally-replicated
measured_product_effect_rows_at_authoring: 0
predecessor: cdeb-fresh-v5
predecessor_verdict: terminal-hold
fixed_repositories:
  - agent-operator-score
  - gitseed
expected_source_decisions:
  agent-operator-score: 16
  gitseed: 18
  total: 34
product_release_tag: v1.2.0
product_release_commit: 90a8b212e1db70cccf69fbf48415b9c036b2d854
product_dist_sha256: 318e16612206ae0aa3732033127b2937276ce2f142872c33a91ec04a33133b91
source_snapshot_cutoff: 2026-08-20T22:08:19Z
---

# CommitLore CDEB-Fresh v6 Final End-to-End Research SSOT

> **이번 연구의 역할**
>
> V3–V5는 제품 효과를 측정하지 못한 실패작이 아니라, 실제로 측정 가능한 모집단을 찾아낸 선행 instrument studies다.
>
> V5는 treatment outcome을 한 건도 만들지 않은 상태에서 다음을 확정했다.
>
> ```text
> 62 historical decisions fully adjudicated
>
> 34 FUNCTIONALLY_VIOLABLE
> 23 FUNCTIONAL_ACCEPTANCE_NONDETERMINISTIC
>  5 SEMANTIC_BOUNDARY_AMBIGUOUS
>
> product-effect rows = 0
> ```
>
> V6는 더 이상 corpus·identity·host-load 연구를 반복하지 않는다.
>
> **V5에서 pre-treatment measurement feasibility가 성립한 두 repository와 34개 source decision만을 대상으로, automatic CommitLore decision delivery의 제품 효과를 끝까지 측정하고 연구 프로그램을 종료한다.**
>
> 성공을 강제하지 않는다.
>
> ```text
> positive / qualified / null / negative / terminal hold
> ```
>
> 중 어느 상태든 evidence와 함께 공개하면 연구는 완료다.
>
> **이 SSOT 아래에서 V7은 자동 생성하지 않는다.**

---

## 0. Executive owner decisions

### 0.1 V6로 간다

새 study:

```text
cdeb-fresh-v6
```

V5는 `TERMINAL_HOLD` 역사로 보존한다.

V5의 fixed four-repository estimand를 줄여 같은 study를 재개하지 않는다.

V6는 새로운:

```text
study id
preregistration
task
functional acceptance
gold/violation contract
oracle
controls
pilot
randomization
agent sessions
trajectories
rows
analysis
publication
```

을 가진다.

### 0.2 Repository 선택은 확정됐다

V6 fixed repositories:

```text
agent-operator-score
gitseed
```

이 선택은 treatment 결과를 보고 한 것이 아니다.

V5에서 product-effect row가 0인 상태에서 repository-level measurement feasibility를 조사한 결과:

```text
agent-operator-score
→ deterministic acceptance
→ 16 functionally violable decisions

gitseed
→ deterministic acceptance
→ 18 functionally violable decisions

agent-control-plane
→ acceptance instrument nondeterministic
→ V6 population 밖

logic-pro-mcp
→ acceptance instrument nondeterministic
→ V6 population 밖
```

으로 확정됐다.

따라서 repository inclusion rule은:

> **pre-treatment measurement feasibility**

이지:

> CommitLore가 잘 이길 것 같은 repository

가 아니다.

### 0.3 Owner testimony는 사용하지 않는다

```text
owner testimony = 0
synthetic Record-Id = 0
backfilled decision = 0
```

### 0.4 이번 연구는 최종 planned study다

V6가 어떤 이유로든 HOLD되면:

```text
TERMINAL_HOLD_FINAL
```

로 연구 프로그램을 닫는다.

자동 V7 설계 금지.

추가 연구는 이 SSOT 밖에서 owner가 별도 결정을 내릴 때만 가능하다.

---

## 1. Authoritative predecessor facts

## 1.1 V5 terminalization

작업 시작 시 PR #849를 확인한다.

PR #849가 아직 open이면:

```text
CI green
counts unchanged
terminal semantics valid
```

를 확인한 뒤 merge한다.

PR #849가 이미 merge되었으면 terminal state만 검증한다.

필수 predecessor invariants:

```text
cdeb-fresh-v5 phase = stage1-hold
cdeb-fresh-v5 verdict = TERMINAL_HOLD
cdeb-fresh-v5 measured_run_allowed = false
cdeb-fresh-v5 product-effect rows = 0
ACTIVE-STUDY active_study_id = null
```

하나라도 다르면 V6를 만들기 전에 predecessor state를 먼저 복구한다.

## 1.2 V5 source-pool evidence

V6 source pool은 V5 append-only adjudication ledger의 **current reduced state**에서 가져온다.

Selection:

```text
repository_id ∈ {
  agent-operator-score,
  gitseed
}

AND current adjudication = FUNCTIONALLY_VIOLABLE
```

Expected:

```text
agent-operator-score  16
gitseed               18
total                 34
```

Expected count가 다르면 임의로 맞추지 않는다.

```text
drift audit
→ V5 reducer / PR #849 / ledger 확인
→ exact reason 공개
```

후에만 진행한다.

## 1.3 V5 descriptive finding의 범위

V5의:

```text
34 / 62 = 55%
34 / 39 = 87%
```

는 product-effect result가 아니다.

허용 해석:

> V5가 valid하게 assess할 수 있었던 historical decisions 중 다수에서 functionally passing policy violation을 구성할 수 있었다.

금지:

> CommitLore가 bad decisions를 55% 또는 87% 줄였다.

---

## 2. Primary research question

## 2.1 Question

> **V5에서 prequalified functionally violable historical decisions를 바탕으로 새로 만든 coding tasks에서, first relevant mutation 이전의 automatic CommitLore decision delivery가 suppressed automatic delivery보다 Decision-Safe First-Pass Success를 높이는가?**

## 2.2 Experimental contrast

### Delivery ON

Frozen CommitLore shipping release가 candidate-relevant decision의:

```text
load-bearing ruling
reason
scope
lifecycle
```

를 first relevant mutation 이전에 model-visible context로 전달한다.

### Delivery SUPPRESSED

동일:

```text
hook entry
injector execution
repository
task
model
harness
tools
budgets
runtime
fresh-session policy
ordinary Git history
```

를 사용한다.

차이:

```text
model-visible CommitLore decision payload를 forwarding 직전에 suppression
```

한다.

즉 연구가 추정하는 것은:

> **relevant automatic model-visible decision delivery의 total effect**

다.

여기에는:

```text
semantic content
salience
payload/token load
```

가 포함된다.

다음은 추정하지 않는다.

```text
semantic content only
CommitLore hook installation overhead
knowledge access vs no access
```

OFF agent가 ordinary Git을 자율 탐색해 record를 발견하는 것은 허용하고 manipulation check로 기록한다.

## 2.3 Record-Id

`Record-Id`는 delivery 성공의 필요조건이 아니다.

Delivery는 decision content를 기준으로 판정한다.

Synthetic/backfilled ID 금지.

---

## 3. Claim population and external validity

## 3.1 Primary population

정확한 모집단:

> **Fresh coding tasks successfully constructed from naturally recorded, V5-prequalified functionally violable decisions in two author-operated repositories whose acceptance instruments were deterministic under the frozen configuration.**

## 3.2 금지 일반화

```text
all repository decisions
all repositories
all coding agents
all CommitLore versions
all teams
objective architectural correctness
```

로 일반화 금지.

## 3.3 Evidence tier

정확한 표현:

> **Author-operated, multi-agent internally replicated confirmatory study.**

금지:

```text
independent external validation
third-party validation
industry-wide benchmark
```

---

## 4. Product and repository freeze

## 4.1 Product

Primary treatment product는 V5에서 이미 검증된 release를 그대로 사용한다.

```text
tag:
v1.2.0

commit:
90a8b212e1db70cccf69fbf48415b9c036b2d854

dist SHA-256:
318e16612206ae0aa3732033127b2937276ce2f142872c33a91ec04a33133b91
```

더 최신 release로 자동 교체하지 않는다.

현재 stable이 다르더라도 primary result는 v1.2.0-specific으로 공개한다.

Result 이후 latest release compatibility check는 descriptive only이며 primary row에 섞지 않는다.

## 4.2 Repository snapshots

V5가 sealed한 exact AOS/gitseed bundles와 snapshot commits를 참조한다.

새 snapshot 금지.

V6 manifest는:

```text
source bundle path
bundle SHA-256
snapshot commit
tree OID
refs digest
notes policy
V5 source manifest digest
```

를 재검증한다.

## 4.3 Why reuse is valid

V5에는 product-effect outcomes가 없었다.

따라서 다음 V5 evidence를 planning/input eligibility로 재사용할 수 있다.

```text
natural decision identity
decision audit anchor
frozen repository snapshot
source scope
V5 pre-treatment functionally-violable classification
```

다음은 V6 measured artifact로 재사용 금지:

```text
V5 task prompt
V5 worker prose
V5 violation patch bytes
V5 Good/Bad patch bytes
V5 oracle
V5 randomization
V5 trajectory
V5 result row
```

V6 control implementation은 fresh하게 작성한다.

---

## 5. Owner conditional execution authorization

이 문서를 agent에게 전달하는 행위는 다음을 조건부 승인한다.

```text
V5 terminalization 확인/merge
V6 study 생성
34-source pool lock
fresh task/buildability pipeline
pilot
confirmatory freeze
ON/OFF execution
row seal
independent analysis
publication
README evidence update if claim gate passes
terminal cleanup
```

자동 진행 조건:

```text
current mandatory gates PASS
P0/P1 unresolved = 0
required CI green
artifact hashes complete
no protocol drift
```

자동 HOLD 조건:

```text
source pool mismatch
task-buildable floor failure
firewall breach
acceptance/oracle invalidity
pilot threshold failure
runtime/model drift
randomization corruption
row loss
analysis disagreement
claim-integrity blocker
```

Owner에게 다시 질문할 수 있는 경우는 다음뿐이다.

```text
GitHub write/merge permission unavailable
agent/model credential unavailable
hard usage/billing limit
external provider outage beyond registered retry
```

방법론 선택을 owner에게 되묻지 않는다.

---

## 6. Role isolation and information firewall

필수 역할:

| Role | 책임 | 금지 입력 |
|---|---|---|
| ORCHESTRATOR | state, PR, gate, manifests | interim aggregate effect |
| SOURCE-LOCK | 34 decision source manifest | treatment outcomes |
| NEED-SCOUT | neutral maintenance needs | record, ruling, reason, V5 patch |
| FUNCTIONAL-AUTHOR | task-specific acceptance | record, ruling, reason, oracle |
| TASK-FREEZER | deterministic task selection | treatment outcomes |
| CONTROL-BUILDER | fresh Good/Bad controls | arm outcomes, V5 patch bytes |
| ORACLE-BUILDER | policy oracle | arm, transcript, token data |
| ORACLE-REDTEAM | false positive/negative attacks | arm/outcomes |
| RANDOMIZATION-CUSTODIAN | sealed schedule | semantic result |
| RUN-OPERATOR | assigned episodes | aggregate effect |
| STAT-A | primary analysis | desired headline |
| STAT-B | independent implementation | STAT-A code/narrative |
| PATCH-A/B | re-explanation audit | arm, delivery, transcript |
| CLAIM-GATE | mechanical publication verdict | subjective marketing preference |

Task authoring roles must be fresh sessions and receive only allow-listed inputs.

현재 orchestrator는 records와 V5 evidence를 이미 봤으므로 NEED-SCOUT/FUNCTIONAL-AUTHOR 역할을 수행할 수 없다.

가능한 paired reviews는 서로 다른 model family를 사용한다.

불가능하면 fresh independent sessions로 대체하고 limitation을 기록한다.

---

## 7. State machine

```text
PREDECESSOR_TERMINAL_CHECK
→ V6_DRAFT
→ SOURCE_POOL_LOCKED
→ REPOSITORY_INSTRUMENT_QUALIFIED
→ TASK_BUILDABILITY_RUNNING
→ TASK_BUILDABILITY_FROZEN
→ ADVERSARIAL_REVIEWED
→ PILOT_FROZEN
→ PILOT_RUNNING
→ PILOT_PASS | TERMINAL_HOLD_FINAL
→ CONFIRMATORY_FROZEN
→ CONFIRMATORY_RUNNING
→ ROWS_SEALED
→ ANALYSIS_COMPLETE
→ PUBLISHED_POSITIVE
 | PUBLISHED_QUALIFIED
 | PUBLISHED_NULL
 | PUBLISHED_NEGATIVE
 | TERMINAL_HOLD_FINAL
```

역행 금지.

각 transition은 append-only ledger에:

```text
actor
timestamp
input artifacts + hashes
output artifacts + hashes
checks
deviations
```

를 기록한다.

---

## 8. V6 repository artifact layout

```text
bench/cdeb/studies/cdeb-fresh-v6/
├── PRD.md
├── PREREGISTRATION.md
├── study.json
├── STATUS.json
├── transitions.jsonl
├── deviations.jsonl
├── source-pool.json
├── product-lock.json
├── snapshot-lock.json
├── roles/
│   └── manifest.json
├── buildability/
│   ├── dispositions.jsonl
│   ├── summary.json
│   ├── tasks/
│   ├── functional-acceptance/
│   ├── controls/
│   ├── oracles/
│   ├── firewall-manifest.jsonl
│   └── validation-report.md
├── pilot/
├── confirmatory/
├── analysis/
└── RESULT.md
```

---

## 9. Repository instrument preflight

V6는 ACP/logic-pro host research를 반복하지 않는다.

AOS와 gitseed만 확인한다.

## 9.1 Regression acceptance

각 repository는:

```text
task-specific functional acceptance
+
frozen repository regression acceptance
```

두 층을 사용한다.

Bad control은 둘 다 PASS해야 한다.

## 9.2 AOS

V6 시작 전에 V5 command를 그대로 신뢰하지 않는다.

다음 rule로 command를 freeze한다.

1. broadest practical deterministic package/repository suite를 선택한다.
2. V5의 `doctor-contract` 41-test subset보다 좁을 수 없다.
3. sealed-snapshot horizon 때문에 실행 불가능한 test는 exact IDs로만 제외한다.
4. task-specific acceptance가 candidate behavior를 직접 검증한다.
5. candidate touched code에 대한 sabotage negative control이 acceptance를 실패시켜야 한다.

Exact command와 exclusions를 V6 preregistration에 freeze한다.

## 9.3 Gitseed

기본 regression acceptance:

```text
python3 -m pytest -q
```

정확한 environment와 baseline fingerprint를 freeze한다.

## 9.4 Stability check

Exact V6 acceptance configuration이 V5와 동일하면 V5의 structured stability evidence를 reference할 수 있다.

Command/exclusion이 강화 또는 변경되면, task generation 전에 unmodified frozen tree에서:

```text
10 consecutive runs
```

을 수행한다.

모든 run이 동일:

```text
test total
pass
fail
skip
failure IDs
```

이어야 한다.

불일치하면 해당 repository는 V6에서 사용할 수 없으므로:

```text
TERMINAL_HOLD_FINAL
```

이다.

100-run host study를 새로 만들지 않는다.

---

## 10. The 34-source decision lock

`source-pool.json` 필수 필드:

```text
study_id
source_study_id
source_ledger_digest
reducer_version/digest
candidate_id
decision_audit_anchor
repository_id
snapshot_sha
source commit
ruling
reason
scope
lifecycle
identity_present
V5 current adjudication
```

금지:

```text
V5 passing patch
V5 worker prose
V5 outcome-like convenience score
```

Source pool 전체 SHA-256을 preregistration에 기록한다.

---

## 11. Fresh task-buildability pipeline

34개 모두 처리한다.

최종 상태는 정확히 하나:

```text
TASK_BUILDABLE
NOT_TASK_BUILDABLE:<registered_reason>
```

Undecided 0이 되기 전 pilot 금지.

## 11.1 Registered exclusion reasons

```text
candidate-decision-visible-to-task-author
neutral-maintenance-need-not-derivable
task-already-satisfied-by-base
task-functional-acceptance-not-deterministic
regression-acceptance-not-deterministic
scope-not-isolatable
no-two-compliant-controls
no-functionally-passing-violation-for-frozen-task
semantic-boundary-ambiguous-for-frozen-bad-control
oracle-not-discriminative
oracle-redteam-failure
runtime-budget-infeasible
```

Free-form exclusion 금지.

## 11.2 NEED-SCOUT

Input:

```text
record-blind tree
candidate path scope
repository metadata
```

Forbidden:

```text
CommitLore record
Ruled-out
Reason
Record-Id
decision anchor
V5 patch
V5 shape/verdict prose
oracle
gold
```

Output:

```text
exactly 3 plausible neutral maintenance needs
tree evidence for each
```

## 11.3 Candidate-specific record blindness

Task-author tree:

```text
no .git history
no refs/notes/commitlore
candidate's own record removed
candidate ruling/reason absent
```

다른 candidate record의 단순 존재는 report-only다.

Candidate own decision의:

```text
exact ID
exact ruling
near-verbatim ruling
confirmed semantic paraphrase
```

가 task-author input에 있으면 exclude 또는 safe redaction 후 revalidate한다.

Process/input manifest가 primary firewall이다.

N-gram scan만으로 semantic blindness를 주장하지 않는다.

## 11.4 Deterministic task selection

NEED-SCOUT가 만든 세 need를:

```text
SHA256(
  preregistration_seed
  + candidate_id
  + need_hash
)
```

로 정렬한다.

정렬 순서대로 buildability를 평가한다.

첫 번째로 full dual-solution contract를 만족한 task를 freeze한다.

없으면 candidate 제외.

이 rule은 treatment outcome과 무관하다.

## 11.5 FUNCTIONAL-AUTHOR

Record-blind input만 사용한다.

Task acceptance는:

```text
user-visible / public behavior
task-specific output
bounded scope
```

를 검증한다.

Decision을 encoding하는 condition 금지.

예:

```text
"JSON을 쓰지 말 것"
"badge를 추가하지 말 것"
"wrapper signature를 검증하지 말 것"
```

같은 ruling leak를 functional acceptance에 넣지 않는다.

## 11.6 Task freeze order

```text
neutral need
→ task prompt
→ task-specific functional acceptance
→ hashes/manifest freeze
→ 그 이후에만 record-aware control/oracle work
```

순서를 machine-verifiable하게 기록한다.

---

## 12. Dual acceptance contract

모든 control과 experimental final tree는 두 acceptance를 받는다.

## 12.1 Task-specific functional acceptance

질문:

> 새 task가 요구한 기능을 실제로 구현했는가?

## 12.2 Regression acceptance

질문:

> frozen repository baseline에 새로운 regression을 만들지 않았는가?

## 12.3 Passing definition

```text
functional_pass =
task_acceptance_pass
AND regression_acceptance_pass
```

Regression-only pass는 functional pass가 아니다.

이 규칙은 V5의 provisional violation implementation을 V6 task로 오해하는 것을 막는다.

## 12.4 Machine-generated receipts

각 acceptance run은 machine receipt를 가진다.

최소:

```text
registered command hash
executed command hash
timestamps
exit code
structured counts
failure IDs
baseline fingerprint
changed files
worktree/final tree IDs
stdout/stderr hashes
runtime identity
```

Worker prose는 evidence가 아니다.

---

## 13. Fresh controls and oracle

## 13.1 Mandatory controls per TASK_BUILDABLE candidate

### Base

```text
task acceptance:
expected FAIL

regression:
baseline-equivalent

oracle:
false
```

### Good A

```text
task PASS
regression PASS
oracle false
```

### Good B

Good A와 구조적으로 다른 compliant implementation:

```text
task PASS
regression PASS
oracle false
```

### Bad A

```text
task PASS
regression PASS
oracle true
blind semantic violation confirmed
```

### Bad B

가능하면 다른 conceptual shape:

```text
task PASS
regression PASS
oracle true
```

Bad B가 불가능하면 limitation을 기록하되 Bad A는 필수다.

### Near miss

```text
oracle false
```

## 13.2 No V5 patch reuse

V5 diff/patch bytes를 control로 복사하지 않는다.

Control builder는 V6 frozen task 이후 fresh implementation을 작성한다.

## 13.3 Semantic violation adjudication

Passing implementation이 자동 violation인 것은 아니다.

두 independent blind judges가:

```text
VIOLATION_CONFIRMED
NOT_A_VIOLATION
AMBIGUOUS
```

를 판정한다.

둘 다 `VIOLATION_CONFIRMED`일 때만 Bad control이 된다.

Disagreement:

```text
third blind adjudication
```

그래도 ambiguity가 남으면 candidate 제외.

Judges는:

```text
corpus floors
arm
future outcome
marketing goal
```

을 보지 않는다.

## 13.4 Oracle

Oracle은 final tree만 읽는다.

Forbidden:

```text
arm
delivery log
transcript
token usage
agent explanation
record citation
```

우선순위:

```text
black-box behavior
public API/CLI
AST/structured parse
semantic structural predicate
lexical predicate only for inherently lexical decisions
```

## 13.5 Oracle validation

필수:

```text
all controls correctly classified
30 deterministic repeated evaluations
mutation tests
independent oracle red-team
unresolved false positive/negative = 0
```

---

## 14. Task-buildability GO/HOLD gate

Source pool:

```text
AOS     16
gitseed 18
```

Pilot 전에 필요한 minimum TASK_BUILDABLE:

```text
agent-operator-score >= 10
gitseed              >= 10
total                >= 22
```

미달:

```text
TERMINAL_HOLD_FINAL
```

Threshold 완화 금지.

TASK_BUILDABLE candidate는 그 후 deterministic seed ranking으로:

```text
AOS pilot      2
gitseed pilot  2
```

를 선택한다.

나머지는 confirmatory reserve.

Confirmatory reserve minimum:

```text
AOS >= 8
gitseed >= 8
total >= 18
```

---

## 15. Experimental coding agent and runtime lock

## 15.1 Agent selection

Default experimental harness:

```text
Codex CLI
```

이유:

```text
V5 implementation environment에서 실제 사용됨
fresh isolated sessions 지원
exact CLI/model/runtime identity 기록 가능
```

V6 freeze 시:

```text
exact CLI version
executable digest
server-reported exact model ID
system prompt bytes/digest
tools
permissions
container/runtime
```

를 기록한다.

Credential이 없다면 owner에게 물을 수 있다.

여러 모델을 비교하지 않는다.

## 15.2 Claim scope

Result는 한 pinned model/harness에 대한 것이다.

## 15.3 Episode budget

Freeze before pilot:

```text
wall clock: 1800 seconds
max meaningful turns: 60
max tool calls: 80
fresh worktree: required
fresh HOME/session: required
cross-run memory: forbidden
manual CommitLore query tools: disabled in both arms
capture/write side: disabled in both arms
ordinary Git: available in both arms
```

Provider가 hard token budget을 지원하면 exact 값도 freeze한다.

지원하지 않으면 raw usage를 기록한다.

---

## 16. Pilot

## 16.1 Allocation

```text
2 AOS
2 gitseed
= 4 candidates
```

Candidate selection은 buildability freeze 후 preregistered hash ranking으로 한다.

Pilot candidates는 confirmatory에서 제외한다.

## 16.2 Episodes

```text
4 candidates
× 2 arms
× 1 episode
= 8 assigned episodes
```

## 16.3 Purpose

Pilot은 instrument feasibility만 판단한다.

```text
runtime lock
fresh isolation
ON delivery
OFF suppression
first-mutation timing
task execution
functional acceptance
oracle evaluation
row durability
```

Pilot treatment effect는:

```text
sample size
repeats
candidate selection
continuation
endpoint
analysis
```

을 바꾸지 못한다.

## 16.4 PASS thresholds

```text
task/control prevalidation valid             4/4
ON expected delivery before first mutation   4/4
OFF model-visible CommitLore payload          0/4
stale-as-current                              0
wrong-tree delivery                           0
meaningful agent start                        8/8
durable schema-valid row                      8/8
final tree evaluable                         >=7/8
completion                                   >=6/8
unresolved P0/P1                              0
```

## 16.5 Retry

Meaningful model turn 이전의 arm-independent infrastructure failure:

```text
1 retry
```

허용.

그 이후 failure는 row에 남고 pilot threshold에 포함된다.

Pilot FAIL:

```text
TERMINAL_HOLD_FINAL
```

같은 study 안에서 task/oracle을 outcome-aware하게 고쳐 재실행하지 않는다.

---

## 17. Confirmatory design

## 17.1 Corpus

Pilot 4개를 제외한 모든 TASK_BUILDABLE reserve를 사용한다.

Hand selection 금지.

## 17.2 Repeat rule

Confirmatory candidate total `M`:

```text
M >= 24
→ 5 repeats per arm

20 <= M < 24
→ 6 repeats per arm

18 <= M < 20
→ 8 repeats per arm

M < 18
→ TERMINAL_HOLD_FINAL
```

각 repository reserve >= 8 필수.

이 rule은 pilot effect와 무관하다.

## 17.3 Expected size

대략:

```text
240–304 confirmatory episodes
```

## 17.4 Randomization

Unit:

```text
candidate × repeat
```

각 unit에서 ON/OFF pair를 모두 실행한다.

Arm order:

```text
committed seed
```

로 randomize한다.

Global schedule는:

```text
repository
candidate
repeat
arm
```

을 interleave한다.

Complete schedule와 expected row list/hash를 첫 episode 전에 commit한다.

## 17.5 Concurrency

최대:

```text
4 active episodes
max 2 per repository
same candidate pair concurrent 금지
```

Service/time drift가 arm에 몰리지 않게 block schedule을 따른다.

---

## 18. Delivery manipulation

## 18.1 ON success

Expected decision의:

```text
ruling visible
reason visible
scope correct
lifecycle current
before first relevant mutation
```

을 모두 만족.

`Record-Id` visibility 불필요.

## 18.2 SUPPRESSED success

Shipping injector/hook path는 실행되지만:

```text
model-visible CommitLore decision payload = absent
```

이어야 한다.

## 18.3 Discovery

OFF agent가 Git에서 decision을 발견하면:

```text
control_discovery = true
```

로 기록한다.

삭제/제외 금지.

---

## 19. Row durability and ITT

## 19.1 Every assigned episode

다음 순서:

```text
write temp
fsync
atomic rename
read back
schema validate
sha256
append manifest
```

## 19.2 Required row fields

```text
study/task/candidate/repository
assignment
repeat
runtime identity
base/final tree OID
task acceptance
regression acceptance
functional_pass
oracle result
revival
DSFPS
completion
delivery manipulation
first mutation timing
usage
retry lineage
artifact digests
```

## 19.3 Primary ITT

모든 assigned episode가 denominator에 남는다.

```text
DSFPS =
completed
AND functional_pass
AND revival == false
```

다음은 DSFPS 0:

```text
timeout
non-completion
task failure
regression failure
revival
not-evaluable
post-turn provider/harness failure
```

## 19.4 Retry

오직 meaningful model turn 이전의 registered infrastructure failure에 1회.

Original attempt와 retry 모두 보존.

---

## 20. Statistical Analysis Plan

## 20.1 Fixed strata

Repositories:

```text
agent-operator-score
gitseed
```

fixed strata다.

Repository를 random sample로 취급하지 않는다.

## 20.2 Candidate effect

Candidate `c` in repository `r`:

```text
d_rc =
mean_repeat(DSFPS_ON[r,c])
-
mean_repeat(DSFPS_SUPPRESSED[r,c])
```

Repository effect:

```text
D_r = mean_candidate(d_rc)
```

Primary effect:

```text
Delta = 0.5 * D_AOS + 0.5 * D_gitseed
```

## 20.3 Primary interval

Candidate-cluster bootstrap:

```text
resample candidates within each fixed repository
carry all ON/OFF repeats together
do not resample repositories
do not resample repeats in primary bootstrap
50,000 replicates
fixed seed
percentile 95% interval
```

## 20.4 Randomization sensitivity

Within each candidate × repeat pair:

```text
swap ON/SUPPRESSED labels
```

Monte Carlo:

```text
100,000 permutations
fixed seed
```

## 20.5 Key secondary

```text
FVR =
functional_pass
AND revival == true

RBDR =
1 - FVR_ON / FVR_SUPPRESSED
```

Report:

```text
raw counts
raw rates
absolute pp difference
relative reduction
95% interval
```

If `FVR_SUPPRESSED = 0`, RBDR is undefined.

## 20.6 Safety

```text
completion rate difference
functional pass rate difference
not-evaluable rate
timeout rate
```

Noninferiority margin:

```text
-5 percentage points
```

## 20.7 Repository-specific reporting

AOS와 gitseed effect를 따로 공개한다.

Headline gate에서는 두 repository 모두 DSFPS point estimate가 positive여야 한다.

---

## 21. Independent analysis replication

STAT-A와 STAT-B는:

```text
same sealed rows
same frozen formulas
independent implementation
fresh sessions
different model family where available
```

을 사용한다.

STAT-B는 결과 seal 전 STAT-A code/narrative를 보지 않는다.

Match:

```text
raw counts exact
point estimates tolerance <= 1e-12
bootstrap quantiles <= 1e-6
claim gate identical
```

Mismatch unresolved:

```text
TERMINAL_HOLD_FINAL
```

평균내서 해결 금지.

---

## 22. Blind re-explanation audit

Secondary user-impact result.

Input:

```text
task
final diff
redacted policy summary
```

Blind to:

```text
arm
CommitLore payload
Record-Id
delivery logs
transcript
token usage
```

Question:

> 이 patch를 승인하려면 이미 기록된 repository decision을 reviewer가 다시 설명해야 하는가?

PATCH-A:

```text
all evaluable final trees
```

PATCH-B:

```text
A=yes all
A=no deterministic 25% sample
```

Disagreement는 third blind adjudication.

Primary code oracle를 덮어쓰지 않는다.

---

## 23. Cost reporting

Episode별:

```text
input/output tokens
cache categories
turns
tool calls
files read
wall time
```

Report:

```text
raw token difference
wall-time difference
Token Tax per Prevented Revival
```

Token saving은 success gate가 아니다.

---

## 24. Publication and claim gate

## 24.1 Always publish

어떤 결과든:

```text
RESULT.md
raw normalized rows
freeze manifest
task/acceptance/oracle/control index
pilot report
STAT-A/B reports
deviations
limitations
reproduction instructions
claim-gate result
```

을 공개한다.

## 24.2 Strong README headline

다음 모두 통과해야:

```text
[ ] DSFPS Delta 95% CI lower bound > 0
[ ] FVR ON-SUPPRESSED 95% CI upper bound < 0
[ ] RBDR point estimate >= 50%
[ ] RBDR 95% lower bound >= 20%
[ ] SUPPRESSED raw FVR events >= 10
[ ] completion lower 95% bound > -5pp
[ ] functional-pass lower 95% bound > -5pp
[ ] overall ON delivery >= 95%
[ ] every candidate ON delivery >= 80%
[ ] SUPPRESSED model-visible payload leakage = 0
[ ] stale-as-current = 0
[ ] wrong-tree delivery = 0
[ ] AOS DSFPS point estimate > 0
[ ] gitseed DSFPS point estimate > 0
[ ] extreme missingness direction reversal = 0
[ ] STAT-A/B mismatch = 0
[ ] unresolved P0/P1 = 0
```

통과 시:

> **R% fewer repeated bad decisions.**

Footnote 필수:

> Fresh tasks derived from prequalified functionally violable decisions in two author-operated repositories; one pinned model/harness; CommitLore v1.2.0; automatic relevant delivery versus suppressed automatic delivery.

## 24.3 Gate fail

다음 중 정확한 하나로 공개:

```text
PUBLISHED_QUALIFIED
PUBLISHED_NULL
PUBLISHED_NEGATIVE
TERMINAL_HOLD_FINAL
```

README strong headline 금지.

Null result는:

> no detectable effect under this design

이지:

> CommitLore has no effect

가 아니다.

---

## 25. Latest-release compatibility check

Primary result 이후에만 수행 가능.

현재 latest stable이 v1.2.0과 다르면:

```text
final V6 tasks에서 latest release의 ON content delivery
suppression mechanism
stale/scope behavior
```

만 descriptive check한다.

Agent product-effect episode 재실행 금지.

Compatibility가 통과해도 primary causal result는 v1.2.0에 귀속된다.

README에는 tested version을 명시한다.

---

## 26. PR execution plan

## PR-A — V5 terminal + V6 preregistration and task buildability

포함:

```text
PR #849 terminalization 확인/merge
V6 SSOT install
study/status/active declaration
34 source pool lock
snapshot/product lock
repository acceptance preflight
34 task-buildability dispositions
tasks/acceptance/controls/oracles
firewall manifests
validation report
adversarial review
runtime schema
analysis code/tests
```

금지:

```text
assigned-arm pilot
product-effect row
```

Merge gate:

```text
TASK_BUILDABLE floors pass
all controls valid
P0/P1 0
CI green
measured rows 0
```

Floor fail:

```text
TERMINAL_HOLD_FINAL publication
```

## PR-B — Pilot and confirmatory freeze

포함:

```text
pilot allocation
8 pilot episodes
pilot PASS/HOLD
PASS면 confirmatory candidate/repeat rule
runtime lock
randomization schedule
expected rows
freeze manifest
```

Pilot HOLD:

```text
terminalize and publish
```

Pilot PASS:

```text
merge and start PR-C automatically
```

## PR-C — Confirmatory, analysis, publication, closure

포함:

```text
all confirmatory episodes
row seal
STAT-A/B
re-explanation audit
claim gate
RESULT
README update only if allowed
terminal STATUS
ACTIVE-STUDY null
CDEB-specific work closure
```

Branch protection 우회 금지.

---

## 27. Mandatory tests and negative controls

최소:

```text
V5 terminal study cannot be resumed
V6 source pool is exactly 16 AOS + 18 gitseed
ambiguous/nondeterministic V5 rows cannot enter
V5 patch bytes cannot enter V6 controls
task author forbidden inputs rejected
task freeze precedes oracle
base fails task acceptance
Good A/B pass both acceptances and oracle false
Bad A passes both acceptances and oracle true
semantic ambiguity excludes
receipt command mismatch rejects
test deletion/skip increase rejects
oracle reads final tree only
oracle mutation controls
pilot continuation cannot read effect
runtime drift stops
OFF payload leakage stops headline
ITT cannot drop post-turn failures
candidate bootstrap never resamples repositories
STAT-A/B mismatch stops
strong headline fails when any gate is false
```

---

## 28. Final result categories

```text
PUBLISHED_POSITIVE
PUBLISHED_QUALIFIED
PUBLISHED_NULL
PUBLISHED_NEGATIVE
TERMINAL_HOLD_FINAL
```

모든 category는 연구 완료다.

---

## 29. Repository cleanup

최종 merge 후:

```text
V6 STATUS terminal
ACTIVE-STUDY active_study_id = null
last_terminal_study_id = cdeb-fresh-v6
open CDEB issues = 0
open CDEB PRs = 0
temporary worktrees/secrets removed
raw evidence retained
merged remote branches retained unless owner explicitly orders deletion
```

Unrelated product work는 건드리지 않는다.

---

## 30. Definition of Done

```text
[ ] PR #849 terminal state resolved
[ ] V5 preserved and non-resumable
[ ] V6 new study id/preregistration
[ ] source pool exact 34
[ ] AOS/gitseed only
[ ] product/snapshot locked
[ ] all 34 task-buildability disposed
[ ] task-buildable floor evaluated
[ ] floor fail이면 final HOLD published
[ ] floor pass이면 pilot executed
[ ] pilot PASS/HOLD published
[ ] PASS이면 confirmatory frozen/executed
[ ] all expected rows sealed
[ ] ITT analysis complete
[ ] fixed two-repository equal-weight estimand
[ ] independent analysis match
[ ] secondary audit/cost complete
[ ] claim gate mechanical
[ ] positive/qualified/null/negative/HOLD published
[ ] README changed only if allowed
[ ] ACTIVE-STUDY cleared
[ ] V6 terminal
[ ] no automatic V7
```

---

## 31. Absolute prohibitions

```text
resuming V5
adding ACP/logic-pro to V6
dropping AOS/gitseed after seeing outcomes
reusing V5 patches as V6 controls
task prompt leaking ruling
regression-only PASS as functional PASS
pilot effect choosing N/repeats/candidates
post-treatment exclusion
repository bootstrap
Record-Id backfill
owner testimony
interim significance stopping
README number before claim gate
fatal defect called limitation
automatic V7
```

---

## 32. Final principle

> **V6 does not need to prove that CommitLore works. It needs to produce the final truthful answer for the exact population V5 made measurable.**

The research is complete when that answer is published and the study is terminalized.
