# Evidence matrix — cdeb-fresh-v3r1

Total claims: 34
Resolved: 34
Unresolved: 0

## Verdict summary

| Verdict | Claims |
| --- | ---: |
| `SUPPORTED` | 10 |
| `SUPPORTED_WITH_SCOPE` | 13 |
| `OVERSTATED` | 6 |
| `MISATTRIBUTED` | 3 |
| `NOT_CAUSAL` | 2 |
| `NOT_LOAD_BEARING` | 0 |

## ADR-01

- Statement: ADR adoption은 여전히 낮다
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ACCESS-2023-BUCHGEHER`
- Adjudication reasoning: Both auditors' spans are verbatim accurate (abstract and conclusion respectively) and do not conflict; this is a measured MSR result, not a background assertion. Scope is required because the paper itself imposes it: 'External validity of our findings cannot be claimed regarding the adoption of ADRs in closed source projects: The findings of our MSR study apply to open source projects only.' The corpus is public GitHub repositories available at the end of 2020. The source also binds the finding to a countervailing trend in the same sentence ('although the number of repositories using ADRs is i
- Scope note: Both auditors' spans are verbatim accurate (abstract and conclusion respectively) and do not conflict; this is a measured MSR result, not a background assertion. Scope is required because the paper itself imposes it: 'External validity of our findings cannot be claimed regarding the adoption of ADRs in closed source projects: The findings of our MSR study apply to open source projects only.' The corpus is public GitHub repositories available at the end of 2020. The source also binds the finding to a countervailing trend in the same sentence ('although the number of repositories using ADRs is i

## ADR-02

- Statement: ADR 채택이 낮은 이유는 manual effort다
- Final verdict: `NOT_CAUSAL`
- Status: `resolved`
- Source id: `ACCESS-2023-BUCHGEHER`
- Adjudication reasoning: This is the assert-as-background case, and the citation chain is circular. DRAFT states the cause in its abstract ('their adoption is limited due to the manual effort involved and insufficient tool support') and introduction ('their adoption has been low in practice [6]. This is largely due to the high manual effort required to document decisions, the lack of adequate tool support...[6]'), attributing it to reference [6], which is Buchgeher et al. itself. Buchgeher explicitly declines to answer that question and calls it open, requiring qualitative follow-up work it did not do. Buchgeher's own
- Scope note: This is the assert-as-background case, and the citation chain is circular. DRAFT states the cause in its abstract ('their adoption is limited due to the manual effort involved and insufficient tool support') and introduction ('their adoption has been low in practice [6]. This is largely due to the high manual effort required to document decisions, the lack of adequate tool support...[6]'), attributing it to reference [6], which is Buchgeher et al. itself. Buchgeher explicitly declines to answer that question and calls it open, requiring qualitative follow-up work it did not do. Buchgeher's own

## AK-01

- Statement: Architectural knowledge vaporization은 architecture decision 지식이 사라지는 문제다
- Final verdict: `SUPPORTED`
- Status: `resolved`
- Source id: `WICSA-2005-JANSEN`
- Adjudication reasoning: The paper defines the problem in terms of knowledge about architectural design decisions disappearing into the architecture; it does not quantify its prevalence.
- Scope note: The paper defines the problem in terms of knowledge about architectural design decisions disappearing into the architecture; it does not quantify its prevalence.

## AK-02

- Statement: 코드에는 결과가 남고 기각 이유는 증발한다
- Final verdict: `OVERSTATED`
- Status: `resolved`
- Source id: `WICSA-2005-JANSEN`
- Adjudication reasoning: Jansen and Bosch say that effects of made decisions remain in the design while the decisions are not visible. Neither cited paper specifically says that code retains outcomes or that reasons for rejected alternatives vaporize.
- Scope note: Jansen and Bosch say that effects of made decisions remain in the design while the decisions are not visible. Neither cited paper specifically says that code retains outcomes or that reasons for rejected alternatives vaporize.

## AK-03

- Statement: AK vaporization은 maintenance cost를 높인다
- Final verdict: `NOT_CAUSAL`
- Status: `resolved`
- Source id: `ECSA-2011-TOFAN`
- Adjudication reasoning: Both auditors quote the same abstract sentence, which is motivation rather than result. The paper restates it as a premise when framing its GQM goal ('This is important to both practitioners and researchers, because knowledge vaporization leads to increased maintenance costs'), i.e. as the reason the study matters, not as something the study tests. The measured constructs are three documentation proxies obtained from a graduate-student survey: number of explicit decision alternatives, number of concerns, and the ratio of expressed rankings to possible rankings. Maintenance cost is never measur
- Scope note: Both auditors quote the same abstract sentence, which is motivation rather than result. The paper restates it as a premise when framing its GQM goal ('This is important to both practitioners and researchers, because knowledge vaporization leads to increased maintenance costs'), i.e. as the reason the study matters, not as something the study tests. The measured constructs are three documentation proxies obtained from a graduate-student survey: number of explicit decision alternatives, number of concerns, and the ratio of expressed rankings to possible rankings. Maintenance cost is never measur

## CR-01

- Statement: Code Researcher는 GPT-4o에서 48% vs SWE-agent 31.5%였다
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ARXIV-2506.11060`
- Adjudication reasoning: The comparison is the unassisted GPT-4o P@5 setting with 15 maximum calls on the paper's 200-instance kBenchSyz Linux-kernel-crash subset.
- Scope note: The comparison is the unassisted GPT-4o P@5 setting with 15 maximum calls on the paper's 200-instance kBenchSyz Linux-kernel-crash subset.

## CR-02

- Statement: Code Researcher는 약 10 files, SWE-agent는 1.33 files를 탐색했다
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ARXIV-2506.11060`
- Adjudication reasoning: The span is verbatim and reports a measured result. Scope is material rather than decorative because the paper gives two different file counts for the same comparison in adjacent sentences: per crash, Code Researcher reads 29.13 unique files against SWE-agent's 1.91; per trajectory, 10 against 1.33. Dropping 'averaged by trajectory' leaves the two cited numbers ambiguous against figures the source states one sentence earlier. The configuration is also fixed: both agents on GPT-4o, P@5, 15 max calls, over Linux kernel crashes, as stated in the sentence introducing the figure ('the number of uni
- Scope note: The span is verbatim and reports a measured result. Scope is material rather than decorative because the paper gives two different file counts for the same comparison in adjacent sentences: per crash, Code Researcher reads 29.13 unique files against SWE-agent's 1.91; per trajectory, 10 against 1.33. Dropping 'averaged by trajectory' leaves the two cited numbers ambiguous against figures the source states one sentence earlier. The configuration is also fixed: both agents on GPT-4o, P@5, 15 max calls, over Linux kernel crashes, as stated in the sentence introducing the figure ('the number of uni

## CR-03

- Statement: Commit history의 causal analysis가 중요하다
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ARXIV-2506.11060`
- Adjudication reasoning: A removal ablation supports importance of this search_commits component, but it was run on the 96 bugs previously resolved by Code Researcher; it does not establish that historical-causal analysis is universally important for all coding tasks.
- Scope note: A removal ablation supports importance of this search_commits component, but it was run on the 96 bugs previously resolved by Code Researcher; it does not establish that historical-causal analysis is universally important for all coding tasks.

## CR-04

- Statement: Filtering memory가 품질을 올렸다
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ARXIV-2506.11060`
- Adjudication reasoning: The filtering ablation supports higher crash-resolution and localization performance, but the direct no-filter comparison contains only 20 randomly sampled crashes; it does not establish a general quality law.
- Scope note: The filtering ablation supports higher crash-resolution and localization performance, but the direct no-filter comparison contains only 20 randomly sampled crashes; it does not establish a general quality law.

## CR-05

- Statement: Code Researcher가 general coding agent에 일반화된다
- Final verdict: `OVERSTATED`
- Status: `resolved`
- Source id: `ARXIV-2506.11060`
- Adjudication reasoning: The evidence is for systems-code crash resolution: the Linux-kernel benchmark plus 10 FFmpeg crashes. The paper explicitly leaves other systems problems untested, so it does not establish generalization to general coding agents/tasks.
- Scope note: The evidence is for systems-code crash resolution: the Linux-kernel benchmark plus 10 FFmpeg crashes. The paper explicitly leaves other systems problems untested, so it does not establish generalization to general coding agents/tasks.

## CTIM-01

- Statement: CTIM-Rover는 어떤 configuration에서도 AutoCodeRover를 이기지 못했다
- Final verdict: `SUPPORTED`
- Status: `resolved`
- Source id: `ARXIV-2505.23422`
- Adjudication reasoning: This is the authors' conclusion for the configurations evaluated on their 45-instance SWE-bench Verified subset.
- Scope note: This is the authors' conclusion for the configurations evaluated on their 45-instance SWE-bench Verified subset.

## CTIM-02

- Statement: Episodic memory는 knowledge가 아니라 noise다
- Final verdict: `OVERSTATED`
- Status: `resolved`
- Source id: `ARXIV-2505.23422`
- Adjudication reasoning: The authors advance a qualitative, configuration-specific hypothesis that noisy CTIM items or exemplars caused degradation. They do not conclude that episodic memory in general is noise rather than knowledge.
- Scope note: The authors advance a qualitative, configuration-specific hypothesis that noisy CTIM items or exemplars caused degradation. They do not conclude that episodic memory in general is noise rather than knowledge.

## CTIM-03

- Statement: Memory arm은 token도 더 썼다
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ARXIV-2505.23422`
- Adjudication reasoning: The figures are verbatim from Table 3 and every CTIM/exemplar configuration does exceed the AutoCodeRover baseline mean of 11,414.02, with CTIM-Rover highest at 17,544.93. Two qualifiers keep this from being unscoped. First, Table 3 is descriptive summary statistics on a 45-instance test set with no significance testing and heavily overlapping ranges (CTIM only spans 4,438-46,983 against the baseline's 3,654-31,408). Second, the ordering does not hold on every statistic: the General CTIM only median of 9,984 sits just below the baseline median of 10,027, so 'the memory arm used more tokens' is
- Scope note: The figures are verbatim from Table 3 and every CTIM/exemplar configuration does exceed the AutoCodeRover baseline mean of 11,414.02, with CTIM-Rover highest at 17,544.93. Two qualifiers keep this from being unscoped. First, Table 3 is descriptive summary statistics on a 45-instance test set with no significance testing and heavily overlapping ranges (CTIM only spans 4,438-46,983 against the baseline's 3,654-31,408). Second, the ordering does not hold on every statistic: the General CTIM only median of 9,984 sits just below the baseline median of 10,027, so 'the memory arm used more tokens' is

## DRAFT-01

- Statement: DRAFT는 4,911 ADR을 사용했다
- Final verdict: `SUPPORTED`
- Status: `resolved`
- Source id: `ARXIV-2504.08207`
- Adjudication reasoning: The 4,911 count is the final, preprocessed ADR dataset used by this study.
- Scope note: The 4,911 count is the final, preprocessed ADR dataset used by this study.

## DRAFT-02

- Statement: DRAFT가 모든 면에서 가장 좋았다
- Final verdict: `OVERSTATED`
- Status: `resolved`
- Source id: `ARXIV-2504.08207`
- Adjudication reasoning: DRAFT/Flan-T5 led the automated metrics, but the human evaluation reports weaknesses on custom contexts and better overall feedback for DRAFT/Llama. It was not best in every respect.
- Scope note: DRAFT/Flan-T5 led the automated metrics, but the human evaluation reports weaknesses on custom contexts and better overall feedback for DRAFT/Llama. It was not best in every respect.

## DRAFT-03

- Statement: DRAFT는 decision 생성 문제를 다룬다
- Final verdict: `SUPPORTED`
- Status: `resolved`
- Source id: `ARXIV-2504.08207`
- Adjudication reasoning: The study targets generation of a Design Decision from a Decision Context, rather than autonomous generation of a complete ADR from a codebase.
- Scope note: The study targets generation of a Design Decision from a Decision Context, rather than autonomous generation of a complete ADR from a codebase.

## DRAFT-04

- Statement: Fully autonomous final decisions가 권장된다
- Final verdict: `MISATTRIBUTED`
- Status: `resolved`
- Source id: `ARXIV-2504.08207`
- Adjudication reasoning: Neither auditor's label is quite the dispute I found, but auditor 2's is correct and auditor 1's is not: OVERSTATED presupposes the source supports some weaker form of the claim, and here there is no weaker form to fall back on. The paper's closing recommendation runs in the opposite direction. It names fully automated ADD generation as the thing not to aim for, and specifies that generated decisions serve as recommendations subject to architect review, modification and approval. Citing this paper for a recommendation of fully autonomous final decisions attributes to it a position it explicitl
- Scope note: Neither auditor's label is quite the dispute I found, but auditor 2's is correct and auditor 1's is not: OVERSTATED presupposes the source supports some weaker form of the claim, and here there is no weaker form to fall back on. The paper's closing recommendation runs in the opposite direction. It names fully automated ADD generation as the thing not to aim for, and specifies that generated decisions serve as recommendations subject to architect review, modification and approval. Citing this paper for a recommendation of fully autonomous final decisions attributes to it a position it explicitl

## PR-01

- Statement: 33k agent PR 연구는 33,596 PR, overall merge 71.48%를 분석했다
- Final verdict: `SUPPORTED`
- Status: `resolved`
- Source id: `ARXIV-2601.15195`
- Adjudication reasoning: These are the aggregate counts and overall merge rate for the study's five-agent AIDev dataset.
- Scope note: These are the aggregate counts and overall merge rate for the study's five-agent AIDev dataset.

## PR-02

- Statement: documentation 84%, CI 79%, build 74%, performance 55%, fix 64%
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ARXIV-2601.15195`
- Adjudication reasoning: The five figures are verbatim and measured. Scope is required on two counts. The population is 33,596 agent-authored GitHub PRs from five agents, labelled with task categories supplied by the dataset, and it is heavily skewed: OpenAI Codex contributes 21,799 of 33,596 PRs and has the highest merge rate at 82.59%, so the cross-agent aggregate largely tracks one agent. More directly, the paper's own per-agent breakdown in the same paragraph shows these are not stable task-type constants: documentation ranges from 0.92 (Codex) to 0.61 (Copilot), build from 0.88 (Claude Code) to 0.57 (Cursor), CI
- Scope note: The five figures are verbatim and measured. Scope is required on two counts. The population is 33,596 agent-authored GitHub PRs from five agents, labelled with task categories supplied by the dataset, and it is heavily skewed: OpenAI Codex contributes 21,799 of 33,596 PRs and has the highest merge rate at 82.59%, so the cross-agent aggregate largely tracks one agent. More directly, the paper's own per-agent breakdown in the same paragraph shows these are not stable task-type constants: documentation ranges from 0.92 (Codex) to 0.61 (Copilot), build from 0.88 (Claude Code) to 0.57 (Cursor), CI

## PR-03

- Statement: Duplicate 142건, paper가 23%로 보고했다
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ARXIV-2601.15195`
- Adjudication reasoning: The 142 and 23% figure is from the qualitative rejected-PR sample (initially 600; 38 later inaccessible), not from all 33,596 PRs.
- Scope note: The 142 and 23% figure is from the qualitative rejected-PR sample (initially 600; 38 later inaccessible), not from all 33,596 PRs.

## PR-04

- Statement: Unwanted feature 24건(4%)
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ARXIV-2601.15195`
- Adjudication reasoning: This category count and percentage are from the manually annotated rejected-PR sample, not the full agentic-PR dataset.
- Scope note: This category count and percentage are from the manually annotated rejected-PR sample, not the full agentic-PR dataset.

## PR-05

- Statement: Reviewer abandonment 228건(38%)
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ARXIV-2601.15195`
- Adjudication reasoning: This count/percentage is from the manually annotated rejected-PR sample; the category means no meaningful human reviewer interaction before closure, not an established reason for every non-merge.
- Scope note: This count/percentage is from the manually annotated rejected-PR sample; the category means no meaningful human reviewer interaction before closure, not an established reason for every non-merge.

## PR-06

- Statement: Review comments/revisions의 effect size가 작다
- Final verdict: `SUPPORTED`
- Status: `resolved`
- Source id: `ARXIV-2601.15195`
- Adjudication reasoning: This is the reported small Cliff's-delta difference between merged and not-merged PR distributions; it is not a causal estimate of comments or revisions.
- Scope note: This is the reported small Cliff's-delta difference between merged and not-merged PR distributions; it is not a causal estimate of comments or revisions.

## PR-07

- Statement: 33k paper가 historical rejected decisions의 빈도를 측정했다
- Final verdict: `MISATTRIBUTED`
- Status: `resolved`
- Source id: `ARXIV-2601.15195`
- Adjudication reasoning: Both auditors left this open on the grounds that no supporting span exists, but that absence is determinate rather than undecidable, so I resolve it. The paper measures two things: merge outcomes over 33,596 agentic PRs, and a frequency distribution of twelve rejection patterns over the 562 categorizable PRs from a 600-PR annotated sample (Table 2: Abandoned/Not Reviewed 228, Duplicate PR 142, CI/Test Failure 99, Unwanted Feature 24, and so on). Every one of those patterns describes why the pull request at hand was closed; none is a historical-rejected-decision construct, and none counts the r
- Scope note: Both auditors left this open on the grounds that no supporting span exists, but that absence is determinate rather than undecidable, so I resolve it. The paper measures two things: merge outcomes over 33,596 agentic PRs, and a frequency distribution of twelve rejection patterns over the 562 categorizable PRs from a 600-PR annotated sample (Table 2: Abandoned/Not Reviewed 228, Duplicate PR 142, CI/Test Failure 99, Unwanted Feature 24, and so on). Every one of those patterns describes why the pull request at hand was closed; none is a historical-rejected-decision construct, and none counts the r

## PR2-01

- Statement: AIDev fix PR 중 46.41%가 rejected, 306개 sample을 분석했다
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ARXIV-2606.13468`
- Adjudication reasoning: The 46.41% rate covers 3,225 fix PRs from Copilot, Devin, Cursor, and Claude (Codex excluded); the qualitative analysis is a representative random sample of 306 rejected fixes.
- Scope note: The 46.41% rate covers 3,225 fix PRs from Copilot, Devin, Cursor, and Claude (Codex excluded); the qualitative analysis is a representative random sample of 306 rejected fixes.

## PR2-02

- Statement: Paper는 hints, forbidden constraints, validation guidance를 권장한다
- Final verdict: `SUPPORTED`
- Status: `resolved`
- Source id: `ARXIV-2606.13468`
- Adjudication reasoning: These are the authors' implications/recommendations, not an intervention that was experimentally validated.
- Scope note: These are the authors' implications/recommendations, not an intervention that was experimentally validated.

## PR2-03

- Statement: “Wrong approach”가 CommitLore revival과 동일하다
- Final verdict: `MISATTRIBUTED`
- Status: `resolved`
- Source id: `ARXIV-2606.13468`
- Adjudication reasoning: The taxonomy entry is decisive about its own extension: 'Wrong approach' is a rejection sub-category covering 8 of the 306 sampled non-merged PRs (2.6%), applying where the issue at hand was resolved by a different implementation, evidenced by reviewer comments such as 'went a different way'. CommitLore appears nowhere in the paper. What I am ruling is that the cited source does not establish the asserted equivalence, not that the two constructs are provably distinct, which this paper cannot decide either; that is sufficient to settle the row, because an identity claim cited to a source contai
- Scope note: The taxonomy entry is decisive about its own extension: 'Wrong approach' is a rejection sub-category covering 8 of the 306 sampled non-merged PRs (2.6%), applying where the issue at hand was resolved by a different implementation, evidenced by reviewer comments such as 'went a different way'. CommitLore appears nowhere in the paper. What I am ruling is that the cited source does not establish the asserted equivalence, not that the two constructs are provably distinct, which this paper cannot decide either; that is sufficient to settle the row, because an identity claim cited to a source contai

## SWE-01

- Statement: SWE-ContextBench는 1,100 base + 376 related tasks, 51 repos, 9 languages다
- Final verdict: `SUPPORTED`
- Status: `resolved`
- Source id: `ARXIV-2602.08316`
- Adjudication reasoning: These are the benchmark's stated aggregate counts.
- Scope note: These are the benchmark's stated aggregate counts.

## SWE-02

- Statement: no-context 26.26%, free context 26.26%, oracle full 27.27%, free summary 22.22%, oracle summary 34.34%
- Final verdict: `SUPPORTED`
- Status: `resolved`
- Source id: `ARXIV-2602.08316`
- Adjudication reasoning: All five values match Table 4 exactly. No scope note is needed because the claim's own citation already carries it: 'Table 4, SWE-ContextBench Lite 99 tasks' matches the table caption ('99 related tasks from SWE-ContextBench Lite') and is corroborated in the efficiency section ('we evaluate all five settings on the 99 related tasks, yielding 495 runs in total'). A reader following that citation lands on exactly the right rows. The one detail left unstated is the model, Claude Sonnet 4.5, which is held constant across all five rows and so does not affect the comparison the figures express. One
- Scope note: All five values match Table 4 exactly. No scope note is needed because the claim's own citation already carries it: 'Table 4, SWE-ContextBench Lite 99 tasks' matches the table caption ('99 related tasks from SWE-ContextBench Lite') and is corroborated in the efficiency section ('we evaluate all five settings on the 99 related tasks, yielding 495 runs in total'). A reader following that citation lands on exactly the right rows. The one detail left unstated is the model, Claude Sonnet 4.5, which is held constant across all five rows and so does not affect the comparison the figures express. One

## SWE-03

- Statement: Oracle summary는 baseline보다 +8.08pp, free summary는 오히려 낮다
- Final verdict: `SUPPORTED`
- Status: `resolved`
- Source id: `ARXIV-2602.08316`
- Adjudication reasoning: Both halves check out against the cited Table 4 and section 3.3.1. The +8.08pp figure is arithmetic on the two percentages the quoted sentence itself reports (34.34 minus 26.26), and the paper performs the identical operation one sentence later when it says Oracle Summary Learning 'outperforms Free Summary Learning by 12.12 points' (34.34 minus 22.22), so this is restatement within the source's own idiom rather than inference beyond it. The second half reads directly off the same table: Free Summary Learning resolves 22.22%, below the 26.26% baseline, and the section closes by characterising s
- Scope note: Both halves check out against the cited Table 4 and section 3.3.1. The +8.08pp figure is arithmetic on the two percentages the quoted sentence itself reports (34.34 minus 26.26), and the paper performs the identical operation one sentence later when it says Oracle Summary Learning 'outperforms Free Summary Learning by 12.12 points' (34.34 minus 22.22), so this is restatement within the source's own idiom rather than inference beyond it. The second half reads directly off the same table: Free Summary Learning resolves 22.22%, below the 26.26% baseline, and the section closes by characterising s

## SWE-04

- Statement: 어려운 task에서 runtime이 60% 이상 감소했다
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ARXIV-2602.08316`
- Adjudication reasoning: The result applies to the slowest instances among harder tasks under oracle summaries; it is a tail result, not an average reduction across difficult tasks.
- Scope note: The result applies to the slowest instances among harder tasks under oracle summaries; it is a tail result, not an average reduction across difficult tasks.

## SWE-05

- Statement: Summary reuse가 평균 token cost를 줄였다
- Final verdict: `OVERSTATED`
- Status: `resolved`
- Source id: `ARXIV-2602.08316`
- Adjudication reasoning: For the Table 4 Lite experiment, oracle and free summary cost more than the no-context baseline on average; the paper explicitly says summary reuse did not reduce cost relative to baseline in this setup.
- Scope note: For the Table 4 Lite experiment, oracle and free summary cost more than the no-context baseline on average; the paper explicitly says summary reuse did not reduce cost relative to baseline in this setup.

## SWE-06

- Statement: 틀린·unfiltered context는 제한적 또는 negative benefit을 만든다
- Final verdict: `SUPPORTED_WITH_SCOPE`
- Status: `resolved`
- Source id: `ARXIV-2602.08316`
- Adjudication reasoning: This sentence is the paper summarising its own measurements rather than importing a background assertion, and Table 4 backs both halves of it: Free Context Learning resolves 26.26%, exactly matching the no-context baseline (limited benefit), and Free Summary Learning resolves 22.22%, below it (negative benefit). Table 5 supplies the mechanism, showing Free Context Learning self-selecting 136,907-token top-1 contexts while matching the correct context only 18.18% of the time. Scope is nonetheless required, and this is where the row differs from SWE-02 and SWE-03: those restate values under a ci
- Scope note: This sentence is the paper summarising its own measurements rather than importing a background assertion, and Table 4 backs both halves of it: Free Context Learning resolves 26.26%, exactly matching the no-context baseline (limited benefit), and Free Summary Learning resolves 22.22%, below it (negative benefit). Table 5 supplies the mechanism, showing Free Context Learning self-selecting 136,907-token top-1 contexts while matching the correct context only 18.18% of the time. Scope is nonetheless required, and this is where the row differs from SWE-02 and SWE-03: those restate values under a ci

## SWE-07

- Statement: Context를 전달하면 agent가 따른다
- Final verdict: `OVERSTATED`
- Status: `resolved`
- Source id: `ARXIV-2602.08316`
- Adjudication reasoning: The study expressly finds that provision or retrieval of context does not ensure that an agent uses it correctly; inaccurate prior assumptions can mislead it.
- Scope note: The study expressly finds that provision or retrieval of context does not ensure that an agent uses it correctly; inaccurate prior assumptions can mislead it.
