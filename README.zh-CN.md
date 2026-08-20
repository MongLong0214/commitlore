<!-- README:BRAND -->
<p align="center">
  <img src="./assets/readme/commitlore-logo.svg" width="440" alt="CommitLore">
</p>

<h1 align="center">CommitLore</h1>

<h3 align="center">你的编程代理不断重新提议团队早已否决的方案。</h3>

<p align="center">
  <strong>由 Git 所有的编程代理决策权威。</strong><br>
  把约束、已否决的替代方案和警告保存在 Git 中，只交付仍然有效的内容。
  这样代理就不会把仓库早已推翻的决定当作当前指引。
</p>

<p align="center">
  <strong>CommitLore 没有托管服务。record 归仓库所有。</strong>
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml/badge.svg">
  </a>
  <a href="https://github.com/MongLong0214/commitlore/releases">
    <img alt="最新发布" src="https://img.shields.io/github/v/release/MongLong0214/commitlore?display_name=tag">
  </a>
  <a href="spec/SPEC.md">
    <img alt="协议 2.0 稳定" src="https://img.shields.io/badge/protocol-2.0%20stable-3FB950">
  </a>
  <a href="package.json">
    <img alt="Node.js 22.23.2 或更高版本" src="https://img.shields.io/badge/node-22.23.2%2B-3FB950">
  </a>
  <a href="LICENSE">
    <img alt="MIT 许可证" src="https://img.shields.io/badge/license-MIT-3FB950">
  </a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ja.md">日本語</a> ·
  <strong>简体中文</strong>
</p>

<p align="center">
  <strong>安装一次。</strong> 然后初始化每个要使用它的仓库。
</p>

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.sh | sh -s v1.2.0
```

<details>
<summary>想先阅读安装器吗？</summary>

```bash
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.sh
sh install.sh v1.2.0

# 或者跳过脚本：它创建的检出，你自己也能创建。
git clone --depth 1 --branch v1.2.0 https://github.com/MongLong0214/commitlore
node commitlore/dist/commitlore.mjs --version
```

它安装固定版本的源码检出，以及一个运行 `node <checkout>/dist/commitlore.mjs` 的 wrapper。
没有编译产物下载，也没有构建步骤。

</details>

<p align="center">
  <img
    src="./assets/readme/demo.gif"
    width="900"
    alt="commitlore 演示会打印为 src/pricing.ts 记录的两项决定，只交付带有 limit 与已排除替代方案的 active 决定，并说明 superseded 决定仍留在 Git 中但不会作为当前指引交付。"
  >
</p>

---

> **代码留得住，判断留不住。**

代理提出一种做法。团队因一个不明显的约束而否决它。最终代码保留了结果，却通常不会保留
为什么否决该替代方案。之后的代理只看到代码，又会提出同一个主意。

CommitLore 把那份判断留在代码旁边。

## CommitLore 做什么

| | 行为 | 产品路径 |
|---|---|---|
| **Capture** | 保存 diff 无法展示的约束、已否决替代方案与警告。候选内容会与 session transcript 和 staged diff 核对。 | `commitlore capture` |
| **Preserve** | 将已接受的 record 保存到 Git trailer 或 notes，而不是托管记忆数据库。 | commit hook · `refs/notes/commitlore` |
| **跟踪生命周期** | 区分 active、superseded 与 expired 的决定。 | `commitlore stale` |
| **限定范围** | 为代理将要编辑的 path 选择决定。 | `commitlore context` |
| **信任分级** | 将 record 作为 directive、claim 或 withheld content 交付。 | 默认 / signed mode |
| **Delivery** | 在编辑前向受支持的代理提供当前上下文。 | plugin hook · MCP |

绝大多数 commit 都不应带 record。CommitLore 用于代码无法保留的判断，而不是叙述每一项更改。

<!-- README:QUICKSTART -->
## 60 秒让代理具备决策意识

### 1. 安装 CLI

macOS 和 Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.sh | sh -s v1.2.0
```

Windows：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.ps1))) v1.2.0
```

需要 Node.js 22.23.2+ 和 Git。脚本会在写入任何内容前检查两者。

### 2. 连接代理

Claude Code：

```text
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

Codex：

```bash
commitlore plugin install-codex
```

plugin 不会把 `commitlore` 放到 `PATH` 上，因此下面的命令还需要 CLI 安装。
安装器会在能安全处理的地方检测并配置受支持的 MCP host；准确矩阵见下文。

### 3. 初始化仓库

```bash
cd your-repository
commitlore init
commitlore context .
```

安装或更新 plugin 后，请启动新的 agent session；正在运行的 session 会保留已加载的 runtime。

接着照常工作和 commit。支持 skill integration 时，CommitLore 会在普通 commit 请求中被考虑；
没有值得保存的内容时会保持安静。无需在每次 commit 时都点名 CommitLore。

若想让已接受的 record 不经逐条提示就 stage，仓库可以一次性选择
`commitlore auto on`。这项政策由仓库所有并适用于团队，因此本页不会悄悄启用它。

<!-- README:PAYLOAD -->
## 代理收到的内容

编辑 `src/pricing.ts` 之前：

```text
commitlore: active records for src/pricing.ts

Limit
  [claim] r-price01  calculatePrice owns final checkout pricing only

Ruled-out
  [claim] r-price01  Reuse it for admin quotes |
                     eligibility and rounding semantics differ
```

`[claim]` 表示“把它作为信息权衡”。仓库可以选择更强的 signed-authority mode。
delivery 只提供上下文，并不阻止编辑。

[安全模型 →](SECURITY.md)

## 为什么是 Git？

**仓库应当拥有其代码背后的判断。**

CommitLore 将 record 存入普通 Git trailer 和 notes，因此它们会随所解释的代码一起 branch、
merge、clone、review，并在 provider 变更后继续存在。

SQLite 只是可重建的 index。删掉它，record 仍在 Git 中。

## 仅找到一个旧决定还不够

一般的 memory 或 retrieval system 会问：

> 哪段旧 text 看起来相关？

CommitLore 会问：

> 已记录的决定中，哪些现在仍适用于这条 path？

被 supersede 的决定可能非常相关，但作为当前指引仍然是错的。相关性与权威是不同的问题。

## 工作方式

<p align="center">
  <img src="./assets/readme/hero.svg" width="720" alt="对于 src/pricing.ts，Git 历史中的 active 决定会进入下一次编辑前交付的上下文，并带着其 limit 和已排除的替代方案。此前也涉及管理员报价的决定已被 supersede，仍留在历史中，但不会作为当前指引向前交付。">
</p>

1. **Capture** — 代理只起草 diff 无法展示的决策上下文。
2. **Verify** — CommitLore 将草稿与 session 和 staged diff 核对。
3. **Preserve** — 已接受的 record 连同 identity 和 lifecycle 留在 Git 中。
4. **Deliver** — 后续编辑前，只返回该 path 的 active record。

绝大多数 commit 没有 record。commit hook 会在 record 存在时验证它，不会凭空发明一个。

不会覆盖已有 hook。 `commitlore init` 会遵守 `core.hooksPath`，把已安装的 hook 移到
`<hook>.commitlore-chained`，并先调用它； `commitlore hooks uninstall` 会将其还原。

<!-- README:CAPABILITY -->
## 哪些是自动的，哪些不是

| Host | 编辑前 delivery | 已验证的 capture 工作流 | 每个 commit 都确定执行 capture |
|---|---|---|---|
| Claude Code | 通过 plugin 自动完成 | 通过 plugin skill 可用 | **未认证** |
| Codex | 通过 plugin 自动完成 | 通过 plugin skill 可用 | **未认证** |
| Hermes | 执行 `commitlore hermes install` 后可用 | host 安装后可用 | **未认证** |
| Gemini CLI、Cursor、Windsurf、opencode | host 使用注册时提供 MCP delivery | 通过 MCP 暴露的 procedure | 否 |
| `AGENTS.md` host | 仅 procedure | 仅 procedure | 否 |

“可用”表示 prepare → verify → stage workflow 存在，并不表示每个符合条件的 commit 都会自动评估。

受支持 skill host 的用户无需在每次 commit 时说“把这个记到 CommitLore”。剩下的限制是 host 是否
发起流程，而不是每条 record 都要用户命令。

## 现场报告，不是测量

这是某人在一个无关仓库首次安装 v1.2.0 时的一次运行。这里没有测量任何东西，也没有写进
evidence log。之所以放在这里，是因为上段主张了一种本页表格未覆盖的 loop。

那个人让 agent 修复一个舍入 bug，顺带提到 decimal library 已经考虑过又被否决，最后说“commit it”。
从未提到 CommitLore。commit 携带的部分内容如下：

```
Ruled-out: adopting a decimal library such as Decimal.js | the backend is a
  number contract, so it is meaningless
Warn: do not revert the test file to console.assert: it exits 0 even on
  failure, so CI passes silently
Provenance: drafted
```

`Warn` 并不是人逐字指示给 agent 的；它是在工作中撞上这个陷阱后留给下一位的。
`Provenance: drafted` 记录的是没有人阅读该 record，因而将其评为 `claim`：作为需要权衡的报告，
而不是命令来交付。

一个没有共享历史的后续 session 后来被要求最终采用 decimal library。它没有采用，并把 record
作为理由；它还读了该等级。 `claim` 不是指令，所以它先把所述理由与代码核对，才表示赞同。

## 不同于记忆存储

| | 一般 memory / RAG | **CommitLore** |
|---|---|---|
| 首要问题 | 哪段旧 text 相关？ | 哪些决定现在仍适用于这里？ |
| 权威 | memory store 或 provider | Git |
| 范围 | 语义相似性 | repository path |
| lifecycle | 通常 append-first | active · superseded · expired |
| 信任 | 检索到的 text | directive · claim · blocked |
| capture | transcript 或 note 存储 | 已核对证据的决策 record |
| 可移植性 | 依赖 backend | 普通 Git |

CommitLore 有意更窄。它不是通用 user-memory system、对话 archive 或 vector database 的替代品。

<!-- README:EVIDENCE -->
## 证据：检索能找到记录

| 问题 | 测量结果 | 边界 |
|---|---|---|
| 在已登记研究中，claim 等级上下文是否改变了重新提议？ | 有 CommitLore 时 **2.8%** (16/580)，没有时 **18.8%** (109/579) | 一个模型、一套 harness、构造的 task |
| lifecycle filtering 是否在测量的 active projection 中交付 retired record？ | **retired record 0 条** | 有 superseded record；没有 expiry |
| 有 index 的 lookup 能扩展吗？ | **100k commit 下 p50 496 ms** | 无 index 的 fallback 慢得多 |

index 的构建时间取决于 *record* 数量，而不是 commit 数量。高成本步骤每条 record 只运行一次，
所以记录较少的长历史比 record 密集的短历史构建得更快。

path scope 阻止大型历史到达 model。在 #167 corpus 中，10,002 条 record 里只有 2 条到达。

| route | 模型可见记录 | 相关记录 | 模型可见 token |
|---|---:|---:|---:|
| 注入全部内容 | 10,002 | 2/2 | 1,004,554 |
| top-k lexical | 2 | 1/2 | 190 |
| CommitLore path scope | 2 | 2/2 | 335 |

这在固定两条 record 预算下测量 exposure 和 recall，不测量 token cost、计费成本、准确率或
agent 行为。它只涉及一个 corpus、一个 query 和一个固定的 embedding model。

agent study 并不证明普遍的 model 效果。delivery 不是 model 阅读或遵循 record 的证据。

[方法、完整表格、排除项与负面结果 →](docs/evidence.md)

<!-- README:LIMITS -->
## 这在什么情况下帮不上忙

- **Capture 是辅助的，不是确定性的。** 支持的 skill 会考虑普通 commit 请求，但没有 host 被认证为会评估
  每一项符合条件的 commit。
- **默认 directive mode 不是认证。** 它匹配 commit author header，任何能写 commit 的人都能设置该 header。
  因而默认 mode 的 `[directive]` 是 policy metadata，不是 identity 证明。signature mode 还要求 Git 自己的
  verified status 与 repository-local `commitlore.trustedSigner` allowlist 相匹配；signer allowlist 缺失、
  为空或不可读取时无人被授权，因此该 mode 会 fail-closed。
- **Guard 是实验性参考信息**，不是安全网：precision 44.8% (95% Wilson CI 32.7%–57.5%)，
  recall 22.0%，基于 417-decision corpus。空的 guard 结果不是安全判定。
- **Delivery 在每次匹配的 tool call 中消耗 token。** 编辑前 hook 不仅在 `Read` 时运行，也在 `Edit`、
  `Write`、`MultiEdit`、`NotebookEdit` 时运行，远多于 editing agent commit 的次数。每次最多使用默认
  800 token 的 payload，可用 `--budget` 修改。没有 record 的仓库不消耗任何内容，所以这项成本随采纳而非安装出现。
- **答案可能不完整。** coverage 会被披露；部分结果没有某条 record，并不证明它不存在。
  repository-wide coverage、symbol anchor 与 interactive record builder 仍未完成：
  [#32](https://github.com/MongLong0214/commitlore/issues/32)、
  [#33](https://github.com/MongLong0214/commitlore/issues/33)。
- **commit trailer 会随 clone 传递，notes 不会。** Git 默认不会 fetch `refs/notes/*`，
  所以 `refs/notes/commitlore` 中的 record 在 `commitlore init` 配置该 mirror 前不会出现在普通 clone 中。
- **没有托管 backend。** 但 server 或 hook 返回上下文后，host 会按自己的政策处理它；CommitLore 不控制那条数据流。

[安全](SECURITY.md) ·
[兼容性](docs/COMPATIBILITY.md) ·
[证据](docs/evidence.md)

<details>
<summary><strong>安全与信任模型</strong></summary>

record 在分级前不可信。默认 author matching 是 policy metadata，不是认证。signed directive mode 需要
Git verification 与 repository-local signer allowlist；allowlist 缺失或不可读取时无人被授权。
形似 injection 的 payload 会从 model-readable route 中被保留。

[完整安全模型 →](SECURITY.md)

</details>

<details>
<summary><strong>安装、升级与旧 hook 世代</strong></summary>

CLI installer 无法重写它不知道的仓库里的 hook，正在运行的 host session 会保留加载的 runtime。
`commitlore doctor` 会指出两种状态及其修复，`commitlore upgrade` 会报告是否有更新的 release。

[安装与升级 →](docs/install.md)

</details>

<details>
<summary><strong>协议与 Git 存储</strong></summary>

record 是普通 Git trailer 或 notes。Protocol 2.0 定义 lifecycle、trust grade、validation 与 compatibility。

[面向人的指南 →](docs/protocol.md) ·
[规范说明 →](spec/SPEC.md)

</details>

<details>
<summary><strong>证据与负面结果</strong></summary>

仓库发布方法、排除项、失败的测量，以及原始 benchmark 或诊断出错的情况。

[证据 →](docs/evidence.md) ·
[自我审计 →](docs/SELF-AUDIT.md)

</details>

<hr>

<p align="center">
  <strong>请在有历史的仓库上试用。</strong><br>
  <sub>告诉我们 path scope、lifecycle、capture 或安装在哪些地方出错。</sub>
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/issues/new">报告失败案例</a>
  ·
  <a href="docs/SELF-AUDIT.md">阅读自我审计</a>
</p>

<hr>

<!-- README:DOCS -->
## 文档

- [安装、升级与卸载](docs/install.md)
- [CLI 参考](docs/cli.md)
- [Capture 工作流](docs/capture.md)
- [Record 协议](docs/protocol.md)
- [安全模型](SECURITY.md)
- [证据与限制](docs/evidence.md)
- [生产契约](docs/PRODUCTION-READINESS-SSOT.md)
- [文档索引](docs/README.md)

## 贡献

[CONTRIBUTING.md](CONTRIBUTING.md) 说明本仓库自身遵守的 record protocol、release gate，
以及如何复现证据。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
