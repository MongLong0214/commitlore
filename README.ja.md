<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="CommitLore: Git は何が変わったかを記憶し、CommitLore はなぜ変わったかを記憶する。新しいエージェントも除外された代案と理由を読む。">
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="ライセンス: MIT" src="https://img.shields.io/badge/license-MIT-3f6b52"></a>
  <a href="package.json"><img alt="Node.js 22 以上" src="https://img.shields.io/badge/Node.js-%3E%3D22-3f6b52"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <strong>日本語</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

# CommitLore

## Git は何が変わったかを記憶する。CommitLore はなぜ変わったかを記憶する。

**AI 支援コードベースのための Git-native decision memory。** CommitLore は、コード変更の背後にある制約、除外した代案、警告、検証の空白を Git に直接記録します。開発者やコーディングエージェントは、何を変える前にもなぜこうなっているかを理解できます。

ホスト型メモリサービスも、ベンダー固有のチャット履歴もありません。リポジトリが所有し、共に移動する、レビュー可能な意思決定コンテキストだけです。

一度インストールしたら、普段どおりコミットしてください。CommitLore が残すのは、引き継ぐ価値のある意思決定だけです。

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/dev/install.sh | sh
```

検証フックとローカル index を使う各リポジトリで、続けて `commitlore init` を実行します。installer は対応するコーディングエージェントを検出し、安全に可能な場所でローカル MCP server を登録します。

## init の後に起きること

- 普段どおりコミットします。ほとんどのコミットには record がありません。
- record がある場合、commit-msg hook が検証します。record を作成することはありません。
- エージェントは MCP で意思決定コンテキストを照会するか、`PreToolUse` hook から受け取ります。
- path を変更する前に、active limit、ruled-out alternative、warning、verification gap を確認します。

<details>
<summary>インストールを確認または固定したいですか？</summary>

この一行は利便性のためです。レビュー済みまたは固定されたインストールが必要なら、まず `install.sh` をダウンロードして確認するか、リポジトリを clone するか、リリース資産を手動でダウンロードして `SHA256SUMS` を検証してください。スクリプトはダウンロードするバイナリのチェックサムを検証しますが、すでに `sh` に渡したスクリプト自体を認証するものではありません。

```bash
# installer を固定してダウンロードし、確認してから実行します。
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v0.2.0/install.sh
sh install.sh v0.2.0

# または release binary を自分で検証してから展開します。
version=0.2.0; target=aarch64-apple-darwin
curl -fsSLO "https://github.com/MongLong0214/commitlore/releases/download/v$version/commitlore-$version-$target.tar.gz"
curl -fsSLO "https://github.com/MongLong0214/commitlore/releases/download/v$version/SHA256SUMS"
grep "commitlore-$version-$target.tar.gz" SHA256SUMS | shasum -a 256 -c - # Linux: sha256sum -c -
```

</details>

## 実際に動かす

**新しいエージェント、チャット履歴はゼロ。それでも明白な修正案がなぜ除外されたかを知っています。** 変更する前に path を照会します。

```bash
commitlore context install.sh
```

出力には、installer の欠陥の修正として `-musl` target を公開する案を除外した active record とその理由が含まれます。hook はコンテキストを返すものであり、編集を止めるとは主張しません。

```console
context for install.sh as of <timestamp> — 0 limits, 1 ruled-out, 1 warnings, 2 other in 1 record (no index, 1 commit record(s) scanned)

ruled-out
  r-instci99a  <commit>  [claim]  Publish a -musl release target | a release.yml/build-matrix change, not an install.sh or CI-verification fix

warnings
  r-instci99a  <commit>  [claim]  Revisit this wording if a musl target ships
```

<details>
<summary>正確な PreToolUse hook path を再現する</summary>

```bash
printf '%s\n' '{"tool_name":"Edit","tool_input":{"file_path":"install.sh"}}' \
  | node dist/commitlore.mjs inject --hook-input --budget 5000
```

</details>

## 違い

- **CLAUDE.md はエージェントに作業方法を伝える。CommitLore はこのコードがなぜ存在するかを伝える。**
- **ADR はアーキテクチャを文書化する。CommitLore は diff の中に隠れた意思決定を文書化する。**
- **もう一つの memory database ではない。Git に組み込まれた decision protocol です。**

権威ある原本は通常の commit trailer と `refs/notes/commitlore` です。index と report はこれらの Git record から派生し、再構築できます。

## record が作られる方法

すべてのコミットに trailer を手書きする必要はありません。ほとんどのコミットには record がないべきです。外部制約、除外した代案、warning、verification gap のように、diff だけでは復元できない意思決定にだけ record を追加します。

現在、record がコミットに届く方法は二つです。保存する価値がある意思決定コンテキストがあるとき、エージェントが `skills/commitlore-commits/` の指針に従って trailer block を作成するか、人が通常の Git trailer を手書きします。commit-msg hook はすでにある record を検証するだけです。record を発明したり、黙って追加したりしません。

`commitlore harvest` は session transcript と staged diff から prompt contract を作り、`commitlore harvest-verify` はそれに対する draft を検証します。これらは draft を支援しますが、自動でコミットしません。interactive record builder は未実装です。

## 一つの記録

この例は conformance fixture でもあります。Git trailer parser は、すべての翻訳 README で下の code block を同じように読みます。

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

path の履歴は `commitlore context <path>` で読み、Git を直接使うこともできます。

```bash
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

text search ではなく Git trailer parser を使います。本文の `Key:` は trailer とは限りません。

## リポジトリが証明すること

- テスト済みの Git workflow では、意思決定の履歴は rebase、squash、remote transfer、path rename を経ても残る。
- すべての route は同じ trust grading を使い、信頼されない text は instruction ではなく information として渡す。
- free-form trailer 内の injection に似た text は model-readable route から保留される。
- 読める repository に record がない状態は、不完全な history や fetch されていない notes mirror と区別される。

これは Git に結び付けられ、人間が検証できる意思決定履歴についての製品上の主張です。CommitLore が agent performance を改善するという主張には依存しません。

## Evidence: より狭い製品上の主張

112 回の実験は記録されましたが、M4 には run ごとの `guard_exposure` 記録がありません。treatment があったか検証できないため、agent behavior の主張を検証も支持も反証もしていません。上記のより狭い製品上の主張は独立して検証可能な動作に基づきます。クリーンなデータセットと撤回については [M4 verdict](bench/VERDICT-M4.md) を読んでください。

<details>
<summary>完全な benchmark record（112 回の実験）</summary>

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

## source からインストール

source distribution を確認または実行するには次を使います。

```bash
git clone https://github.com/MongLong0214/commitlore ~/.commitlore
node ~/.commitlore/dist/commitlore.mjs init
node ~/.commitlore/dist/commitlore.mjs context src/auth
```

## 既知の制限事項

- Windows は未対応です: [#95](https://github.com/MongLong0214/commitlore/issues/95)。
- Alpine および他の musl Linux host は未対応です: [#99](https://github.com/MongLong0214/commitlore/issues/99)。
- cryptographic author verification、repository-wide record coverage、symbol anchor、interactive record builder は未実装です: [#28](https://github.com/MongLong0214/commitlore/issues/28)、[#32](https://github.com/MongLong0214/commitlore/issues/32)、[#33](https://github.com/MongLong0214/commitlore/issues/33)、[#34](https://github.com/MongLong0214/commitlore/issues/34)。
- M4 は guard の効果を検証していません。row に `guard_exposure` がないため treatment exposure を検証できません: [#122](https://github.com/MongLong0214/commitlore/issues/122)。

## コントリビュート

[spec](spec/SPEC.md)、[ADR](docs/adr/)、[`CONTRIBUTING.md`](CONTRIBUTING.md) を読んでください。CommitLore は [MIT License](LICENSE) の下で永久に無料のオープンソースです。
