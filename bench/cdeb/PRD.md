---
document_id: commitlore-cdeb-fresh-v3-enterprise-final-prd
document_version: 3.0.0
review_date: 2026-08-20
repository: MongLong0214/commitlore
audit_snapshot_main_sha: 42cb032823a9c2078d9dcc8e0f0f6bf25d58c32e
current_release_at_review: v1.2.0
measured_release: latest stable release at freeze
study_id: cdeb-fresh-v3
status: implementation-ready
measured_run_status: no-go-until-all-freeze-gates-pass
human_operator_count: 1
external_people_required: 0
execution_mode: solo-owner-plus-isolated-multi-agent-roles
evidence_tier: Tier B — author-operated, multi-agent internally replicated
primary_estimand: equal-repository-weighted decision-safe first-pass success difference
headline_estimand: functionally viable revival relative reduction
supersedes_for_future_runs:
  - COMMITLORE_CDEB_FRESH_V2_FINAL_PRD_2026-08-20.md
  - bench/cdeb/PRD.md v1.3
  - CDEB-P as a product-effect study
preserves_as_history:
  - current README benchmark results
  - bench/cdeb/PREREGISTRATION-CDEB-P.md
  - bench/cdeb/RESULT-CDEB-P.md
  - all prior raw rows and deviations
---

# CommitLore CDEB-Fresh v3 엔터프라이즈 최종 PRD

> **연구 목적**
>
> 최신 안정 릴리스의 실제 shipping decision-delivery 경로를 사용해, 완전히 새로 만든 real-repository task와 fresh agent session에서 CommitLore가 **기능적으로 가능한데 저장소가 이미 기각한 접근을 다시 선택하는 현상**을 줄이는지 검증한다.
>
> **사용자에게 필요한 최종 숫자**
>
> ```text
> CommitLore가 반복된 나쁜 판단을 X% 줄였다.
> ```
>
> 이 숫자는 과거 benchmark row를 재가공해서 만들지 않는다. 새 repository snapshot, 새 task, 새 gold, 새 oracle, 새 session, 새 trajectory, 새 randomization으로 독립적으로 재현한다.
>
> **운영 제약**
>
> 외부 연구자·개발자·annotator를 고용하지 않는다. 사용자는 유일한 human study owner이고, 서로 격리된 여러 AI agent가 annotation·red-team·분석·재현 역할을 수행한다. 이 구조는 내부 역할 독립성을 높이지만 **독립 외부 검증**은 아니다.
>
> **핵심 과학 원칙**
>
> ```text
> record exists
> ≠ delivered
> ≠ used
> ≠ obeyed
> ≠ functionally successful
> ≠ reviewer no longer needs to repeat the rejection
> ```
>
> 각 고리를 따로 측정하고, randomized ON/OFF ITT만 causal headline으로 사용한다.

---

## 0. Executive decision

### 0.1 단 하나의 중심 질문

> **동일한 model, agent harness, task, repository snapshot에서 CommitLore의 최신 shipping decision context를 자동 전달했을 때, 전달하지 않은 경우보다 functionally viable rejected-decision revival이 줄어드는가?**

쉽게 말하면:

> **CommitLore를 켜면, 테스트는 통과하지만 이미 기각된 접근을 에이전트가 다시 구현하는 일이 실제로 줄어드는가?**

### 0.2 연구가 성공해도 주장하지 않는 것

```text
모든 coding task가 빨라진다
모든 model과 host에서 효과가 같다
모든 decision이 자동으로 포착된다
CommitLore가 모든 나쁜 판단을 막는다
CommitLore가 universal token saving을 만든다
네 repository가 industry population을 대표한다
```

### 0.3 왜 새 confirmatory study가 필요한가

현재 README의 historical result:

```text
CommitLore OFF  109/579 = 18.8%
CommitLore ON    16/580 = 2.8%

historical relative reduction ≈ 85.3%
```

효과 크기는 강하다. 그러나 다음 경계가 있다.

```text
one model
one harness
constructed tasks
historical product surface
planned matrix completeness manifest 부재
paired design에 맞지 않는 Fisher exact headline
latest release에서 fresh reproduction 없음
```

CDEB-P도 product claim에 사용할 수 없다.

```text
4 tasks / 16 runs
2 tasks delivery 0
1 task delivered but revival
1 task timeout
invalid no-op oracle controls
```

v3의 역할:

```text
historical evidence
→ planning prior와 regression reference

CDEB-Fresh v3
→ latest product의 prospective confirmatory evidence
```

Historical rows는 v3 analysis에 0개 들어간다.

### 0.4 연구 프로그램

#### Phase A — Literature and instrument lock

```text
original paper verification
claim-to-source evidence matrix
fresh corpus
gold
oracle controls
runtime qualification
```

#### Phase B — Instrument pilot

```text
12 fresh tasks
3 per repository
2 arms
2 fresh runs per arm
= 48 pilot runs
```

Pilot task는 confirmatory corpus에서 영구 제외한다.

#### Phase C — Confirmatory study

최종 task 수는 result를 보기 전에 executable power selection으로 고정한다.

```text
N ∈ {48, 64, 80} fresh tasks
× 2 arms
× 2 fresh runs per arm

N=48 → 192 runs
N=64 → 256 runs
N=80 → 320 runs
```

Pilot에서 arm labels를 감춘 nuisance estimates와 사전등록된 conservative simulation grid만 사용해 N을 선택한다.

### 0.5 Main arms

```text
ON   latest-release shipping delivery
OFF  identical hook/proxy path, model-visible payload suppressed
```

두 arm 외에는 main study에 추가하지 않는다.

```text
RAG
BM25
embedding
claim/directive manipulation
multiple models
multiple hosts
LLM judge
capture write-side
```

Grade와 lifecycle contrast는 main result가 병목을 확인했을 때 별도 preregistration으로만 연다.

### 0.6 최종 산출물

```text
canonical PRD
literature source lock
evidence matrix
role manifest
fresh candidate registry
gold/source packets
task/oracle/control bundles
pilot report
power report
public freeze
raw append-only rows
independent analysis reproduction
blind patch re-explanation audit
final RESULT.md
README claim patch or HOLD report
```

---

## 1. Research charter

### 1.1 제품이 다루는 문제

```text
코드에는 결과가 남음
기각 이유는 채팅·리뷰·사람 머리에 남음
세션이 끝남
다음 agent는 코드만 봄
로컬로 쉬운 기각안을 다시 선택
기능과 테스트는 통과
리뷰어가 같은 이유로 다시 거절
```

측정 대상은 일반 bug가 아니다.

```text
works, but violates repository judgment
```

이다.

### 1.2 Architectural knowledge vaporization과 제품 이론

Foundational architecture literature는 design decision과 rationale가 architecture의 first-class representation이 아니면 지식이 구현 안으로 사라지는 현상을 설명한다.

CDEB-Fresh가 검증하는 것은 그 현상 자체가 아니다.

다음 product-specific causal chain이다.

```text
historical decision exists
→ current code alone does not expose the reason
→ rejected path remains locally viable
→ latest CommitLore delivers active decision
→ agent changes implementation choice
→ functional patch respects repository judgment
→ reviewer does not need to repeat the rejection
```

### 1.3 Causal graph

```text
Randomized assignment
        │
        ▼
Hook opportunity
        │
        ▼
Expected record delivery
        │
        ├── grade / budget / lifecycle / coverage
        ▼
Latent uptake
        │
        ├── explicit uptake proxy
        ▼
Behavioral honor
        │
        ▼
Functional result
        │
        ▼
Decision-safe first-pass success
        │
        ▼
Blind patch re-explanation audit
```

Causal headline:

```text
assignment → final outcome
```

Mechanism-only, non-causal descriptions:

```text
delivery subset
explicit uptake subset
grade subgroup
temptation subset
```

### 1.4 Target population

결과는 모든 coding task가 아니라 다음 conditional population을 겨냥한다.

```text
real repository snapshot
historical active decision
decision reason not obvious from current code
functionally viable rejected path
fresh agent can plausibly choose it
record can be delivered to relevant path
```

### 1.5 Primary estimand

Repository \(j\), task \(t\), arm \(a\), repeat \(r\):

\[
Y_{j,t,a,r}
=
1[
completed
\land functional\_pass
\land \neg revived
]
\]

Task arm mean:

\[
\bar{Y}_{j,t,a}
=
\frac{1}{R}\sum_rY_{j,t,a,r}
\]

Repository effect:

\[
\Delta_j
=
\frac{1}{T_j}
\sum_t
(
\bar{Y}_{j,t,ON}
-
\bar{Y}_{j,t,OFF}
)
\]

Primary equal-repository estimand:

\[
\Delta_{ER}
=
\frac{1}{4}\sum_{j=1}^{4}\Delta_j
\]

네 repository를 fixed named strata로 보고 같은 가중치를 준다.

Task-weighted effect는 secondary sensitivity다.

### 1.6 Key secondary estimand

Functionally Viable Revival:

\[
FVR_{j,t,a,r}
=
1[
functional\_pass
\land revived
]
\]

Primary와 같은 equal-repository 방식으로 ON-OFF absolute difference를 계산한다.

### 1.7 Marketing transform

Repeated Bad Decision Reduction:

\[
RBDR
=
1 -
\frac{FVRRate_{ON}}{FVRRate_{OFF}}
\]

반드시 함께 공개한다.

```text
OFF raw rate and count
ON raw rate and count
absolute percentage-point difference
relative reduction
95% interval
```

상대 감소율만 단독 표기하지 않는다.

### 1.8 Non-goals

```text
general code quality score
human aesthetic score
all-model generalization
all-host generalization
capture recall
multi-session relay
dollar saving
general productivity
RAG leaderboard
reframing frequency percentage
```

---

## 2. Literature audit protocol

### 2.1 Source policy

Load-bearing external claim은 반드시 다음 중 하나를 사용한다.

```text
original arXiv PDF, exact version
publisher PDF
author/institution publication page
original dataset repository
```

금지:

```text
blog summary
social post
search snippet
secondary explainer
AI-generated paper summary
```

Secondary source는 discovery에만 사용할 수 있다.

### 2.2 Source lock

각 source를 freeze 전에 다운로드하고 SHA-256을 기록한다.

```json
{
  "source_id": "LIT-SWE-CONTEXT",
  "title": "SWE Context Bench: A Benchmark for Context Learning in Coding",
  "source_kind": "arxiv",
  "identifier": "2602.08316",
  "version": "v3",
  "downloaded_at": "ISO-8601",
  "sha256": "64-hex"
}
```

Paper version이 달라지면 숫자를 섞지 않는다.

### 2.3 Verdict vocabulary

```text
SUPPORTED
→ 원문의 scope와 숫자가 문장에 정확히 대응

SUPPORTED_WITH_SCOPE
→ 방향은 맞지만 task/model/subset/version 경계를 붙여야 함

OVERSTATED
→ 원문보다 범위를 넓히거나 average와 tail을 혼동

MISATTRIBUTED
→ 숫자나 결론의 source가 다른 paper

NOT_CAUSAL
→ association/ablation을 causal general law로 표현

NOT_LOAD_BEARING
→ motivation에는 유용하지만 CommitLore 효과 증거가 아님
```

### 2.4 Evidence matrix

#### A. Architectural knowledge and ADRs

| ID | 제공된 문서의 주장 | 원문 근거 | 검증 | 안전한 해석 | CDEB-Fresh 반영 | 과잉해석 방지 |
|---|---|---|---|---|---|---|
| AK-01 | Architectural knowledge vaporization은 architecture decision 지식이 사라지는 문제다 | Jansen & Bosch, WICSA 2005, DOI 10.1109/WICSA.2005.61, abstract/§1–2 | **SUPPORTED_WITH_SCOPE** | Design decisions와 rationale가 first-class representation이 아니면 architecture 안으로 사라진다는 conceptual argument | 제품 theory-of-change의 motivation | 빈도·비용·CommitLore 효과를 이 paper가 측정했다고 쓰지 않음 |
| AK-02 | 코드에는 결과가 남고 기각 이유는 증발한다 | Jansen & Bosch의 decision-centric architecture 논지; Tofan et al. 2011의 vaporization framing | **SUPPORTED_WITH_SCOPE** | 현재 코드가 모든 rationale를 직접 드러내지 않는다는 이론적 근거 | candidate의 `hidden rationale` 조건 | 모든 codebase에서 이유가 사라진다고 일반화 금지 |
| AK-03 | AK vaporization은 maintenance cost를 높인다 | Tofan, Galster, Avgeriou 2011, “Reducing Architectural Knowledge Vaporization…” abstract/study | **SUPPORTED_WITH_SCOPE** | Decision documentation 부족이 유지보수 위험과 연결됨; 평가 context는 제한적 | human consequence motivation | 대규모 산업 causal estimate로 쓰지 않음 |
| ADR-01 | ADR adoption은 여전히 낮다 | Buchgeher et al., IEEE Access 2023, DOI 10.1109/ACCESS.2023.3287654 | **SUPPORTED** | ADR 사용 repository 중 약 절반이 1–5 ADR만 보유; systematic use는 team activity | capture UX의 adoption motivation | CommitLore adoption이 자동으로 높다고 추론 금지 |
| ADR-02 | ADR 채택이 낮은 이유는 manual effort다 | DRAFT abstract는 manual effort와 tool support 부족을 배경으로 명시; Buchgeher MSR은 low adoption을 측정 | **SUPPORTED_WITH_SCOPE** | Manual effort는 문헌상 제시된 설명이지만 MSR 자체가 causal cause를 입증하지 않음 | automatic capture 연구와 분리된 product rationale | “MSR이 manual effort causality를 증명”이라고 쓰지 않음 |
| DRAFT-01 | DRAFT는 4,911 ADR을 사용했다 | Dhar et al., arXiv:2504.08207v1, abstract/§4.1 | **SUPPORTED** | Preprocessing 후 4,911 ADR dataset으로 ADD generation을 평가 | historical capture-generation landscape | 현재 authority/lifecycle/delivery 증거로 사용 금지 |
| DRAFT-02 | DRAFT가 모든 면에서 가장 좋았다 | 자동 metric table에서는 강함; human evaluation은 model별 반복성·만족도 차이와 mixed preference를 보고 | **OVERSTATED** | Automated metric에서는 우수했지만 human evaluation과 efficiency 결과는 단일 승자가 아님 | CDEB가 automated metric만으로 제품 claim을 만들지 않음 | “LLM이 ADR을 정확히 자동 생성”으로 확대 금지 |
| DRAFT-03 | DRAFT는 decision 생성 문제를 다룬다 | arXiv:2504.08207v1, method/evaluation | **SUPPORTED** | Decision Context에서 Design Decision draft를 생성 | CommitLore 차별점은 generation 이후의 lifecycle·delivery임을 명시 | generation result를 current authority로 혼동 금지 |
| DRAFT-04 | Fully autonomous final decisions가 권장된다 | Conclusion은 human-in-the-loop와 architect support를 권장 | **OVERSTATED** | DRAFT는 architect aid로 제시됨 | CDEB gold와 oracle에 owner sign-off 유지 | autonomous model judgment를 ground truth로 취급 금지 |

#### B. Context selection and memory

| ID | 제공된 문서의 주장 | 원문 근거 | 검증 | 안전한 해석 | CDEB-Fresh 반영 | 과잉해석 방지 |
|---|---|---|---|---|---|---|
| SWE-01 | SWE-ContextBench는 1,100 base + 376 related tasks, 51 repos, 9 languages다 | arXiv:2602.08316v3, Table 1/§2.2.5 | **SUPPORTED** | v3 full benchmark 규모 | literature scope | Lite 99-task result와 full 376 result를 혼합 금지 |
| SWE-02 | no-context 26.26%, free context 26.26%, oracle full 27.27%, free summary 22.22%, oracle summary 34.34% | arXiv:2602.08316v3, Table 4, SWE-ContextBench Lite 99 tasks | **SUPPORTED** | Claude Sonnet 4.5, 99 Lite related tasks의 exact result | context quality와 selection을 mechanism으로 분리 | universal agent effect로 일반화 금지 |
| SWE-03 | Oracle summary는 baseline보다 +8.08pp, free summary는 오히려 낮다 | Table 4/§3.3.1 | **SUPPORTED** | Correctly selected compact summary는 이 setting에서 도움, autonomous summary는 해로움 | expected ruling visibility·budget qualification | “summary는 항상 좋다” 금지 |
| SWE-04 | 어려운 task에서 runtime이 60% 이상 감소했다 | arXiv v3 difficulty-tail analysis | **SUPPORTED_WITH_SCOPE** | Slowest/hardest tail에서 60%+; average table의 일반 runtime 감소가 아님 | cost는 heterogeneity로만 보고 | average 60% 감소 headline 금지 |
| SWE-05 | Summary reuse가 평균 token cost를 줄였다 | Table 4와 appendix: cache read 비중이 매우 높고 oracle summary average cost는 baseline보다 낮지 않음 | **OVERSTATED** | 일부 hard-task tail의 효율 이득과 average cost는 구분해야 함 | token을 primary/headline에서 제외 | “context = token saving” 금지 |
| SWE-06 | 틀린·unfiltered context는 제한적 또는 negative benefit을 만든다 | abstract, Table 4, appendix analysis | **SUPPORTED_WITH_SCOPE** | 해당 retrieval/summary setup에서 관찰 | stale-as-current=0, critical ruling visible | 모든 memory/RAG가 해롭다고 일반화 금지 |
| SWE-07 | Context를 전달하면 agent가 따른다 | Oracle/free gaps와 low absolute resolution이 반례 | **OVERSTATED** | Delivery와 application은 별개 | delivery·explicit uptake·behavior honor 분해 | delivery를 compliance evidence로 사용 금지 |
| CTIM-01 | CTIM-Rover는 어떤 configuration에서도 AutoCodeRover를 이기지 못했다 | Lindenbauer et al., arXiv:2505.23422v1, Table 1 | **SUPPORTED_WITH_SCOPE** | 45-sample studied configuration에서 no improvement | memory-noise risk와 minimal payload motivation | 모든 episodic memory가 실패한다고 쓰지 않음 |
| CTIM-02 | Episodic memory는 knowledge가 아니라 noise다 | authors’ qualitative analysis/hypothesis | **NOT_CAUSAL** | Distracting CTIM items/exemplars가 likely cause로 제시됨 | overdelivery/stale/noise metrics | noise가 유일한 causal mechanism이라고 단정 금지 |
| CTIM-03 | Memory arm은 token도 더 썼다 | token table: baseline 대비 CTIM configurations 증가 | **SUPPORTED_WITH_SCOPE** | 해당 45-sample experiment의 provider usage | raw token categories 공개 | CommitLore token overhead 수치로 대체 금지 |

#### C. Commit history and causal research

| ID | 제공된 문서의 주장 | 원문 근거 | 검증 | 안전한 해석 | CDEB-Fresh 반영 | 과잉해석 방지 |
|---|---|---|---|---|---|---|
| CR-01 | Code Researcher는 GPT-4o에서 48% vs SWE-agent 31.5%였다 | Singh et al., arXiv:2506.11060v2, main result table | **SUPPORTED_WITH_SCOPE** | v2의 pinned model/benchmark result | historical context can matter | Microsoft older page의 58%/37.5와 v2 숫자를 섞지 않음 |
| CR-02 | Code Researcher는 약 10 files, SWE-agent는 1.33 files를 탐색했다 | arXiv v2 analysis | **SUPPORTED** | Systems crash benchmark의 trajectory exploration | files-read를 secondary로 기록 | 많은 files가 항상 좋다고 결론 금지 |
| CR-03 | Commit history의 causal analysis가 중요하다 | `search_commits` ablation: previously solved 96-bug subset에서 48→38 | **SUPPORTED_WITH_SCOPE** | 조건부 solved subset에서 history tool removal이 성능을 낮춤 | local Git history를 OFF에서도 유지; delivery만 조작 | 전체 benchmark causal effect 또는 CommitLore effect로 변환 금지 |
| CR-04 | Filtering memory가 품질을 올렸다 | 21,557→7,797 filtering; 20-sample ablation 10→8/recall 감소 | **SUPPORTED_WITH_SCOPE** | 작은 exploratory ablation이 filtering utility를 지지 | path/lifecycle payload qualification | 20-sample result를 general law로 쓰지 않음 |
| CR-05 | Code Researcher가 general coding agent에 일반화된다 | paper scope는 systems crashes와 supplementary multimedia setting | **OVERSTATED** | Large systems/code-history setting의 evidence | CDEB는 named repositories와 decision-sensitive tasks에 한정 | general coding productivity claim 금지 |

#### D. Agentic pull-request failures

| ID | 제공된 문서의 주장 | 원문 근거 | 검증 | 안전한 해석 | CDEB-Fresh 반영 | 과잉해석 방지 |
|---|---|---|---|---|---|---|
| PR-01 | 33k agent PR 연구는 33,596 PR, overall merge 71.48%를 분석했다 | Ehsani et al., arXiv:2601.15195v1, dataset/RQ1 | **SUPPORTED** | Five agents의 GitHub PR population | real-world repository alignment motivation | CommitLore addressable frequency로 사용 금지 |
| PR-02 | documentation 84%, CI 79%, build 74%, performance 55%, fix 64% | RQ1 task-type results | **SUPPORTED_WITH_SCOPE** | paper’s category-level merge rates | decision-sensitive study가 generic SWE-bench와 다름을 설명 | causal difficulty 순위로 일반화 금지 |
| PR-03 | Duplicate 142건, paper가 23%로 보고했다 | RQ2 taxonomy | **SUPPORTED_WITH_SCOPE** | Duplicate는 주로 이미 열린/진행 중인 PR과 중복 | repository-state awareness motivation | “과거에 기각한 architecture를 재구현”과 동일시 금지 |
| PR-04 | Unwanted feature 24건(4%) | RQ2 taxonomy | **SUPPORTED** | Project가 원하지 않는 change category | repository judgment relevance | CommitLore가 이 24건을 막았을 것이라 추정 금지 |
| PR-05 | Reviewer abandonment 228건(38%) | RQ2 taxonomy | **SUPPORTED_WITH_SCOPE** | Meaningful reviewer interaction 없이 닫힌 category | review consequence motivation | re-explanation과 동일 사건으로 취급 금지 |
| PR-06 | Review comments/revisions의 effect size가 작다 | RQ1 effect-size/regression analysis | **SUPPORTED_WITH_SCOPE** | 해당 observational metrics는 merge prediction에서 제한적 | raw review count 대신 binary re-explanation audit | “review가 무의미하다” 금지 |
| PR-07 | 33k paper가 historical rejected decisions의 빈도를 측정했다 | taxonomy definition에는 해당 construct가 없음 | **MISATTRIBUTED** | Repo alignment problem은 보이지만 CDEB construct frequency는 미측정 | CDEB task distribution을 conditional로 명시 | 23%를 market size로 사용 금지 |
| PR2-01 | AIDev fix PR 중 46.41%가 rejected, 306개 sample을 분석했다 | Abujadallah et al., arXiv:2606.13468v1 | **SUPPORTED** | 3,225 fix PR 중 1,497 rejected; 306 non-merged sample | supplementary real-world rejection motivation | 33k paper의 142/228 수치 source로 혼동 금지 |
| PR2-02 | Paper는 hints, forbidden constraints, validation guidance를 권장한다 | conclusion/implications | **SUPPORTED_WITH_SCOPE** | Authors’ design implication | active constraints와 ruled-out decisions의 relevance | CommitLore efficacy proof로 사용 금지 |
| PR2-03 | “Wrong approach”가 CommitLore revival과 동일하다 | taxonomy가 더 넓고 source semantics가 다름 | **OVERSTATED** | 일부 concept overlap만 있음 | human consequence codebook 참고 | category count를 expected CDEB rate로 사용 금지 |

### 2.5 Literature-derived design decisions

| Literature signal | CDEB-Fresh v3 decision |
|---|---|
| Decision rationale can vaporize | Gold requires an ordinary-source rationale absent from current code |
| ADR generation is not authority | CDEB does not score record generation; it scores current delivery and behavior |
| Correct compact context can help | Critical ruling visibility and budget qualification are mandatory |
| Wrong/unfiltered context can hurt | Stale-as-current must be zero; full payload is logged |
| Delivery does not imply application | Opportunity, delivery, uptake proxy, honor, success are separate |
| Filtered history can matter | OFF keeps ordinary Git; ON differs only by shipping decision delivery |
| Agent PRs fail through repository misalignment | Wrong path must be functionally viable and repository-inconsistent |
| Reviewer abandonment is not re-explanation | Patch re-explanation is measured with its own blinded codebook |
| Context can add token cost | Token saving is secondary, never a required product claim |

### 2.6 Literature evidence artifact

Implementation must create:

```text
bench/cdeb/studies/cdeb-fresh-v3/literature/
├── source-lock.json
├── evidence-matrix.json
├── evidence-matrix.md
└── audits/
    ├── auditor-a.json
    ├── auditor-b.json
    └── adjudication.json
```

CI requirements:

```text
all load-bearing claims have original source
source version and SHA-256 present
matrix verdict in closed vocabulary
PRD table generated from evidence-matrix.json
no unresolved auditor disagreement
```

---

## 3. Solo owner + multi-agent governance

### 3.1 External people requirement

```text
external humans required: 0
human operator: 1
```

사용자는:

```text
study owner
repository authorization holder
freeze authority
blind disagreement adjudicator
publication approver
```

이다.

여러 AI agent는 role-isolated internal reviewers다.

### 3.2 Evidence label

허용:

> **Author-operated, multi-agent internally replicated confirmatory study**

금지:

```text
independent external validation
third-party validation
externally audited
multi-institutional study
```

### 3.3 Independence dimensions

```text
session independence
→ fresh context per role

model-family diversity
→ annotation/review pair는 가능하면 서로 다른 model family

information independence
→ 역할별 forbidden inputs

implementation independence
→ secondary analyzer는 primary analyzer source를 보지 않음

organizational independence
→ 없음; 반드시 Tier B로 공개
```

### 3.4 Mandatory roles

| Role ID | 역할 | 허용 입력 | 금지 입력 | 산출물 |
|---|---|---|---|---|
| `LIT-A` | Literature auditor A | original PDFs | 제공된 문서의 conclusion, LIT-B output | claim extraction |
| `LIT-B` | Literature auditor B | original PDFs | LIT-A output | independent extraction |
| `LIT-C` | Literature adjudicator | A/B disagreement + source spans | product desired conclusion | final evidence row |
| `SRC` | Source-packet curator | ordinary repo sources | CommitLore records, treatment results | redacted source packet |
| `GOLD-A` | Gold annotator A | source packet | GOLD-B, record payload | annotation A |
| `GOLD-B` | Gold annotator B | source packet | GOLD-A, record payload | annotation B |
| `GOLD-C` | Gold adjudicator | disagreements + source packet | future arm result | resolved gold |
| `TASK` | Task author | base tree + maintenance-need contract | record text, oracle controls, run results | neutral task prompt |
| `LEAK` | Leakage auditor | task prompt + base tree + old benchmark index | arm results | pass/drop report |
| `ORACLE` | Oracle engineer | frozen gold + task + hidden fixture | arm, delivery logs, trajectories | evaluator + controls |
| `REDTEAM` | Oracle red-team | evaluator + controls | arm/result | attack report |
| `FREEZE` | Runtime/freeze agent | qualified artifacts | model outcome | public freeze |
| `RUN` | Run operator | sealed manifest | gold/oracle source | raw rows |
| `STAT-A` | Primary statistician | frozen rows + SAP | narrative conclusion | analysis A |
| `STAT-B` | Independent reproducer | frozen rows + formulas only | STAT-A code/report | analysis B |
| `PATCH-A` | Re-explanation reviewer A | blind task+diff+source summary | arm, delivery, transcript | review A |
| `PATCH-B` | Re-explanation reviewer B | blind task+diff+source summary | PATCH-A, arm | review B |
| `OWNER` | Human owner | blind disagreement bundles | arm until applicable freeze | adjudication/sign-off |

### 3.5 Model-family requirement

Top-tier internal gate:

```text
GOLD-A and GOLD-B: different model families
ORACLE and REDTEAM: different model families
STAT-A and STAT-B: different model families or independent language implementations
PATCH-A and PATCH-B: different model families
```

한 family만 사용 가능하면 study는 실행할 수 있지만:

```text
multi-agent internally replicated
```

대신:

```text
single-family internally replicated
```

로 downgrade하고 README headline eligibility는 HOLD한다.

### 3.6 Role prompt lock

각 role prompt:

```text
versioned
SHA-256
allowed inputs
forbidden inputs
output schema
stop conditions
```

를 가진다.

```text
bench/cdeb/studies/cdeb-fresh-v3/roles/
```

에서 관리한다.

### 3.7 Owner adjudication

Owner가 보는 경우:

```text
literature A/B unresolved claim
gold A/B unresolved atom
patch reviewer disagreement
critical oracle red-team blocker disposition
```

Owner가 보지 않는 경우:

```text
confirmatory arm labels before row seal
interim treatment effect
headline draft before analysis freeze
```

### 3.8 No role self-approval

```text
task author ≠ leakage auditor
oracle engineer ≠ oracle red-team
primary statistician ≠ independent reproducer
reviewer A ≠ reviewer B
```

같은 agent session을 재사용하면 해당 pair는 invalid다.

---

## 4. Study lifecycle and change control

### 4.1 State machine

```text
DRAFT
→ LITERATURE_LOCKED
→ CORPUS_QUALIFIED
→ INSTRUMENT_QUALIFIED
→ PILOT_FROZEN
→ PILOT_COMPLETE
→ POWER_LOCKED
→ PREREGISTERED
→ CONFIRMATORY_FROZEN
→ RUNNING
→ ROWS_SEALED
→ ANALYSIS_LOCKED
→ PUBLISHED
```

역행 금지.

### 4.2 Transition artifact

각 transition:

```json
{
  "from": "DRAFT",
  "to": "LITERATURE_LOCKED",
  "timestamp": "...",
  "actor_role": "OWNER",
  "input_digest": "...",
  "output_digest": "...",
  "checks": ["..."],
  "deviations": []
}
```

### 4.3 Post-freeze modification

Confirmatory freeze 후:

```text
task
gold
oracle
threshold
analysis code
model
runtime
repository snapshot
```

중 하나라도 바뀌면 current study는 중단한다.

Hotfix 후 이어붙이지 않는다.

```text
new study ID
new preregistration
```

이 필요하다.

### 4.4 Deviation ledger

```text
bench/cdeb/studies/cdeb-fresh-v3/deviations.jsonl
```

Append-only.

Deviation을 결과 문서에서 숨기지 않는다.

---

## 5. Freshness and contamination control

### 5.1 새로 생성할 데이터

Preregistration 이후:

```text
task IDs
task prompts
repository bundles
gold files
known-good controls
known-bad controls
oracle images
randomization
pilot trajectories
confirmatory trajectories
human-review rows
analysis outputs
```

### 5.2 재사용 금지

```text
M4/M5 task prompt
CDEB-P task prompt
CDEB-P oracle fixture
old CDEB seed
old trajectory
old result row
old task qualification
public result에 답이 노출된 task
```

### 5.3 사용 가능한 historical data

Source decision은 study보다 앞서 존재해야 한다.

```text
ordinary development 중 생성
study cutoff 이전
benchmark 목적이 아님
source evidence 존재
```

Historical benchmark result는:

```text
sample-size planning prior
regression expectation
```

으로만 사용한다.

Confirmatory outcome 계산에는 사용하지 않는다.

### 5.4 Prompt novelty audit

`LEAK` role이 다음을 검사한다.

```text
exact old prompt match
semantic paraphrase
old task ID/reference
known bad patch phrase
record ID
trailer wording
answer-bearing rejection reason
```

Novelty report가 fail이면 task drop.

### 5.5 Fresh session

각 run:

```text
fresh worktree
fresh agent session
fresh HOME
fresh settings
fresh MCP lifecycle state
fresh index
no prior transcript
no cross-run memory
```

Provider cache가 완전히 통제 불가능하면 raw category와 order를 공개한다.

---

## 6. Repository corpus

### 6.1 Primary repositories

현재 authorization의 dense set 전체:

```text
gitseed
agent-operator-score
logic-pro-mcp
agent-control-plane
```

CommitLore repository는 primary corpus에서 제외한다.

### 6.2 Evidence tier

네 repository 모두 product/benchmark owner가 운영한다.

```text
Tier B
four author-operated repositories
```

### 6.3 Candidate pool requirement

Confirmatory sample-size 선택 전:

```text
at least 80 qualified, fresh, non-pilot candidates
```

를 준비하는 것을 목표로 한다.

Power-selected N보다 pool이 작으면:

```text
threshold를 낮추지 않음
다른 repo로 post-hoc 대체하지 않음
benchmark-authored record를 만들지 않음
NO-GO
```

### 6.4 Repository allocation

최종 N이 무엇이든:

```text
minimum 10 tasks per repository
maximum 40% of all tasks from one repository
```

Primary가 equal-repository-weighted이므로 exact equality는 요구하지 않는다.

### 6.5 Category floors

N에 관계없이:

```text
architecture / abstraction reuse      >= 8
workaround / force / escape hatch     >= 8
compatibility / integration           >= 8
lifecycle / supersession / expiry     >= max(8, ceil(0.15 × N))
security / trust                      >= 4
```

한 category가 35%를 초과하지 않는다.

### 6.6 Candidate enumeration

Current repository snapshots에서 full census.

```text
all Ruled-out records
active constraints with explicit negative alternative
lifecycle chains
source refs
author
path scope
grade
```

`human_review_required` 상태를 agent adjudication workflow로 채운다.

### 6.7 Repository snapshot

Candidate census를 시작하기 전에 exact SHA를 고정한다.

Task authoring 중 main이 움직여도 current study snapshot은 움직이지 않는다.

---

## 7. Candidate eligibility

한 candidate는 모두 충족해야 한다.

### 7.1 Natural provenance

```text
record predates study cutoff
record not benchmark-authored
source decision predates task
decision author disclosed
repository authorization exists
```

### 7.2 Independent ordinary-source packet

Gold source:

```text
merged PR discussion/review
linked issue
ordinary commit message
accepted ADR
maintainer explanation before cutoff
current code/tests
```

제거:

```text
CommitLore trailer
CommitLore note
CommitLore rendered output
benchmark result
```

### 7.3 Explicit decision semantics

Source에서 명확해야 한다.

```text
rejected approach or active constraint
reason
scope
lifecycle at snapshot
```

추측이 필요하면 drop.

### 7.4 Hidden rationale

Current code와 task prompt만 읽어도 rejection reason이 완전히 드러나면 drop.

### 7.5 Functionally viable wrong path

두 종류의 implementation이 모두 기능 요구를 통과해야 한다.

```text
Good A / Good B
→ functional PASS
→ decision honor

Bad A / Bad B
→ functional PASS
→ decision revival
```

Wrong path가 일반 bug로 실패하면 CDEB task가 아니다.

### 7.6 Plausibility review

`GOLD-A/B`와 다른 두 reviewer agent가 prompt와 base tree만 보고:

```text
wrong path is locally plausible
task is not leading
task is realistic
```

를 independently pass해야 한다.

OFF agent outcome을 task selection에 사용하지 않는다.

### 7.7 Shipping delivery qualification

Frozen latest release의 actual hook path로:

```text
expected Record-Id
critical Limit/Ruled-out/Warn sentence
correct lifecycle
actual grade
coverage
```

가 first mutation 전 전달될 수 있어야 한다.

CLI `context` 성공만으로 qualification하지 않는다.

### 7.8 Runtime-boundedness

Pilot 전 ON/OFF dry run은:

```text
process returns within 60% of measured timeout
```

만 검증한다.

기능 success나 treatment effect를 qualification에 사용하지 않는다.

---

## 8. Gold and task construction

### 8.1 Source packet

```text
bench/cdeb/studies/cdeb-fresh-v3/source-packets/<task-id>/
```

내용:

```text
manifest
redacted ordinary sources
source hashes
cutoff
excluded CommitLore refs list
```

### 8.2 Double annotation

`GOLD-A/B`가 독립 추출:

```text
decision kind
decision atom
rejected approach
reason
scope
lifecycle
source anchors
violation semantics
compliance semantics
```

### 8.3 Agreement

다음이 모두 같아야 agreement다.

```text
existence
atom boundary
reason
scope
lifecycle
violation behavior
```

Lexical match가 아니라 semantic field agreement다.

### 8.4 Adjudication

`GOLD-C`가 source packet만 사용한다.

해결되지 않으면 OWNER가 blind bundle을 본다.

Source로 결정 불가하면 task drop.

### 8.5 Owner sign-off

Owner는 결과가 존재하기 전에 모든 final task gold checklist에 서명한다.

```text
approved
dropped
```

만 가능하다.

Gold 문장을 편의상 rewrite하지 않는다.

### 8.6 Task author firewall

`TASK` role은:

```text
base tree
neutral maintenance need
functional acceptance
```

만 본다.

보지 않는다.

```text
exact record text
Record-Id
oracle controls
historical benchmark outcome
```

### 8.7 Leakage audit

Task prompt에 다음이 있으면 fail.

```text
rejected dependency name without natural task need
rejection reason
record vocabulary
“do not use X” answer
expected file path beyond task necessity
oracle implementation hint
```

### 8.8 Gold schema

```json
{
  "schema_version": 3,
  "task_id": "repo-category-001",
  "repository_id": "gitseed",
  "snapshot_sha": "40-hex",
  "decision_kind": "ruled-out",
  "decision": "...",
  "rejected_approach": "...",
  "reason": "...",
  "scope": ["src/..."],
  "lifecycle": "active",
  "source_anchors": [
    {
      "kind": "pull_request_review",
      "ref": "...",
      "quote_hash": "64-hex"
    }
  ],
  "expected_record_ids": ["r-..."],
  "expected_shipping_grade": "directive",
  "violation_contract": "...",
  "compliance_contract": "...",
  "owner_approved": true
}
```

---

## 9. Oracle contract

### 9.1 두 evaluator

```text
functional evaluator
decision-revival evaluator
```

Analyzer가 derived state를 계산한다.

### 9.2 Behavior-first hierarchy

```text
black-box behavior
public CLI/API
typed structural parse
AST
lexical check only when decision is lexical
```

단어 `force`, `strict`, `Lifecycle` 존재만으로 revival을 판정하지 않는다.

### 9.3 Seven mandatory controls

| Control | Functional | Revival |
|---|---:|---:|
| untouched base | FAIL | false |
| compliant good A | PASS | false |
| compliant good B | PASS | false |
| obvious viable bad A | PASS | true |
| keyword-free semantic bad B | PASS | true |
| comment/string/unrelated near miss | task-specific | false |
| unreadable/tampered tree | NOT_EVALUABLE | null |

### 9.4 No `it.fails`

```text
it.fails count = 0
```

Instrument known failure를 confirmatory run에 가져가지 않는다.

### 9.5 Mutation tests

필수 mutation:

```text
functional always true
functional requirement 하나 skip
revival always false
identifier grep only
near-miss를 revival
keyword-free bad B를 safe
unreadable을 false
```

모두 kill해야 한다.

### 9.6 Determinism

Frozen tree 100회:

```text
same verdict
same observations
network 0
clock/random effect 0
locale/path effect 0
```

### 9.7 Arm blindness

Evaluator에 제공하지 않는다.

```text
arm
delivery log
record payload
session transcript
usage
agent prose
```

### 9.8 Oracle red-team

`REDTEAM` 역할이 다음 공격을 수행한다.

```text
no-op patch
renamed implementation
comment-only keyword
dead code
alternative API same behavior
partial implementation
test fixture tamper
path escape
symlink
evaluator timeout
malformed result
```

Unresolved blocker가 하나라도 있으면 task drop 또는 study HOLD.

---

## 10. Instrument pilot and sample-size lock

### 10.1 Pilot matrix

```text
12 tasks
3 per repository
2 arms
2 repeats per arm
= 48 runs
```

Pilot tasks는 confirmatory에서 제외한다.

### 10.2 Pilot purpose

```text
oracle validity
runtime boundedness
shipping delivery
row durability
exposure instrumentation
nuisance variance
```

Pilot treatment effect는 공개할 수 있으나 sample-size 선택에 사용하지 않는다.

### 10.3 Pilot pass

```text
no-op functional success       0
known-good false revival       0
known-bad false safe           0
evaluator nondeterminism       0
product delivery failures      0
expected on-path delivery      >= 95%
critical ruling truncation     0
stale-as-current               0
grade mismatch                 0
row write/read failure         0
task leakage                   0
```

### 10.4 Blinded nuisance extraction

`blinded-pool.ts`가 arm labels를 제거하고 다음만 계산한다.

```text
pooled completion
pooled functional rate
pooled event rate
within-task discordance
repository heterogeneity
```

출력에는 ON/OFF contrast가 없다.

### 10.5 Sample-size choices

```text
N ∈ {48, 64, 80}
```

`power/simulate.ts`가 smallest N을 선택한다.

### 10.6 Power gates

사전등록된 nuisance grid와 blinded pilot이 허용하는 모든 scenario에서:

```text
DSFPS +15pp
→ power >= 90%

FVR relative reduction 50%
with OFF FVR >= 15%
→ power >= 80%
```

이어야 한다.

### 10.7 Sample-size refusal

```text
N=80도 power 부족
qualified pool < selected N
repository/category floors 불충족
```

이면 confirmatory run NO-GO.

결과를 본 뒤 N을 늘리지 않는다.

---

## 11. Treatment arms

### 11.1 ON

```text
latest frozen stable release
actual shipping hook matcher
actual inject renderer
actual budget
actual lifecycle filter
actual trust grading
actual index/notes behavior
```

### 11.2 OFF

동일:

```text
repository
history
notes
index
hook opportunity
proxy process
logger
agent settings
model
tools
timeout
```

차이:

```text
model-visible CommitLore payload suppressed
```

### 11.3 Ordinary Git remains available

OFF agent는 local ordinary Git history를 볼 수 있다.

이것이 realistic comparator다.

```text
CommitLore
vs
same agent with repository Git but no automatic decision payload
```

### 11.4 Manual CommitLore tools disabled

양 arm:

```text
manual query
guard
before_change
capture
```

를 agent tool list에서 제거한다.

Automatic delivery만 측정한다.

### 11.5 Capture disabled

양 arm에서 write-side capture가 history를 변경하지 못한다.

### 11.6 Shipping grade

Benchmark override 금지.

```text
normal latest-release init
actual repository config
actual record provenance
```

가 만든 grade를 사용한다.

Grade subgroup은 grade별 task ≥ 8일 때만 descriptive로 보고한다.

---

## 12. Runtime, security, and freeze

### 12.1 Exact runtime pin

```text
release tag/commit
dist digest
protocol version
index schema
agent CLI version
agent executable SHA
requested model alias
observed exact model ID
Node version/executable SHA
OCI image digest
permission mode
tool set
system/settings digest
network policy
timeout
turn/token cap
```

### 12.2 Latest-release check

Freeze 시 GitHub latest stable tag와 target을 비교한다.

Mismatch면 refusal.

Freeze 이후 새 release는 current study를 바꾸지 않는다.

### 12.3 Model drift

Observed model ID mismatch:

```text
study stop
rows not mixed
```

### 12.4 OCI isolation

Real Docker/Podman gate:

```text
hidden evaluator
read-only gold
no host secret
no Docker socket
provider-only egress
CPU/memory/time limit
task bundle tamper refusal
evaluator digest refusal
daemon failure fail closed
```

Local mock는 충분하지 않다.

### 12.5 Agent information boundary

Agent worktree에서 접근 불가:

```text
gold
oracle source
known-good/bad controls
arm label
expected record IDs
randomization mapping
prior trajectories
```

### 12.6 One freeze command

```bash
node --experimental-strip-types bench/cdeb/freeze.ts \
  --study bench/cdeb/studies/cdeb-fresh-v3/study.json
```

### 12.7 Freeze outputs

```text
public-freeze.json
literature source lock digest
role prompt digests
repository bundle digests
task/gold/oracle digests
runtime pin
model observation
arm settings
randomization commitment
analysis source digest
expected row list
power result
authorization digest
```

### 12.8 Fail closed

하나라도 null/mismatch:

```text
frozen=false
measured run refusal
```

---

## 13. Randomization and execution

### 13.1 Paired temporal blocks

각 task:

```text
repeat block 1: ON/OFF randomized order
repeat block 2: ON/OFF randomized order
```

Paired arms를 시간적으로 가깝게 실행한다.

### 13.2 Repository balance

Global scheduler가 repository와 category를 interleave한다.

Arm이 특정 시간대에 몰리지 않게 한다.

### 13.3 Public commitment

Run 전 공개:

```text
study ID
selected N
opaque block IDs
randomization digest
expected row count
analysis code digest
```

Mapping은 sealed하고 rows seal 후 공개한다.

### 13.4 No reroll

First model turn 이후:

```text
timeout
provider error
agent error
bad patch
```

은 assigned outcome이다.

### 13.5 Durable row

각 run:

```text
write temp
fsync
atomic rename
read back
schema validate
digest
append manifest
```

후 다음 run으로 이동한다.

### 13.6 Expected row count

```text
4 × N
```

N=64이면 256 rows.

Missing/extra/duplicate row가 있으면 analysis refusal.

---

## 14. Mechanism instrumentation

### 14.1 Opportunity

```text
read opportunity
mutation opportunity
```

를 분리한다.

Primary delivery timing은 first mutating event 기준이다.

### 14.2 Terminal exposure outcome

모든 ON assigned run:

```text
delivered
no-mutation-opportunity
product-failure
runtime-failure-before-opportunity
```

Silent unknown 금지.

### 14.3 Delivery success

```text
expected active Record-Id visible
critical decision/reason visible
actual grade visible
first mutation 전 또는 같은 PreToolUse
coverage complete
stale-as-current 0
```

ID만 있고 reason이 budget에서 잘리면 failure다.

### 14.4 Explicit uptake proxy

관찰 가능한 것만 기록한다.

```text
record ID 언급
rejected approach와 reason 정확히 언급
constraint가 grounded plan에 등장
```

`explicit_uptake_observed`라고 부른다.

없다고 unread라고 단정하지 않는다.

### 14.5 Behavioral honor

```text
honored = revived == false
```

Final tree evaluator가 판정한다.

### 14.6 Funnel

```text
assigned
→ mutation opportunity
→ expected delivery
→ explicit uptake proxy
→ behavioral honor
→ functional pass
→ decision-safe success
```

### 14.7 Delivered subset

다음은 descriptive다.

```text
FVR among delivered ON runs
honor among explicit-uptake runs
grade subgroup
```

CACE, complier effect, causal effect라고 부르지 않는다.

---

## 15. Outcomes

### 15.1 Run status

```text
completed
timeout
over-turns
over-tokens
agent-error
provider-error
infrastructure-prestart
not-evaluable
```

### 15.2 Four-state result

| Functional | Revival | State |
|---:|---:|---|
| PASS | false | decision-safe success |
| PASS | true | functionally viable revival |
| FAIL | false | functional failure |
| FAIL | true | failed + revival |
| NOT_EVALUABLE | null | not evaluable |

### 15.3 Primary

Decision-Safe First-Pass Success.

Timeout/error/not-evaluable은 success 0.

### 15.4 Key secondary

Functionally Viable Revival.

Denominator는 assigned logical runs다.

### 15.5 Safety outcomes

```text
functional pass rate
completion rate
wrong-tree delivery
stale-as-current
product delivery failure
```

---

## 16. Blind patch re-explanation audit

### 16.1 이름

```text
Blind Patch Re-explanation Audit
```

Human user study라고 부르지 않는다.

### 16.2 Question

> 이 patch를 승인하려면 repository가 이미 문서화한 rejection 또는 constraint를 reviewer가 다시 설명해야 하는가?

### 16.3 Input

```text
task prompt
final diff
redacted ordinary-source decision summary
```

제거:

```text
arm
record ID
CommitLore payload
delivery logs
agent transcript
model identity where possible
```

### 16.4 Reviewer plan

`PATCH-A`:

```text
all evaluable runs
```

`PATCH-B`:

```text
A=yes all
A=no deterministic 25% sample
```

Disagreement:

```text
OWNER blind adjudication
```

### 16.5 Metric

```text
re_explanation_required
```

Secondary only.

### 16.6 Audit disagreement with oracle

Patch audit가 oracle defect를 발견하면 final row를 손으로 고치지 않는다.

```text
instrument deviation
headline HOLD
new oracle revision
new study
```

---

## 17. Temptation and grade diagnostics

### 17.1 Temptation subset

OFF arm에서 task별 revival이 한 번 이상:

```text
temptation_task = true
```

사전등록된 descriptive subset.

Primary denominator에서 제외하지 않는다.

### 17.2 Grade subgroup

```text
claim
directive
blocked
mixed
```

별 task 수와 event count를 공개한다.

각 grade task <8이면 rate만 raw table로 보고 effect claim 금지.

### 17.3 Follow-up trigger

```text
delivery >=95%
primary effect weak
delivered honor weak
grade heterogeneity plausible
```

일 때만 별도 claim-vs-directive randomized study를 연다.

---

## 18. Token and operational cost

### 18.1 Raw usage

```text
input
output
cache creation
cache read
total provider-reported volume
turns
tool calls
files read
wall time
```

### 18.2 Token saving

Primary/headline gate 아님.

### 18.3 Token Tax per Prevented Revival

\[
TTPR
=
\frac{
TokenVolume_{ON}-TokenVolume_{OFF}
}{
FVRCount_{OFF}-FVRCount_{ON}
}
\]

Denominator ≤0:

```text
undefined
```

### 18.4 Claim

허용:

> 한 functionally viable revival을 예방하는 데 추가로 X provider-reported tokens가 들었다.

금지:

```text
money saved
universal token saving
environmental saving
```

---

## 19. Statistical Analysis Plan

### 19.1 Analysis lock

`SAP.md`와 analyzer digest를 confirmatory randomization 전에 freeze한다.

### 19.2 Primary effect

Equal-repository-weighted DSFPS difference.

### 19.3 Key secondary

Equal-repository-weighted FVR absolute difference.

### 19.4 Confidence intervals

```text
repository-stratified task bootstrap
20,000 replicates
task’s ON/OFF/repeats move together
fixed seed
```

### 19.5 Randomization test

Within-task temporal block label swap.

Primary p-value는 randomization design을 반영한다.

### 19.6 Multiplicity

Hierarchical:

```text
1. DSFPS at two-sided α=0.05
2. only if 1 passes, FVR at two-sided α=0.05
3. RBDR is transform of FVR, not separate hypothesis
```

### 19.7 Non-inferiority safety

```text
functional-pass ON-OFF lower 95% bound > -5pp
completion ON-OFF lower 95% bound > -5pp
```

### 19.8 Sensitivity

```text
task-weighted effect
equal-repository effect
leave-one-repository-out
leave-one-task-out range
category effects
grade descriptive effects
temptation subset
```

### 19.9 Not-evaluable extremes

두 extreme:

```text
ON non-evaluable=revival, OFF=safe
ON non-evaluable=safe, OFF=revival
```

Headline direction이 둘 중 하나에서 바뀌면 HOLD.

### 19.10 Independent reproduction

`STAT-B`는 primary analyzer source를 보지 않는다.

독립 implementation:

```text
different model family
different code path
same frozen formulas
same rows
```

반드시 일치:

```text
counts exact
rates exact
point estimates tolerance <= 1e-12
bootstrap quantiles tolerance <= 1e-6
headline gate same
```

불일치 unresolved면 publication HOLD.

---

## 20. Headline eligibility

다음을 전부 통과해야 README 상단 수치를 허용한다.

```text
[ ] DSFPS 95% CI lower bound > 0
[ ] FVR absolute-difference 95% CI upper bound < 0
[ ] RBDR point estimate >= 50%
[ ] RBDR 95% lower bound >= 20%
[ ] OFF FVR raw events >= 12
[ ] functional-pass non-inferiority > -5pp
[ ] completion non-inferiority > -5pp
[ ] ON on-path delivery >= 95%
[ ] product delivery failures = 0
[ ] critical ruling truncation = 0
[ ] stale-as-current = 0
[ ] wrong-tree delivery = 0
[ ] grade mismatch = 0
[ ] leave-one-repository-out sign reversal = 0
[ ] not-evaluable extreme direction reversal = 0
[ ] oracle red-team unresolved blocker = 0
[ ] STAT-A / STAT-B unresolved mismatch = 0
[ ] two-model-family internal review gate passed
```

### 20.1 허용 headline

> **R% fewer repeated bad decisions in fresh decision-sensitive coding tasks.**

정식:

> Across N fresh decision-sensitive tasks from four author-operated repositories, CommitLore reduced functionally viable re-use of previously rejected approaches from A% to B% — an R% relative reduction.

Footnote:

```text
latest frozen release
one pinned model
one pinned agent harness
author-operated Tier B
```

### 20.2 금지 headline

```text
up to 85% fewer ...
CommitLore prevents bad decisions
independent validation
all agents/repositories
token saving
```

Fresh result가 old 85%를 재현하지 못하면 historical maximum을 골라 `up to`로 쓰지 않는다.

### 20.3 Failure interpretation

Delivery <95%:

```text
delivery product defect
```

Delivery ≥95%, effect weak:

```text
post-delivery compliance problem
```

DSFPS good, FVR unclear:

```text
safe-success claim only
```

Token increase:

```text
publish as measured
behavior claim may remain if gates pass
```

---

## 21. Data model and repository layout

```text
bench/cdeb/
├── PRD.md
├── archive/
│   └── PRD-v1.3.md
└── studies/
    └── cdeb-fresh-v3/
        ├── study.json
        ├── STATUS.json
        ├── SAP.md
        ├── literature/
        │   ├── source-lock.json
        │   ├── evidence-matrix.json
        │   ├── evidence-matrix.md
        │   └── audits/
        ├── roles/
        │   ├── manifest.json
        │   └── *.md
        ├── corpus/
        │   ├── candidate-registry.jsonl
        │   ├── selection.json
        │   └── adjudication/
        ├── source-packets/
        ├── gold/
        ├── tasks/
        ├── oracles/
        ├── controls/
        ├── pilot/
        ├── power/
        ├── freeze/
        ├── rows/
        ├── patch-audit/
        ├── analysis/
        ├── deviations.jsonl
        └── RESULT.md
```

### 21.1 Study manifest

```json
{
  "study_id": "cdeb-fresh-v3",
  "schema_version": 3,
  "release_tag": "vX.Y.Z",
  "release_commit": "40-hex",
  "repositories": [
    "gitseed",
    "agent-operator-score",
    "logic-pro-mcp",
    "agent-control-plane"
  ],
  "pilot_tasks": 12,
  "confirmatory_task_candidates": [48, 64, 80],
  "repeats_per_arm": 2,
  "arms": ["delivery-on", "delivery-suppressed"],
  "primary_estimand": "equal_repository_dsfps_difference",
  "key_secondary": "equal_repository_fvr_difference",
  "evidence_tier": "tier-b-author-operated-multi-agent"
}
```

### 21.2 Run row

```json
{
  "study_id": "cdeb-fresh-v3",
  "run_id": "...",
  "task_id": "...",
  "repository_id": "...",
  "arm": "delivery-on",
  "repeat": 1,
  "block_id": "...",
  "status": "completed",
  "release_tag": "vX.Y.Z",
  "model_id": "...",
  "base_tree_oid": "...",
  "final_tree_oid": "...",
  "functional_pass": true,
  "revived": false,
  "decision_safe_success": true,
  "functionally_viable_revival": false,
  "opportunity": {
    "read": 3,
    "mutation": 1
  },
  "exposure_outcome": "delivered",
  "delivery": {
    "expected_record_ids": ["r-..."],
    "delivered_record_ids": ["r-..."],
    "before_first_mutation": true,
    "critical_ruling_visible": true,
    "grade": "directive",
    "coverage": "complete",
    "stale_as_current": []
  },
  "explicit_uptake_observed": false,
  "usage": {
    "input": 0,
    "output": 0,
    "cache_creation": 0,
    "cache_read": 0
  },
  "turns": 0,
  "tool_calls": 0,
  "files_read": 0,
  "wall_ms": 0,
  "row_sha256": "64-hex"
}
```

### 21.3 Patch audit row

```json
{
  "run_id": "...",
  "reviewer_role": "PATCH-A",
  "reviewer_family": "...",
  "re_explanation_required": true,
  "confidence": "high",
  "reason_code": "rejected-approach-repeated",
  "adjudicated": false
}
```

---

## 22. Test and verification matrix

### 22.1 Literature

```text
[ ] every claim has source ID
[ ] every source has version/hash
[ ] all matrix verdicts closed vocabulary
[ ] A/B audit independent
[ ] unresolved disagreements 0
[ ] Code Researcher version drift test
[ ] PR-paper source attribution test
```

### 22.2 Role isolation

```text
[ ] role prompts hashed
[ ] fresh session IDs
[ ] forbidden input manifests
[ ] no role self-approval
[ ] model-family diversity recorded
[ ] owner adjudication blind bundle
```

### 22.3 Freshness

```text
[ ] old task ID match 0
[ ] semantic old-prompt collision 0
[ ] old result row ingestion refusal
[ ] no prior trajectory mounted
[ ] fresh HOME/settings/index/session
```

### 22.4 Corpus

```text
[ ] four authorized repos
[ ] candidate source pre-cutoff
[ ] no benchmark-authored record
[ ] independent ordinary-source packet
[ ] hidden rationale
[ ] viable wrong path
[ ] delivery qualification
[ ] owner gold sign-off
```

### 22.5 Oracle

```text
[ ] seven controls
[ ] no-op fails functional
[ ] two good PASS/SAFE
[ ] two bad PASS/REVIVED
[ ] keyword-free bad detected
[ ] near miss safe
[ ] unreadable NOT_EVALUABLE/null
[ ] mutation suite 100%
[ ] deterministic x100
[ ] arm blind
[ ] red-team blocker 0
```

### 22.6 Arms

```text
[ ] same repository bundle
[ ] same process path
[ ] same index/history/notes
[ ] only model-visible payload differs
[ ] manual CommitLore tools absent
[ ] capture absent
[ ] actual grade logged
```

### 22.7 Runtime

```text
[ ] latest release pin
[ ] exact model ID
[ ] executable/image digests
[ ] real OCI matrix
[ ] provider-only egress
[ ] no gold/oracle access
[ ] no reroll
[ ] durable row
```

### 22.8 Analysis

```text
[ ] expected rows exact
[ ] equal-repo primary
[ ] task-weighted sensitivity
[ ] bootstrap fixed seed
[ ] randomization test
[ ] non-inferiority
[ ] not-evaluable extremes
[ ] leave-one-repo-out
[ ] independent analyzer match
[ ] headline gate deterministic
```

---

## 23. Implementation plan

### PR 1 — Authority, archive, and literature lock

```text
archive v1.3
install v3 as canonical
create study directory
source-lock schema
evidence matrix
literature role prompts
CI generation/check
```

Exit:

```text
original-source matrix complete
unresolved literature claims 0
```

### PR 2 — Role governance and study schemas

```text
role manifest
information firewalls
study/gold/task/run/patch schemas
state machine
transition ledger
mixed-study refusal
```

### PR 3 — Fresh corpus pipeline

```text
current repository snapshots
candidate census
ordinary-source packets
double annotation
adjudication
owner sign-off
task authoring
leakage audit
```

Exit:

```text
12 pilot candidates
qualified confirmatory pool sufficient for N max decision
```

### PR 4 — Oracle contract

```text
functional/revival split
seven controls
mutation harness
determinism
oracle red-team
```

Exit:

```text
it.fails 0
all selected tasks instrument-qualified
```

### PR 5 — Shipping arms and mechanism instrumentation

```text
delivery-on
delivery-suppressed
manual tools removal
capture off
opportunity/delivery/grade/stale logs
fresh session isolation
```

### PR 6 — Pilot, power, and preregistration

```text
48 pilot runs
pilot report
blinded nuisance extraction
power simulation
select N
freeze SAP
publish preregistration
```

Exit:

```text
all pilot gates
power gates
selected N available
```

### PR 7 — Runtime freeze and adversarial qualification

```text
latest release
OCI image
model observation
all digests
adversarial matrix
public randomization commitment
```

Exit:

```text
frozen=true
null digest 0
```

### PR 8 — Confirmatory execution

```text
4N logical runs
blocked randomization
durable rows
no peek
incident ledger
```

Exit:

```text
rows sealed
expected count exact
```

### PR 9 — Independent analysis and patch audit

```text
STAT-A
STAT-B independent implementation
PATCH-A/B reviews
owner blind adjudication
sensitivity analysis
```

### PR 10 — Publication

```text
RESULT.md
raw rows
reproduction instructions
deviations
claim gate
README update or HOLD
```

---

## 24. Definition of Done

### Literature integrity

```text
[ ] all supplied-paper claims original-source audited
[ ] version-locked evidence matrix
[ ] unsupported/overstated claims corrected
[ ] PR source conflation removed
```

### Solo execution

```text
[ ] external people required 0
[ ] one human owner workflow
[ ] isolated multi-agent roles
[ ] minimum two model families
[ ] owner blind adjudication procedure
[ ] evidence called Tier B, not external
```

### Freshness

```text
[ ] historical result rows in analysis 0
[ ] old task reuse 0
[ ] old trajectory reuse 0
[ ] latest stable release frozen
[ ] fresh session/worktree/HOME/index each run
```

### Corpus

```text
[ ] 4 authorized repositories
[ ] 12 pilot tasks
[ ] selected confirmatory N ∈ {48,64,80}
[ ] repository/category floors
[ ] natural pre-cutoff decisions
[ ] independent source packets
[ ] owner-approved gold
```

### Instrument

```text
[ ] seven controls each task
[ ] no-op cannot pass
[ ] viable wrong path passes function
[ ] semantic revival detection
[ ] mutation tests
[ ] deterministic x100
[ ] oracle red-team blocker 0
```

### Treatment

```text
[ ] latest shipping path
[ ] OFF payload suppression only
[ ] actual grade
[ ] manual tools disabled
[ ] capture disabled
[ ] delivery qualification
```

### Runtime

```text
[ ] exact model/runtime/release digests
[ ] real OCI adversarial gate
[ ] no shared memory
[ ] no reroll
[ ] durable append-only rows
[ ] all state transitions audited
```

### Statistics

```text
[ ] power-selected N before confirmatory run
[ ] equal-repository primary
[ ] hierarchical testing
[ ] paired randomization sensitivity
[ ] non-inferiority
[ ] not-evaluable extremes
[ ] independent analysis reproduction
```

### Publication

```text
[ ] raw counts/rates
[ ] absolute and relative effects
[ ] mechanism funnel
[ ] patch re-explanation audit
[ ] raw token categories/TTPR
[ ] all deviations
[ ] exact evidence tier
[ ] headline only if every gate passes
[ ] negative/inconclusive result same template
```

---

## 25. Agent role cards

### 25.1 Gold annotator

```text
You are GOLD-A (or GOLD-B) for CDEB-Fresh v3.

Input:
- frozen ordinary-source packet
- repository snapshot metadata
- annotation schema

You do not have:
- CommitLore records
- the other annotator's output
- task prompts
- arm results

Extract the smallest independently true decision atoms. For each, record:
kind, rejected approach/constraint, reason, scope, lifecycle, and exact source
anchor. Do not infer a reason absent from the packet. Mark undecidable rather
than guessing. Output schema-valid JSON only.
```

### 25.2 Task author

```text
You are TASK for CDEB-Fresh v3.

Input:
- frozen base tree
- neutral maintenance-need contract
- functional acceptance criteria

You do not have:
- CommitLore record text
- rejected-approach answer
- oracle controls
- prior run results

Write a realistic maintenance request that does not reveal the repository
decision. The user need must admit at least two functionally valid approaches.
Do not mention prohibited dependencies, the rejection reason, CommitLore, or
benchmark terminology. Output the prompt and a leakage self-check.
```

### 25.3 Oracle red-team

```text
You are REDTEAM for CDEB-Fresh v3.

Input:
- frozen task
- gold contract
- evaluator
- seven controls

You do not have:
- arm labels
- agent trajectories
- treatment outcomes

Attempt to make the evaluator misclassify:
no-op, comment-only keywords, renamed behavior, dead code, alternate APIs,
partial implementation, unreadable trees, symlink/path escape, timeout and
tampered fixtures. Produce only reproducible attacks. Any unresolved attack is
a blocker, not a suggestion.
```

### 25.4 Independent statistician

```text
You are STAT-B for CDEB-Fresh v3.

Input:
- sealed schema-valid rows
- frozen SAP formulas
- randomization manifest
- fixed seeds

You do not have:
- STAT-A source or narrative
- desired headline
- README copy

Implement the estimands independently. Report raw counts, equal-repository and
task-weighted effects, intervals, randomization result, non-inferiority,
sensitivities and the deterministic headline gate. Do not inspect STAT-A until
your artifact is sealed.
```

### 25.5 Patch reviewer

```text
You are PATCH-A (or PATCH-B).

Input:
- task prompt
- final patch
- redacted ordinary-source decision summary
- review codebook

You do not have:
- treatment arm
- CommitLore payload
- record IDs
- delivery log
- agent transcript

Answer only whether accepting this patch would require restating an already
documented rejection or constraint. Use the closed reason codes. Do not score
style, elegance, or general quality.
```

---

## 26. Owner execution order

```text
1. Merge PR 1 and lock literature.
2. Start fresh role sessions from role manifest.
3. Build candidate census and source packets.
4. Run GOLD-A/B, GOLD-C, owner sign-off.
5. Author tasks through TASK and LEAK roles.
6. Build and red-team oracles.
7. Run pilot only.
8. Run blinded power selector.
9. Publish preregistration and public freeze.
10. Verify latest release/runtime/model/OCI.
11. Run confirmatory matrix with no result peeking.
12. Seal rows.
13. Run STAT-A and STAT-B independently.
14. Run patch audit.
15. Resolve only blind disagreements.
16. Publish result and either update README or issue HOLD.
```

---

## 27. Final claim templates

### 27.1 Headline eligible

> **CommitLore reduced repeated bad decisions by R% in fresh decision-sensitive coding tasks.**

> Across N fresh tasks on four author-operated repositories, functionally viable re-use of previously rejected approaches fell from A% without automatic CommitLore delivery to B% with it (absolute difference Dpp, 95% CI L to U).

### 27.2 Positive but headline gate failed

> CommitLore improved decision-safe first-pass success by Dpp, but the study did not satisfy every pre-registered gate required for a “fewer repeated bad decisions” headline.

### 27.3 Delivery bottleneck

> The study could not estimate the intended behavioral effect cleanly because expected decisions were not delivered before mutation often enough.

### 27.4 Compliance bottleneck

> Expected decisions were delivered reliably, but fresh agents did not honor them often enough to establish a reduction in repeated bad decisions.

### 27.5 Null/inconclusive

> Under the frozen model, harness, repositories and tasks, the interval remained compatible with both no effect and effects the study was not powered to distinguish.

### 27.6 Harmful

> Under this frozen configuration, CommitLore reduced functional success or increased functionally viable decision revival. The negative result is published without changing tasks or thresholds.

---

## 28. Final execution prompt

```text
Implement and execute CDEB-Fresh v3 using this PRD as the sole current
authority.

Core requirement:
Create fresh prospective evidence for the latest stable CommitLore release.
Do not reanalyze historical CDEB rows as the new product result.

Governance:
- one human owner
- no external people required
- isolated multi-agent roles from the role manifest
- two model families for annotation, red-team, analysis and patch review
- never describe the result as independent external validation

First:
1. Re-read live main, package version, latest stable release, issue #771,
   current PRD, authorization, runtime pin and README evidence.
2. Archive PRD v1.3 and install this document as canonical.
3. Materialize the original-source literature lock and evidence matrix.
4. Refuse any load-bearing secondary-source claim.

Fresh corpus:
5. Freeze current snapshots for the four authorized repositories.
6. Enumerate candidates from natural pre-cutoff decisions.
7. Build ordinary-source packets with CommitLore records removed.
8. Run independent GOLD-A/B annotation and blind adjudication.
9. Have the owner sign off every final gold before task generation.
10. Generate neutral tasks through TASK and reject leakage through LEAK.
11. Never reuse old CDEB prompts, fixtures, trajectories or result rows.

Oracle:
12. Build functional and revival evaluators separately.
13. Require untouched, Good A/B, Bad A/B, near-miss and unreadable controls.
14. Kill all required mutations.
15. Run deterministic x100 and independent red-team.
16. Keep `it.fails` at zero.

Pilot and power:
17. Run 12 excluded pilot tasks, 48 runs.
18. Do not use pilot treatment contrast for sample-size selection.
19. Use arm-blinded nuisance values and the frozen power simulator.
20. Select N from 48, 64 or 80 before confirmatory randomization.
21. Stop if power, pool, repository or category floors fail.

Treatment:
22. ON is the exact latest-release shipping delivery path.
23. OFF uses the same hook/proxy path and suppresses only model-visible payload.
24. Keep ordinary Git available in both arms.
25. Remove manual CommitLore tools and disable capture in both arms.
26. Use actual shipping grade; do not seed a benchmark-only grade.

Freeze:
27. Pin release, dist, model, CLI, Node, OCI, settings, tools, network and
    analysis digests.
28. Run real Docker/Podman adversarial isolation.
29. Publish the randomization commitment and expected row count.
30. Start only when `frozen=true` and no digest is null.

Execution:
31. Use fresh worktree/session/HOME/settings/index for every run.
32. Randomize ON/OFF within two temporal blocks per task.
33. Never reroll after the first model turn.
34. Write, fsync, rename, read back and validate each row before continuing.
35. Record opportunity, terminal exposure outcome, ruling visibility, grade,
    coverage, stale delivery, uptake proxy, final-tree outcomes and usage.

Analysis:
36. Seal all rows before unblinding.
37. Run STAT-A and STAT-B independently.
38. Use equal-repository DSFPS as primary and FVR as hierarchical key secondary.
39. Run bootstrap, randomization, non-inferiority and all sensitivity analyses.
40. Run blind patch re-explanation review.
41. Resolve analysis mismatch before publication; never average disagreements.

Claim:
42. Apply every headline gate mechanically.
43. If any gate fails, publish the correct HOLD/qualified result.
44. Do not use historical 85% as “up to” marketing.
45. Publish negative and inconclusive results with the same artifact set.

Final report:
- live main and measured release
- literature matrix digest
- role/model-family manifest
- repository snapshots
- pilot result
- power-selected N
- oracle control/mutation report
- freeze/runtime/OCI evidence
- expected/actual rows
- DSFPS
- FVR and RBDR
- mechanism funnel
- patch re-explanation audit
- token categories and TTPR
- all sensitivity analyses
- deviations
- exact permitted claim
- GO / HOLD
```

---

## 29. Final decision

이 PRD가 만드는 연구는 다음 세 가지를 동시에 지킨다.

```text
제품 후킹
→ 사용자가 이해하는 “반복된 나쁜 판단 감소” 숫자

과학적 정직성
→ ITT causal effect와 mechanism subset을 분리

solo executability
→ 외부 인력 없이 owner + isolated multi-agent roles로 완주
```

최종 연구 성공은 큰 숫자를 얻는 것이 아니다.

```text
latest release
fresh tasks
valid oracle
reliable delivery
sealed randomization
independent internal reproduction
pre-registered claim gate
```

를 모두 지킨 상태에서 결과가 무엇이든 공개하는 것이다.

---

## 30. Source ledger

### CommitLore repository

```text
audit main:
42cb032823a9c2078d9dcc8e0f0f6bf25d58c32e

current release at review:
v1.2.0
```

Reviewed:

```text
README.md
docs/evidence.md
docs/MEASUREMENT-PROTOCOL.md
bench/cdeb/PRD.md v1.3
bench/cdeb/AUTHORIZATION.md
bench/cdeb/PREREGISTRATION-CDEB-P.md
bench/cdeb/RESULT-CDEB-P.md
bench/cdeb/runtime/**
bench/cdeb/freeze/**
issue #771
```

### External literature

```text
LIT-AK-01
Anton Jansen, Jan Bosch.
Software Architecture as a Set of Architectural Design Decisions.
WICSA 2005.
DOI 10.1109/WICSA.2005.61.

LIT-AK-02
Dan Tofan, Matthias Galster, Paris Avgeriou.
Reducing Architectural Knowledge Vaporization by Applying the Repertory Grid Technique.
2011.

LIT-ADR-01
Georg Buchgeher et al.
Using Architecture Decision Records in Open Source Projects—An MSR Study on GitHub.
IEEE Access 2023.
DOI 10.1109/ACCESS.2023.3287654.

LIT-DRAFT
Rudra Dhar et al.
DRAFT-ing Architectural Design Decisions using LLMs.
arXiv:2504.08207v1.

LIT-SWE-CONTEXT
Jiayuan Zhu et al.
SWE Context Bench: A Benchmark for Context Learning in Coding.
arXiv:2602.08316v3.

LIT-CTIM
Tobias Lindenbauer, Georg Groh, Hinrich Schütze.
From Knowledge to Noise: CTIM-Rover and the Pitfalls of Episodic Memory in Software Engineering Agents.
arXiv:2505.23422v1.

LIT-CODE-RESEARCHER
Ramneet Singh et al.
Code Researcher: Deep Research Agent for Large Systems Code and Commit History.
arXiv:2506.11060v2.

LIT-AGENT-PR
Ramtin Ehsani et al.
Where Do AI Coding Agents Fail? An Empirical Study of Failed Agentic Pull Requests in GitHub.
arXiv:2601.15195v1.

LIT-AIDEV-REJECTION
Mahmoud Abujadallah, Ali Arabat, Mohammed Sayagh.
Understanding the Rejection of Fixes Generated by Agentic Pull Requests—Insights from the AIDev Dataset.
arXiv:2606.13468v1.
```

These sources motivate the construct and design controls. None establishes
CommitLore's product effect. Only the frozen CDEB-Fresh v3 randomized study may
support that claim.
