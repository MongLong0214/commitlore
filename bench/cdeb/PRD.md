# CommitLore Decision Efficiency Benchmark (CDEB)

Production-Ready Implementation PRD · **v1.2 Final**

| | |
|---|---|
| 문서 상태 | Approved for implementation |
| 프로토콜 버전 | 1.2.0 |
| 벤치마크 ID | `cdeb-v1` |
| 대상 저장소 | MongLong0214/commitlore |
| 기준 브랜치 | `dev` |
| 측정 대상 | pinned CommitLore build의 실제 shipping decision-context 전달 경로 |
| 대체 문서 | CDEB PRD v1.1, COMMITLORE_CDEB_FINAL_PRD.md v1.0, 별도 production-readiness review |
| 승인 범위 | 인프라 구현 승인. 실제 measured run은 본 문서의 Freeze Gate와 Definition of Done 통과 후에만 허용한다. |

### v1.1 → v1.2 변경 이력

v1.1의 실험 설계, matrix, gate, locked decisions는 그대로다. v1.2는 v1.1이 게이트로 사용하면서 정의하지 않았거나, 이 저장소의 실제 shipping 동작과 어긋나게 된 지점만 닫는다.

1. **`TokenVolumeReduction` 정의 추가** — §16.4가 게이트 조건으로 사용하지만 §15에 정의가 없었다. §15.2에 정의한다.
2. **bootstrap replicate 내 TVPDSS 계산 규정** — 재표집된 task 집합 위에서 ratio-of-sums로 계산함을 §16.2에 명시한다.
3. **ON arm의 활성 surface를 delivery로 한정** — ADR-0030이 병합되어 capture 기본 모드가 `auto`(무인 스테이징)가 됐다. Agent가 run 중 commit하면 무인 캡처가 새 record를 만들어 repository state를 비결정적으로 바꾼다. §2.3과 §9.2가 이제 capture surface를 양 arm 모두 설치하지 않는다고 명시하고, full install과의 차이를 공개 사항으로 규정한다.
4. **shipping trust 상태의 명시** — 현재 어떤 설치 표면도 `--trusted-author`를 전달하지 않으므로 shipping 설정에서 모든 record는 `[claim]`으로 전달된다(#415). CDEB는 그 상태를 그대로 측정하며, §9.2와 §17이 이를 결과 문구에 포함하도록 한다.
5. **randomization manifest의 task ID 누출 차단** — public pre-run freeze에 randomization을 raw task ID로 공개하면 sealed corpus가 부분 누출된다. §18.2가 opaque block index를 쓰고 mapping은 post-run에 공개한다.
6. **corpus cutoff의 단위 명확화** — cutoff는 per-repository snapshot ref이고, 프로토콜 자체의 freeze는 본 PRD를 승인하는 commit이다(§3.1).
7. **provider-side cache 공유 한계 명시** — cache_read는 org-scoped provider cache 때문에 run 순서에 의존할 수 있다. §14.2와 §18.2가 within-block 랜덤 순서로 이를 분산하고, §23 appendix가 arm별 cache category를 보고하도록 한다.
8. **final tree staging의 gitignore 준수와 `.git/` 배제 명시** — product 내부 상태(index, MCP lifecycle log)는 `.git/commitlore/`에 쓰이므로 tree 동일성에 영향이 없음을 §6.2와 §11.1에 명시한다.
9. **reviewer 독립성의 tier 연동** — §4.8의 reviewer identity는 §3.3 independence tier와 함께 공개한다.

────────

## 0. Executive decision

CDEB는 다음 하나만 검증한다.

> **동일한 모델·동일한 agent harness·동일한 task·동일한 repository state에서 CommitLore의 shipping decision context만 ON/OFF했을 때, CommitLore가 저장소의 기존 결정을 지킨 기능적 첫 패치의 비율을 높이고, 그런 성공 한 건을 얻는 데 필요한 provider-reported task-execution token volume을 줄이는가?**

최종 제품 지표는 세 개뿐이다.

1. **Decision-Safe First-Pass Success** — 첫 agent session의 최종 tree가 기능 요구를 통과하면서 기존 기각 결정을 되살리지 않은 비율
2. **Token Volume per Decision-Safe Success** — 실패 run을 포함한 전체 provider-reported task-execution token volume을 decision-safe success 수로 나눈 값
3. **Rejected-Decision Revival Rate** — 이미 기각된 접근이 최종 implementation state에 다시 등장한 비율

고정 matrix는 다음과 같다.

```text
5 repositories
× 6 tasks per repository
× 2 conditions: CommitLore ON / OFF
× 3 fresh runs per condition
= 30 decision-sensitive tasks
= 180 measured logical runs
= 90 runs per condition
```

이 규모를 늘리거나 arm, model, judge, RAG baseline을 추가하지 않는다. CDEB v1의 난점은 더 많은 실험이 아니라 정확히 같은 것을 비교하고, 실제 제품 경로를 측정하며, 결과 조작 가능성을 제거하는 것이다.

────────

## 1. 제품 가설과 검증 경계

### 1.1 Product hypothesis

CommitLore가 relevant active decision을 agent가 변경하려는 code path에 자동 전달하면 다음 sequence가 발생한다.

```text
repository decision delivered
        ↓
previously rejected approach revived less often
        ↓
more first-pass patches are both functional and repository-consistent
        ↓
less model work is spent per usable result
```

CDEB는 이 sequence에 임의의 가중치, human score 또는 LLM judge score를 추가하지 않는다.

### 1.2 In scope

- 실제 개발 과정에서 이미 존재하던 CommitLore record
- 실제 PR, issue, commit, review 또는 ADR에 근거한 기각 decision
- 해당 decision을 모르는 fresh agent가 합리적으로 잘못 선택할 수 있는 maintenance task
- CommitLore automatic delivery ON/OFF
- 한 번의 fresh agent session이 남긴 최초 final tree
- deterministic hidden functional evaluator
- deterministic rejected-decision oracle
- provider-reported token usage
- task-level paired analysis

### 1.3 Explicit non-goals

- 일반적인 코드 품질 점수
- 사람 또는 LLM의 미감·스타일 평가
- 모든 coding task에서의 생산성
- 모든 모델·agent·repository에 대한 일반화
- long-horizon multi-session relay
- visual/three.js류 시연 과제
- custom RAG 대 CommitLore 검색 대결
- internal ablation benchmark
- capture write-side 비용의 재측정
- dollar saving의 자동 주장

### 1.4 Evidence boundary

CDEB 결과가 허용하는 최대 주장은 다음 범위다.

```text
30 frozen decision-sensitive tasks
5 named repositories
1 pinned model
1 pinned agent harness
CommitLore shipping delivery ON/OFF
```

CDEB는 "CommitLore가 모든 coding agent를 더 좋게 만든다"를 증명하지 않는다.

────────

## 2. Locked experimental design

### 2.1 Statistical unit

- 제품 사례의 실질적 단위는 **30 tasks**다.
- 180 runs는 stochastic variance를 줄이기 위한 반복이며 독립적인 engineering cases 180개로 해석하지 않는다.
- 각 task는 ON 3회, OFF 3회를 가진다.
- task는 동일 가중치다.
- repository당 정확히 6개 task를 사용한다.

### 2.2 Reference model and harness

CDEB v1은 한 model과 한 agent runtime만 사용한다.

Freeze manifest에 다음을 고정한다.

- requested model alias
- preflight에서 확인한 exact observed model ID
- agent CLI version
- agent executable SHA-256
- Node/runtime version과 executable SHA-256
- agent runtime OCI image digest
- permission mode
- allowed/disallowed tool set
- system/settings/MCP configuration digests
- provider-only network policy digest
- per-run wall-clock timeout

다음 중 하나라도 study 중 바뀌면 새로운 study ID가 필요하다.

- observed model ID
- agent CLI hash/version
- runtime image digest
- product build digest
- tool policy
- provider event schema

### 2.3 Conditions

**OFF — normal repository workflow**

- ON과 byte-identical repository bundle
- ordinary Git history와 notes 접근 가능
- 동일 source, dependencies, prompt, tools, timeout
- CommitLore hook, plugin, MCP server, skills, automatic context delivery 비활성화
- CommitLore record는 repository에서 제거하지 않는다

**ON — shipping CommitLore delivery**

- OFF와 동일한 repository/runtime
- pinned shipping `commitlore inject --hook-input` 경로 활성화
- shipping matcher, default budget, trust configuration, index behavior 유지
- agent에게 CommitLore 사용을 지시하지 않음
- benchmark-only context renderer 사용 금지

**Capture surface — 양 arm 모두 미설치 (v1.2)**

ADR-0030 이후 capture의 shipping 기본값은 `auto`다: agent가 commit하면 캡처 파이프라인이 묻지 않고 record를 스테이징하고 `prepare-commit-msg` 훅이 이를 커밋에 부착한다. Measured run 중 이것이 발동하면 repository state가 run별로 비결정적으로 변한다.

따라서 ON arm은 **delivery surface(PreToolUse inject hook)만** 활성화하고, capture surface(`commit-msg` gate, `prepare-commit-msg`, `post-commit`, `pre-push` hooks)는 **어느 arm에도 설치하지 않는다**. 이는 full `commitlore init` 설치와의 의도적 차이이며 §17의 결과 문구와 §23 report에 공개한다. Capture는 run 시작 전에 이미 존재하던 record의 전달에 영향을 주지 않으므로, 이 차이는 측정 대상 경로를 바꾸지 않는다.

### 2.4 Intention-to-treat principle

Primary comparison은 CommitLore가 설치·활성화된 상태와 OFF를 비교한다.

- shipping product가 record를 전달하지 못해도 row를 제거하지 않는다.
- ON에서 실제 delivery가 없었지만 agent가 우연히 안전하게 성공한 경우 success는 그대로 success다.
- product delivery failure는 exposure data에 남고 downstream outcome에 자연스럽게 반영된다.
- benchmark instrumentation 자체가 불명확한 경우에만 measurement invalid로 처리한다.

`decision_safe_success`는 actual exposure 여부로 강제 false가 되지 않는다.

────────

## 3. Corpus integrity

### 3.1 Primary corpus cutoff

CDEB v1 primary task는 다음을 모두 만족해야 한다.

```text
decision source existed before corpus cutoff
AND
CommitLore record existed before corpus cutoff
AND
record was created during ordinary repository work
AND
record was not created or backfilled for CDEB
```

**Cutoff의 단위 (v1.2 명확화):** corpus cutoff는 **repository별 frozen snapshot ref**다 — §6.1의 `snapshot_commit`이 그 역할을 한다. 프로토콜 자체의 freeze 시점은 본 PRD를 승인하는 commit이며, 두 시점 모두 freeze manifest에 기록한다. Record와 decision source는 해당 repository의 snapshot ref 도달 범위 안에 존재해야 한다.

다음 task는 headline corpus에 포함할 수 없다.

- cutoff 이후 작성된 record
- CDEB task를 위해 새로 만든 record
- synthetic/backfilled record
- benchmark harness 내부 decision
- CommitLore repository 자체의 product/benchmark decision

이들은 필요하면 명확히 분리된 exploratory appendix에만 사용할 수 있다.

### 3.2 Candidate registry

최종 task를 만들기 전에 eligible candidate registry를 먼저 freeze한다.

각 candidate는 다음을 가진다.

```yaml
candidate_id: pricing-admin-quote
repository_id: repo-pricing
record_ids: [r-price01]
decision_source_refs: [...]
record_commit_or_note_ref: "..."
record_created_at: "..."
natural_record: true
benchmark_authored: false
eligibility:
  explicit_rejection_reason: true
  wrong_path_functionally_viable: true
  deterministic_oracle_possible: true
  current_code_does_not_reveal_reason: true
  bounded_implementation: true
review_status: accepted | rejected
rejection_reason: null
```

규칙:

1. accepted/rejected candidate를 모두 보존한다.
2. model을 사용해 candidate를 선별하지 않는다.
3. ON/OFF behavior를 candidate selection 전에 실행하지 않는다.
4. quota보다 candidate가 많으면 `SHA-256(candidate_id + freeze_seed)` 오름차순으로 선택한다.
5. candidate가 부족하면 기준을 낮추거나 새 record를 만들지 않고 study를 중단한다.

### 3.3 Repository composition

Primary corpus는 다음을 만족한다.

- 5 named repositories
- repository당 6 tasks
- CommitLore repository 자체는 primary corpus에서 제외
- 최소 3개의 서로 다른 application/domain repository
- repository ownership과 decision authorship 공개

**Independence tier**

- **Tier A**: 최소 2개 repository에서 decision author 또는 accepting reviewer가 benchmark/product author와 다름
- **Tier B**: 5개 모두 author-operated repository

Tier B도 실행할 수 있으나 결과 문구는 반드시 "five author-operated repositories"라고 명시하며 independent external validation이라고 표현하지 않는다.

### 3.4 Category quota

| Category | Count |
|---|---:|
| Rejected architecture / abstraction reuse | 12 |
| Rejected workaround / quick fix | 8 |
| Compatibility / platform constraint | 5 |
| Security / operational constraint | 3 |
| Superseded decision / lifecycle | 2 |
| **Total** | **30** |

Quota를 채울 qualified candidate가 없으면 약한 task를 넣지 않고 study를 중단한다.

────────

## 4. Task qualification

모든 task는 다음을 전부 만족해야 한다.

### 4.1 Real decision

- 실제 source evidence가 존재한다.
- rejected alternative와 rejection reason이 명시적이다.
- record ID와 source evidence가 frozen repository에서 검증 가능하다.

### 4.2 Natural prompt

Prompt는 실제 maintenance request처럼 작성한다.

금지:

- CommitLore 언급
- "기존 decision을 찾아라"는 지시
- rejected approach의 직접 언급
- 정답 architecture의 직접 언급
- source evidence 위치 노출

### 4.3 Plausible wrong path

Fresh competent agent가 rejected approach를 고를 합리적인 이유가 있어야 한다.

예:

- 가장 작은 diff
- 가장 가까운 existing abstraction
- visible tests를 가장 빨리 통과
- 일반적으로 권장되는 pattern
- 현재 source만 보면 자연스러운 reuse

### 4.4 Functionally viable wrong path

Rejected approach를 구현한 bad control patch가 functional evaluator를 통과해야 한다.

즉 CDEB는 다음을 구분한다.

```text
works, but violates repository judgment
vs
works and respects repository judgment
```

### 4.5 Deterministic decision oracle

Oracle 우선순위:

1. runtime invariant
2. AST / call graph / dependency graph
3. config / module topology
4. exact structural predicate
5. lexical predicate는 다른 방법이 불가능하고 reviewer가 승인한 경우만 허용

Oracle은 agent transcript가 아니라 final implementation state를 검사한다.

### 4.6 Bounded implementation

권장 범위:

- 1–4 source files modified
- 약 20–200 changed LOC
- 하나의 primary decision
- 한 fresh agent session 안에 완료 가능

### 4.7 Dual controls

각 task는 sealed artifact로 세 control을 가진다.

```text
good control
- functional PASS
- decision oracle PASS

bad control
- functional PASS
- decision oracle FAIL

no-op control
- functional FAIL
```

추가 anti-tamper control:

- candidate가 package/test script를 exit 0으로 바꿔도 evaluator가 속지 않아야 한다.

### 4.8 Independent review

Task author 외 1명이 다음을 승인한다.

- natural-record 조건
- prompt neutrality
- source evidence
- bad path viability
- good/bad/no-op controls
- oracle determinism
- evaluator isolation

Reviewer approval은 signed attestation 또는 reviewer identity + artifact digest로 freeze한다.

**Reviewer 독립성 공개 (v1.2):** reviewer가 benchmark/product author와 동일 조직·동일인인지 여부는 §3.3 independence tier와 함께 결과에 공개한다. Tier B corpus에서 reviewer도 author 본인이라면 그 사실이 tier 문구에 포함된다 — review의 존재를 독립 검증처럼 표현하지 않는다.

────────

## 5. Sealed task package

Prompt와 hidden evaluator는 measured run 전에 public repository에 공개하지 않는다.

### 5.1 Public pre-run freeze

Public repository에는 다음만 commit한다.

```text
protocol version
study manifest without secret task contents
candidate registry commitment
sealed task bundle SHA-256 / Merkle root
repository bundle digests
randomization manifest (opaque block indices — §18.2)
analysis-source digest
model/runtime/product digests
claim thresholds
```

### 5.2 Private sealed assets

다음은 private benchmark repository, encrypted archive 또는 access-controlled storage에 둔다.

- task prompts
- expected record IDs
- hidden evaluator source/images
- good/bad/no-op patches
- private source evidence
- private repository bundles
- block index → (task, repeat) mapping (§18.2)

Runner는 `CDEB_SEALED_BUNDLE`의 exact digest가 public freeze와 일치할 때만 실행한다.

### 5.3 Post-run reveal

Final immutable row가 모두 생성된 후:

1. public-safe task assets를 공개한다.
2. 공개 artifact hash를 pre-run commitment와 비교한다.
3. block index mapping을 공개하고 randomization commitment와 대조한다.
4. private task는 source를 공개하지 않더라도 hash, evaluator result, reviewer attestation을 공개한다.
5. mismatch가 있으면 verdict를 생성하지 않는다.

────────

## 6. Repository bundle and arm equivalence

### 6.1 Frozen repository bundle

각 repository는 network-independent Git bundle 또는 equivalent immutable archive로 freeze한다.

필수 포함:

- target snapshot commit
- reachable commit history
- relevant branches/tags
- `refs/notes/commitlore`
- required Git attributes

각 repository는 다음을 가진다.

```json
{
  "repository_id": "repo-pricing",
  "bundle_sha256": "...",
  "snapshot_commit": "...",
  "snapshot_tree_oid": "...",
  "refs_digest": "...",
  "notes_ref_digest": "...",
  "source_authorization_id": "..."
}
```

### 6.2 Same-history invariant

각 task/repeat의 ON/OFF는 다음이 동일해야 한다.

```text
bundle SHA-256
HEAD
base tree OID
commit-message digest
refs digest
notes digest
working-tree source digest
runtime image
prepared dependency artifact
```

Condition 간 유일한 차이는 frozen agent settings/config다.

**`.git/` 내부 product 상태는 tree 동일성에 포함하지 않는다 (v1.2).** CommitLore는 index(`.git/commitlore/index.db`)와 MCP lifecycle log(`.git/commitlore/mcp-lifecycle.log`)를 `.git/` 아래에 쓴다. 이들은 working tree 밖이므로 base/final tree OID와 `working-tree source digest`에 영향을 주지 않으며, ON arm에서 index가 생성되는 것은 same-history 위반이 아니다. Digest 계산 코드는 `.git/`를 명시적으로 배제해야 하고, 이는 §25.2의 mutation test로 고정한다.

### 6.3 Prohibited control construction

금지:

- OFF에서 CommitLore trailers 제거
- OFF에서 notes ref 제거
- commit messages rewrite
- ON에만 별도 seed commit 추가
- 서로 다른 fixture import

### 6.4 Materialization

각 logical run은:

1. frozen bundle을 offline clone/materialize한다.
2. exact snapshot을 detached checkout한다.
3. refs/notes digest를 검증한다.
4. evaluator-owned prepare step으로 dependencies를 offline 준비한다.
5. prepared source digest를 기록한다.

기존 benchmark의 synthetic seed/record-stripping workspace helper를 CDEB repository materialization에 직접 사용하지 않는다.

────────

## 7. Agent runtime isolation

### 7.1 Reference runtime

ON/OFF 모두 동일한 pinned OCI image를 사용한다.

Image에는 다음이 포함된다.

- agent CLI
- exact Node/runtime
- Git
- pinned CommitLore build
- transparent hook proxy
- repository별 offline dependency cache 또는 prepared environment

CommitLore binary가 두 arm 모두 image에 존재하는 것은 허용한다. OFF에서는 활성 surface가 없어야 한다.

### 7.2 Fresh isolation per logical run

각 run은 다음을 새로 만든다.

- container/process namespace
- isolated HOME
- isolated Git config
- isolated agent settings
- empty session state
- empty MCP config
- no user/project/local settings source
- no external skills/plugins
- no prior transcript/cache

### 7.3 Tool policy

Allowed tool set을 freeze한다.

- source read/search/edit/test에 필요한 최소 tool만 허용
- web search/fetch 금지
- subagent/task delegation 금지
- external memory 금지
- benchmark/sealed artifact path 접근 금지

Per-turn event에 `parent_tool_use_id != null`이 있으면 CDEB v1 measured row를 거부한다.

### 7.4 Network policy

Agent runtime은 provider API/auth endpoint 외 outbound network를 차단한다.

- repository dependency 설치는 run 전에 offline 수행
- agent shell에서 arbitrary internet access 불가
- no general web access
- policy digest를 freeze하고 row에 기록

이 정책을 enforce할 수 없는 runtime에서는 measured run을 시작하지 않는다.

### 7.5 Fail-closed capability gate

다음을 확인할 수 없으면 경고 후 계속하지 않고 hard refusal한다.

- strict MCP isolation
- settings source isolation
- no session persistence
- exact tool policy
- provider-only network policy
- model observation
- raw usage stream
- runtime/executable hashes

────────

## 8. Model and executable pinning

각 measured row는 다음을 기록한다.

```text
requested_model
observed_model_ids[]
agent_cli_version
agent_executable_sha256
node_version
node_executable_sha256
agent_runtime_image_digest
permission_mode
tool_policy_digest
settings_digest
mcp_config_digest
network_policy_digest
```

규칙:

- observed model ID는 모든 main-session turn에서 동일해야 한다.
- empty model ID 금지
- subagent turn 금지
- preflight observed model ID와 다르면 study hard stop
- alias만 기록하고 exact model을 모르는 row 금지
- auto-updated CLI를 허용하지 않음

서버 측에서 fingerprint할 수 없는 provider change는 limitation으로 공개하며 block randomization으로 시간 drift를 완화한다.

────────

## 9. ON/OFF arm implementation

### 9.1 Shared runtime

두 condition은 동일 image와 filesystem layout을 사용한다.

- OFF config: empty CDEB-controlled settings, no CommitLore hook/MCP/plugin
- ON config: transparent proxy를 command로 사용하는 shipping-equivalent settings — **delivery surface만** (§2.3)

### 9.2 Shipping configuration freeze

ON은 다음 product defaults를 그대로 사용한다.

- shipping hook event
- shipping matcher
- shipping injector command
- default injection budget
- trusted-author configuration
- index/no-index behavior
- trust grading behavior

CDEB를 유리하게 만들기 위해 trusted authors를 추가하거나 budget을 변경하지 않는다.

**Shipping trust 상태의 명시 (v1.2):** 현재 shipping 설치는 `--trusted-author`를 전달하지 않으므로, ON arm이 전달하는 모든 record는 `[claim]`으로 렌더링되고 payload legend는 "not an instruction"이라고 말한다(#415). CDEB는 이 상태를 그대로 측정한다 — 이것이 사용자가 실제로 받는 제품이기 때문이다. 결과 문구는 "records delivered as `[claim]`-graded information under the shipping trust configuration"임을 명시하며, `[directive]` 전달의 효과에 대한 주장으로 확장하지 않는다. Shipping trust configuration이 향후 바뀌면 새로운 study가 필요하다(§2.2의 product build digest 규칙에 의해 자동으로 강제된다).

### 9.3 Transparent hook proxy

Proxy는 benchmark-only renderer가 아니다.

역할은 다음 다섯 개로 제한한다.

1. exact hook stdin bytes 수신
2. pinned shipping command 실행
3. child stdout/stderr/exit code 캡처
4. child output을 byte-for-byte 그대로 forward
5. exposure event를 append-only side channel에 기록

Proxy는 context를 생성·수정·재정렬·요약하지 않는다.

**Exposure event**

```json
{
  "event_index": 1,
  "tool_name": "Read",
  "repository_relative_path": "src/pricing.ts",
  "input_sha256": "...",
  "child_command_sha256": "...",
  "child_exit_code": 0,
  "stdout_sha256": "...",
  "stdout_bytes": 1201,
  "payload_sha256": "...",
  "parsed_record_ids": ["r-price01"],
  "product_error": null,
  "started_monotonic_ns": 0,
  "finished_monotonic_ns": 0
}
```

`parsed_record_ids`는 frozen output parser가 exact shipping output에서 추출한다. Parsing이 불명확하면 event는 unknown이며 study를 중단한다.

### 9.4 Byte-identity gate

Measured run 전에 fixture payload corpus에서 다음을 검증한다.

```text
direct shipping command stdout == proxied stdout
same stderr
same exit code
```

하나라도 다르면 ON condition은 shipping path로 인정하지 않는다.

### 9.5 Exposure semantics

Exposure는 outcome과 분리한다.

기록:

- hook opportunities
- actual proxy executions
- delivered expected record IDs
- first mutating shipping-hook event 이전/동일 event delivery
- empty delivery
- product command failure

Agent가 Bash 등 shipping matcher 밖의 도구로 변경해 delivery opportunity가 없었던 경우도 그대로 기록한다. 이는 product effectiveness의 일부이며 row를 제거하지 않는다.

### 9.6 OFF integrity

OFF는 다음을 preflight로 증명한다.

- no hook settings
- no CommitLore MCP server
- no CommitLore plugin/skill
- no proxy invocation path
- empty external memory
- same repository records/history retained

────────

## 10. Run lifecycle and retry state machine

### 10.1 Logical run

Logical run ID는 다음 cell을 유일하게 식별한다.

```text
repository_id / task_id / condition / repeat
```

한 logical run은 agent outcome을 최대 한 번만 생성한다.

### 10.2 State machine

```text
PLANNED
  ↓
PREFLIGHT
  ↓
AGENT_STARTING
  ↓ first provider model turn observed
AGENT_STARTED
  ↓ agent process ends
FINAL_TREE_FROZEN
  ↓
EVALUATING
  ↓
MEASURED
```

Error states:

```text
PRE_AGENT_INFRA_FAILURE
MEASURED_AGENT_FAILURE
EVALUATOR_INFRA_FAILURE
MEASUREMENT_INTEGRITY_FAILURE
```

### 10.3 Retry rules

**Before first model turn**

Transient provider/auth/runtime infrastructure failure는 최대 3회 retry할 수 있다.

- 모든 attempt를 보존
- agent output 없음
- logical run outcome 없음

Deterministic config/schema/bundle failure는 retry하지 않고 study를 hard stop한다.

**After first model turn**

Agent를 절대 다시 실행하지 않는다.

- provider/agent error는 measured failure
- timeout은 measured failure
- product hook failure는 measured product behavior
- final tree를 가능한 범위에서 freeze하고 evaluator를 실행

**After final tree freeze**

Evaluator infrastructure failure는 동일 final tree만 재평가한다.

- agent rerun 금지
- evaluator attempt lineage 보존
- final evaluator result가 없으면 matrix incomplete

**Instrumentation failure**

- raw provider stream이 보존되어 parser만 고칠 수 있으면 동일 artifact를 재분석한다.
- proxy/exposure bytes가 유실되어 복구 불가하면 agent rerun으로 교체하지 않는다.
- 해당 study는 incomplete이며 수정 후 새 study ID로 다시 시작한다.

### 10.4 Stop reasons

Measured agent stop reason은 다음으로 제한한다.

```text
completed
timeout
agent_error
provider_error_after_start
```

`max_tokens`, `max_turns`를 v1 primary success의 stop reason으로 사용하지 않는다.

### 10.5 Budget contract

CDEB v1의 enforceable 동일 budget은 wall-clock timeout이다.

- task별 timeout은 freeze한다.
- token usage와 turn count는 outcome으로 측정한다.
- provider cost 안전을 위한 study-wide emergency ceiling은 새 run launch만 중지한다.
- emergency ceiling이 발동한 partial matrix는 분석하지 않으며 이후 같은 freeze로 resume한다.

CLI가 실제 in-flight turn cap을 지원하더라도 CDEB v1 primary contract에는 추가하지 않는다.

────────

## 11. First-pass final tree freeze

Agent process 종료 직후 사람·reviewer·두 번째 agent feedback 없이 final tree를 freeze한다.

### 11.1 Canonical final tree

Temporary Git index를 사용해:

1. base tree를 read한다.
2. working tree의 addable tracked/untracked changes를 stage한다. **Staging은 repository의 `.gitignore`를 준수한다 (v1.2)** — agent가 생성한 `node_modules`, build output 등 ignored 경로는 final tree에 포함하지 않으며, 이는 `git add -A`의 기본 동작과 일치한다. Agent가 `.gitignore` 자체를 수정한 경우 수정된 상태의 규칙을 따른다(그 수정 역시 tree에 포함되므로 검증 가능하다).
3. `git write-tree`로 `final_tree_oid`를 생성한다.
4. base → final tree binary diff를 canonical 생성한다.
5. final tree archive를 생성한다.

기록:

```text
base_commit
base_tree_oid
final_tree_oid
canonical_diff_sha256
final_tree_archive_sha256
workspace_status_digest
```

Agent가 commit을 만들었는지와 관계없이 final implementation state를 평가한다.

### 11.2 First-pass definition

- initial prompt 이후 한 fresh agent session
- agent가 스스로 visible tests를 실행하고 수정하는 것은 허용
- hidden evaluator 결과는 agent에게 전달하지 않음
- process 종료 시점의 final tree가 first pass
- 사람 또는 다른 agent 수정 금지

────────

## 12. Evaluator security and contract

### 12.1 Immutable evaluator

각 task는 pinned OCI evaluator image를 가진다.

```yaml
evaluator:
  image_digest: "sha256:..."
  task_entrypoint: ["/cdeb/evaluate", "pricing-admin-quote"]
  network: none
  cpu_limit: 2
  memory_mb: 4096
  pids_limit: 256
  timeout_ms: 180000
```

Evaluator source와 oracle은 candidate tree 밖에 있다.

### 12.2 Sandbox requirements

- no network
- no host HOME
- no host secrets
- no Docker socket
- read-only evaluator/oracle mount
- candidate final tree archive만 input
- writable isolated scratch only
- CPU/memory/PID/file-size/time limits
- deterministic locale/timezone
- pinned runtime/dependency artifacts

### 12.3 Candidate-controlled command prohibition

PASS/FAIL의 authority는 evaluator image의 entrypoint다.

금지:

- candidate가 수정한 npm script를 그대로 신뢰
- candidate test config만으로 PASS 결정
- candidate repository 안의 `.cdeb/oracles` 실행
- hidden evaluator path를 candidate에 mount

Evaluator는 필요 시 candidate code를 build/run할 수 있으나 command, arguments, expected behavior는 evaluator가 소유한다.

### 12.4 Fixed evaluator output

```json
{
  "schema_version": 1,
  "task_id": "pricing-admin-quote",
  "functional_pass": true,
  "rejected_decision_revived": false,
  "functional_checks": {"passed": 12, "failed": 0},
  "decision_oracle_code": "SAFE",
  "evaluator_image_digest": "sha256:...",
  "candidate_tree_oid": "..."
}
```

Free-form quality score는 없다.

### 12.5 Mandatory evaluator tests

각 task에서 다음을 final evaluator image로 검증한다.

- good control → functional PASS, decision SAFE
- bad control → functional PASS, decision REVIVED
- no-op → functional FAIL
- package/test script tamper → 결과 조작 실패
- hidden path read attempt → 실패
- network access attempt → 실패
- host secret read attempt → 실패
- resource abuse → 제한됨
- repeated evaluation → byte-identical normalized result

────────

## 13. Outcome definitions

### 13.1 Functional pass

```text
functional_pass = evaluator functional checks all pass
```

### 13.2 Rejected-decision revival

```text
rejected_decision_revived = evaluator decision oracle reports REVIVED
```

Transcript mention은 revival이 아니다. Final implementation state만 검사한다.

### 13.3 Decision-Safe First-Pass Success

```text
decision_safe_success =
  stop_reason == completed
  AND functional_pass == true
  AND rejected_decision_revived == false
```

Exposure 여부는 이 formula에 직접 넣지 않는다.

다음은 false다.

- no-op
- functional failure
- rejected approach를 사용한 functional patch
- timeout
- agent/provider error after start

### 13.4 Assignment denominators

모든 180 logical runs가 behavioral denominator다.

Pre-agent infra attempts는 logical run이 아니며 outcome denominator에 들어가지 않는다.

────────

## 14. Provider token accounting

### 14.1 Source of truth

Provider/agent CLI raw event stream과 terminal usage object만 사용한다.

Measured run은 raw NDJSON을 compressed artifact로 보존한다.

필수:

```text
turn_usage.reconciled == true
unparsed_lines == 0
all observed model IDs match freeze
no subagent turns
```

### 14.2 Token categories

각 run은 다음 raw category를 저장한다.

```text
input_tokens
output_tokens
cache_creation_input_tokens
cache_read_input_tokens
```

Thinking tokens가 output의 subset이면 별도로 더하지 않는다.

**Provider-side cache 공유 한계 (v1.2):** provider prompt cache는 org 단위로 동작할 수 있어, 한 run이 만든 cache entry를 이후 run이 읽으면 `cache_read`가 run **순서**에 의존한다. 이를 완전히 차단할 수단이 harness에 없으므로 CDEB는 (a) §18.2의 within-block 랜덤 ON/OFF 순서로 cache-warming 비대칭을 평균적으로 분산하고, (b) §23 appendix에 arm별 token category 합계를 분리 보고해 독자가 cache_read 기여분을 확인할 수 있게 하며, (c) 이를 §17의 limitation으로 공개한다. Cache를 비활성화할 수 있는 harness라면 preflight에서 비활성화하고 그 사실을 freeze한다.

### 14.3 Reported task-execution token volume

```text
total_token_volume =
  input_tokens
  + output_tokens
  + cache_creation_input_tokens
  + cache_read_input_tokens
```

이는 provider-reported token volume이지 dollar cost가 아니다.

### 14.4 Included

- initial prompt
- system/context
- CommitLore injected context
- model output/reasoning
- tool-result context
- completed agent session의 실패 작업량

### 14.5 Excluded

- historical record capture cost
- local repository materialization CPU
- dependency preparation CPU
- CommitLore index build CPU
- hidden evaluator CPU

따라서 claim은 항상 task-execution token volume으로 제한한다.

### 14.6 Incomplete usage

Behavioral outcome은 유효하지만 terminal provider usage가 복구 불가능한 run이 하나라도 있으면:

- safe-success와 revival metric은 유지 가능
- token-efficiency claim은 NOT MEASURABLE
- token을 0으로 두거나 추정하지 않음
- 해당 run을 token denominator에서 제거하지 않음

Graceful timeout path는 terminal usage를 얻도록 구현하고 fault-injection test를 통과해야 한다.

### 14.7 Raw/derived consistency

Row에 `total_token_volume`을 저장하는 경우 verifier가 raw category 합과 정확히 일치하는지 재계산한다.

Analyzer는 저장된 `decision_safe_success`도 raw stop/evaluator fields에서 재계산한다.

────────

## 15. Primary metrics

### 15.1 Decision-Safe First-Pass Success

```text
SafeSuccessRate(arm) = safe successes / 90
```

Task-level effect:

```text
safe_rate(task, arm) = safe successes across 3 repeats / 3
SafeSuccessLift = mean_task[safe_rate(ON) - safe_rate(OFF)]
```

### 15.2 Token Volume per Decision-Safe Success

```text
TVPDSS(arm) =
  sum(total_token_volume across all 90 assigned runs)
  /
  count(decision_safe_success)
```

실패 run의 token volume도 numerator에 포함한다.

**TokenVolumeReduction 정의 (v1.2 — v1.1에서 게이트로 사용되었으나 미정의):**

```text
TokenVolumeReduction = 1 - TVPDSS(ON) / TVPDSS(OFF)
```

양수는 ON이 decision-safe success 한 건당 더 적은 token volume을 썼음을 뜻한다. `TVPDSS(OFF)`의 분모(OFF safe successes)가 0이면 이 값은 undefined이며, §16.4의 "both arms ≥ 10 safe successes" 조건이 이 경우를 게이트에서 배제한다.

보조:

```text
SafeSuccessesPer1M = 1,000,000 × safe successes / total_token_volume
TokenVolumePerAssignedRun = total_token_volume / 90
```

### 15.3 Rejected-Decision Revival Rate

```text
RevivalRate(arm) = revived runs / 90
RevivalReduction = 1 - RevivalRate(ON) / RevivalRate(OFF)
```

OFF revival이 0이면 relative reduction은 undefined다.

────────

## 16. Statistical analysis

### 16.1 Task aggregation

각 task에서 먼저 다음을 만든다.

```text
3 ON outcomes
3 OFF outcomes
```

30 tasks를 동일 가중치로 사용한다.

### 16.2 Bootstrap

10,000회 repository-stratified paired task bootstrap을 사용한다.

- 각 repository의 6 tasks를 replacement로 6개 재표집
- ON/OFF와 3 repeats는 task와 함께 이동
- 5 repositories는 항상 유지
- fixed PRNG algorithm과 seed를 analysis source에 고정
- percentile 2.5%, 97.5% interval

**Replicate 내 metric 계산 (v1.2):** 각 replicate에서 `TVPDSS`는 재표집된 30개 task(중복 포함)의 token volume 합을 그 task들의 safe success 합으로 나눈 **ratio-of-sums**로 계산한다. Task별 ratio의 평균이 아니다 — task 하나의 safe success가 0일 때 task-level ratio는 정의되지 않지만 sum-level ratio는 정의되기 때문이다. `SafeSuccessLift`와 revival absolute difference는 task-level 값의 평균으로 계산한다. 두 방식 모두 analysis source에 고정한다.

### 16.3 Performance gate

허용 조건:

```text
SafeSuccessLift >= +10 percentage points
AND
paired bootstrap 95% CI lower bound > 0
```

### 16.4 Token-efficiency gate

허용 조건:

```text
TokenVolumeReduction >= 15%
AND
paired bootstrap 95% CI lower bound > 0
AND
both arms have >= 10 safe successes
AND
all 180 runs have complete provider usage
AND
>= 9,900 / 10,000 bootstrap replicates have finite TVPDSS in both arms
```

Finite replicate 조건 미달 시 token claim은 NOT MEASURABLE이다. Undefined sample을 조용히 버리지 않는다.

### 16.5 Mechanism gate

허용 조건:

```text
RevivalReduction point estimate >= 30%
AND
OFF raw revival count >= 10
AND
absolute difference = RevivalRate(ON) - RevivalRate(OFF) < 0
AND
paired bootstrap 95% CI upper bound for absolute difference < 0
```

Relative percentage는 selling number이고 inferential gate는 stable한 absolute difference를 사용한다.

### 16.6 Full commercial headline gate

Performance, token efficiency, mechanism gate를 모두 통과해야 한다.

### 16.7 Interpretation limit

CDEB는 이 frozen corpus에서 큰 상업적으로 의미 있는 효과를 인증하도록 설계됐다.

Gate 실패는 더 작은 효과가 전혀 없음을 증명하지 않는다.

CI는 5 fixed repositories / 30 tasks 내의 task-resampling stability를 표현하며 모든 software repository의 population CI로 해석하지 않는다.

### 16.8 Prohibited analysis

- 180 rows를 독립 Bernoulli sample처럼 분석
- post-hoc task exclusion
- outcome을 보고 category/repository weighting 변경
- timeout/error 제거 후 재분석
- successful run끼리만 token 비교
- p-value만으로 성공 선언
- 유리한 repository만 headline에 사용

────────

## 17. Claim gates and wording

### 17.1 Full gate 통과

> Across 30 frozen decision-sensitive tasks from five named repositories, the same pinned coding agent with CommitLore produced **X percentage points more first-pass patches that worked without reviving a previously rejected decision**, used **Y% less provider-reported task-execution token volume per decision-safe success**, and revived rejected approaches **Z% less often** than the same agent with ordinary Git access.

항상 바로 옆에 표시:

```text
30 tasks · 5 repositories · 90 runs per condition
one pinned model and agent harness
corpus independence tier
records delivered as [claim]-graded information under the shipping trust configuration
delivery surface only; capture surface disabled in both arms
```

### 17.2 Partial gates

통과한 metric만 개별 주장한다.

- Performance만 통과 → first-pass lift만 주장
- Token만 통과 → task-execution token volume per safe success만 주장
- Mechanism만 통과 → rejected-decision revival만 주장

실패한 metric을 숨겨 전체 성능 향상처럼 표현하지 않는다.

### 17.3 Always prohibited

- "CommitLore makes every coding agent better."
- "CommitLore reduces tokens on all coding tasks."
- "Scientifically proven across software development."
- "CommitLore improves code quality by X%."
- token volume을 별도 pricing manifest 없이 dollar saving으로 표현
- Tier B corpus를 independent external validation으로 표현
- deterministic delivery result를 agent behavior result로 표현
- `[claim]` 전달로 측정된 효과를 `[directive]` 전달의 효과처럼 표현 (v1.2)

────────

## 18. Freeze protocol

### 18.1 Freeze manifest

Measured run 전에 다음을 고정한다.

```text
protocol source and digest
candidate registry commitment
sealed task bundle commitment
5 repository bundle digests
all snapshot/refs/notes digests
30 task IDs/categories (sealed; commitment only in public freeze)
randomization order (opaque block indices)
agent runtime image
model/CLI/executable identities
product commit + dist digest
shipping matcher/config/trust/index settings
proxy digest and byte-identity result
evaluator image digests
result schemas and verifier digest
analysis source and bootstrap seed
claim thresholds
privacy/authorization manifest
```

### 18.2 Randomization

90개의 task × repeat pair block을 만든다.

각 block:

```text
same task
same repeat
ON and OFF in randomized order
fresh runtime for each
```

90 blocks의 순서를 deterministic PRNG로 randomize한다.

Pair는 가능한 한 back-to-back 실행해 provider/time drift를 줄인다. **Block 내 ON/OFF 순서의 랜덤화는 provider-side cache warming 비대칭(§14.2)을 평균적으로 분산하는 역할도 겸한다** — 항상 같은 arm이 먼저면 뒤따르는 arm이 체계적으로 cache hit 이득을 본다.

**Task ID 누출 차단 (v1.2):** public pre-run freeze의 randomization manifest는 **opaque block index**(예: `block-000` … `block-089`)와 각 block의 condition 순서만 담는다. Block index → (task_id, repeat) mapping은 sealed bundle에 두고, §5.3 post-run reveal에서 공개해 commitment와 대조한다. Raw task ID를 pre-run에 공개하면 sealed corpus의 대상 영역이 부분 누출된다.

### 18.3 No mutable overrides

Freeze 이후 run CLI는 scientific parameter를 override할 수 없다.

허용:

```text
--study-id
--resume
--backup-dir
```

금지:

```text
--model
--timeout
--task subset
--condition
--product path
--randomization seed
```

### 18.4 No peeking

Progress output:

```text
logical run ID
state
attempt count
completed / remaining
```

금지:

```text
condition aggregate
safe success
revival
functional result
token total
raw agent outcome
```

Analyzer는 180 logical rows가 모두 존재하기 전 aggregate를 계산하지 않는다.

> 참고: 이 규칙은 M5에서 두 차례 실측으로 검증됐다 — outcome을 인쇄하는 runner 로그를 진행 확인에 쓰면 규칙을 기억하는 것만으로는 지켜지지 않는다(M5 pre-registration Appendix A.1). Progress 표면은 outcome 필드를 **출력할 수 없게** 구현한다. 명령이 규칙을 지니게 하고, 주의력에 맡기지 않는다.

────────

## 19. Result and artifact schema

### 19.1 Per-run directory

```text
runs/<logical-run-id>/
├── attempts/
│   └── <attempt-id>/attempt.json
├── provider.ndjson.zst
├── provider.ndjson.sha256
├── exposure.jsonl
├── exposure.sha256
├── final-tree.tar.zst
├── final-tree.json
├── evaluator-attempts/
├── evaluator.json
└── row.json
```

### 19.2 Canonical measured row

```json
{
  "schema_version": 1,
  "benchmark": "cdeb-v1",
  "protocol_version": "1.2.0",
  "study_id": "cdeb-2026-01",
  "logical_run_id": "repo-pricing__pricing-admin-quote__on__r2",
  "repository_id": "repo-pricing",
  "task_id": "pricing-admin-quote",
  "category": "rejected-architecture",
  "condition": "commitlore-on",
  "repeat": 2,
  "order": 73,

  "freeze_manifest_sha256": "...",
  "sealed_task_bundle_sha256": "...",
  "repository_bundle_sha256": "...",
  "repository_snapshot": "...",
  "base_tree_oid": "...",
  "refs_digest": "...",
  "notes_ref_digest": "...",

  "requested_model": "...",
  "observed_model_ids": ["..."],
  "agent_cli_version": "...",
  "agent_executable_sha256": "...",
  "node_version": "...",
  "node_executable_sha256": "...",
  "agent_runtime_image_digest": "sha256:...",
  "tool_policy_digest": "...",
  "network_policy_digest": "...",
  "settings_digest": "...",
  "mcp_config_digest": "...",

  "harness_commit": "...",
  "product_commit": "...",
  "dist_digest": "...",
  "hook_proxy_sha256": "...",

  "started_at": "...",
  "finished_at": "...",
  "stop_reason": "completed",
  "first_model_turn_observed": true,
  "wall_ms": 412000,

  "exposure": {
    "instrumentation_complete": true,
    "hook_opportunities": 4,
    "proxy_executions": 4,
    "expected_record_delivered": true,
    "delivered_before_first_mutation": true,
    "delivered_record_ids": ["r-price01"],
    "payload_sha256s": ["..."],
    "product_failures": 0
  },

  "usage": {
    "input_tokens": 12000,
    "output_tokens": 4100,
    "cache_creation_input_tokens": 5000,
    "cache_read_input_tokens": 9000,
    "total_token_volume": 30100,
    "reconciled": true,
    "unparsed_lines": 0,
    "raw_stream_sha256": "..."
  },

  "final_tree": {
    "final_tree_oid": "...",
    "canonical_diff_sha256": "...",
    "archive_sha256": "...",
    "workspace_status_digest": "..."
  },

  "evaluation": {
    "evaluator_image_digest": "sha256:...",
    "evaluator_attempts": 1,
    "functional_pass": true,
    "rejected_decision_revived": false,
    "normalized_result_sha256": "..."
  },

  "decision_safe_success": true,
  "simulated": false
}
```

### 19.3 Schema rules

- `additionalProperties: false`
- all measured fields required
- derived fields verifier recomputation
- unknown exposure 금지
- `simulated: true` publication 금지
- observed model mismatch 금지
- raw usage mismatch 금지
- final tree/evaluator tree mismatch 금지
- measured row edit-in-place 금지

────────

## 20. Durable storage, resume and backup

### 20.1 Authoritative path

```text
bench/results/cdeb/<study-id>/
├── public-freeze.json
├── randomization.json
├── runs/
├── rows/
├── attempts/
├── deviations.md
├── RESULT.json
└── RESULT.md
```

`/tmp` 또는 session scratchpad는 authoritative storage로 사용할 수 없다.

> 참고: 이 규칙은 가정이 아니라 실측된 손실에서 왔다. M5는 완료된 400 rows를 session scratchpad에만 두었다가 temp reaper에 잃었다(M5 deviation 3). Shard가 완성되는 즉시 repository에 commit하는 것까지가 규칙이다.

### 20.2 Atomic write

각 artifact:

1. same-filesystem `.partial` write
2. file fsync
3. close
4. atomic rename
5. parent directory fsync
6. optional backup mirror 확인

### 20.3 Backup

Measured run 전 `CDEB_BACKUP_DIR`을 필수로 설정한다.

각 logical row가 완성되면 primary와 backup의 SHA-256 일치를 확인한다.

### 20.4 Resume

Resume는 freeze manifest와 expected logical IDs를 기준으로 missing row만 실행한다.

- completed logical run agent rerun 금지
- duplicate/conflicting row → hard stop
- `.partial`은 attempt state로 복구 또는 격리
- changed freeze/product/model → resume 금지

────────

## 21. Recursive verification and CI

기존 legacy result verifier에 CDEB를 암묵적으로 끼워 넣지 않는다.

### 21.1 CDEB verifier

```text
bench/cdeb/verify.mjs
```

재귀 검증 대상:

- public freeze
- randomization
- all task commitments
- all attempt files
- all per-run rows
- evaluator result
- final RESULT.json/RESULT.md consistency
- expected file accounting

### 21.2 Default-in CI

`npm run bench:verify`는 다음을 모두 실행한다.

```text
legacy bench verifier
CDEB recursive verifier
```

규칙:

- nested invalid row 하나라도 CI FAIL
- empty study directory FAIL
- unknown unclassified file FAIL
- missing expected row FAIL
- mixed schema family FAIL
- report/manual-number drift FAIL

`schema_version`을 legacy metric-row skip discriminator로 CDEB 분류에 재사용하지 않는다. CDEB는 explicit `benchmark: cdeb-v1` schema를 가진다.

> 참고: analysis 입력은 directory glob이 아니라 **명시된 파일 목록**이어야 한다. M5 analyzer는 `bench/results`의 모든 `.jsonl`을 읽어 22개 파일 1,835 rows — 다른 실험 4개 포함 — 를 집었고, 그 수가 registered n을 초과해 stopping rule이 오염 덕분에 통과할 뻔했다(#441). CDEB analyzer는 freeze manifest가 명명한 row 파일만 읽고, 명명된 파일이 없으면 조용히 건너뛰지 않고 실패한다.

────────

## 22. Command contract

### 22.1 Package scripts

```json
{
  "bench:cdeb:verify": "node bench/cdeb/verify.mjs",
  "bench:cdeb:preflight": "node --experimental-strip-types bench/cdeb/preflight.ts",
  "bench:cdeb:freeze": "node --experimental-strip-types bench/cdeb/freeze.ts",
  "bench:cdeb:smoke": "node --experimental-strip-types bench/cdeb/run.ts --smoke",
  "bench:cdeb:run": "node --experimental-strip-types bench/cdeb/run.ts",
  "bench:cdeb:analyze": "node --experimental-strip-types bench/cdeb/analyze.ts"
}
```

### 22.2 Preflight

검증:

- OCI runtime
- isolation/network capability
- model/CLI exact identity
- provider event schema
- proxy byte identity
- repository bundle integrity
- evaluator container controls
- storage/backup atomicity
- no hidden task artifact inside agent runtime

Model call을 사용하는 capability probe는 study result에 포함하지 않으며 exact artifacts를 freeze한다.

### 22.3 Freeze

- dirty protocol checkout 거부
- existing freeze overwrite 거부
- sealed bundle digest 검증
- randomization 생성
- all digests 기록

### 22.4 Smoke

Final corpus에 포함되지 않는 disposable tasks만 사용한다.

- ON/OFF
- proxy
- usage ledger
- final tree freeze
- evaluator sandbox
- retries
- storage
- analyzer refusal

Smoke row는 simulated 또는 smoke marker를 가져 publishable result와 구분한다.

### 22.5 Run

```bash
npm run bench:cdeb:run -- --study-id cdeb-2026-01 --resume
```

Scientific overrides 없음.

### 22.6 Analyze

다음을 먼저 통과해야 aggregate를 계산한다.

- 180 logical rows
- exact identities
- schema/derived consistency
- complete exposure instrumentation
- provider usage integrity
- no forbidden retry
- no simulated row
- no freeze mismatch

────────

## 23. Fixed report contract

```text
CommitLore Decision Efficiency Benchmark v1
30 frozen decision-sensitive tasks · 5 named repositories · 180 fresh runs
Same pinned model · same agent harness · byte-identical repository states
90 runs per condition · corpus independence tier A/B
Records delivered as [claim]-graded information · delivery surface only

DECISION-SAFE FIRST-PASS SUCCESS
OFF  __ / 90  (__%)
ON   __ / 90  (__%)
Lift +__.pp · task-bootstrap 95% CI [__, __]

TOKEN VOLUME PER DECISION-SAFE SUCCESS
OFF  __ provider-reported tokens
ON   __ provider-reported tokens
Reduction __% · task-bootstrap 95% CI [__, __]
Total token volume: OFF __ · ON __
Token volume per assigned run: OFF __ · ON __
Safe successes per 1M tokens: OFF __ · ON __

REJECTED-DECISION REVIVALS
OFF  __ / 90  (__%)
ON   __ / 90  (__%)
Relative reduction __%
Absolute difference __pp · task-bootstrap 95% CI [__, __]

CLAIM GATES
Performance             PASS / FAIL
Token efficiency        PASS / FAIL / NOT MEASURABLE
Mechanism               PASS / FAIL / OPPORTUNITY FAILURE
Full commercial claim   PASS / FAIL
```

Appendix 필수:

- all 30 task IDs
- repository ownership/authorship + reviewer identity (§4.8)
- category counts
- stop reasons per arm
- exposure opportunities/deliveries/product failures
- provider token category totals **per arm** (cache_read 분리 — §14.2)
- evaluator retries
- pre-agent attempts
- deviations
- every provenance digest
- public/private task disclosure status

부정적 결과도 동일한 순서와 prominence로 출력한다.

────────

## 24. Implementation architecture

```text
bench/cdeb/
├── PRD.md
├── schemas/
│   ├── study.schema.json
│   ├── candidate.schema.json
│   ├── task.schema.json
│   ├── attempt.schema.json
│   ├── result.schema.json
│   └── evaluator.schema.json
├── protocol/
│   ├── types.ts
│   ├── constants.ts
│   └── claims.ts
├── freeze/
│   ├── candidate-registry.ts
│   ├── sealed-bundle.ts
│   ├── repository-bundle.ts
│   ├── randomize.ts
│   └── freeze.ts
├── runtime/
│   ├── repository-materializer.ts
│   ├── agent-container.ts
│   ├── isolation.ts
│   ├── shipping-proxy.ts
│   ├── exposure.ts
│   ├── provider-ledger.ts
│   ├── final-tree.ts
│   └── evaluator-container.ts
├── orchestration/
│   ├── state-machine.ts
│   ├── attempts.ts
│   ├── storage.ts
│   ├── backup.ts
│   └── run.ts
├── analysis/
│   ├── validate-matrix.ts
│   ├── bootstrap.ts
│   ├── metrics.ts
│   ├── gates.ts
│   ├── report.ts
│   └── analyze.ts
├── verify.mjs
├── test-fixtures/
└── revealed-tasks/
```

### 24.1 Existing code reuse

재사용 가능:

- `digestDistTree`
- stream-json per-turn usage parser의 검증된 semantics
- existing statistical primitives where exact semantics match
- legacy provenance principles

직접 재사용 금지 또는 수정 필요:

- record-stripping workspace control
- outcome을 console에 출력하는 legacy runner loop
- fail-open agent isolation fallback
- benchmark matcher가 shipping matcher와 다른 hook plan
- top-level JSONL만 보는 legacy verifier

────────

## 25. Testing and fault injection

### 25.1 Schema and freeze

- cutoff 이후 record reject
- benchmark-authored record reject
- candidate registry deterministic selection
- sealed bundle hash mismatch reject
- randomization drift reject
- randomization manifest에 raw task ID 존재 시 reject (v1.2)
- scientific override reject

### 25.2 Same-history

- ON/OFF HEAD identical
- tree OID identical
- commit-message digest identical
- refs/notes digest identical
- trailer stripping mutation test fails
- `.git/commitlore/` 내 파일 생성이 tree/workspace digest에 영향 없음을 확인 (v1.2)

### 25.3 Shipping proxy

- direct/proxy stdout byte identity
- stderr/exit identity
- matcher/config exact freeze
- expected record parse
- empty context
- product error forwarding
- proxy mutation causes hard refusal

### 25.4 Runtime isolation

- inherited MCP blocked
- user settings blocked
- session persistence blocked
- web/subagent tools blocked
- benchmark artifact path inaccessible
- provider-only network enforced
- model/CLI hash drift hard stop
- capture surface가 어느 arm에도 활성화되어 있지 않음을 preflight로 증명 (v1.2)

### 25.5 Token ledger

- duplicate assistant content blocks do not double count
- final output tokens from authoritative event
- turn/session total reconcile
- unparsed line reject
- subagent turn reject
- timeout graceful usage control
- raw category sum/derived total mismatch reject

### 25.6 Evaluator security

- package script tamper cannot pass
- candidate test deletion cannot pass
- hidden oracle read fails
- network fails
- secret read fails
- fork bomb/resource abuse contained
- good/bad/no-op exact behavior

### 25.7 Retry integrity

- pre-first-turn transient retry allowed
- after-first-turn agent retry refused
- evaluator retry reuses same final tree
- exposure artifact loss prevents replacement rerun
- attempt lineage preserved

### 25.8 Storage and verification

- file and directory fsync
- interrupted partial recovery
- backup hash equality
- nested invalid CDEB row fails CI
- unknown file fails CI
- duplicate logical row fails
- incomplete matrix refuses analysis
- progress logs contain no outcome — outcome 필드를 출력하는 progress 코드 경로가 존재하지 않음을 정적으로 확인 (v1.2)

### 25.9 Analysis controls

- known null fixture
- known positive fixture
- clustered repeated rows retain task weighting
- zero-safe-success bootstrap handling
- finite replicate threshold
- ratio-of-sums replicate 계산 검증 (v1.2)
- mechanism opportunity failure
- generated report byte regeneration

────────

## 26. Implementation tickets

### CDEB-00 · Land v1.2 protocol and locked contracts

Scope

- 본 PRD
- protocol constants
- cutoff/freeze semantics
- claim wording

Acceptance

- v1.0, v1.1 superseded 표시
- no unresolved P0 design decision

────────

### CDEB-01 · Schemas and recursive verifier

Scope

- study/candidate/task/attempt/result/evaluator schemas
- `bench/cdeb/verify.mjs`
- CI integration

Acceptance

- nested invalid row fails
- unknown file fails
- derived mismatch fails
- `npm run bench:verify` runs legacy + CDEB verifier

Depends on: CDEB-00

────────

### CDEB-02 · Frozen repository materializer

Scope

- Git bundle creation/import
- refs/notes preservation
- offline materialization
- same-history digest checks

Acceptance

- ON/OFF exact base identity proven
- record-stripping path impossible

Depends on: CDEB-01

────────

### CDEB-03 · Agent runtime isolation and model pinning

Scope

- pinned OCI runtime
- isolated HOME/settings/MCP/session
- provider-only network
- exact tool policy
- executable/model identity

Acceptance

- missing isolation capability hard fails
- inherited memory/settings test fails closed
- model or CLI drift stops study

Depends on: CDEB-01

────────

### CDEB-04 · Transparent shipping hook proxy

Scope

- actual shipping command wrapper
- exposure side channel
- frozen output parser
- byte-identity tests
- exact shipping matcher/trust/index config
- capture-surface exclusion proof (v1.2)

Acceptance

- direct/proxy exact output equality
- no benchmark context assembly
- ON/OFF integrity proven
- no capture hook active in either arm

Depends on: CDEB-02, CDEB-03

────────

### CDEB-05 · Strict provider usage ledger

Scope

- raw NDJSON persistence
- exact observed models
- reconciliation
- total token volume
- graceful terminal usage handling

Acceptance

- no unparsed measured stream
- no subagent turn
- incomplete usage makes token claim unavailable, never estimated

Depends on: CDEB-03

────────

### CDEB-06 · Immutable evaluator sandbox

Scope

- pinned evaluator images
- candidate tree ingestion
- functional/decision result schema
- dual and anti-tamper controls

Acceptance

- candidate cannot forge pass
- no network/secrets/host access
- all controls deterministic

Depends on: CDEB-01, CDEB-02

────────

### CDEB-07 · Durable orchestrator and attempt state machine

Scope

- blocked randomization (opaque indices)
- run lifecycle
- stage-aware retry
- final tree freeze
- atomic storage/backup/resume
- outcome-free progress

Acceptance

- no agent rerun after first model turn
- evaluator retry same tree
- interrupted run resumes missing logical IDs only
- progress surface cannot emit outcome fields

Depends on: CDEB-04, CDEB-05, CDEB-06

────────

### CDEB-08 · Analyzer, bootstrap and claim generator

Scope

- matrix validation (freeze-named files only)
- three metrics + TokenVolumeReduction
- 10,000 paired stratified bootstrap (ratio-of-sums TVPDSS)
- claim gates
- fixed report

Acceptance

- null/positive controls
- finite replicate rule
- revival absolute CI
- report generated without manual numbers

Depends on: CDEB-01, CDEB-05

────────

### CDEB-09 · End-to-end adversarial smoke gate

Scope

- disposable tasks
- all infrastructure paths
- fault injections

Acceptance

- evaluator tamper/network/secret attempts blocked
- shipping proxy mutation caught
- model drift caught
- nested invalid result caught
- patch-frozen evaluator retry proven

Depends on: CDEB-07, CDEB-08

────────

### CDEB-10 · Candidate registry and sealed 30-task corpus

Scope

- candidate enumeration
- natural-record validation
- deterministic selection
- prompts/evaluators/controls
- independent review
- privacy authorization

Acceptance

- 5 × 6 = 30
- exact category quota
- all records pre-cutoff
- no benchmark-authored record
- no measured agent run
- sealed commitment published

Depends on: CDEB-09

────────

### CDEB-11 · Freeze, execute and publish

Scope

- final preflight/freeze
- 180 logical runs
- immutable report
- allowed README/evidence claims

Acceptance

- 180 complete logical rows
- no unknown instrumentation
- all identities frozen
- no forbidden retry
- report regenerated mechanically
- null/negative result preserved unchanged

Depends on: CDEB-10

────────

## 27. Risks and mandatory responses

| Risk | Response |
|---|---|
| qualified pre-cutoff tasks < 30 | do not lower criteria; CDEB v1 does not run |
| OFF revivals < 10 | mechanism opportunity failure; no revival claim |
| ON product does not deliver | keep rows; report exposure/product failures |
| one or more run lacks complete usage | no token-efficiency claim |
| evaluator can be changed by patch | task/evaluator rejected before freeze |
| model/CLI changes mid-study | hard stop; new study ID |
| prompt/oracle leaked pre-run | study invalid; new sealed corpus |
| infrastructure fails after patch | evaluator-only retry on same tree |
| raw exposure/usage irrecoverably lost | no agent replacement; study incomplete |
| all repositories author-operated | Tier B wording; no external-validation claim |
| shipping trust config changes mid-study | hard stop via product digest rule (§2.2) |
| negative/null result | publish in fixed format |

────────

## 28. Definition of Done

### 28.1 Infrastructure

- ☐ recursive CDEB verifier in default CI
- ☐ frozen bundle materializer
- ☐ identical ON/OFF repository proof
- ☐ pinned isolated agent runtime
- ☐ exact model/CLI/executable observation
- ☐ transparent shipping proxy with byte-identity gate
- ☐ OFF zero activation proof
- ☐ capture surface disabled in both arms, proven at preflight
- ☐ strict provider ledger and raw stream persistence
- ☐ evaluator-owned sandbox
- ☐ final tree canonicalization
- ☐ stage-aware retries
- ☐ durable primary + backup storage
- ☐ mechanically generated report

### 28.2 Corpus

- ☐ cutoff frozen (per-repository snapshot refs)
- ☐ candidate registry frozen
- ☐ 5 repositories / 30 tasks
- ☐ CommitLore repo excluded from primary
- ☐ exact category quota
- ☐ all records natural and pre-cutoff
- ☐ dual/no-op/anti-tamper controls pass
- ☐ independent review attestations (reviewer identity disclosed with tier)
- ☐ sealed task commitment published (opaque randomization)
- ☐ privacy/provider authorization complete

### 28.3 Measurement

- ☐ 180 unique logical runs
- ☐ same frozen product/model/runtime
- ☐ no missing cell
- ☐ no forbidden agent rerun
- ☐ no unknown exposure instrumentation
- ☐ all behavioral outcomes deterministic
- ☐ all provider usage complete or token claim marked not measurable
- ☐ all deviations published

### 28.4 Publication

- ☐ RESULT.json generated
- ☐ RESULT.md generated
- ☐ every gate shown
- ☐ total token volume and per-assigned-run tokens shown, per-arm cache categories in appendix
- ☐ ownership/independence tier shown
- ☐ trust-configuration wording present ([claim]-graded delivery)
- ☐ raw artifacts/hashes available under policy
- ☐ claim text generated only from gate status
- ☐ null/negative verdict immutable and citable

────────

## 29. Final locked decisions

Implementation 중 다음을 다시 열지 않는다.

1. 이름은 **CommitLore Decision Efficiency Benchmark (CDEB)**다.
2. matrix는 5 repositories / 30 tasks / 180 runs다.
3. model과 agent harness는 하나다.
4. conditions는 ON/OFF 두 개뿐이다.
5. repository state는 두 arm에서 byte-identical하다.
6. OFF에서도 CommitLore records/history를 삭제하지 않는다.
7. ON은 실제 shipping injector만 사용한다.
8. transparent proxy는 output을 변경하지 않는다.
9. primary evaluator는 deterministic external sandbox뿐이다.
10. first-pass final tree만 평가한다.
11. token은 provider-reported task-execution volume이다.
12. failure run token을 포함하며 성공 run만 비교하지 않는다.
13. human/LLM judge를 추가하지 않는다.
14. custom RAG, ablation, multi-session relay를 추가하지 않는다.
15. task 결과를 본 뒤 corpus를 수정하지 않는다.
16. agent가 시작된 logical run은 다시 뽑지 않는다.
17. hidden prompt/evaluator는 sealed freeze를 사용한다.
18. incomplete or unverifiable matrix에서 commercial verdict를 만들지 않는다.
19. 기존 M1–M5, delivery, token-ledger artifact를 삭제하거나 CDEB 결과로 재해석하지 않는다.
20. negative/null result도 동일한 report contract로 공개한다.

────────

## 30. Final approval

본 v1.2는 v1.1이 이전 production-readiness review의 blocking findings를 닫은 방식을 유지하고, v1.1 자체의 잔여 갭을 닫는다.

**v1.1이 닫은 것 (유지):**

- benchmark-planted answer → pre-cutoff natural-record corpus + candidate registry
- arm history mismatch → frozen bundle + same-history invariant
- shipping mismatch → exact matcher/config + transparent byte-identical proxy
- hidden evaluator tampering → immutable external sandbox
- unenforceable token/turn budget → wall-clock-only primary budget, token as outcome
- outcome reroll → first-turn/patch-frozen retry state machine
- fail-open environment → pinned OCI runtime + fail-closed isolation
- ungated nested results → recursive CDEB verifier in default CI
- public freeze contradiction → sealed bundle commitment
- incomplete claim inference → revival absolute CI + finite token bootstrap rule

**v1.2가 추가로 닫은 것:**

- gate에 쓰였으나 미정의였던 TokenVolumeReduction → §15.2 정의
- bootstrap replicate 내 ratio 계산 미규정 → §16.2 ratio-of-sums
- ADR-0030 auto-capture와의 충돌 → capture surface 양 arm 미설치, 공개 사항화
- shipping trust 상태([claim] 전달) 미명시 → §9.2/§17 문구 규정
- randomization manifest의 task ID 누출 → opaque block index
- provider cache 순서 의존성 → within-block 랜덤 순서 + per-arm category 보고 + limitation 공개
- `.git/` 내 product 상태와 tree 동일성의 관계 미규정 → §6.2/§25.2

Implementation status: **Approved**
