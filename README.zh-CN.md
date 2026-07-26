# CommitLore

[English](README.md) | [한국어](README.ko.md) | **简体中文** | [日本語](README.ja.md)

> **把 git commit trailer 变成 AI 编码智能体的组织记忆。**
> 永久免费。无服务器、无数据库、无付费计划 —— **git 就是唯一事实来源（SSOT）。**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-v0.1.0_已发布-brightgreen.svg)](https://github.com/MongLong0214/commitlore/milestones)
[![Protocol](https://img.shields.io/badge/protocol-CommitLore_v2-8A2BE2.svg)](docs/adr/ADR-0001-scope-v010.md)

> ⚠️ **状态**：协议本身**今天**就能用纯 git 使用（见[立即使用](#立即使用纯-git)）。
>
> **v0.1.0 已发布。** CLI、MCP 服务器、钩子和 GitHub Actions 均已实现，并在 `main` 上通过 CI。分发方式只有 git clone —— 没有注册表、没有账号、没有发布步骤（[ADR-0011](docs/adr/ADR-0011-plugin-first-distribution.md)）。
>
> clone 就是完整安装：`dist/commitlore.mjs` 自带依赖，无需安装，也无需构建。
>
> 本 README 的每个论断要么现在可复现，要么明确标注为计划，数字只会来自 [CommitLoreBench](docs/prd/PRD-F7-commitlorebench.md) 日志。本仓库在 CI 中对自己的历史强制执行自己的协议 —— 见[狗粮是强制的](CONTRIBUTING.md#dogfooding-is-enforced-not-aspirational)。

---

## 问题：你的智能体是一位每个会话都会离职的资深工程师

如今大量提交由 AI 智能体完成。工作中的智能体掌握着完整的决策上下文 —— 它发现的约束、尝试后否决的替代方案、有意未测试的部分。然后会话结束，上下文窗口消亡，**只有 diff 幸存**。

下一个会话（或下一个智能体、下一位同事）会重新推导一切 —— 并且经常**重新提出三周前刚被否决的那个方案**，因为没有任何地方记录过它被否决，以及为什么。

四十年来，这被称为*设计依据捕获问题（design rationale capture problem）*，始终无解，原因只有一个：人类不愿支付记录依据的成本。**智能体改变了这个经济学。** 提交时，依据已经完整存在于智能体的上下文中，序列化只需几百个 token。CommitLore 就是回答"把它放在哪里"的协议。

## 三行核心

1. **捕获是免费的** —— 智能体本来就知道"为什么"，它把结构化的 *git trailer* 写进本来就要创建的提交里。无法引用证据的 trailer 会被验证器丢弃。
2. **消费是 push 而非 pull** —— 当智能体触碰某个文件时，*该路径*的活跃约束与历史否决会被自动注入。没有人需要记得去查询。
3. **git 是唯一事实来源** —— 知识原子存在于提交信息和 `refs/notes/commitlore` 中。其余一切（索引、面板）都是可丢弃的派生缓存。一次 `git clone` 就带走全部记忆。

## 长什么样

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

这是一个普通的 git 提交。书写无需任何工具，git 自身即可解析 —— trailer 是 git 原生特性（`Signed-off-by`、Gerrit 的 `Change-Id`、Conventional Commits 的 footer 用的是同一机制）。

### Protocol v2 词汇表

| Trailer | 用途 | 消费方 |
|---|---|---|
| `Limit:` | 塑造决策的外部约束 | 注入、`commitlore limits` |
| `Record-Id:` | 稳定身份 —— 取代/废止的锚点 | 生命周期折叠 |
| `Ruled-out:` | `方案 \| 理由` —— 试过并放弃的 | **`commitlore guard`**（拦截重复提案） |
| `Certainty:` | `firm` \| `tentative` \| `guess` | 评审路由 |
| `Blast:` | `local` \| `module` \| `system` | 审批门路由 |
| `Undo:` | `easy` \| `costly` \| `permanent` | 审批门路由 |
| `Warn:` | 给未来修改者的警告 | 注入（按信任分级） |
| `Verified:` / `Unverified:` | 已验证 / 未验证 | 覆盖查询 |
| `Follows:` | 串联决策链的提交 | 上下文组装 |
| `Supersedes:` | 废止早前的 Record-Id | **过期引擎** |
| `Expires:` | 约束终止的日期或条件 | 过期引擎 |
| `Evidence:` | 论断→证据链接（`路径#锚点`） | 收获验证器 |
| `Provenance:` | `authored` \| `inherited <sha>` \| `reconstructed` | **信任分级** |
| `CommitLore-Version:` / `X-*` | 身份、版本、扩展 | 工具链 |

设计规则（["禁止死字段"](docs/adr/ADR-0006-push-injection.md)）：每个 trailer 至少有一个消费路由 —— 查询、门禁或注入规则。没人读的词汇会从规范中删除。

## 快速上手

不需要注册表、包管理器或账号。先拿到代码：

```bash
git clone https://github.com/MongLong0214/commitlore ~/.commitlore
```

然后只看你自己那一行。每一行的终点都一样 —— 智能体在动手改文件**之前**
就看到这条路径上的决定。

| 你的智能体 | 设置 |
|---|---|
| **所有 MCP 客户端** —— Codex、Gemini CLI、Cursor、Cline、Windsurf、Zed、Qwen Coder、Kimi… | 添加下面的服务器配置 |
| **Claude Code** | `/plugin marketplace add MongLong0214/commitlore` → `/plugin install commitlore` |
| **任何能执行 shell 的智能体** | 把 [`AGENTS.md`](AGENTS.md) 复制到你的仓库 |
| **完全不用智能体** | 纯 `git log` —— 见[下文](#立即使用纯-git) |

**MCP 服务器配置** —— 任何讲 MCP 的客户端里都是同样三个工具
(`commitlore_query`、`commitlore_stale`、`commitlore_guard`)：

```json
{
  "mcpServers": {
    "commitlore": {
      "command": "node",
      "args": ["~/.commitlore/dist/commitlore.mjs", "mcp"]
    }
  }
}
```

安装到此为止。智能体在动手改文件前会读取这条路径已经做过的决定；一旦提出被否决过
的方案，`guard` 会告诉它。

**记录就写成普通的提交 trailer** —— 就是上面的例子，没有别的要学。

没有 MCP 客户端时，用命令行拿到同样的答案：

```bash
commitlore context src/auth/                     # 这条路径决定过什么
commitlore guard --proposal "换成 RabbitMQ"       # 已被否决？以非零状态退出
```

**诚实地说说预期。** 记录能挺过 rebase、squash 与重命名，在大型历史上依然很快
（10 万次提交下 p50 1.86ms）。**尚未被证明的**是它能在多大程度上改变智能体的行为
—— 我们自己的基准测试没有跑出显著差异，我们照样公开：
[`bench/VERDICT-M1.md`](bench/VERDICT-M1.md)、
[`bench/ROUTE-GAP.md`](bench/ROUTE-GAP.md)。

## 立即使用（纯 git）

协议零工具依赖。在提交里写 trailer（或交给智能体的指令去写），然后用 git 本身查询：

```bash
# 提取约束值，机器可读 —— git 原生 trailer 解析器
git log --format='%h %(trailers:key=Limit,valueonly,separator=%x3B)'

# 解析某个提交的完整 trailer 块
git log -1 --format=%B <sha> | git interpret-trailers --parse

# 涉及某路径的约束（跟踪重命名）
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

> 注意：用 `%(trailers:...)`，别用 `--grep`。文本 grep 会误匹配正文散文，且在多行折叠时失效 —— 我们[复现了这个失败模式](docs/tickets/F2-core-cli.md)，CLI 存在的意义之一就是让它不可能发生。

## v0.1.0 交付内容（2026-08-23）

| 层 | 交付物 | 里程碑 |
|---|---|---|
| **L0 协议** | `SPEC.md`、JSON Schema、一致性夹具、路由契约测试 | [M1](https://github.com/MongLong0214/commitlore/milestone/1) |
| **L1 核心 CLI** | `commitlore validate / context / limits / ruled-out / warnings / stale / index / doctor` —— SQLite 增量索引、`--no-index` 回退、10 万提交 p50 < 100ms 目标 | [M2](https://github.com/MongLong0214/commitlore/milestone/2) |
| **L1 存续** | `commitlore squash-preserve`（squash 合并继承）、`refs/notes/commitlore` 镜像（rebase 存活）、默认 `--follow` | [M2](https://github.com/MongLong0214/commitlore/milestone/2) |
| **L2 智能体织物** | `commitlore mcp`（MCP 服务器）、自动注入钩子（按路径、限预算、确定性）、transcript 收获 + **证据校验器**、`commitlore guard`、洁净室 skills | [M3](https://github.com/MongLong0214/commitlore/milestone/3) |
| **L3 信任** | provenance × lifecycle 分级、**Warn 降级**（未验证指令只渲染为*主张*，绝不作为指令）、注入启发式、secret guard | [M3](https://github.com/MongLong0214/commitlore/milestone/3) |
| **L4 组织** | GitHub Actions：PR lint + 活跃约束评论、squash 继承自动化 —— 跑在*你自己的* CI 上，零外部调用 | [M4](https://github.com/MongLong0214/commitlore/milestone/4) |
| **L5 CommitLoreBench** | 重复提案率（CommitLore 开/关）、噪声消融、每个被接受原子的成本 —— README 所有数字均可从日志再生 | [M1](https://github.com/MongLong0214/commitlore/milestone/1) / [M4](https://github.com/MongLong0214/commitlore/milestone/4) |

完整计划：[ADR](docs/adr/) · [PRD](docs/prd/) · [票据规格](docs/tickets/TICKETS.md) · [Issues](https://github.com/MongLong0214/commitlore/issues)

## 为什么不直接用……

| 替代方案 | 为什么不够 |
|---|---|
| **ADR / Wiki / Notion** | 独立文件会与代码脱节并腐烂。trailer 与 diff 同处一个提交对象 —— 脱同步在结构上不可能，`git clone` 顺带携带。 |
| **对 Slack/文档做 RAG** | 在低信号产物上做读取时搜索。CommitLore 在写入时*生成*高信号知识，并绑定到它所解释的代码上。 |
| **智能体记忆框架**（向量库） | 无策展的情景记忆经实测会*损害* SE 智能体（噪声）。CommitLore 原子是类型化、证据校验、路径限定、生命周期管理的 —— 每一条都直接回应已发表的失败模式。 |
| **静态上下文文件**（CLAUDE.md / AGENTS.md） | 全局倾倒，实证结果参差。CommitLore 按*路径*、按*等级*、只注入*活跃*内容，且有 token 预算。 |
| **知识库 SaaS** | 组织的决策史不应住在别人的数据库里。这里没有会宕的服务器、没有可取消的订阅 —— 仓库本身就是数据库。 |

## 安全模型（诚实版）

提交信息会成为智能体的指令通道 —— 这意味着它也是注入面。v0.1 交付诚实的最小防御：**未验证的 `Warn:` 在所有注入与查询输出中降级为"主张"**（外部贡献一律降级），注入模式启发式隔离恶意原子，secret guard 阻止凭据被永久刻入。密码学签名（sigstore）[已在计划中](https://github.com/MongLong0214/commitlore/issues/28)，分级模型的设计保证签名接入时不破坏消费者。

## 设计原则

- **用户成本为零，永远。** MIT，无付费层、无遥测、无服务器。依赖 LLM 的功能（收获、backfill）只在你已付费的智能体会话内以 opt-in 方式运行。核心路径 —— parse、query、inject、guard —— 是确定性的、与 LLM 无关。
- **无证据，不成原子。** 收获验证器丢弃任何无法引用 transcript 或 diff 的 trailer。宁缺毋假。
- **工作流不容谈判。** squash、rebase、重命名 —— 知识必须在你的工作流中存活，而不是让工作流迁就工具。
- **要么数字，要么沉默。** 本 README 只引用可从 `bench/results/` 复现的测量值。

## FAQ

**真的免费吗？** 是 —— 全部、永久、MIT。不存在也不计划云版本。可持续性来自标准被采纳，而非销售（[ADR](docs/adr/ADR-0001-scope-v010.md)）。

**支持哪些智能体？** 任何能执行 shell 命令的东西今天就能读这个协议。v0.1.0 集成目标：Claude Code（钩子+skills），以及通过 `commitlore mcp` 的一切支持 MCP 的智能体。提交格式与所有会写提交的智能体兼容 —— 包括人类。

**我们全用 squash 合并，trailer 不就没了？** 默认情况下会 —— 我们亲自复现过。所以才有 `commitlore squash-preserve` + notes 镜像 + GitHub Action（[ADR-0004](docs/adr/ADR-0004-workflow-survival.md)）。

**超大仓库呢？** 索引是 `.git/commitlore/` 下的增量 SQLite 缓存，一条命令重建，永不提交。目标：10 万提交路径查询 p50 < 100ms —— 在 CI 中测量，不是口头承诺。

**能和 Conventional Commits 一起用吗？** 可以。CommitLore trailer 就是 git footer，与 Conventional Commits 的 `BREAKING CHANGE` 使用同一机制。保留 `feat:` / `fix:` 标题行，在正文下方追加 trailer 即可，commitlint 与 semantic-release 照常工作。

## 参与贡献

规范（F1）最先落地 —— 一致性套件即契约，欢迎并可验证替代实现。从 [good first issue](https://github.com/MongLong0214/commitlore/issues) 开始，"为什么"请读 [ADR](docs/adr/)。本仓库的历史本身就在吃自己的狗粮：在这里 `git log --format='%h %(trailers:key=Ruled-out,valueonly)'` 真的能用。

## 许可证

[MIT](LICENSE)
