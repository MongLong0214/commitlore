---
document_id: commitlore-cdeb-fresh-v8-final-blind-panel-effect-trial-ssot
document_version: 1.0.0
document_date: 2026-08-24
repository: MongLong0214/commitlore
audit_main_sha: cfb25520c2a453ee09401de80177b17f3a54536c
v7_work_branch: cdeb-v7-pra
v7_work_branch_sha: 9ad19a41c75a34ae4f3d0ffaa41028222961d714
study_id: cdeb-fresh-v8
status: implementation-and-conditionally-execution-authorized
owner_override_of_no_successor: explicit
predecessor_study: cdeb-fresh-v7
predecessor_expected_verdict: TERMINAL_HOLD_FINAL
predecessor_measured_product_effect_rows: 0
fixed_repositories:
  - agent-operator-score
  - gitseed
fixed_tasks:
  agent-operator-score: 8
  gitseed: 9
  total: 17
v7_boundary_status:
  settled: 8
  unresolved: 9
repeats_per_arm_per_task: 10
expected_measured_episodes: 340
primary_outcome_instrument: blinded-three-judge-semantic-panel
expected_primary_judgements: 1020
primary_product_release_tag: v1.2.0
primary_product_release_commit: 90a8b212e1db70cccf69fbf48415b9c036b2d854
primary_product_dist_artifact: dist/commitlore.mjs
primary_product_dist_sha256: a0c542977f048e6b5163f581d2e4a53963b2d9845467af8949fa105b8bc0e528
benchmark_pilot: none
external_people_required: 0
evidence_tier: author-operated-multi-agent-internally-replicated
automatic_v9: forbidden
---

# CommitLore CDEB-Fresh v8 Final Blind-Panel Effect Trial — End-to-End SSOT

> **이번 연구의 목적**
>
> V7은 제품 효과를 측정하지 못한 채, 자연 발생 repository decision 17개 중:
>
> ```text
> deterministic machine boundary settled     8
> deterministic machine boundary unresolved  9
> product-effect episodes                     0
> ```
>
> 을 확인했다.
>
> 이는 CommitLore의 효과가 없다는 결과가 아니다.
>
> 다음을 뜻한다.
>
> > **사람에게 의미가 있는 자연어 repository decision이 항상 deterministic final-tree predicate로 환원되지는 않는다.**
>
> V8은 deterministic machine oracle을 더 이상 primary outcome instrument로 요구하지 않는다.
>
> exact 17-task population을 그대로 유지하고, arm-blind semantic adjudication panel이 final tree를 판정한다.
>
> ```text
> 17 fixed tasks
> × 2 arms
> × 10 repetitions
> = 340 measured coding-agent episodes
>
> 340 outputs
> × 3 blind judges
> = 1,020 primary semantic judgements
> ```
>
> 이번에는 `BOUNDARY_UNRESOLVED`가 exclusion이나 HOLD 사유가 아니다.
> 그것이 V8이 panel adjudication을 사용하는 이유다.
>
> Positive, qualified, null, negative, indeterminate 또는 integrity HOLD 중 하나를 공개하면 연구는 완료다.
>
> **V9은 자동 생성하지 않는다.**

---

## 0. Final owner decisions

### 0.1 V7은 terminal history로 닫는다

현재 `cdeb-v7-pra`의 Phase 5 evidence를 보존한다.

V7 result:

```text
exact tasks:                  17
machine boundary settled:     8
machine boundary unresolved:  9
measured product-effect rows: 0
```

V7 PRD §13.3의 terminal rule을 적용한다.

```text
V7 verdict:
TERMINAL_HOLD_FINAL
```

17개를 8개로 줄여 V7을 실행하지 않는다.

V7 phase evidence를 삭제하거나 고쳐서 원래부터 V8 설계였던 것처럼 만들지 않는다.

### 0.2 V8은 새로운 owner-authorized study다

```text
study_id:
cdeb-fresh-v8
```

V8은 V7을 재개하지 않는다.

새로 생성:

```text
study/preregistration
judge instrument
judge calibration
runtime/model/panel locks
schedule
coding-agent sessions
blind judgements
rows
analysis
publication
```

### 0.3 Fixed 17-task population

17개 모두 유지한다.

```text
BOUNDARY_SETTLED    8
BOUNDARY_UNRESOLVED 9
```

두 group 모두 primary population에 포함한다.

금지:

```text
17 → 8 축소
unresolved task 제외
judge agreement이 낮은 task 제외
유리한 task 교체
새 task 추가
repository 변경
```

### 0.4 No deterministic-oracle prerequisite

Deterministic machine oracle은 V8 primary prerequisite가 아니다.

V7에서 이미 완성된 deterministic oracle이 일부 존재하더라도 secondary calibration/sensitivity에만 사용한다.

V8 primary violation outcome은 blind three-judge panel로 결정한다.

### 0.5 No benchmark pilot and no sample-size gate

```text
benchmark pilot 없음
power 부족을 이유로 실행 중단 없음
task count floor 없음
```

Judge calibration과 synthetic runtime/manipulation smoke만 execution 전에 수행한다.

### 0.6 Finality

V8은 다음 중 하나로 끝난다.

```text
PUBLISHED_POSITIVE
PUBLISHED_QUALIFIED
PUBLISHED_NULL
PUBLISHED_NEGATIVE
PUBLISHED_INDETERMINATE
TERMINAL_HOLD_FINAL
```

No automatic V9.

---

## 1. Required predecessor terminalization

### 1.1 Current evidence at authoring

```text
main:
cfb25520c2a453ee09401de80177b17f3a54536c

V7 work branch:
cdeb-v7-pra

V7 branch SHA:
9ad19a41c75a34ae4f3d0ffaa41028222961d714

open tracking issue:
#853
```

### 1.2 V7 terminal PR

V8 work 전에 V7을 terminalize한다.

V7 terminal PR에 포함:

```text
Phase 5 evidence freeze
8 settled / 9 unresolved raw artifact
RESULT.md
STATUS = TERMINAL_HOLD_FINAL
measured_run_allowed = false
product_effect_rows = 0
ACTIVE-STUDY = null
last_terminal_study_id = cdeb-fresh-v7
no V7 execution schedule
```

V7 terminal result의 정확한 문장:

> CDEB-Fresh v7 reached TERMINAL_HOLD_FINAL before any product-effect episode. Eight of the fixed 17 decisions yielded a semantic boundary precise enough for deterministic oracle construction and nine did not. Because the preregistered population was fixed at all 17 tasks and unresolved ambiguity was terminal under v7, the population was not reduced post hoc. This result concerns deterministic machine adjudicability, not the causal effect of CommitLore delivery.

V7 terminal PR merge 전 V8 measured work 금지.

### 1.3 Issue #853

V7 terminal merge 후 #853을 다음 중 하나로 정리한다.

권장:

```text
same issue retained as research-line tracker
body updated with:
- V7 terminal result
- explicit owner authorization for V8
- V8 exact study question
- no automatic V9
```

V8 final merge 후 close한다.

---

## 2. Exact fixed benchmark population

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

### 2.3 V7 machine-boundary metadata

#### Boundary settled — 8

```text
v4-0ecd7426eebc1cab
v4-34aef026d81c2f6b
v4-77e1745655a235ce
v4-8fc3d2ec14b1c078
v4-cadfb63755c3f504
v4-ed878960135ff45a
v4-f3c960a48273132c
v4-f901052615fa3aee
```

#### Boundary unresolved — 9

```text
v4-002ffd1e428c572a
v4-377f04276465b59d
v4-84cd6d391ac2fa6d
v4-8f24735524874167
v4-9b42b1951da730e1
v4-c61d7c943edd8cff
v4-ce2adee3c134ab03
v4-dd4a74ba2b628991
v4-e7587b2b65750306
```

이 status는 secondary analysis metadata다.

Judges에게 보여주지 않는다.

Primary inclusion/exclusion에 사용하지 않는다.

### 2.4 No selection discretion

한 task라도 missing/corrupt하면 다른 task로 교체하지 않는다.

```text
TERMINAL_HOLD_FINAL
```

로 종료한다.

---

## 3. Product and repository identity

### 3.1 Product

```text
release tag:
v1.2.0

release commit:
90a8b212e1db70cccf69fbf48415b9c036b2d854

artifact:
dist/commitlore.mjs

SHA-256:
a0c542977f048e6b5163f581d2e4a53963b2d9845467af8949fa105b8bc0e528
```

과거 declared `318e1661…`은 runtime identity로 사용하지 않는다.

V6/V7 deviation history에만 남긴다.

### 3.2 Repository snapshots

V6/V7에서 frozen된 exact AOS/gitseed snapshots와 bundles를 사용한다.

새 snapshot 금지.

V8 import manifest:

```text
bundle SHA-256
snapshot commit
tree OID
refs digest
notes policy
task/control hashes
```

를 검증한다.

### 3.3 Immutable task artifacts

재사용:

```text
task prompt
task-specific acceptance
registered regression acceptance
per-candidate baseline evidence
Base verification
Good A
Good B
Bad A
Bad A semantic judgement
firewall evidence
source decision packet
```

금지:

```text
task 재작성
acceptance 완화/강화
V6/V7 Bad patch를 experimental agent output으로 재사용
```

---

## 4. Primary causal question

> **Across the exact 17 frozen decision-sensitive tasks, does automatic delivery of the candidate-relevant CommitLore decision before the first relevant mutation increase Panel-Decision-Safe First-Pass Success relative to suppressing that automatic target-decision delivery?**

한국어:

> **고정된 17개 decision-sensitive task에서, 관련 CommitLore decision을 첫 relevant mutation 전에 자동 전달하면 그 전달을 억제했을 때보다 task를 정상 완료하고 blind semantic panel이 repository decision을 지켰다고 판정할 확률이 높아지는가?**

---

## 5. Claim population and evidence tier

### 5.1 Primary population

> **The exact 17 frozen tasks constructed from naturally recorded decisions in two author-operated repositories at the frozen snapshots.**

### 5.2 Fixed benchmark inference

```text
17 tasks:
fixed finite benchmark population

10 repetitions per arm:
stochastic execution replication
```

### 5.3 Evidence tier

> **Author-operated, multi-agent internally replicated, blind-panel fixed-benchmark effect trial.**

금지:

```text
external independent validation
industry-wide benchmark
all-repository proof
all-agent proof
objective architecture optimality
```

---

## 6. Experimental arms

### 6.1 Common execution path

두 arm 동일:

```text
repository snapshot
task
coding agent/model
system prompt
tools
permissions
runtime
budgets
fresh session/worktree
ordinary Git history
shipping hook/injector execution
non-target payload blocks
```

### 6.2 TARGET-DELIVERY ON

Expected decision:

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
hook/injector preserved
framing preserved
```

Substring-only suppression 금지.

### 6.4 Manual discovery

SUPPRESSED agent가 ordinary Git을 자율 검색해 decision을 발견하는 것은 허용한다.

```text
manual_discovery = true
```

로 기록하고 episode를 제외하지 않는다.

### 6.5 Estimand

추정:

> **total effect of automatic candidate-relevant decision delivery**

포함:

```text
semantic content
salience
target payload token load
```

추정하지 않음:

```text
semantic content alone
hook installation overhead
knowledge access vs no access
```

---

## 7. Primary outcome instrument — blind semantic panel

### 7.1 Why panel adjudication is required

V7은:

```text
deterministic boundary settled     8
deterministic boundary unresolved  9
```

를 확인했다.

하지만 자연어 decision을 읽고 특정 final patch가 명백하게 위반인지 판정하는 것과,
모든 가능한 implementation을 커버하는 deterministic predicate를 작성하는 것은 다른 문제다.

V8은 전자를 측정한다.

### 7.2 Panel composition

Primary panel:

```text
JUDGE-1
JUDGE-2
JUDGE-3
```

필수:

```text
3 fixed judge identities
fresh independent session per episode per judge
at least 2 distinct model families where available
exact model/version IDs frozen
same canonical prompt and schema
```

한 model family만 사용 가능해도 연구는 진행한다.

단:

```text
evidence tier downgraded
strong README headline disabled
```

### 7.3 Judge input

각 judge가 보는 것:

```text
opaque episode ID
exact natural decision ruling
exact reason
scope
lifecycle
task prompt
read-only final tree
base-to-final diff
relevant source context
```

Judge가 보지 않는 것:

```text
arm
ON/SUPPRESSED label
candidate boundary-settled status
agent model identity
transcript
delivery payload/log
token usage
functional acceptance result
repeat number
V6 Bad A / Good controls
V7 spec A/B/C
aggregate outcomes
```

### 7.4 Final-tree presentation

Judge tree copy에서 제거:

```text
.git
CommitLore notes/index
experiment logs
assignment files
arm labels
runtime logs
hidden acceptance/oracle files
```

Agent-generated source files와 comments는 변형하지 않는다.

### 7.5 Canonical judge question

> Based only on the frozen repository decision, its reason and scope, the task, and the final implementation, does this final tree clearly implement an approach the decision ruled out?

Labels:

```text
COMPLIANT
VIOLATION
INDETERMINATE
```

Rules:

- `COMPLIANT`: final tree clearly stays outside the ruled-out approach.
- `VIOLATION`: final tree clearly implements the ruled-out approach within recorded scope/lifecycle.
- `INDETERMINATE`: record does not clearly decide this implementation, evidence is insufficient, or both readings remain plausible.

Judges do not decide whether the historical decision was wise.

### 7.6 Required structured output

```json
{
  "packet_id": "opaque",
  "label": "COMPLIANT|VIOLATION|INDETERMINATE",
  "decision_clause": "...",
  "evidence_paths": ["..."],
  "observable_behavior": "...",
  "confidence": "high|medium|low",
  "reexplanation_required": "YES|NO|INDETERMINATE",
  "rationale": "..."
}
```

Confidence is descriptive only.

---

## 8. Judge calibration and freeze

### 8.1 Calibration corpus

V6 frozen controls provide known semantic labels for all 17 tasks.

Per task:

```text
Good A → COMPLIANT
Good B → COMPLIANT
Bad A  → VIOLATION
```

Total:

```text
51 calibration cases per judge
153 calibration judgements
```

These are pre-treatment controls, not measured product-effect outputs.

### 8.2 Canonical prompt

One canonical prompt/schema is fixed before calibration.

Measured-output feedback cannot change it.

### 8.3 Judge candidate pool

Up to five available judge models/families may be evaluated on the control corpus.

Select the fixed three by a deterministic rule:

1. pass minimum thresholds;
2. maximize panel-level control accuracy;
3. maximize model-family diversity;
4. deterministic model-ID lexical tie-break.

### 8.4 Minimum individual threshold

Each selected judge:

```text
overall control accuracy >= 85%
VIOLATION recall >= 80%
COMPLIANT recall >= 80%
malformed output = 0
```

### 8.5 Minimum panel threshold

Majority panel over the 51 controls:

```text
overall accuracy >= 92%
VIOLATION recall >= 90%
COMPLIANT recall >= 90%
no candidate has Bad A classified COMPLIANT by all three judges
```

### 8.6 Calibration failure

If no valid three-judge panel can be selected:

```text
TERMINAL_HOLD_FINAL
```

No measured coding episode is run.

### 8.7 Freeze

After calibration:

```text
judge model IDs
prompt bytes/hash
system instructions
tool access
output schema
aggregation rule
```

are frozen.

Measured output을 본 뒤 judge/prompt 교체 금지.

---

## 9. Panel aggregation

### 9.1 Episode-level panel label

Three independent labels:

- 2 or 3 `VIOLATION` → `PANEL_VIOLATION`
- 2 or 3 `COMPLIANT` → `PANEL_COMPLIANT`
- 2 or 3 `INDETERMINATE` → `PANEL_INDETERMINATE`
- one of each → `PANEL_INDETERMINATE`

No post-hoc fourth judge.

### 9.2 Why no tie-break judge

Fourth-judge adjudication only on disagreements would create differential adjudication and make reliability harder to interpret.

Three-judge majority is the frozen primary instrument.

### 9.3 Primary success

```text
functional_pass =
task_acceptance_pass
AND regression_acceptance_pass

P-DSFPS =
completed
AND functional_pass
AND panel_label == PANEL_COMPLIANT
```

`PANEL_VIOLATION` and `PANEL_INDETERMINATE` are primary failure.

This is conservative.

### 9.4 Panel functionally viable revival

```text
P-FVR =
functional_pass
AND panel_label == PANEL_VIOLATION
```

### 9.5 Indeterminate outcome

```text
P-IND =
functional_pass
AND panel_label == PANEL_INDETERMINATE
```

Always reported.

### 9.6 Continuous vote score

Judge vote encoding:

```text
COMPLIANT     0.0
INDETERMINATE 0.5
VIOLATION     1.0
```

Episode `Decision Violation Vote Score`:

```text
DVVS = mean(three judge votes)
```

Secondary only.

---

## 10. Semantic reliability metrics

Always report:

```text
three-way exact agreement
pairwise raw agreement
pairwise Gwet AC1
Fleiss kappa
panel indeterminate rate
per-task indeterminate rate
per-repository agreement
BOUNDARY_SETTLED agreement
BOUNDARY_UNRESOLVED agreement
```

### 10.1 Reliability interpretation

#### Acceptable

```text
median pairwise Gwet AC1 >= 0.50
overall panel indeterminate rate <= 20%
```

#### Strong-claim quality

```text
median pairwise Gwet AC1 >= 0.60
overall three-way exact agreement >= 70%
panel indeterminate rate <= 15%
```

#### Low-reliability result

If:

```text
median pairwise Gwet AC1 < 0.40
OR panel indeterminate rate > 30%
```

then causal estimates are still calculated and published, but final category cannot be positive/null in a strong sense.

Use:

```text
PUBLISHED_INDETERMINATE
```

unless material negative safety evidence requires `PUBLISHED_NEGATIVE`.

Low semantic reliability is not a reason to create V9.

---

## 11. Judge-packet blinding and assignment concealment

### 11.1 Opaque packet IDs

Judges receive packet IDs derived from a separate sealed seed.

Packet name/path must not expose:

```text
candidate ID
repository
arm
repeat
execution order
```

### 11.2 Assignment key

Arm mapping is held by RANDOMIZATION-CUSTODIAN.

Judges and analysts cannot access it until:

```text
all 1,020 judgements sealed
```

### 11.3 Judge order

Each judge receives all 340 packets in a separately randomized order.

Constraints:

```text
same candidate not adjacent where possible
paired ON/SUPPRESSED outputs not adjacent
repository blocks not disclosed
fresh session per packet
```

### 11.4 Arm-cue audit

Every judge packet is scanned for:

```text
ON
SUPPRESSED
Record-Id
experiment assignment
delivery log
CommitLore injection markers
```

Source-code comments containing ordinary product words are not automatically redacted.

Record:

```text
arm_cue_present
```

Primary ITT retains all episodes.

Sensitivity excludes cue-present packets.

Strong headline requires no sign reversal in cue-excluded analysis.

---

## 12. State machine

```text
V7_TERMINALIZING
→ V7_TERMINAL
→ V8_DRAFT
→ V8_PREREGISTERED
→ TASK_POPULATION_IMPORTED
→ JUDGE_CALIBRATION
→ JUDGE_PANEL_FROZEN
→ MANIPULATION_FROZEN
→ RUNTIME_FROZEN
→ SCHEDULE_FROZEN
→ EXECUTION_READY
→ CONFIRMATORY_RUNNING
→ CODING_ROWS_SEALED
→ JUDGEMENT_RUNNING
→ JUDGEMENTS_SEALED
→ ASSIGNMENT_REVEALED
→ ANALYSIS_COMPLETE
→ PUBLISHED_POSITIVE
 | PUBLISHED_QUALIFIED
 | PUBLISHED_NULL
 | PUBLISHED_NEGATIVE
 | PUBLISHED_INDETERMINATE
 | TERMINAL_HOLD_FINAL
```

역행 금지.

각 transition은 append-only ledger에:

```text
actor
timestamp
input paths/hashes
output paths/hashes
checks
deviations
```

를 기록한다.

---

## 13. V8 artifact layout

```text
bench/cdeb/studies/cdeb-fresh-v8/
├── PRD.md
├── PREREGISTRATION.md
├── study.json
├── STATUS.json
├── transitions.jsonl
├── deviations.jsonl
├── product-lock.json
├── snapshot-lock.json
├── task-population.json
├── v7-boundary-metadata.json
├── judge/
│   ├── canonical-prompt.md
│   ├── schema.json
│   ├── candidate-models.json
│   ├── calibration/
│   ├── panel-lock.json
│   ├── packets/
│   ├── judgements/
│   ├── reliability.json
│   └── seal-manifest.json
├── manipulation/
├── runtime-lock.json
├── schedule.json
├── expected-rows.json
├── rows/
├── analysis/
└── RESULT.md
```

---

## 14. Pre-execution import validation

17개 각각:

```text
candidate ID
repository
snapshot identity
task/hash
task acceptance/hash
regression acceptance/hash
baseline evidence
Good A/B hashes
Bad A hash
Bad A semantic judgement
firewall evidence
source decision packet
V7 boundary status
```

를 freeze한다.

V7 spec A/B/C는 metadata archive로 보존하지만 judges에게 노출하지 않는다.

하나라도 missing/drift:

```text
TERMINAL_HOLD_FINAL
```

이다.

---

## 15. Manipulation preflight

17개 전체:

```text
raw shipping payload generated
target structured identity resolved
ON contains ruling/reason/scope/lifecycle
SUPPRESSED removes all target-bound blocks
unrelated blocks byte-identical
hook/injector executes both arms
stale-as-current = false
wrong-tree = false
```

### 15.1 Synthetic coding-agent smoke

17개 benchmark task가 아닌 synthetic fixture에서:

```text
ON episode = 1
SUPPRESSED episode = 1
```

을 실행한다.

검증:

```text
model/runtime reporting
fresh isolation
hook parity
suppression
first mutation instrumentation
row durability
judge-packet builder
```

Product-effect row가 아니다.

---

## 16. Coding agent and runtime lock

### 16.1 Experimental harness

```text
Codex CLI
```

### 16.2 Model pin

세 번의 metadata probe에서 동일 concrete model ID를 확인한다.

Explicit pin이 가능하면 사용한다.

불가능하면 모든 row에서 resolved concrete ID를 검증한다.

Model drift:

```text
TERMINAL_HOLD_FINAL
```

### 16.3 Runtime fields

```text
CLI version/digest
model ID
system prompt digest
tools/permissions
runtime/container
network/cache policy
wall-clock budget
turn/tool-call budget
fresh HOME/session
fresh worktree
product digest a0c542...
hook/suppression digest
judge-packet builder digest
acceptance runner digest
```

### 16.4 Episode budget

```text
wall clock: 1800 seconds
max meaningful turns: 60
max tool calls: 80
cross-run memory: forbidden
manual CommitLore query tools: disabled
capture/write side: disabled
ordinary Git: available
```

---

## 17. No benchmark pilot

Benchmark tasks를 쓰는 pilot은 없다.

Execution readiness:

```text
17 imports valid
judge panel calibrated/frozen
17 manipulation checks pass
synthetic smoke pass
runtime/model locked
340 schedule frozen
judge packet/analysis simulation pass
P0/P1 = 0
CI green
measured benchmark rows = 0
```

일 때만 PASS.

---

## 18. Fixed measured schedule

```text
17 candidates
× 10 repeat blocks
= 170 paired blocks

each:
ON + SUPPRESSED

total:
340 episodes
```

### 18.1 Seed

```text
seed =
SHA256(
  "CDEB-FRESH-V8"
  + task-population-sha
  + judge-panel-lock-sha
  + runtime-lock-sha
  + preregistration-commit-sha
)
```

### 18.2 Arm order

```text
SHA256(seed + candidate_id + repeat + "arm-order")
```

first bit.

### 18.3 Pair ordering

Repository별 pair를 hash-sort하고 AOS/gitseed를 번갈아 merge한다.

각 pair의 두 episode는 인접 실행한다.

### 18.4 Concurrency

```text
max active coding episodes = 2
max active per repository = 1
same pair concurrent = false
```

Complete schedule와 expected 340-row manifest를 첫 episode 전에 commit한다.

---

## 19. Coding episode protocol

각 episode:

1. assignment/runtime/product verify
2. fresh worktree from frozen snapshot
3. fresh HOME/session
4. task install
5. hidden acceptance files unavailable to agent
6. assigned arm applied just in time
7. raw/model-visible payload hashes recorded
8. coding agent run
9. first relevant mutation recorded
10. final tree and diff freeze
11. task acceptance
12. regression acceptance
13. normalized coding row
14. atomic write/fsync/readback/hash
15. judge-packet construction
16. worktree teardown

V8에는 mechanical revival oracle step이 없다.

---

## 20. Retry and ITT

Allowed retry:

```text
meaningful model turn 이전
arm-independent infrastructure failure
maximum 1
```

Original과 retry 모두 보존한다.

삭제/제외 금지:

```text
timeout
non-completion
task failure
regression failure
provider failure after start
judge indeterminate
```

---

## 21. Blind judgement execution

### 21.1 Count

```text
340 packets
× 3 judges
= 1,020 judgements
```

### 21.2 Freshness

```text
fresh judge session per packet
no prior packet context
read-only final tree
fixed prompt/schema/model
```

### 21.3 Durability

각 judgement:

```text
temp write
fsync
atomic rename
read back
schema validate
hash
append seal manifest
```

### 21.4 Assignment reveal

```text
coding rows sealed
AND 1,020 judgements sealed
```

후에만 arm mapping을 reveal한다.

---

## 22. Primary coding row and outcome schema

Coding row:

```text
study/candidate/repository
repeat/pair/assignment
runtime/model/product
base/final tree
completion
task acceptance
regression acceptance
functional_pass
delivery manipulation
first mutation
manual discovery
usage
retry lineage
packet ID/hash
```

Judgement-derived episode row:

```text
three judge labels
panel label
DVVS
P-DSFPS
P-FVR
P-IND
reexplanation panel result
agreement metadata
```

---

## 23. Statistical Analysis Plan

### 23.1 Candidate effect

```text
d_rc =
mean_repeat(P-DSFPS_ON[r,c])
-
mean_repeat(P-DSFPS_SUPPRESSED[r,c])
```

### 23.2 Repository effect

```text
D_r = mean_candidate(d_rc)
```

### 23.3 Primary effect

```text
Delta =
0.5 * D_AOS
+
0.5 * D_gitseed
```

### 23.4 Primary bootstrap

17 tasks와 2 repositories는 fixed.

각 candidate 내부의 10 paired repeat blocks를 resample한다.

```text
100,000 replicates
fixed seed
ON/SUPPRESSED pair together
candidates fixed
repositories fixed
percentile 95% CI
```

### 23.5 Randomization inference

170 pairs에서 arm label swap:

```text
1,000,000 Monte Carlo permutations
two-sided
fixed seed
```

### 23.6 Secondary outcomes

```text
P-FVR absolute difference
RBDR
P-IND difference
DVVS difference
completion difference
functional-pass difference
manual-discovery difference
token/wall-time difference
```

### 23.7 Judge sensitivity

각 judge를 단독 instrument로 사용한:

```text
judge-specific DSFPS
judge-specific FVR
```

를 계산한다.

Strong claim은 judge-specific effect sign reversal이 없어야 한다.

### 23.8 Boundary-status sensitivity

```text
V7 BOUNDARY_SETTLED 8
V7 BOUNDARY_UNRESOLVED 9
```

별 effect와 reliability를 descriptive로 보고한다.

Primary population을 나누거나 재선택하지 않는다.

### 23.9 Cue sensitivity

`arm_cue_present=false` packets만 사용한 sensitivity를 계산한다.

Primary ITT를 대체하지 않는다.

---

## 24. Independent analysis

ANALYST-A와 ANALYST-B:

```text
same sealed coding rows
same sealed judgements
same frozen SAP
independent code
fresh sessions
different model family where available
```

ANALYST-B는 own seal 전 ANALYST-A code/narrative를 보지 않는다.

Match:

```text
raw counts exact
panel labels exact
point estimates <= 1e-12
bootstrap quantiles <= 1e-6
permutation p <= 1e-6
reliability metrics <= 1e-6
claim gate identical
```

Mismatch unresolved:

```text
TERMINAL_HOLD_FINAL
```

---

## 25. Re-explanation outcome

각 judge output의:

```text
reexplanation_required:
YES|NO|INDETERMINATE
```

를 panel majority로 집계한다.

Secondary:

```text
Re-explanation Required Reduction
```

Primary P-DSFPS를 대체하지 않는다.

---

## 26. Semantic reliability publication rules

### 26.1 Strongly interpretable

```text
median pairwise Gwet AC1 >= 0.60
three-way exact agreement >= 70%
panel indeterminate <= 15%
```

### 26.2 Acceptable but qualified

```text
median pairwise Gwet AC1 >= 0.40
panel indeterminate <= 30%
```

### 26.3 Indeterminate instrument

```text
median pairwise Gwet AC1 < 0.40
OR panel indeterminate > 30%
```

Result:

```text
PUBLISHED_INDETERMINATE
```

unless statistically supported material harm warrants `PUBLISHED_NEGATIVE`.

Measured data and estimates are still published.

No V9.

---

## 27. Strong README claim gate

> **R% fewer repeated bad decisions**

모두 통과해야 한다.

```text
[ ] 340 coding rows sealed
[ ] 1,020 judge rows sealed
[ ] P-DSFPS Delta 95% CI lower > 0
[ ] randomization p < 0.05
[ ] P-FVR ON-SUPPRESSED 95% CI upper < 0
[ ] RBDR point >= 50%
[ ] RBDR lower bound >= 20%
[ ] SUPPRESSED raw panel-violation events >= 10
[ ] completion lower 95% bound > -5pp
[ ] functional-pass lower 95% bound > -5pp
[ ] AOS P-DSFPS point effect > 0
[ ] gitseed P-DSFPS point effect > 0
[ ] no judge-specific sign reversal
[ ] median pairwise Gwet AC1 >= 0.60
[ ] three-way exact agreement >= 70%
[ ] panel indeterminate <= 15%
[ ] at least 2 judge model families
[ ] overall ON delivery >= 95%
[ ] every candidate ON delivery >= 80%
[ ] SUPPRESSED automatic target leak = 0
[ ] stale-as-current = 0
[ ] wrong-tree delivery = 0
[ ] cue-excluded analysis no sign reversal
[ ] ANALYST-A/B match
[ ] unresolved P0/P1 = 0
```

Footnote:

> Exact 17-task fixed benchmark in two author-operated repositories; one pinned coding agent; CommitLore v1.2.0 artifact a0c542…; automatic target delivery versus structured suppression; final trees judged by a frozen three-agent blind semantic panel.

---

## 28. Result categories

### PUBLISHED_POSITIVE

Strong claim gate 전부 통과.

### PUBLISHED_QUALIFIED

Benefit evidence가 있으나 strong claim/reliability gate 일부 실패.

### PUBLISHED_NULL

Primary CI가 zero를 포함하고 semantic reliability는 acceptable하며 material harm 없음.

문구:

> No detectable effect under this fixed 17-task blind-panel design.

### PUBLISHED_NEGATIVE

Material negative effect 또는 statistically supported harm.

### PUBLISHED_INDETERMINATE

Semantic panel reliability가 interpretation threshold 미달이거나 indeterminate rate가 과도함.

문구:

> The fixed trial ran to completion, but natural decision semantics were not judged reliably enough to support a directional product-effect conclusion.

### TERMINAL_HOLD_FINAL

Data-integrity failure로 experiment를 신뢰할 수 없음.

No automatic V9.

---

## 29. Always-published artifacts

```text
V7 terminal RESULT
V8 PRD/preregistration
17-task manifest
product/snapshot/runtime locks
judge canonical prompt/schema
judge candidate calibration results
fixed panel lock
51-control calibration judgements
340 coding rows
1,020 blind judgements
judge packet hashes
assignment reveal manifest
reliability metrics
analysis code
ANALYST-A/B reports
re-explanation result
delivery/cost diagnostics
deviations
limitations
reproduction instructions
claim gate
RESULT.md
```

---

## 30. PR execution plan

### PR-0 — Terminalize V7

Use current `cdeb-v7-pra` evidence.

포함:

```text
8 settled / 9 unresolved freeze
V7 RESULT
V7 STATUS terminal
product rows 0
ACTIVE-STUDY null
owner decision for V8 recorded
```

CI green 후 merge.

### PR-A — V8 preregistration, judge calibration, runtime/manipulation/schedule freeze

포함:

```text
V8 SSOT/preregistration
exact 17 import
V7 boundary metadata
product/snapshot locks
judge canonical prompt/schema
judge candidate calibration
fixed three-judge panel
17 manipulation preflights
synthetic coding-agent smoke
runtime/model lock
340 schedule
judge-packet and analysis simulation
readiness red-team
```

금지:

```text
benchmark measured coding episode
product-effect row
```

Merge gate:

```text
panel calibration pass
all 17 imports/preflights pass
runtime/schedule frozen
P0/P1 0
CI green
measured rows 0
```

### PR-B — 340 episodes, 1,020 judgements, analysis, publication, closure

한 execution branch에서 끝까지 실행한다.

Checkpoint commits 허용.

Interim result PR 금지.

포함:

```text
340 coding rows
1,020 judge rows
row/judgement seals
assignment reveal
ANALYST-A/B
reliability
re-explanation
claim gate
RESULT
README update only if authorized
terminal status
ACTIVE-STUDY null
```

---

## 31. Readiness red-team

PR-A merge 전 fresh hostile reviewer가 공격한다.

```text
V7 not truly terminal
17-task population drift
boundary status leaking to judges
judge calibration overfit
single-family panel mislabeled as diverse
control label corruption
judge prompt exposing arm
final-tree packet leaking assignment
judge cross-episode memory
SUPPRESSED asymmetry
model/runtime drift
packet/judgement count mismatch
post-start retry loophole
panel aggregation bug
indeterminate counted as success
wrong bootstrap unit
assignment revealed before judgement seal
reliability overclaim
headline overgeneralization
```

P0/P1 unresolved:

```text
TERMINAL_HOLD_FINAL
```

---

## 32. Mandatory tests and negative controls

```text
V7 terminal and product rows 0
exact 17 IDs and 8/9 repository counts
exact 8 settled / 9 unresolved metadata
unresolved task cannot be excluded
non-17 task refused
product digest a0c542 required
task/control hash drift refused
judge packet contains no arm/repeat/boundary status
three fixed judge IDs
calibration 51 cases per judge
panel calibration thresholds
fresh session per judge packet
opaque packet mapping
assignment unavailable before judge seal
340 unique coding assignments
10 repeats per arm per task
1,020 unique judgements
panel aggregation truth table
INDETERMINATE never counts as P-DSFPS success
post-start failure retained in ITT
manual discovery not automatic leak
paired-repeat bootstrap unit
candidates/repositories fixed
randomization label swap
Gwet/kappa implementation tests
low reliability maps to PUBLISHED_INDETERMINATE
ANALYST mismatch blocks publication
strong claim fails one gate at a time
terminal clears ACTIVE-STUDY
no automatic V9
```

---

## 33. Absolute prohibitions

```text
resume V7 as 8-task study
exclude 9 boundary-unresolved tasks
construct deterministic oracle as primary requirement
change 17-task population
rewrite tasks/acceptances
use V6 Bad patch as experimental output
benchmark pilot
stop for low power
change repeat count after outcomes
interim aggregate effect analysis
drop failed or indeterminate episodes
replace failed task
switch coding model mid-study
switch judge panel after measured output
reveal arm before all judgements seal
count INDETERMINATE as compliant
claim external independent validation
strong README claim without full gate
automatic V9
```

---

## 34. Definition of Done

```text
[ ] V7 terminal result merged
[ ] V8 new study/preregistration
[ ] exact 17 tasks imported
[ ] 8/9 boundary metadata frozen but not used for selection
[ ] product/snapshot locked
[ ] three-judge panel calibrated and frozen
[ ] manipulation/runtime/schedule ready
[ ] 340 coding episodes executed or integrity HOLD published
[ ] 340 coding rows sealed
[ ] 1,020 blind judgements sealed
[ ] assignment revealed only after judgement seal
[ ] panel outcomes/reliability computed
[ ] ITT analysis complete
[ ] independent analysis matched
[ ] re-explanation/cost complete
[ ] positive/qualified/null/negative/indeterminate/HOLD published
[ ] README changed only if allowed
[ ] V8 terminal
[ ] ACTIVE-STUDY null
[ ] issue #853 closed or final research tracker closed
[ ] no automatic V9
```

---

## 35. Final principle

> **V7 proved that natural repository decisions are not uniformly reducible to deterministic predicates. V8 measures their effect with the instrument humans actually use: blinded semantic judgement.**

The research is complete when the fixed 17-task trial is published with its effect estimate, semantic reliability, and limitations—or when an integrity failure is published and terminalized.
