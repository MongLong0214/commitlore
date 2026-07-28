<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="CommitLore：Git 记住改了什么，CommitLore 记住为什么改。新代理也能看到被排除的方案及其理由。">
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

## Git 记住改了什么。CommitLore 记住为什么改。

**面向 AI 辅助代码库的 Git-native decision memory。** CommitLore 将代码改动背后的限制、排除的方案、警告和验证空白直接记录在 Git 中。因此开发者或编程代理在改动之前，可以先理解为什么代码会是这样。

没有托管记忆服务，也没有特定供应商的聊天历史。只有由仓库拥有并随仓库流转、可供审查的决策上下文。

安装一次后，照常提交即可。CommitLore 只保留值得延续的决策。

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/dev/install.sh | sh
```

然后在每个需要验证 hook 与本地 index 的仓库运行 `commitlore init`。安装程序会检测受支持的编程代理，并在可以安全处理的地方注册本地 MCP server。

## init 之后会发生什么

- 照常提交。绝大多数提交没有 record。
- 如果已有 record，commit-msg hook 会验证它；不会创建 record。
- 代理通过 MCP 查询决策上下文，或从 `PreToolUse` hook 接收它。
- 更改 path 前，它们会看到 active limit、ruled-out alternative、warning 和 verification gap。

<details>
<summary>想检查或固定安装版本？</summary>

这一行命令是为了方便。若需要经过审阅或固定版本的安装，请先下载并检查 `install.sh`，或 clone 仓库，或手动下载发布资产并验证其 `SHA256SUMS`。脚本会校验下载二进制文件的校验和；它不会认证已经通过管道交给 `sh` 的脚本本身。

```bash
# 固定版本并检查 installer 后再执行。
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v0.2.0/install.sh
sh install.sh v0.2.0

# 或自行验证 release binary 后再解压。
version=0.2.0; target=aarch64-apple-darwin
curl -fsSLO "https://github.com/MongLong0214/commitlore/releases/download/v$version/commitlore-$version-$target.tar.gz"
curl -fsSLO "https://github.com/MongLong0214/commitlore/releases/download/v$version/SHA256SUMS"
grep "commitlore-$version-$target.tar.gz" SHA256SUMS | shasum -a 256 -c - # Linux: sha256sum -c -
```

</details>

## 看它实际运行

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

## 有何不同

- **CLAUDE.md 告诉代理如何工作。CommitLore 告诉它这段代码为何存在。**
- **ADR 记录架构。CommitLore 记录藏在 diff 中的决策。**
- **不是又一个 memory database，而是构建在 Git 中的 decision protocol。**

权威来源是普通的 commit trailer 与 `refs/notes/commitlore`。index 和 report 都从这些 Git record 派生，且可以重建。

## record 如何创建

不必为每次提交手写 trailer。绝大多数提交都不应带 record。只在 diff 无法还原的决策中添加 record：外部限制、排除的方案、warning 或 verification gap。

当前 record 有两种进入提交的方式：当有值得保留的决策上下文时，代理按照 `skills/commitlore-commits/` 的指引编写 trailer block；或由人手写普通 Git trailer。commit-msg hook 只验证已经存在的 record；它不会凭空创建或静默添加 record。

`commitlore harvest` 从 session transcript 和 staged diff 构建 prompt contract；`commitlore harvest-verify` 据此检查 draft。它们支持起草，而不会自动提交。interactive record builder 尚未实现。

## 一条记录

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

完成了 112 次实验，但所测 agent behavior 的主张未获支持。因此 CommitLore 提出的是上面更窄的产品主张。完整限制见 [M4 verdict](bench/VERDICT-M4.md)。

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

## 已知限制

- 不支持 Windows：[#95](https://github.com/MongLong0214/commitlore/issues/95)。
- 不支持 Alpine 与其他 musl Linux host：[#99](https://github.com/MongLong0214/commitlore/issues/99)。
- 尚未实现 cryptographic author verification、repository-wide record coverage、symbol anchor 和 interactive record builder：[#28](https://github.com/MongLong0214/commitlore/issues/28)、[#32](https://github.com/MongLong0214/commitlore/issues/32)、[#33](https://github.com/MongLong0214/commitlore/issues/33)、[#34](https://github.com/MongLong0214/commitlore/issues/34)。
- benchmark 未能证明 guard 对 agent behavior 有效果：[#37](https://github.com/MongLong0214/commitlore/issues/37)。

## 贡献

请阅读 [spec](spec/SPEC.md)、[ADR](docs/adr/) 和 [`CONTRIBUTING.md`](CONTRIBUTING.md)。CommitLore 是采用 [MIT License](LICENSE) 的永久免费开源软件。
