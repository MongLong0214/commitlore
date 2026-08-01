<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="CommitLore：编程代理不得复活仓库已经推翻的决策。">
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="许可证: MIT" src="https://img.shields.io/badge/license-MIT-3f6b52"></a>
  <a href="package.json"><img alt="Node.js 22 或更高版本" src="https://img.shields.io/badge/Node.js-%3E%3D22-3f6b52"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <strong>简体中文</strong>
</p>

# CommitLore

## 不再重复评审同一个坏主意。

编程代理能读代码，却看不到六个月前团队为什么否决了那个显而易见的修复 —— 于是它再次提出，
而有人要花一次评审去解释一个早已做出的决定。

**编程代理不得复活仓库已经推翻的决定。** CommitLore 把约束、被否决的替代方案、警告和验证
缺口记录在 Git 中，并在下一次编辑前只呈现**当下仍然有效的决定**。

Claude Code · Codex · Cursor · Gemini CLI · OpenCode · Windsurf

**面向 AI 辅助代码库的 Git-native 决策权威。** CommitLore 在 Git 中直接追踪哪些决策仍然有效、哪些已被推翻。编程代理查询路径时，只能看到当前有效的决策。

没有托管记忆服务，也没有特定供应商的聊天历史。只有由仓库拥有并随仓库流转、可供审查的决策上下文。

安装一次。你的编程代理可以记录值得延续的决策，而 CommitLore 会验证它们并将其保存在 Git 中。

**Claude Code** — 一个插件即可注册 MCP 服务器、编辑前上下文钩子与技能:

```
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

两条路径的前置条件都是 Node.js 22+ 与 Git。脚本在写入任何内容之前会检查这两项。

**其他编程代理** — 安装 CLI:

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v0.5.0/install.sh | sh
```

支持哪些 host，以及各条安装路径需要什么：[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。

## 看它实际运行

<p align="center">
  <img src="./assets/readme/commitlore-demo.svg" width="100%" alt="commitlore demo: lifecycle filtering shows only active decisions">
</p>

**一个全新的代理，没有聊天历史。它仍知道为什么那个显而易见的修复被排除了。** 在改动前查询 path：

```bash
commitlore context install.sh
```

输出会包含一条 active record：它排除了把发布 `-musl` target 当作 installer 缺陷修复的做法，并说明原因。hook 提供上下文；它并不声称会阻止编辑。

```console
context for install.sh as of <timestamp> — 0 limits, 1 ruled-out, 1 warnings, 2 other in 1 record (no index, 1 commit record(s) scanned)

ruled-out
  r-instci99a  <commit>  [claim]  Publish a -musl release target | a release.yml/build-matrix change, not an install.sh or CI-verification fix

warnings
  r-instci99a  <commit>  [claim]  Revisit this wording if a musl target ships
```

<details>
<summary>复现完全相同的 PreToolUse hook path</summary>

```bash
printf '%s\n' '{"tool_name":"Edit","tool_input":{"file_path":"install.sh"}}' \
  | node dist/commitlore.mjs inject --hook-input --budget 5000
```

</details>

## 检索能找到记录。路径范围会排除已经推翻的决策。

漏掉一条记录，模型损失的是上下文；交给它一项已经推翻的决策，损失的是正确性。在这项[检索测量](bench/retrieval/result.md)中，从 0 到 10,000 条干扰记录的每个规模，BM25、embedding top-k、hybrid RRF 与带路径过滤的 embedding 都各返回了一条已被替代的记录。带生命周期的 CommitLore 路径范围返回零条过时记录，并返回两条当前记录 (2/2)。

召回率是辅助结果：两种方式的检索大体找到相同的记录，但只有一条路由知道哪些仍然有效。在没有已被替代记录的 #166 语料库中，embedding 检索与路径范围同为 2/2。决策被推翻时优势才会出现——而这正是本产品存在的情形。

独立的 #167 暴露运行仍然重要：10,002 条记录中只有 2 条到达模型。

| 路由 | 模型可见记录 | 相关记录 | 模型可见令牌 |
|---|---:|---:|---:|
| 注入全部内容 | 10,002 | 2/2 | 1,004,554 |
| top-k 词法检索 | 2 | 1/2 | 190 |
| CommitLore 路径范围 | 2 | 2/2 | 335 |

这项测量是在固定的两条记录输出预算下进行的暴露与召回率测量，不测量令牌成本、计费成本、准确率或代理行为。它只涉及一个语料库、一个查询和一个固定的 embedding 模型。

然后在每个需要验证 hook 与本地 index 的仓库运行 `commitlore init`。安装程序会检测受支持的编程代理，并在可以安全处理的地方注册本地 MCP server。

## init 之后会发生什么

- 照常提交。绝大多数提交没有 record。
- 如果已有 record，commit-msg hook 会验证它；不会创建 record。
- 代理通过 MCP 查询决策上下文，或从 `PreToolUse` hook 接收它。
- 更改 path 前，它们会看到 active limit、ruled-out alternative、warning 和 verification gap。

## 在仓库中试用

```bash
cd your-repository
commitlore init
commitlore context .
```

然后继续通过编程代理工作。若某项更改包含 diff 无法保存的决策上下文，请让代理在提交中加入 CommitLore record。

<details>
<summary>想检查或固定安装版本？</summary>

这一行命令是为了方便。若需要经过审阅或固定版本的安装，请先下载并检查 `install.sh`，或 clone 仓库。脚本只安装一个固定标签的源码检出，以及一个运行 `node <checkout>/dist/commitlore.mjs` 的薄 wrapper —— 它不下载任何编译产物，也没有构建步骤，因此放到机器上的就是你能阅读的源码。

```bash
# 固定版本并检查 installer 后再执行。
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v0.5.0/install.sh
sh install.sh v0.5.0

# 或者完全不用脚本：它创建的检出，你自己也能创建。
git clone --depth 1 --branch v0.5.0 https://github.com/MongLong0214/commitlore
node commitlore/dist/commitlore.mjs --version
```

</details>

## 看看差别

**没有 CommitLore。** 新会话看到两个输入相似的函数，复用了其中一个。

```ts
calculatePrice(input, { isAdminPreview: true, skipCoupon: true });
```

团队于是多了一个标志、一个包装器，以及一个守护该函数本不该承担的用例的兼容分支。评审者
第二次写下"我们已经否决过这个了"。

**有 CommitLore。** 编辑之前，代理收到：

```
Must respect
  calculatePrice owns final checkout pricing only.

Do not retry without new evidence
  Reusing it for admin quotes was rejected — eligibility and rounding
  semantics differ between the two flows.
```

它转而共享纯计算原语，不去动 checkout 的策略入口。那次评审根本不会发生，因为决定早就在
那里。

## 工作方式

1. **Capture** — 代理只起草 diff 无法呈现的决策上下文。
2. **Verify** — CommitLore 将草稿与会话和暂存 diff 进行核对。
3. **Preserve** — 通过验证的记录带着身份与生命周期留在 Git 中。
4. **Deliver** — 下一个代理在编辑路径前，只收到**当下仍然有效的决定**。

## 在真实仓库中的样子

来自一份约 768 次提交的 Swift MCP 服务器现场报告，安装后第二天。工程师在安装 CommitLore
之前已完成代码库的全面普查，当时正在处理普查标记出的文件。

```
$ commitlore context Sources/LogicProMCP/Accessibility/LibraryAccessor.swift
context for … — 0 limits, 0 ruled-out, 0 warnings, 2 other in 2 records

other
  -  01ff2705  [claim]  ax: eliminate clear-win coordinate actuations (8 sites)
                        with live-verified AX paths
```

> **我不知道那个提交存在。** 那是两周前合并的 PR，已经移除了其中八处，并把每一处都换成了
> accessibility-native 的等价实现，全部 fail-closed 并经过真机验证。
>
> 它重新定位了我的普查。我一直把剩下的站点当作问题**本身**。不是的。它们是一次已发布的
> 移除行动之后的**残余** — 是在一次有意的移除尝试中存活下来的那些。这是完全不同的工程
> 问题，也是不同的风险评估。
>
> 这些都不在任何聊天记录里。它们在仓库里，而我只是给出了一个文件路径。

替代方案是通读两周的已合并 PR。这不是代理会主动做的事，也不是人在每次编辑前会做的事。

同一份报告中的接入成本：一条命令，768 次提交索引耗时 7.4 秒。不触碰历史，也不触碰工作区。

**托管式聊天记录产品无法提供的三个性质**，也是把权威放在 Git 而非服务上的理由：

| 工具 | 它记住什么 |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | 代理应该如何工作 |
| ADR | 以文档形式记录大的架构决策 |
| Chat memory / RAG | 过去的相关文本 |
| **CommitLore** | **对这条代码路径当下仍然有效的决定** |

相似度检索能找到相关的决定。CommitLore 还知道那个决定是否仍然有效、是否已被取代或过期 ——
并且只呈现第一种。

## 有何不同

- **CLAUDE.md 告诉代理如何工作。CommitLore 告诉它这段代码为何存在。**
- **ADR 记录架构。CommitLore 记录藏在 diff 中的决策。**
- **不是又一个 memory database，而是构建在 Git 中的 decision protocol。**

权威来源是普通的 commit trailer 与 `refs/notes/commitlore`。index 和 report 都从这些 Git record 派生，且可以重建。

## 在哪里见效

**守住模块边界。** *"`calculatePrice` 只负责最终的 checkout 定价。不要复用于管理员预览。"*

**保留被否决的权宜之计。** *"调高超时会掩盖连接泄漏。请修复 cleanup 路径。"*

**标记临时兼容代码。** *"这个调用方是临时的，不属于受支持的契约。"*

**传递验证缺口。** *"单用户行为已测试。并发刷新仍未验证。"*

每一条都是 diff 无法承载的句子，否则评审者就得说第二遍。

## record 如何创建

不必为每次提交手写 trailer。绝大多数提交都不应带 record。只在 diff 无法还原的决策中添加 record：外部限制、排除的方案、warning 或 verification gap。

### 通过编程代理

让代理照常提交，只保留 diff 无法解释的决策上下文：

> 提交这项更改。只有当 diff 无法还原重要限制、排除的方案、warning 或 verification gap 时，才添加 CommitLore record。

绝大多数提交仍不应带 record。代理说明位于 `skills/commitlore-commits/`，commit hook 会验证代理添加的任何 record。

### 高级路径：harvest

`commitlore harvest` 从 session transcript 和 staged diff 构建 prompt contract；`commitlore harvest-verify` 据此检查 draft。它们支持起草，而不会自动提交。interactive record builder 尚未实现。

### 手写

作为逃生出口，人可以手写普通 Git trailer。commit-msg hook 只验证已经存在的 record；它不会凭空创建或静默添加 record。

## 最小 record

record 可以很小。只包含否则会丢失的上下文：

```text
Fix expired-token refresh

Ruled-out: Extend token TTL to 24h | security policy violation
Warn: Do not narrow the 4xx handler without verifying upstream behavior
```

绝大多数 record 不需要所有 protocol field。决策需要时，可以使用 identity、lifecycle、risk、provenance 和 verification field。

## 完整 record

这个示例也是 conformance fixture。Git trailer parser 会在所有翻译版 README 中以相同方式读取下面的 code block。

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

### Protocol vocabulary

| Trailer | Meaning |
|---|---|
| `Limit:` | External condition that constrained the decision |
| `Record-Id:` | Stable identity across rewritten commit hashes |
| `Ruled-out:` | `alternative \| reason` |
| `Certainty:` | `firm` \| `tentative` \| `guess` |
| `Blast:` | `local` \| `module` \| `system` |
| `Undo:` | `easy` \| `costly` \| `permanent` |
| `Warn:` | Warning for a future modifier; trust-graded before delivery |
| `Verified:` / `Unverified:` | What was and was not checked |
| `Follows:` / `Supersedes:` | Decision-chain and lifecycle links |
| `Expires:` | Date or condition that ends a limit |
| `Evidence:` | Path, anchor, or URL supporting a claim |
| `Provenance:` | `authored` \| `inherited <sha>` \| `reconstructed` |
| `CommitLore-Version:` / `X-*:` | Protocol identity and extensions |

用 `commitlore context <path>` 读取 path 的历史，或直接使用 Git：

```bash
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

请使用 Git trailer parser，而不是 text search：正文里的 `Key:` 不一定是 trailer。

## 仓库能够证明什么

- 在经过测试的 Git workflow 中，决策历史会跨越 rebase、squash、remote transfer 与 path rename 保留下来。
- 所有 route 使用相同的 trust grading，因此不受信任的 text 会作为 information 而不是 instruction 传递。
- free-form trailer 中类似 injection 的 text 会从 model-readable route 中被保留。
- 可读取的 repository 没有 record，与不完整的 history 或未 fetch 的 notes mirror 是不同状态。

这是关于绑定到 Git、可由人验证的决策历史的产品主张。它不依赖“CommitLore 提升 agent performance”的主张。

## Evidence：更窄的产品主张

已记录 112 次实验，但 M4 没有逐次运行的 `guard_exposure` 记录。无法验证 treatment 是否存在，因此它没有检验、支持或反驳 agent behavior 的主张。上面更窄的产品主张基于可独立验证的行为。关于干净的数据集和撤回，请见 [M4 verdict](bench/VERDICT-M4.md)。

### 延迟、成本与盈亏平衡

在 100,000 次提交时，已建立索引的 `context` 的 p50 为 496 ms；CommitLore 自身的 `--no-index` 后备路径为 86,673 ms。这一内部后备路径差距在 1k 时为 4.8×、10k 时为 36×、100k 时为 175×（[完整的确定性运行](https://github.com/MongLong0214/commitlore/blob/2fade893f25917fce1ffb497aab96b1eb271a185/bench/results/deterministic-20260729T032652Z.md)）。这是扩展形态，不是产品与替代方案的比较结果。

guard 每次运行的成本是注入的 context 加上测得的 hook overhead：commit-msg 的 p50 为 185.85 ms，injection hook 的 p50 为 102.40 ms（[deterministic measurements](bench/results/deterministic-20260727T174801Z.md)）。

要重新给出盈亏平衡数值，需要一份逐轮记录、由提供商报告的令牌用量账本，以及为仓库已经否决的替代方案所花工作的观测成本。

<details>
<summary>完整 benchmark 记录（112 次实验）</summary>

<!-- BENCH:BEGIN -->
<!-- Generated by `node bench/report.ts --section` from the result logs named below. Do not edit by hand:
     CI regenerates this block and fails if a single byte differs (scripts/check-readme-numbers.mjs). -->

**112 runs recorded.** No manifest declares how many runs the matrix was meant to produce, so completeness cannot be checked from the logs alone.

| Where it comes from | |
|---|---|
| Results | `bench/results/t702-m4-final.jsonl` (112 rows) |
| Run id | `20260727T120103Z-aa5eab`, `20260728T025523Z-db4659`, `20260728T025635Z-e3d669`, `20260728T025817Z-d8d0dc` |
| Driver | `claude-headless` |
| Model | not recorded |
| Matrix | 8 tasks, seeds 1, 2, 3, 4, 5, 6, 7 |
| Status | final (declared in `bench/report.ts`, pending a manifest field) |

**Re-proposal and violation rates, every recorded run:**

| Condition | n | Re-proposed | Re-proposal rate | Runs with violations | Violation rate | Mean turns | Mean tokens |
|---|---|---|---|---|---|---|---|
| `commitlore-guard` | 56 | 41 | 0.732 | 0 | 0.000 | 14.8 | 18965 |
| `commitlore-on` | 56 | 35 | 0.625 | 0 | 0.000 | 14.2 | 18091 |

**Analysis set — all 112 rows.** Nothing was excluded: no simulated rows, no failed runs, no run that never started.

**Significance:** not computed — guard exposure is unknown for 112 analysis rows

**How the runs ended** — failures are reported, not filtered:

| Condition | completed | timeout | over-turns | over-tokens | error |
|---|---|---|---|---|---|
| `commitlore-guard` | 56 | 0 | 0 | 0 | 0 |
| `commitlore-on` | 55 | 0 | 1 | 0 | 0 |

**Read these numbers with their limits:**

- No model is recorded — neither on the rows nor in a manifest. A re-proposal rate whose model is unknown is not a comparable number, and these figures must not be quoted against another model's.
- Every rate here is conditional on the model that produced it. Re-proposal is a behaviour, and behaviours differ between models, so these figures are not evidence about any other model.
- 112 runs in the analysis set: this matrix is only powered to detect a large effect, so a non-significant result from it is a statement about the sample size, not about CommitLore. The exact power table is in [`bench/README.md`](bench/README.md).
<!-- BENCH:END -->

</details>

## 从 source 安装

要检查或运行 source distribution，请使用：

```bash
git clone https://github.com/MongLong0214/commitlore ~/.commitlore
node ~/.commitlore/dist/commitlore.mjs init
node ~/.commitlore/dist/commitlore.mjs context src/auth
```

## 卸载

```bash
commitlore uninstall
```

移除 `install.sh` 或 `install.ps1` 写入的内容 — wrapper、固定的 checkout，以及它
添加到各 agent config 的 MCP 条目。它不会移除自己没有写入的东西，并会明确说明留下
了什么：每个仓库的 hook（`commitlore hooks uninstall`）、agent hook
（`commitlore inject uninstall-claude-hook`）、Claude Code plugin
（`/plugin uninstall commitlore@commitlore`）。`--dry-run` 只报告，不做任何更改。

## 已知限制

- 尚未实现 cryptographic author verification、repository-wide record coverage、symbol anchor 和 interactive record builder：[#28](https://github.com/MongLong0214/commitlore/issues/28)、[#32](https://github.com/MongLong0214/commitlore/issues/32)、[#33](https://github.com/MongLong0214/commitlore/issues/33)、[#34](https://github.com/MongLong0214/commitlore/issues/34)。
- M4 没有检验 guard 效果：row 没有 `guard_exposure`，因而无法验证 treatment exposure（[#122](https://github.com/MongLong0214/commitlore/issues/122)）。
- Guard（ruled-out alternative matching）是实验性参考信息：precision 44.8%（95% Wilson CI 32.7%–57.5%），recall 22.0%，基于 417-decision corpus（[ADR-0020](docs/adr/ADR-0020-guard-is-an-experimental-advisory.md)）。空的 guard 结果不保证提案避开了所有 ruled-out alternative——在 recall 22% 下，遗漏才是常态。

## 贡献

请阅读 [spec](spec/SPEC.md)、[ADR](docs/adr/) 和 [`CONTRIBUTING.md`](CONTRIBUTING.md)。CommitLore 是采用 [MIT License](LICENSE) 的永久免费开源软件。
