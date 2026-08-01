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

## エージェントはコードを受け継ぎます。
## 判断も継がせましょう。

**コーディングエージェントのための Git ネイティブな decision layer。**

新しいエージェントは実装を読めます。しかし制約も、チームが却下した代替案も、警告も、検証の
ギャップも復元できません — それらを保持していたセッションが終われば消えるからです。

CommitLore はその工学的判断を Git に保存し、次の編集の前に**今も有効な決定だけ**を届けます。
のちに置き換えられた決定や期限切れの決定が、まだ有効であるかのようにエージェントへ届くことは
ありません。

**リポジトリ所有 · lifecycle 認識 · 根拠検証 · エージェント非依存**

Claude Code · Codex · Cursor · Gemini CLI · OpenCode · Windsurf

ホスト型メモリサービスも、ベンダー固有のチャット履歴もありません。リポジトリが所有し、共に移動する、レビュー可能な意思決定コンテキストだけです。

一度インストールします。コーディングエージェントは引き継ぐ価値のある意思決定を記録でき、CommitLore はそれを検証して Git に保存します。

**Claude Code** — プラグイン一つで MCP サーバー、編集前のコンテキストフック、スキルが登録されます:

```
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

プラグインが持つのはここまでで、MCP サーバー、編集前フック、スキルです。`commitlore` を `PATH` に置くことはないので、以下の `commitlore …` コマンドは `install.sh` / `install.ps1` から来るものであり、そのインストールも必要です。

どちらの経路も前提条件は Node.js 22+ と Git です。スクリプトは何かを書き込む前に両方を確認します。

**その他のコーディングエージェント** — CLI をインストールします:

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v0.6.0/install.sh | sh
```

どの host に対応しているか、各インストール経路が何を必要とするか: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。

**前のエージェントが得た判断を、次のエージェントに渡しましょう。**

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

この `PreToolUse` hook path をそのまま再現する方法と、その他すべてのコマンドは [docs/cli.md](docs/cli.md) にあります。

## 検索はレコードを見つけられる。パス範囲は覆された意思決定を除外する。

エージェントが最初の編集を行う前に、リポジトリが持つ「今も有効な意思決定」のうち実際にどれだけがエージェントへ届くのか。このリポジトリで、フックが既定で使う 800 トークン予算のもとでは:

| ルート | 予算 | 届いた有効な決定 | 届いた覆された決定 | トークン |
|---|---:|---:|---:|---:|
| コードのみ | — | 0.0% | 0 | 0 |
| そのパスの `git log` | 800 | 42.0% | 7 | 673,134 |
| **CommitLore パス範囲** | **800** | **81.7%** | **0** | **511,412** |
| CommitLore、上限なし | なし | 92.3% | 0 | 741,429 |

上限を外すと、パス範囲はリポジトリ全体のダンプが回収するのと同じ 2,217 組のうち 2,047 組を回収します。ダンプの 92,175,612 トークンの一部しか使わず、ダンプが一緒に運ぶ覆された 7,322 件は一つも届けません。**範囲は何も損なっていません。** 上限が 10.6 ポイントを消費します。残る 170 組は信頼グレーダーが保留したレコードです。

**これは配信を測ったものであり、効果ではありません。** エージェントは走っていないので、回収し*得る*量の上限であって、実際に回収する量ではありません。そして検索指標は、それが予測すべき結果が悪化する間にも上がり得ます。SWE-bench はコンテキスト予算を増やすと BM25 の recall が 29.58 から 51.06 へ上がることを測定した上で、「BM25 の最大コンテキストを増やせば oracle ファイルに対する recall が上がる場合でも性能は落ちる … モデルが問題のコードを特定するのが単に不得手だからだ」と報告しています ([arXiv:2310.06770](https://arxiv.org/abs/2310.06770))。コーパス一つ、リポジトリ一つです。置き換えられたレコードは 7 件、期限切れは 0 件なので、「覆された決定の配信ゼロ」は期限切れについてはまだ何も語りません。手法と全表: [bench/DECISION-DELIVERY.md](bench/DECISION-DELIVERY.md)。

レコードを一つ取り逃がせば、モデルはコンテキストを失います。すでに覆された意思決定を渡せば、正しさを損ないます。この[検索測定](bench/retrieval/result.md)では、ノイズが 0 件から 10,000 件までのすべてのサイズで、BM25、embedding top-k、hybrid RRF、パスフィルター付き embedding がそれぞれ廃止済みのレコードを一つ返しました。lifecycle を伴う CommitLore のパス範囲は古いレコードをゼロにし、現在の二つのレコード (2/2) を返しました。

再現率は補助的な結果です。検索はおおむねどちらでも同じレコードを見つけますが、どの意思決定がまだ有効かを知るルートは一つだけです。意思決定が覆されたときに違いが現れます。これはまさにこの製品が存在するケースです。

別の #167 の露出実行も重要です。10,002 件のうちモデルに届いたレコードは 2 件だけでした。

| ルート | モデルに見えるレコード | 関連レコード | モデルに見えるトークン |
|---|---:|---:|---:|
| すべて注入 | 10,002 | 2/2 | 1,004,554 |
| top-k 語彙検索 | 2 | 1/2 | 190 |
| CommitLore パス範囲 | 2 | 2/2 | 335 |

これは固定した 2 レコードの出力予算における露出と再現率の測定であり、トークンコスト、請求コスト、正確さ、エージェントの振る舞いを測るものではありません。これは一つのコーパス、一つのクエリ、一つの固定された embedding モデルによる結果です。再現率が並ぶ地点と、ほかに何が測定され何が測定されていないかは [docs/evidence.md](docs/evidence.md) にあります。

## リポジトリで試す

検証フックとローカル index を使う各リポジトリで、続けて `commitlore init` を実行します。installer は対応するコーディングエージェントを検出し、安全に可能な場所でローカル MCP server を登録します。

```bash
cd your-repository
commitlore init
commitlore context .
```

そのあとは:

- 普段どおりコミットします。ほとんどのコミットには record がありません。
- record がある場合、commit-msg hook が検証します。record を作成することはありません。
- エージェントは MCP で意思決定コンテキストを照会するか、`PreToolUse` hook から受け取ります。
- path を変更する前に、active limit、ruled-out alternative、warning、verification gap を確認します。

コーディングエージェントとの作業を続けます。変更に diff が保存できない意思決定コンテキストがあるときは、エージェントに CommitLore record をコミットへ含めるよう頼んでください。

<details>
<summary>インストールを確認または固定したいですか？</summary>

この一行は利便性のためです。レビュー済みまたは固定されたインストールが必要なら、まず `install.sh` をダウンロードして確認するか、リポジトリを clone してください。スクリプトは固定タグのソースチェックアウトと、`node <checkout>/dist/commitlore.mjs` を実行する薄い wrapper だけをインストールします — コンパイル済み成果物のダウンロードもビルド手順もないため、マシンに置かれるのは読めるソースです。

```bash
# installer を固定してダウンロードし、確認してから実行します。
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v0.6.0/install.sh
sh install.sh v0.6.0

# あるいはスクリプトを使わずに。スクリプトが作るチェックアウトは自分でも作れます。
git clone --depth 1 --branch v0.6.0 https://github.com/MongLong0214/commitlore
node commitlore/dist/commitlore.mjs --version
```

</details>

## コードは残った。決定は残らなかった。

*同じ悪い案を二度レビューしない。*


**CommitLore なしの場合。** 新しいセッションが入力の似た2つの関数を見て、一方を再利用します。

```ts
calculatePrice(input, { isAdminPreview: true, skipCoupon: true });
```

チームにはフラグが1つ、ラッパーが1つ、そしてその関数が担うつもりのなかったユースケースを
守る互換ブランチが1つ増えます。レビュアーは「それは既に却下した」と2度目を書きます。

**CommitLore ありの場合。** 編集の前に、エージェントはこれを受け取ります:

```
commitlore: active records for src/pricing.ts

Limit
  [claim]      r-price01  87e36511  calculatePrice owns final checkout pricing only

Ruled-out
  [claim]      r-price01  87e36511  Reuse checkout pricing for admin quotes | eligibility
                                    and rounding semantics differ between the two flows
```

`[claim]` は実際に機能しています: この record はリポジトリの信頼された作成者が書いた
ものではないため、エージェントは命令ではなく情報として扱うよう伝えられます。信頼された
作成者による record は `[directive]` として描画されます。

エージェントは代わりに純粋な計算プリミティブを共有し、checkout ポリシーの入口には触れません。
そのレビューは起きません。決定が既にそこにあったからです。

## 仕組み

1. **Capture** — diff からは分からない決定コンテキストだけをエージェントが起草します。
2. **Verify** — CommitLore がその草稿をセッションと staged diff に照合します。
3. **Preserve** — 検証済みレコードが identity と lifecycle を持って Git に残ります。
4. **Deliver** — 次のエージェントはパスを編集する前に、**今も有効な決定だけ**を受け取ります。

## 実際のリポジトリでの見え方

コミット約768個の Swift MCP サーバーのフィールドレポートより、インストール翌日。
ファイルパスを一つ指定しただけで、エンジニアが存在を知らなかったマージ済み PR が現れ、
残っていたコードの意味が変わった。

> **そのコミットの存在を知らなかった。** 2週間前にマージされた PR で、これらのサイトの
> うち8か所を既に削除し、それぞれを accessibility-native な等価物に置き換えていた —
> すべて fail-closed で実機検証済み。
>
> どれもチャット履歴にはなかった。リポジトリにあり、ファイルパスを指定して得た。

代替手段は2週間分のマージ済み PR を読むことだった。エージェントが自発的にやることでは
なく、人が編集のたびにやることでもない。同じレポートの導入コスト: コマンド1つ、コミット
768個のインデックスに7.4秒。履歴も作業ツリーも触らない。コンソール出力とレポート全文は
[docs/evidence.md](docs/evidence.md) にあります。

**ホスト型のチャット履歴製品が提供できない3つの性質**、そして権威をサービスではなく Git に
置いた理由:

| ツール | 覚えているもの |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | エージェントがどう働くべきか |
| ADR | 大きなアーキテクチャ決定を文書として |
| Chat memory / RAG | 過去の関連テキスト |
| **CommitLore** | **このコードパスに今も適用される決定** |

類似検索は関連する決定を見つけられます。CommitLore はさらに、その決定が今も有効か、
置き換えられたか、期限切れかを知っていて — 最初のものだけを示します。

## 違い

- **CLAUDE.md はエージェントに作業方法を伝える。CommitLore はこのコードがなぜ存在するかを伝える。**
- **ADR はアーキテクチャを文書化する。CommitLore は diff の中に隠れた意思決定を文書化する。**
- **もう一つの memory database ではない。Git に組み込まれた decision protocol です。**

権威ある原本は通常の commit trailer と `refs/notes/commitlore` です。index と report はこれらの Git record から派生し、再構築できます。

## どこで効くか

**モジュール境界を守る。** *「`calculatePrice` は最終 checkout 価格のみを担当する。管理者プレビューに再利用しない」*

**却下された回避策を残す。** *「タイムアウトを上げると接続リークが隠れる。cleanup 経路を直すこと」*

**一時的な互換コードに印を付ける。** *「この caller は一時的で、サポート対象の契約には含まれない」*

**検証ギャップを伝える。** *「単一ユーザーの挙動はテスト済み。同時リフレッシュは未検証」*

どれも diff が運べない一文であり、無ければレビュアーが二度言うことになる文です。

## record が作られる方法

すべてのコミットに trailer を手書きする必要はありません。ほとんどのコミットには record がないべきです。外部制約、除外した代案、warning、verification gap のように、diff だけでは復元できない意思決定にだけ record を追加します。

エージェントには、普段どおりコミットし、diff では説明できない意思決定コンテキストだけを残すよう頼みます。

> この変更をコミットしてください。diff で重要な制約、除外した代案、warning、または verification gap を復元できない場合にだけ、CommitLore record を追加してください。

エージェント向けの指針は `skills/commitlore-commits/` にあり、commit-msg hook はエージェントが追加した record を検証するだけで、record を発明したり黙って追加したりしません。`harvest` の経路、`capture` トランザクション、そして人が trailer を手書きする逃げ道は、いずれも [docs/capture.md](docs/capture.md) にあります。

## 完全な record

record はこれよりずっと小さくできますし、ほとんどは数個の field で足ります。この例が語彙のすべてを使うのは、conformance fixture でもあるからです — Git trailer parser は、すべての翻訳 README で下の code block を同じように読みます。

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
| `Ruled-out:` | `alternative \| reason` — the first `\|` separates; there is no escape, so an alternative may not contain one |
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

path の履歴は `commitlore context <path>` で読みます。より小さな例と、Git だけで record を読む方法は [docs/protocol.md](docs/protocol.md) に、規範的な定義は [SPEC §3](spec/SPEC.md) にあります。

## リポジトリが証明すること

- テスト済みの Git workflow では、意思決定の履歴は rebase、squash、remote transfer、path rename を経ても残る。
- すべての route は同じ trust grading を使い、信頼されない text は instruction ではなく information として渡す。
- free-form trailer 内の injection に似た text は model-readable route から保留される。
- 読める repository に record がない状態は、不完全な history や fetch されていない notes mirror と区別される。

これは Git に結び付けられ、人間が検証できる意思決定履歴についての製品上の主張です。CommitLore が agent performance を改善するという主張には依存しません。

## Evidence: より狭い製品上の主張

112 回の実験は記録されましたが、M4 には run ごとの `guard_exposure` 記録がありません。treatment があったか検証できないため、agent behavior の主張を検証も支持も反証もしていません。上記のより狭い製品上の主張は独立して検証可能な動作に基づきます。クリーンなデータセットと撤回については [M4 verdict](bench/VERDICT-M4.md) を読んでください。

何が測定されたか — 検索、露出、レイテンシと規模、hook overhead — そして何が測定されていないか — 損益分岐、そしてエージェントの振る舞いへの効果 — は [docs/evidence.md](docs/evidence.md) にまとめてあります。

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

## アンインストール

```bash
commitlore uninstall
```

`install.sh` または `install.ps1` が書いたものを削除します — wrapper、固定された
checkout、そして各 agent config に追加した MCP エントリ。自分が書いていないものは
削除せず、残すものを明示します: リポジトリごとの hook、agent hook、Claude Code
plugin。`--dry-run` は何も変更せずに報告します。それぞれを何が外すか、そして source
チェックアウトから実行する方法は [docs/install.md](docs/install.md) にあります。

## ドキュメント

- [docs/install.md](docs/install.md) — インストール経路、各経路が書くもの、取り消し方
- [docs/cli.md](docs/cli.md) — すべてのコマンドとフラグ
- [docs/capture.md](docs/capture.md) — record が書かれるまで
- [docs/protocol.md](docs/protocol.md) — record の形式と、Git だけで読む方法
- [docs/evidence.md](docs/evidence.md) — 何が測定され、何が測定されていないか
- [spec/SPEC.md](spec/SPEC.md) — 規範プロトコル

## 既知の制限事項

- cryptographic author verification、repository-wide record coverage、symbol anchor、interactive record builder は未実装です: [#28](https://github.com/MongLong0214/commitlore/issues/28)、[#32](https://github.com/MongLong0214/commitlore/issues/32)、[#33](https://github.com/MongLong0214/commitlore/issues/33)、[#34](https://github.com/MongLong0214/commitlore/issues/34)。
- M4 は guard の効果を検証していません。row に `guard_exposure` がないため treatment exposure を検証できません: [#122](https://github.com/MongLong0214/commitlore/issues/122)。
- Guard（ruled-out alternative matching）は実験的参考情報です: precision 44.8%（95% Wilson CI 32.7%–57.5%）、recall 22.0%、417-decision corpus 基準（[ADR-0020](docs/adr/ADR-0020-guard-is-an-experimental-advisory.md)）。空の guard 結果は、提案がすべての ruled-out alternative を回避したという保証ではありません — recall 22% では、見逃しが一般的です。

## コントリビュート

[spec](spec/SPEC.md)、[ADR](docs/adr/)、[`CONTRIBUTING.md`](CONTRIBUTING.md) を読んでください。CommitLore は [MIT License](LICENSE) の下で永久に無料のオープンソースです。
