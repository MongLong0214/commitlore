# CommitLore Decision Efficiency Benchmark (CDEB)

Production-Ready Implementation PRD · **v1.3 Final**

| | |
|---|---|
| 문서 상태 | Approved for implementation |
| 프로토콜 버전 | 1.3.0 |
| 벤치마크 ID | `cdeb-v1` |
| 대상 저장소 | MongLong0214/commitlore |
| 기준 브랜치 | `dev` |
| 측정 대상 | pinned CommitLore build의 실제 shipping decision-context 전달 경로 |
| 대체 문서 | CDEB PRD v1.2, CDEB PRD v1.1, COMMITLORE_CDEB_FINAL_PRD.md v1.0, 별도 production-readiness review |
| 승인 범위 | 인프라 구현 승인. 실제 measured run은 본 문서의 Freeze Gate와 Definition of Done 통과 후에만 허용한다. |

### v1.2 → v1.3 변경 이력 — 파일럿이 측정한 것에서만 나온 변경

v1.3은 **CDEB-P가 실제로 돌려서 알아낸 것**만 반영한다(`bench/cdeb/RESULT-CDEB-P.md`).
설계·matrix·§29 locked decisions는 그대로다. 프로토콜을 더 꼼꼼히 읽어서 나올 수
있었던 변경은 하나도 없다.

| # | 파일럿이 측정한 것 | v1.3이 바꾸는 것 |
|---|---|---|
| 1 | ⚠ `T_on/T_off` = **1.45** — ON arm이 45% 더 비싸다 | §16.4는 **15% 고정을 유지**하고 보정값은 서술적으로만 쓴다. §16.6은 headline을 세 게이트로 분리한다 |
| 2 | ⚠ 4개 task 중 **1개가 4런 전부 timeout** | §4.6에 ON+OFF runtime-boundedness qualification을 의무화한다 |
| 3 | ⚠ 4개 task 중 **2개가 ON arm에 record를 0개 전달** | §4.9를 신설해 **frozen shipping inject 경로로** 배송 가능성을 봉인 전 검증한다 |
| 4 | 파일럿 계측이 opportunity와 delivery를 합쳐 셌다 | §9.5가 분리를 요구하고 §19.3이 exposure 불변식을 재계산 대상으로 만든다 |

**⚠ 이 앵커들은 shipping 표면과 다른 hook 표면에서 측정됐다 (shipping 표면에 대해 UNVERIFIED).** 파일럿의 ON arm은 `Edit|Write|MultiEdit|NotebookEdit` matcher를 설치했지만 제품이 shipping하는 matcher는 `Read|Edit|Write`다(`CLAUDE_HOOK_MATCHER`, `src/hooks/claude-settings.ts`). shipping은 모든 `Read`에도 발화하므로, 파일럿은 study가 측정할 표면보다 가벼운 표면에서 측정한 것이다 — ON arm의 토큰, wall time, delivery 기회는 이 숫자들과 다를 수 있다. 숫자는 재유도하지도 삭제하지도 않고, 어느 숫자가 어느 표면에서 나왔는지 보이도록 1–3행에 ⚠를 남긴다. 재측정 여부는 이 변경이 내리지 않는 별도의 결정이다. 4행은 계측 구조에 대한 발견이므로 표면에 의존하지 않는다.

**v1.3 초안이 스스로 만든 결함과 그 수정** — 외부 production-readiness review가 잡았다.

| 초안의 오류 | 왜 틀렸나 | 수정 |
|---|---|---|
| 문턱값을 `1 - 1/(1.15·o)`로 유도 | `R = 1 - o/q`이므로 overhead가 이미 R 안에 있다. 다시 곱하면 `q >= 1.15·o²`가 되어 o=1.45에서 대조군 50%일 때 ON이 **120.9%**여야 한다 — 불가능 | 15% 고정 복원, 보정은 서술적 feasibility note |
| `max(0.05, …)` 하한 | 스키마가 `o >= 1.0`을 요구하고 o=1.0에서 공식이 13.04%를 내므로 5%는 **절대 선택되지 않는다** | 삭제 |
| §16.6에서 token을 뺐으나 §17.1 문장은 그대로 | Token FAIL인데 "Y% 적은 토큰"을 주장하는 문장이 생성될 수 있었다 | §16.6 세 게이트 분리, §17.1은 `CombinedHeadline` 전용 |
| "게이트를 느슨하게 만들지 않는다" | `P ∧ M`은 `P ∧ T ∧ M`보다 **엄격하게 약하다**. T를 어렵게 해도 이 사실은 안 바뀐다 | 문장 철회, §16.6에 그대로 기록 |
| probe가 arm을 명시하지 않음 | 실행 시간은 treatment에 민감하고, 한 arm 선별은 그 arm에 유리한 corpus를 고를 수 있다 | ON+OFF 둘 다 요구 |
| probe row 폐기 | 같은 문서가 freeze manifest에 probe 결과를 요구한다 — 재확인 불가능한 qualification은 게이트가 아니다 | artifact 보존, digest를 freeze에 기록 |
| probe가 "완료 가능"을 증명한다는 표현 | `stop_reason == completed`는 프로세스가 반환했다는 뜻이고 no-op도 통과한다 | runtime-boundedness로 개명, 주장 축소 |
| `commitlore context`로 배송 검증 | 측정 대상 표면이 아니다. budget·trust·matcher·index 중 무엇도 통과하지 않는다 | frozen shipping inject 경로로 교체 |
| "파일럿이 원인은 task 자격이었음을 보였다" | 파일럿 계측은 "발화 안 함"과 "발화했으나 record 없음"을 **구분하지 못했다** | 인과 주장 철회, 두 가능성을 각각 닫는다고 기술 |

### v1.1 → v1.2 변경 이력

v1.1의 실험 설계, matrix, gate, locked decisions는 그대로다. v1.2는 v1.1이 게이트로 사용하면서 정의하지 않았거나, 이 저장소의 실제 shipping 동작과 어긋나게 된 지점만 닫는다.

1. **`TokenVolumeReduction` 정의 추가** — §16.4가 게이트 조건으로 사용하지만 §15에 정의가 없었다. §15.2에 정의한다.
2. **bootstrap replicate 내 TVPDSS 계산 규정** — 재표집된 task 집합 위에서 ratio-of-sums로 계산함을 §16.2에 명시한다.
3. **ON arm의 활성 surface를 delivery로 한정** — ADR-0030이 병합되어 capture 기본 모드가 `auto`(무인 스테이징)가 됐다. Agent가 run 중 commit하면 무인 캡처가 새 record를 만들어 repository state를 비결정적으로 바꾼다. §2.3과 §9.2가 이제 capture surface를 양 arm 모두 설치하지 않는다고 명시하고, full install과의 차이를 공개 사항으로 규정한다.
4. **shipping trust 상태의 명시** — 당시 어떤 설치 표면도 `--trusted-author`를 전달하지 않아 shipping 설정에서 모든 record가 `[claim]`으로 전달되던 상태(#415)를 CDEB가 그대로 측정함을 명시하고, §9.2와 §17이 이를 결과 문구에 포함하도록 한다. 이 상태는 2026-08-07 v0.7.0(`a030e93`)에서 끝났다 — `init`이 `commitlore.trustedAuthor`를 시드한다. 현재 상태는 §9.2 참조.
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
4 repositories
× 6-9 tasks per repository (합계 30, repository당 최소 6)
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
4 named repositories
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
- repository당 최소 6개 task를 사용하고, 합계는 30개다 (2026-08-19 개정, §3.3). 30은 4로 나뉘지 않으므로 8·8·7·7이며, `analyze.ts`는 저장소별 하한과 합계를 따로 검사한다 — 저장소별 등식 검사는 이 모양 자체를 거부한다.

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

> **개정 2026-08-19 (#771): 5개 → 4개.** 이 저장소를 제외한 로컬 census를 다 훑은 결과
> 기록이 있는 저장소는 여섯이고 저장소당 6과제를 낼 밀도가 있는 것은 넷이다.
> `candidate-registry.ts` 로 센 값이며, §3.1이 요구하는 대로 snapshot ref를 못박는다:
>
> | repository | snapshot | 후보 | rejection reason 명시 |
> |---|---|---:|---:|
> | `gitseed` | `3fa2c3f` | 84 | 71 |
> | `agent-operator-score` | `bd56d45` | 119 | 29 |
> | `logic-pro-mcp` | `c8764dd3` | 53 | 29 |
> | `agent-control-plane` | `6cf4dbd` | 80 | 17 |
> | `stock-ai-newsletter` | `9041ef8` | 3 | 2 |
> | `repo-factory` | `4b8f299` | 1 | 0 |
>
> 아래 둘은 3건과 1건이라 6과제를 못 낸다. 초안은 `agent-operator-score`를 106/27로
> 적었는데 어느 ref에서도 재현되지 않았다 — ref 없이 인용한 수는 검산할 수 없는 수다. 다섯 번째는 채택이지 코드가 아니며, 그것을 기다리는 동안 study는
> 시작될 수 없다.
>
> **사전등록 문턱을 낮추는 것이므로 값이 없지 않다.** 사전등록이 막으려는 것은 *결과를
> 본 뒤에* 문턱을 고르는 일인데, 이 study는 아직 유효하게 실행된 적이 없다 — §4.7의
> 좋은 control이 손대지 않은 트리를 네 과제 모두에서 성공으로 채점하고, 분산 7회와
> 파일럿 재실행 2회가 확인된 적 없는 REVIVED 라벨을 달고 있다. 계측을 다시 만드는 중에
> corpus 크기를 함께 정하는 것과, 측정된 결과를 보고 문턱을 옮기는 것은 다른 행위다.
>
> **task 수는 줄이지 않는다.** 처음 초안은 4 × 6 = 24로 쿼터를 줄였는데, 그러면 §16.3의
> 사전등록 검정력 시뮬레이션이 무효가 된다 — 검출 가능 효과의 바닥은 30 task 기준으로
> 계산됐고 §13의 CI 해석도 "30 tasks" 안의 재표집 안정성으로 적혀 있다. 재료는 충분하다
> (rejection reason이 명시된 후보만 71·27·29·17건). 그러므로 **저장소만 4개로 줄고
> task 합계 30과 §3.4 쿼터는 그대로**이며, repository당 6은 하한으로 읽는다. 바뀌는 것은
> repository 다양성이다.
>
> **"검정력이 아니다" 는 너무 강한 말이라 쓰지 않는다.** task 30을 유지해도 cluster가
> 5에서 4로 줄면 cluster당 task가 6에서 7.5로 늘고 design effect `1+(m-1)ρ` 가 오른다:
> ICC 0.05 에서 유효 n 24.0→22.6, 0.10 에서 20.0→18.2, 0.20 에서 15.0→13.0. 검정력이
> 보존되는 것은 §16.2의 등록된 bootstrap이 repository를 고정하고 between-repository
> 분산을 전파하지 않기 때문이며, §16.7이 그 한계를 이미 적어두었다. 즉 등록된 게이트에
> 대해서는 참이고, 읽는 사람이 가져갈 일반적 의미로는 거짓이다.
>
> **§3.2 rule 5 를 읽고 넘어간다, 모르고 지나치는 것이 아니다.** 그 규칙은
> *"candidate가 부족하면 기준을 낮추거나 새 record를 만들지 않고 study를 중단한다"* 이다.
> 그 조건은 발동하지 않는다 — 부족한 것은 candidate가 아니라 repository다. rejection
> reason이 명시된 후보만 71·27·29·17건이고 §3.4가 요구하는 것은 30이다. rule 5가 막는
> 것은 약한 task로 수를 채우는 일이고, 여기서는 §4의 자격 심사도 쿼터도 그대로다. 새
> record를 만들지도 않는다.
>
> **결과 문구는 이 개정을 나른다.** independence tier 문구는 "five"가 아니라
> **"four author-operated repositories"** 이며, 이 개정과 그 이유를 함께 공개하지 않고
> 결과를 인용할 수 없다. repository가 넷이면 repository-level 변동의 추정 근거가 하나
> 줄어든다는 사실도 함께 적는다 — task 수가 같다고 이 손실이 사라지지는 않는다.

Primary corpus는 다음을 만족한다.

- 4 named repositories
- repository당 **최소** 6 tasks, 합계 30 tasks
- CommitLore repository 자체는 primary corpus에서 제외
- 최소 3개의 서로 다른 application/domain repository
- repository ownership과 decision authorship 공개

**Independence tier**

- **Tier A**: 최소 2개 repository에서 decision author 또는 accepting reviewer가 benchmark/product author와 다름
- **Tier B**: 4개 모두 author-operated repository

Tier B도 실행할 수 있으나 결과 문구는 반드시 "four author-operated repositories"라고 명시하며 independent external validation이라고 표현하지 않는다.

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

### 4.6 Bounded implementation — 측정된 조건 (v1.3)

권장 범위:

- 1–4 source files modified
- 약 20–200 changed LOC
- 하나의 primary decision
- 한 fresh agent session 안에 완료 가능

**"완료 가능"은 이제 주장이 아니라 검사다.** CDEB-P에서 네 task 중 하나가
15분 예산을 **4런 전부** 초과했다(903/902/902/902초). 양 arm이 모두 timeout이면
그 task는 어떤 비교에도 기여하지 못하면서 연구의 4분의 1을 소비한다. v1.2까지
§4.6은 이 조건을 바랐을 뿐 확인할 방법이 없었다.

**0.6은 이제 판단값이 아니라 관측된 분리에서 나온다 (v1.3).** CDEB-P의 wall
time이 두 가지를 동시에 말한다.

```text
완료된 12런의 최댓값   431s = 0.48 × budget
timeout된 task         900s = 1.00 × budget
관측된 셀 내 최대 편차  ×4.9  (verify-scope ON: 89s → 431s, 같은 셀)
```

첫 두 줄이 문턱값을 정한다: 파일럿의 좋은 task와 나쁜 task는 **0.48과 1.00 사이
어디서든 분리된다.** 0.6은 그 구간 안이며, 양 끝 어디에도 붙어 있지 않다.

**이 분리의 ON 쪽 숫자는 shipping 표면에 대해 UNVERIFIED다 (⚠).** 0.48을 만든
완료 런들과 위 903/902/902/902초 timeout의 ON 행은 `Read`에서 발화하지 않는
파일럿 matcher `Edit|Write|MultiEdit|NotebookEdit`로 측정됐다 — shipping
`Read|Edit|Write`가 아니다. study가 측정할 ON arm은 모든 `Read`에도 발화하므로
이 split은 shipping 표면에서 재현되지 않을 수 있다. 0.6은 screen으로 동결된
채 남고, split의 재측정 여부는 이 변경이 내리지 않는 별도의 결정이다 (§0의 ⚠).

> **2026-08-19 정정 (#775).** 위 두 곳이 shipping matcher를 `Read|Edit|Write`로
> 적었다. 그날의 사실이었고 지금은 아니다. 두 설치 경로가 서로 다른 matcher를
> 쓰고 있었고(CLI `Read|Edit|Write`, 플러그인 `Edit|Write|MultiEdit|NotebookEdit`),
> #775에서 injector가 실제로 처리하는 다섯 개 `Read|Edit|Write|MultiEdit|NotebookEdit`
> 로 통일했다. **⚠의 논지는 그대로 선다** — 파일럿 표면은 여전히 shipping보다
> 가볍다(`Read`가 없다). 바뀐 것은 얼마나 가벼운가지 어느 방향인가가 아니다.
> 앵커는 재유도하지 않는다: 사전등록된 숫자는 측정된 표면에 묶여 있고,
> 재측정은 이 정정이 내리지 않는 별도의 결정이다.

**세 번째 줄이 이 게이트가 주장할 수 있는 것을 제한한다.** 같은 task·같은 arm의
두 반복이 ×4.9까지 벌어졌다. 두 번의 probe는 그 꼬리를 잡지 못한다. 따라서 이
qualification은 **중앙값 근처를 거르는 screen이며, study에서 timeout이 나오지
않는다는 보장이 아니다.** Study의 timeout은 §10.4의 정상적인 measured failure로
남고 intention-to-treat가 처리한다. 이 게이트가 막는 것은 파일럿에서 실제로
일어난 일 — **한 task의 네 런이 전부 timeout이 되어 아무 비교에도 기여하지 못하는
것** — 뿐이다.

**Runtime-boundedness qualification (v1.3).** 이름이 정확해야 한다 — 이것은
**task가 예산 안에서 끝나는지**를 재는 것이지, task가 완료 가능하다거나 기능적으로
풀렸다는 증명이 아니다. `stop_reason == completed`는 프로세스가 timeout 전에
반환했다는 뜻일 뿐이고, 아무 일도 하지 않은 응답도 1분에 그 조건을 만족한다.
이것은 명백한 long-tail runtime screen이며, 그 이상을 주장하지 않는다.

봉인 전, 각 task는 **ON 한 번과 OFF 한 번**을 모두 통과해야 한다.

```text
qualified  ⟺  both arms complete AND max(wall_ms over both probes)
                 <= 0.6 × that task's frozen timeout_ms
```

**양 arm을 모두 요구하는 이유:** 실행 시간은 treatment에 민감하다. 한 arm으로만
선별하면 그 arm에 유리한 corpus가 선택될 수 있고, 그 편향은 결과에서 분리되지
않는다. Probe는 study와 동일한 pinned runtime, 고정된 qualification seed, 무작위
ON/OFF 순서로 실행한다.

**Selector에 노출되는 것은 `wall_ms`와 `stop_reason` 뿐이다.** Oracle을 돌리지
않고 functional/revived 필드를 만들지 않는다.

**Probe artifact는 폐기하지 않는다.** v1.3 초안은 "row는 폐기한다"고 적었는데,
같은 문서가 freeze manifest에 per-task probe 결과를 담으라고 요구한다 — 다시
확인할 수 없는 qualification은 게이트가 아니다. 전체 probe artifact는 sealed
qualification storage에 보존하고, public freeze에는 다음을 기록한다.

```text
probe artifact digests · condition · wall_ms · stop_reason · threshold_ms · qualified
```

Probe cell은 study에서 새로 실행한다.

**Timeout은 task별이며 freeze manifest에 개별 기록된다** (§18.1의 per-task
timeout). 그러나 한 task가 떨어졌다고 그 task의 예산만 늘리는 것은 금지한다 —
예산은 §4.6의 자격 기준이 적용되는 축이고, 통과시키려고 축을 움직이면 그 task는
나머지와 다른 기준으로 뽑힌 것이 된다.

**Probe를 통과하지 못한 task는 예산을 늘려 통과시키지 않는다.** task를 줄이거나
버린다. Task를 바꾸면 그것은 **새 task revision**이다: 새 artifact digest와 새
candidate/task revision identity를 받고, 처음부터 다시 probe하며, 실패한 candidate와
그 probe는 registry에 남는다. 이전 pass/fail을 물려받지 않는다.

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

### 4.9 The edited path must carry the record (v1.3)

CDEB-P에서 **네 task 중 두 개가 ON arm에 record를 0개 전달했다.** 그 런들은
배정상 ON이고 실질은 OFF다. Intention-to-treat가 그것들을 유지하는 것은 옳지만
(§2.4), 그 결과 delivery가 행동을 바꾸는지에 대한 실제 증거는 task 하나와 런
두 건으로 줄었다.

**파일럿은 그 0이 어느 쪽이었는지 구분하지 못했다** — 훅이 발화하지 않은 것인지,
발화했으나 그 경로에 해당 record가 없었던 것인지. 파일럿 자신의 결과 문서가 그
계측 한계를 명시한다. 따라서 "원인은 task 자격 심사였다"고 말할 수 없다.

v1.3은 **두 가능성을 각각 닫는다**: §4.9가 배송 가능성을 사전 검증하고, §9.5가
opportunity를 delivery와 분리해 계측한다. 어느 쪽이 어느 task를 설명했는지는 다음
study가 답한다.

**봉인 전 검증은 실제 shipping 경로로 한다 (v1.3).** v1.3 초안은
`commitlore context P`를 쓰려 했다. 그것은 **CDEB가 측정하는 표면이 아니다.**
파일럿의 문제는 shipping delivery가 0이었던 것인데, context 조회는 injection
budget, trust grading, index behavior, lifecycle projection, hook input parsing,
shipping matcher, output parsing, product command failure 중 어느 것도 통과하지
않는다. 다른 표면에서의 성공은 그 문제를 닫지 않는다.

각 expected record와 good control이 편집하는 각 경로에 대해, **frozen ON 경로를
그대로 실행한다.**

```text
transparent proxy
  → pinned shipping `commitlore inject --hook-input`
  → frozen matcher / config / trust / index / budget
  ← synthetic shipping-valid Read|Edit|Write hook payload for that path
```

**Qualification은 forwarded shipping payload 안에 expected record ID가 실제로
나타날 때만 통과한다.** 검증은 다음을 study와 동일하게 쓴다.

```text
same product commit · same dist digest · same hook proxy
same injection budget · same trust configuration · same index policy
same repository snapshot · same hook matcher
```

`expected_edit_paths`는 **good control patch가 수정하는 파일 집합**이다 — 저자의
예상이 아니라 기계적으로 도출된다.

통과하지 못하면 task는 **거부**한다. 경로·matcher·budget·trusted author 중 어느
것도 통과시키기 위해 넓히지 않는다 — 그것은 배송 실패를 배송 성공으로 다시
정의하는 것이다.

**이 검사가 study에서의 delivery를 보장하지는 않는다.** Agent가 다른 경로를 먼저
편집하거나 matcher 밖의 도구를 쓸 수 있고, 그것은 §9.5가 기록하는 product
effectiveness다.

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

**Shipping trust 상태의 명시 (v1.2, 2026-08-11 수정):** 이 문단은 그것이 참이었을 때 쓰였다. 당시 어떤 설치 표면도 `--trusted-author`를 전달하지 않아 grading이 `[claim]`으로 fail closed했고, payload legend는 "not an instruction"이라고 말했다(#415). 그 상태는 2026-08-07 20:43에 끝났다 — v0.7.0(`a030e93`)부터 `init`은 설치한 운영자의 identity로 `commitlore.trustedAuthor`를 시드한다(`src/core/trusted-authors.ts`). 신뢰 저자가 작성한 record는 `[directive]`로 grading되고, 그 외 저자의 record만 `[claim]`으로 남는다. "shipping 설치는 `[claim]`만 전달한다"는 더 이상 제품의 성질이 아니다.

**그런데도 study가 all-`[claim]` 전달을 측정하는 이유:** study repository는 frozen bundle에서 materialize되며(§6.1), bundle은 git config를 실어 나를 수 없다. 따라서 materialize된 study repository에는 trusted author가 실제로 존재하지 않고, ON arm이 전달하는 모든 record — 운영자 저작 포함 — 는 `[claim]`으로 렌더링된다. **이것은 fixture의 성질이지 제품의 성질이 아니다**: 저 repository들에 shipping 설치가 있다면 운영자 저작 record는 `[directive]`로 grading된다. 파일럿 runner도 이 점에서 shipping install을 재현한다 — `bench/cdeb/pilot/run.ts`는 shipping install이 운영자를 trusted로 기록한다는 주석과 함께 `commitlore.trustedAuthor`를 시드한다.

측정은 자신이 측정하는 것을 정확히 말하는 조건으로 여전히 방어 가능하다. CDEB는 all-`[claim]` 전달을 측정하며, 결과 문구는 그것을 말한다 — "records delivered as `[claim]`-graded information: study repositories carry no trusted-author configuration because bundles cannot carry git config" (§17.1, §23). 문구는 `[directive]` 전달의 효과로 확장하지 않는다: study repository 밖의 shipping 설치는 운영자 저작 record를 `[directive]`로 전달하므로, `[directive]` 전달의 측정은 별도의 study가 필요하다. Shipping trust configuration이 향후 바뀌면 새로운 study가 필요하다는 규칙은 그대로다(§2.2의 product build digest 규칙에 의해 자동으로 강제된다).

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

**Opportunity와 delivery는 별개 계수이며 합쳐 세지 않는다 (v1.3).** CDEB-P의
계측은 배송된 payload만 셌고, 그래서 0이 "훅이 발화하지 않았다"인지 "훅이 발화했고
그 경로에 record가 없었다"인지 구분하지 못했다. 두 경우의 의미는 정반대다 — 앞의
것은 matcher 또는 도구 선택의 문제이고, 뒤의 것은 §4.9가 봉인 전에 배제해야 할
task 자격 문제다.

Proxy는 child를 실행할 때마다 exposure event를 쓰므로(§9.3), `hook_opportunities`는
event 수이고 `delivered_record_ids`는 그중 payload를 낸 event에서만 나온다. 두 값이
같은 소스에서 따로 계산됨을 §25.3의 테스트가 고정한다.

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
- canonical row의 `usage`는 `availability: "unavailable"`와 gap reason만 기록하며,
  raw category나 `total_token_volume` field를 함께 기록하지 않음

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

- 각 repository의 task를 그 repository의 task 수만큼 replacement로 재표집한다 (8·8·7·7이면 8·8·7·7개, 합계 30). 문자 그대로 "6개"를 쓰면 24-task replicate가 되어 §16.3의 검정력 시뮬레이션이 계산된 30을 벗어난다 — `analyze.ts`는 `stratum.length`로 재표집하므로 코드는 이미 30이다
- ON/OFF와 3 repeats는 task와 함께 이동
- 4 repositories는 항상 유지 (2026-08-19 개정, §3.3)
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

### 16.4 Token-efficiency gate — 고정 문턱값, 서술적 보정 (v1.3)

**문턱값은 15%로 유지한다.** v1.3 초안은 이것을 측정된 overhead의 함수로 만들려
했고, 그 공식은 대수적으로 틀렸다. §15.2의 정의에서

```text
o = T_on / T_off        q = S_on / S_off
TokenVolumeReduction R = 1 - o/q
```

이므로 **overhead는 이미 R 안에 들어 있다.** 문턱값을 다시 o의 함수로 만들면
overhead를 두 번 세게 된다:

```text
R >= 1 - 1/(1.15·o)   ⟺   q >= 1.15·o²
o = 1.45  →  q >= 2.418  →  대조군 50%일 때 ON은 120.9%   (불가능)
```

고정 15%가 요구하는 것은 그것이 아니다:

```text
R >= 0.15   ⟺   q >= o/0.85
o = 1.45  →  q >= 1.706  →  대조군 50%일 때 ON은 85.3%   (엄격하지만 가능)
```

**원래 진단도 부분적으로 틀렸다.** 15% 게이트는 "도달 불가능"했던 것이 아니라,
ON arm이 토큰을 45% 더 쓰기 때문에 **엄격**했던 것이다. 45% 더 쓰고도 결과당
15% 덜 쓰려면 성공률이 크게 올라야 한다 — 그것은 게이트의 결함이 아니라 참인
사실이다. 문턱값을 낮추면 다른 것을 재게 된다.

**CalibratedOverhead는 서술적이며, 추론 문턱값이 아니다.**

```text
CalibratedOverhead = T_on / T_off   측정: §22.4 disposable smoke tasks
```

freeze manifest에 기록하고 §23 report에 표시한다. 용도는 하나뿐이다 — 이 게이트가
달성되려면 어느 정도의 성공률 상승이 필요한지를 **실행 전에 알려주는 것**:

```text
FeasibilityNote:  q >= CalibratedOverhead / 0.85
```

이 값은 게이트를 통과시키거나 실패시키지 않는다. 어떤 문턱값도 결정하지 않는다.
Smoke task는 corpus가 아니고, 전체 agent session의 토큰 비율은 순수한 주입
overhead가 아니라 탐색 행동·턴 수·provider cache 효과를 모두 포함하므로, 추론에
쓸 수 있는 양이 아니다.

허용 조건:

```text
TokenVolumeReduction >= 0.15
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

### 16.6 Three separate headline gates (v1.3)

v1.2는 세 게이트의 AND 하나만 두었고, v1.3 초안은 token을 빼면서 §17.1의 문장은
그대로 두었다. 그 상태에서는 **token gate가 FAIL인데도 "Y% 적은 토큰"을 주장하는
문장이 생성될 수 있었다.** 이제 게이트를 세 개로 분리하고, 각 게이트가 허용하는
문구를 각각 고정한다.

```text
CoreBehaviorHeadline = Performance PASS AND Mechanism PASS
TokenClaim           = Token PASS
CombinedHeadline     = Performance PASS AND Mechanism PASS AND Token PASS
```

| 게이트 | 언급할 수 있는 것 |
|---|---|
| `CoreBehaviorHeadline` | X percentage points (성능), Z% (revival) **만** |
| `TokenClaim` | Y% (토큰) **만** |
| `CombinedHeadline` | X, Y, Z 전부 — §17.1의 문장은 **이 게이트에서만** 생성된다 |

**행동 headline 옆에는 언제나 Token PASS / FAIL / NOT MEASURABLE을 붙인다.**

v1.3 초안은 이 변경을 "게이트를 느슨하게 만들지 않는다"고 적었다. 그것은 논리적으로
거짓이다: `P ∧ M`은 `P ∧ T ∧ M`보다 **엄격하게 약하고**, T의 문턱값을 어떻게 하든
그 사실은 바뀌지 않는다. 바뀐 것은 세 지표가 각자의 게이트를 갖는다는 점이고,
약해진 것은 `CoreBehaviorHeadline`이 token 결과와 무관해졌다는 점이다. 그 대신
`CombinedHeadline`이 v1.2의 conjunction을 그대로 보존한다.

### 16.7 Interpretation limit

CDEB는 이 frozen corpus에서 큰 상업적으로 의미 있는 효과를 인증하도록 설계됐다.

Gate 실패는 더 작은 효과가 전혀 없음을 증명하지 않는다.

**Gate가 검출할 수 있는 효과의 바닥 (CDEB-P preregistration 시뮬레이션).** §16.3의 registered analysis — 30 tasks, 3 repeats, paired task bootstrap, ≥10pp 문턱값과 CI lower bound > 0 규칙 — 를 시뮬레이션한 결과다(`bench/cdeb/PREREGISTRATION-CDEB-P.md`).

| true lift | P(gate 통과) · OFF=0.40 | P(gate 통과) · OFF=0.55 |
|---:|---:|---:|
| **10pp** (문턱값 자체) | **0.30** | **0.31** |
| 15pp | 0.55 | 0.58 |
| **20pp** | **0.78** | **0.84** |
| 25pp | 0.93 | 0.96 |
| 30pp | 0.98 | 0.99 |

참 효과가 문턱값(10pp)에 정확히 걸쳐 있어도 gate는 열에 일곱 번 실패하고, 80% 통과에는 약 20pp가 필요하다. 이 study가 인증하는 효과는 대략 20pp 이상이다. Performance gate FAIL을 "효과 없음"으로 읽는 것은 이 검출 바닥을 무시한 오독이다 — FAIL은 검출 가능한 효과의 바닥 아래 효과를 배제하지 않는다.

CI는 4 fixed repositories / 30 tasks 내의 task-resampling stability를 표현하며 모든 software repository의 population CI로 해석하지 않는다.

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

### 17.1 CombinedHeadline 통과 — X, Y, Z 전부 (v1.3)

**아래 문장은 `CombinedHeadline`에서만 생성된다** (§16.6). Token gate가 FAIL이거나
NOT MEASURABLE이면 이 문장은 생성되지 않으며, `CoreBehaviorHeadline`의 X·Z 문장이
그 자리를 대신하고 Token 상태가 그 옆에 표시된다.

> Across 30 frozen decision-sensitive tasks from four named repositories, the same pinned coding agent with CommitLore produced **X percentage points more first-pass patches that worked without reviving a previously rejected decision**, used **Y% less provider-reported task-execution token volume per decision-safe success**, and revived rejected approaches **Z% less often** than the same agent with ordinary Git access.

항상 바로 옆에 표시:

```text
30 tasks · 4 repositories · 90 runs per condition
one pinned model and agent harness
corpus independence tier
records delivered [claim]-graded — fixture property, not product: bundles carry no trusted-author git config (§9.2); a shipping install grades owner-authored records [directive]
delivery surface only; capture surface disabled in both arms
```

### 17.2 Partial gates

통과한 metric만 개별 주장한다.

- Performance만 통과 → first-pass lift만 주장
- Token만 통과 → task-execution token volume per safe success만 주장
- Mechanism만 통과 → rejected-decision revival만 주장
- **Performance + Mechanism 통과, Token 미통과 → `CoreBehaviorHeadline`.** X와 Z만
  말하고 Y는 어떤 형태로도 말하지 않으며, Token FAIL / NOT MEASURABLE을 그 옆에
  표시한다 (v1.3, §16.6)

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
- Token gate가 FAIL 또는 NOT MEASURABLE인데 토큰 절감을 언급 (v1.3, §16.6)

────────

## 18. Freeze protocol

### 18.1 Freeze manifest

Measured run 전에 다음을 고정한다.

```text
protocol source and digest
candidate registry commitment
sealed task bundle commitment
4 repository bundle digests
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
calibrated overhead (descriptive; sets no threshold) and the fixed 15% token threshold (v1.3, §16.4)
per-task wall-clock probe results (v1.3, §4.6)
per-task path-carries-record verification (v1.3, §4.9)
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
  "protocol_version": "1.3.0",
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
    "availability": "measured",
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
30 frozen decision-sensitive tasks · 4 named repositories · 180 fresh runs
Same pinned model · same agent harness · byte-identical repository states
90 runs per condition · corpus independence tier A/B
Records delivered [claim]-graded — fixture property, not product (§9.2) · delivery surface only

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
Mechanism               PASS / FAIL / OPPORTUNITY FAILURE
Token efficiency        PASS / FAIL / NOT MEASURABLE
  Calibrated overhead   __ (descriptive; sets no threshold)
  Feasibility note      q >= overhead / 0.85

Core behavior headline  PASS / FAIL   (performance AND mechanism -- X and Z only)
Token claim             PASS / FAIL / NOT MEASURABLE   (Y only)
Combined headline       PASS / FAIL   (all three -- the only gate that may say X, Y and Z)
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
- wall-clock probe가 timeout이거나 예산의 60%를 넘긴 task는 reject (v1.3, §4.6)
- good control이 편집하는 경로 중 어느 것도 expected record를 렌더링하지 않는 task는 reject (v1.3, §4.9)
- overhead calibration 없이 token gate를 평가하려는 시도는 reject (v1.3, §16.4)
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
- a hook that fires on a path with no records reports opportunity 1 and zero delivered ids, distinguishably from a hook that never fired (v1.3, §9.5)

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

### CDEB-00 · Land v1.3 protocol and locked contracts

Scope

- 본 PRD
- protocol constants
- cutoff/freeze semantics
- claim wording

Acceptance

- v1.0, v1.1, v1.2 superseded 표시
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
- three metrics + TokenVolumeReduction at the fixed 0.15 threshold
- 10,000 paired stratified bootstrap (ratio-of-sums TVPDSS)
- three separate claim gates (§16.6)
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
- ☐ 4 repositories / 30 tasks
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
2. matrix는 4 repositories / 30 tasks / 180 runs다.
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

본 v1.3은 v1.1과 v1.2가 닫은 것을 유지하고, CDEB-P가 실행으로 드러낸 것과 그 1차 수정안이 스스로 만든 결함을 닫는다.

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

**v1.3이 닫은 것 — 파일럿이 측정해서만 나온 것:**

- 아무도 측정하지 않고 고른 15% 토큰 문턱값 → §16.4에서 15% 고정을 유지하고, 측정 overhead는 문턱값을 결정하지 않는 서술적 FeasibilityNote로만 기록
- 가장 도달 불가능한 게이트가 나머지를 거부하던 3중 conjunction → §16.6에서 headline을 세 게이트로 분리해 token이 행동 headline을 지우지 못하게 하고, v1.2의 3중 conjunction은 `CombinedHeadline`에 그대로 보존
- 확인할 방법 없이 바라기만 하던 "한 세션 안에 완료 가능" → §4.6 wall-clock probe
- record가 존재하기만 하면 통과하던 task 자격 → §4.9 경로가 실제로 그것을 나르는지 기계 검증
- opportunity와 delivery를 합쳐 세던 계측 → §9.5 분리 요구 + §25.3 테스트

Implementation status: **Approved**
