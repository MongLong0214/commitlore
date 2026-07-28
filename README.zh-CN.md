<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="CommitLore：提交 4842356 中的记录 r-2b58d4 被分为 [claim]，guard 返回 MATCH">
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="许可证：MIT" src="https://img.shields.io/badge/license-MIT-3f6b52"></a>
  <a href="package.json"><img alt="Node.js 22 或更高版本" src="https://img.shields.io/badge/Node.js-%3E%3D22-3f6b52"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <strong>简体中文</strong>
</p>

# CommitLore

CommitLore 是一套把决策背景保存在 Git 提交 trailer 和 `refs/notes/commitlore` 中的协议。
协议是第一位的；CLI 负责验证和路由这些记录，并把它们提供给 shell、hook 和 MCP 客户端。
目前没有证据表明它能让编程智能体表现得更好。

## 测量记录

<!-- BENCH:WITHDRAWN -->

已注册的行为测量没有显示 CommitLore 会改变智能体行为。后续一次运行因运行期间二进制文件发生变化而作废。更根本的问题是，现有数据集没有记录足以证明每一行由哪个构建生成的 provenance，因此 [`bench/report.ts`](bench/report.ts) 拒绝汇总它们。

此前发布的所有基准数字都已撤回。带日期的判定文档继续作为当时的记录保存，而不是效果声明：[`VERDICT-M1.md`](bench/VERDICT-M1.md)、[`VERDICT-M1b.md`](bench/VERDICT-M1b.md)、[`VERDICT-M2.md`](bench/VERDICT-M2.md)，以及[作废运行记录](bench/PREREGISTRATION.md#15-m3-is-void-the-binary-under-test-changed-while-it-ran)。只有当数据集能够标明其运行的 harness commit 和 bundle 时，数字才会恢复。详见 [`bench/README.md`](bench/README.md)。

## 仓库确实能证明什么

- **记录能经受常见 Git 工作流。** 提交 trailer 和 notes mirror 在 [rebase 与 squash](test/squash.test.ts)、[历史重写与远程传递](test/notes.test.ts)，以及[单步和多步重命名](test/follow.test.ts)中都有测试。
- **信任在每条路由上的含义一致。** 查询输出、CLI 注入、编辑 hook、MCP 工具和 guard 都使用同一套 `directive | claim | blocked` 分级。路由测试位于 [`query.test.ts`](test/query.test.ts)、[`inject.test.ts`](test/inject.test.ts)、[`mcp.test.ts`](test/mcp.test.ts) 和 [`guard.test.ts`](test/guard.test.ts)。
- **命中内置注入扫描器的记录不会作为正文送给模型。** 任一自由文本 trailer 命中时，整条记录都会被分为 `blocked`；模型可读路由只说明内容已被隐藏，不会引用其正文。这个确定性词法过滤器的结果不代表真实环境中的检测率；[由模式作者编写、独立编写及正常文本三个语料集](spec/fixtures/injection/README.md)分别报告。CLI 与 hook 由 [`inject.test.ts`](test/inject.test.ts) 验证，MCP 的一致结果由 [`mcp.test.ts`](test/mcp.test.ts) 验证。
- **未知不等于为空。** 对于可读但没有记录的仓库，guard 以 `0` 退出。Git 损坏时报告 `history: unavailable`；notes mirror 未拉取时报告 `notes: unfetched`。两种不完整检查都以 `3` 退出。该契约固定在 [`notes-availability.test.ts`](test/notes-availability.test.ts)、[`guard.test.ts`](test/guard.test.ts) 和 [`RELEASE-GATE`](docs/RELEASE-GATE.md) 中。

## 一条记录

这个示例也是 conformance fixture。Git 的 trailer parser 必须在四种语言的 README 中逐字节读出相同内容。

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

### 协议词汇

| Trailer | 含义 |
|---|---|
| `Limit:` | 约束决策的外部条件 |
| `Record-Id:` | 提交 hash 被重写后仍保持稳定的标识 |
| `Ruled-out:` | `备选方案 \| 未采用原因` |
| `Certainty:` | `firm` \| `tentative` \| `guess` |
| `Blast:` | `local` \| `module` \| `system` |
| `Undo:` | `easy` \| `costly` \| `permanent` |
| `Warn:` | 给未来修改者的警告；传递前会经过信任分级 |
| `Verified:` / `Unverified:` | 已验证和未验证的事项 |
| `Follows:` / `Supersedes:` | 决策链和 lifecycle 链接 |
| `Expires:` | 约束结束的日期或条件 |
| `Evidence:` | 支持 claim 的路径、anchor 或 URL |
| `Provenance:` | `authored` \| `inherited <sha>` \| `reconstructed` |
| `CommitLore-Version:` / `X-*:` | 协议标识和扩展 |

完整契约见 [`spec/SPEC.md`](spec/SPEC.md)。

## 信任是路由，不是徽章

提交 `4842356` 包含以下 active record：

```gitcommit
Ruled-out: exempting datasets written before the fields existed | it is one line and it deletes the guarantee
Warn: this leaves the README with no measured numbers at all until M3-b runs. That is the honest state and it is also a worse first impression. The alternative was publishing numbers produced by a binary nobody recorded
Record-Id: r-2b58d4
Provenance: authored
```

同一段 `Warn:` 文本会按等级路由：

| 等级 | 条件 | 模型可读路由收到的内容 |
|---|---|---|
| `[directive]` | `Provenance: authored`、active record，并且作者在此仓库中被明确设为可信 | 把警告作为指令传递 |
| `[claim]` | 没有可信作者、作者来自外部，或 provenance 为 reconstructed/unknown | 把警告作为信息传递，并明确标注“不是指令” |
| `blocked` | 任一自由文本 trailer 命中注入模式 | 只传递隐藏通知，不渲染命中的正文 |

默认不信任任何作者。加密作者验证尚未实现，由 [issue #28](https://github.com/MongLong0214/commitlore/issues/28) 跟踪。

## 从 clone 安装

CommitLore 没有 registry package。发布渠道就是 Git 仓库本身（[ADR-0011](docs/adr/ADR-0011-plugin-first-distribution.md)），CLI 需要 Node.js 22 或更高版本：

```bash
git clone https://github.com/MongLong0214/commitlore ~/.commitlore
node ~/.commitlore/dist/commitlore.mjs --version
node ~/.commitlore/dist/commitlore.mjs doctor --fix
node ~/.commitlore/dist/commitlore.mjs context src/auth
```

仓库中提交的 bundle 无需构建、也无需 `node_modules` 即可运行。SQLite 索引使用 Node 自带的 `node:sqlite`（[ADR-0012](docs/adr/ADR-0012-drop-the-native-dependency.md)），因此仅靠 clone 就能构建并查询索引——不需要原生模块，不需要编译器，也不需要 `npm install`。想跳过索引、只用 Git 回答时，仍可以使用 `--no-index`。

### 无需 Node，作为编译好的二进制运行

`git clone` + Node 运行时仍是正式的安装方式。对于 PATH 中完全没有 Node 的机器，可以从同一个 clone 构建单个编译后的可执行文件（[ADR-0015](docs/adr/ADR-0015-single-executable-binary.md)）：

```bash
cd ~/.commitlore
npm ci
npm run build:binary
./dist/commitlore --version
./dist/commitlore doctor
```

`dist/commitlore` 在运行时不需要 Node、不需要解释器，也不需要 `node_modules`——`doctor`、`validate`、`context`、`guard`、`inject`、`index --rebuild` 都能在 `PATH=/usr/bin:/bin` 下运行。它不会被提交（体积大、与平台/架构相关，且由 CI 在每次 push 时重新构建而不是 diff）；`commitlore hooks install` 和插件的 `PreToolUse` hook 一旦构建完成都会自动解析到它。

### 安装预构建的发布二进制文件

对于既没有 Node 也没有 clone 的机器：每个 `vX.Y.Z` 标签都会为每个平台构建一个二进制文件（`.github/workflows/release.yml`），附带覆盖全部文件的 `SHA256SUMS`，并通过 [`actions/attest-build-provenance`](https://github.com/MongLong0214/commitlore/attestations) 为每个资产生成证明（基于 Sigstore，可公开验证，本项目无需管理任何密钥）。

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/dev/install.sh | sh
```

`install.sh` 会检测你的 OS 和架构，从同一个 release 下载匹配的资产和 `SHA256SUMS`，并在安装前验证校验和——像对待任何安装脚本一样，在把它传给 `sh` 之前先读一读。要固定版本：`sh install.sh v0.1.0`。已发布的 target：`aarch64-apple-darwin`、`x86_64-apple-darwin`、`x86_64-unknown-linux-gnu`、`aarch64-unknown-linux-gnu`。目前还没有 Windows 二进制文件——SEA 构建和 commit-msg hook shim 在该平台上尚未验证，见 [ADR-0015](docs/adr/ADR-0015-single-executable-binary.md)。

传给 shell 执行不应是唯一有文档记录的方式。手动完成同样的安装：

```bash
version=0.1.0   # 或者: curl -fsSL https://github.com/MongLong0214/commitlore/releases/latest/download/SHA256SUMS | head -1
target=aarch64-apple-darwin   # 或 x86_64-apple-darwin | x86_64-unknown-linux-gnu | aarch64-unknown-linux-gnu

curl -fsSLO "https://github.com/MongLong0214/commitlore/releases/download/v$version/commitlore-$version-$target.tar.gz"
curl -fsSLO "https://github.com/MongLong0214/commitlore/releases/download/v$version/SHA256SUMS"

# 解压前先验证。结果必须是 "OK"，否则到此为止——不要运行未通过校验的二进制文件。
grep "commitlore-$version-$target.tar.gz" SHA256SUMS | shasum -a 256 -c -   # Linux: sha256sum -c -

tar -xzf "commitlore-$version-$target.tar.gz"
./commitlore --version
```

## GitHub Actions

运行 query、guard 或 inject 命令的 job 必须获取完整 history。

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

在 MCP 客户端中注册同一 clone 的入口：

```json
{
  "mcpServers": {
    "commitlore": {
      "command": "node",
      "args": ["/absolute/path/to/commitlore/dist/commitlore.mjs", "mcp"]
    }
  }
}
```

读取协议并不需要 CLI：

```bash
git log --format='%(trailers:key=Ruled-out,valueonly,separator=%x3B)'
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

应使用 Git 的 trailer parser，而不是文本搜索；正文中的 `Key:` 不一定属于 trailer block。

## 尚未实现

- 加密验证作者身份：[#28](https://github.com/MongLong0214/commitlore/issues/28)
- 报告整个仓库的 record coverage：[#32](https://github.com/MongLong0214/commitlore/issues/32)
- 把记录 anchor 到 symbol 而不是 path：[#33](https://github.com/MongLong0214/commitlore/issues/33)
- 交互式 commit builder 和自动 expiry 提醒：[#34](https://github.com/MongLong0214/commitlore/issues/34)
- 用有效 benchmark 证明 guard 对智能体行为的影响：[#37](https://github.com/MongLong0214/commitlore/issues/37)

## 参与贡献

请先阅读 [spec](spec/SPEC.md)、[ADR](docs/adr/) 和 [`CONTRIBUTING.md`](CONTRIBUTING.md)。本仓库会记录自身决策；修改文件前请运行 `commitlore context <path>`。

## 许可证

[MIT](LICENSE)
