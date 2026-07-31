<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="CommitLore: コーディングエージェントはリポジトリがすでに覆した決定を復活させてはならない。">
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

## コーディングエージェントはリポジトリがすでに覆した決定を復活させてはならない。

**AI 支援コードベースのための Git-native 意思決定権威。** CommitLore は、どの決定がまだ有効でどの決定が覆されたかを Git 内で直接追跡します。コーディングエージェントがパスを問い合わせると、現在有効な決定だけが返されます。

ホスト型メモリサービスも、ベンダー固有のチャット履歴もありません。リポジトリが所有し、共に移動する、レビュー可能な意思決定コンテキストだけです。

一度インストールします。コーディングエージェントは引き継ぐ価値のある意思決定を記録でき、CommitLore はそれを検証して Git に保存します。

**Claude Code** — プラグイン一つで MCP サーバー、編集前のコンテキストフック、スキルが登録されます:

```
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

どちらの経路も前提条件は Node.js 22+ と Git です。スクリプトは何かを書き込む前に両方を確認します。

**その他のコーディングエージェント** — CLI をインストールします:

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v0.4.1/install.sh | sh
```


## 実際に動かす

<p align="center">
  <img src="./assets/readme/commitlore-demo.svg" width="100%" alt="commitlore demo: lifecycle filtering shows only active decisions">
</p>

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

## 検索はレコードを見つけられる。パス範囲は覆された意思決定を除外する。

レコードを一つ取り逃がせば、モデルはコンテキストを失います。すでに覆された意思決定を渡せば、正しさを損ないます。この[検索測定](bench/retrieval/result.md)では、ノイズが 0 件から 10,000 件までのすべてのサイズで、BM25、embedding top-k、hybrid RRF、パスフィルター付き embedding がそれぞれ廃止済みのレコードを一つ返しました。lifecycle を伴う CommitLore のパス範囲は古いレコードをゼロにし、現在の二つのレコード (2/2) を返しました。

再現率は補助的な結果です。検索はおおむねどちらでも同じレコードを見つけますが、どの意思決定がまだ有効かを知るルートは一つだけです。廃止済みのレコードがない #166 のコーパスでは、embedding 検索はパス範囲と同じ 2/2 でした。意思決定が覆されたときに違いが現れます。これはまさにこの製品が存在するケースです。

別の #167 の露出実行も重要です。10,002 件のうちモデルに届いたレコードは 2 件だけでした。

| ルート | モデルに見えるレコード | 関連レコード | モデルに見えるトークン |
|---|---:|---:|---:|
| すべて注入 | 10,002 | 2/2 | 1,004,554 |
| top-k 語彙検索 | 2 | 1/2 | 190 |
| CommitLore パス範囲 | 2 | 2/2 | 335 |

これは固定した 2 レコードの出力予算における露出と再現率の測定であり、トークンコスト、請求コスト、正確さ、エージェントの振る舞いを測るものではありません。これは一つのコーパス、一つのクエリ、一つの固定された embedding モデルによる結果です。

検証フックとローカル index を使う各リポジトリで、続けて `commitlore init` を実行します。installer は対応するコーディングエージェントを検出し、安全に可能な場所でローカル MCP server を登録します。

## init の後に起きること

- 普段どおりコミットします。ほとんどのコミットには record がありません。
- record がある場合、commit-msg hook が検証します。record を作成することはありません。
- エージェントは MCP で意思決定コンテキストを照会するか、`PreToolUse` hook から受け取ります。
- path を変更する前に、active limit、ruled-out alternative、warning、verification gap を確認します。

## リポジトリで試す

```bash
cd your-repository
commitlore init
commitlore context .
```

その後もコーディングエージェントと作業を続けます。変更に diff が保存できない意思決定コンテキストがあるときは、エージェントに CommitLore record をコミットへ含めるよう頼んでください。

<details>
<summary>インストールを確認または固定したいですか？</summary>

この一行は利便性のためです。レビュー済みまたは固定されたインストールが必要なら、まず `install.sh` をダウンロードして確認するか、リポジトリを clone してください。スクリプトは固定タグのソースチェックアウトと、`node <checkout>/dist/commitlore.mjs` を実行する薄い wrapper だけをインストールします — コンパイル済み成果物のダウンロードもビルド手順もないため、マシンに置かれるのは読めるソースです。

```bash
# installer を固定してダウンロードし、確認してから実行します。
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v0.4.1/install.sh
sh install.sh v0.4.1

# あるいはスクリプトを使わずに。スクリプトが作るチェックアウトは自分でも作れます。
git clone --depth 1 --branch v0.4.1 https://github.com/MongLong0214/commitlore
node commitlore/dist/commitlore.mjs --version
```

</details>

## 違い

- **CLAUDE.md はエージェントに作業方法を伝える。CommitLore はこのコードがなぜ存在するかを伝える。**
- **ADR はアーキテクチャを文書化する。CommitLore は diff の中に隠れた意思決定を文書化する。**
- **もう一つの memory database ではない。Git に組み込まれた decision protocol です。**

権威ある原本は通常の commit trailer と `refs/notes/commitlore` です。index と report はこれらの Git record から派生し、再構築できます。

## record が作られる方法

すべてのコミットに trailer を手書きする必要はありません。ほとんどのコミットには record がないべきです。外部制約、除外した代案、warning、verification gap のように、diff だけでは復元できない意思決定にだけ record を追加します。

### コーディングエージェント経由

エージェントには、普段どおりコミットし、diff では説明できない意思決定コンテキストだけを残すよう頼みます。

> この変更をコミットしてください。diff で重要な制約、除外した代案、warning、または verification gap を復元できない場合にだけ、CommitLore record を追加してください。

ほとんどのコミットには、やはり record は不要です。エージェント向けの指針は `skills/commitlore-commits/` にあり、commit hook はエージェントが追加した record を検証します。

### 高度な経路: harvest

`commitlore harvest` は session transcript と staged diff から prompt contract を作り、`commitlore harvest-verify` はそれに対する draft を検証します。これらは draft を支援しますが、自動でコミットしません。interactive record builder は未実装です。

### 手書き

逃げ道として、人は通常の Git trailer を手書きできます。commit-msg hook はすでにある record を検証するだけで、record を発明したり黙って追加したりしません。

## 最小の record

record は小さくできます。失われるものだけを入れてください。

```text
Fix expired-token refresh

Ruled-out: Extend token TTL to 24h | security policy violation
Warn: Do not narrow the 4xx handler without verifying upstream behavior
```

ほとんどの record に protocol field のすべては不要です。意思決定が必要とするときは、identity、lifecycle、risk、provenance、verification field を使えます。

## 完全な record

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

### レイテンシ、コスト、損益分岐

100,000 コミットではインデックス付き `context` の p50 は 496 ms、CommitLore 自身の `--no-index` フォールバックは 86,673 ms です。この内部フォールバックの差は 1k で 4.8×、10k で 36×、100k で 175×へと大きくなります（[完全な決定論的実行](https://github.com/MongLong0214/commitlore/blob/2fade893f25917fce1ffb497aab96b1eb271a185/bench/results/deterministic-20260729T032652Z.md)）。これは規模に対する形であり、製品と代替手段の比較結果ではありません。

guard が一回実行されるコストは、注入される context と測定した hook overhead です。commit-msg は p50 185.85 ms、injection hook は p50 102.40 ms です（[deterministic measurements](bench/results/deterministic-20260727T174801Z.md)）。

損益分岐の数値を再び示すには、プロバイダー報告のターンごとのトークン使用量台帳と、リポジトリがすでに却下した代案に費やした作業の観測済みコストが必要です。

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
- cryptographic author verification、repository-wide record coverage、symbol anchor、interactive record builder は未実装です: [#28](https://github.com/MongLong0214/commitlore/issues/28)、[#32](https://github.com/MongLong0214/commitlore/issues/32)、[#33](https://github.com/MongLong0214/commitlore/issues/33)、[#34](https://github.com/MongLong0214/commitlore/issues/34)。
- M4 は guard の効果を検証していません。row に `guard_exposure` がないため treatment exposure を検証できません: [#122](https://github.com/MongLong0214/commitlore/issues/122)。
- Guard（ruled-out alternative matching）は実験的参考情報です: precision 44.8%（95% Wilson CI 32.7%–57.5%）、recall 22.0%、417-decision corpus 基準（[ADR-0020](docs/adr/ADR-0020-guard-is-an-experimental-advisory.md)）。空の guard 結果は、提案がすべての ruled-out alternative を回避したという保証ではありません — recall 22% では、見逃しが一般的です。

## コントリビュート

[spec](spec/SPEC.md)、[ADR](docs/adr/)、[`CONTRIBUTING.md`](CONTRIBUTING.md) を読んでください。CommitLore は [MIT License](LICENSE) の下で永久に無料のオープンソースです。
