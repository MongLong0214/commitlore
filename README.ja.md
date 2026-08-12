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

**あなたのコーディングエージェントは、チームがすでに却下した案を何度も提案します。**

CommitLore はその決定を Git に残し、ファイルを編集する前に、まだ有効なものだけを
エージェントに渡します。

CommitLore にホスティングサービスはなく、record は Git に保管します。MCP サーバー
または hook がコンテキストを返した後は、host が自身のポリシーでそのコンテキストを
扱います。CommitLore はそのデータフローを制御しません。

<p align="center">
  <img src="./assets/readme/commitlore-demo.svg" width="100%" alt="commitlore demo: lifecycle filtering shows only active decisions">
</p>

<details>
<summary><strong>目次</strong></summary>

- [インストール](#インストール)
- [エージェントが受け取るもの](#実際に動かす)
- [自動になること、ならないこと](#自動になることならないこと)
- [これが役に立たない場合](#これが役に立たない場合)
- [一つの例で見る問題](#コードは残った決定は残らなかった)
- [詳しく言うと何なのか](#詳しく言うと何なのか)
- [パス問い合わせを見る](#パス問い合わせを見る)
- [このリポジトリ自体がデモ](#このリポジトリ自体がデモです)
- [パス範囲と検索](#検索はレコードを見つけられるパス範囲は覆された意思決定を除外する)
- [仕組み](#仕組み)
- [別のリポジトリからの現場報告](#実際のリポジトリでの見え方)
- [何が違うのか](#違い)
- [どこで効くか](#どこで効くか)
- [record の作られ方](#record-が作られる方法)
- [完全な record](#完全な-record)
- [リポジトリが証明すること](#リポジトリが証明すること)
- [根拠](#evidence-より狭い製品上の主張)
- [アンインストール](#アンインストール) · [ドキュメント](#ドキュメント) · [コントリビュート](#コントリビュート)

</details>

## インストール

一度インストールします。host integration を入れ、使うリポジトリを初期化します。

**Claude Code** — プラグイン一つで MCP サーバー、編集前のコンテキストフック、スキルが登録されます:

```
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

プラグインが持つのはここまでで、MCP サーバー、編集前フック、スキルです。`commitlore` を `PATH` に置くことはないので、以下の `commitlore …` コマンドは `install.sh` / `install.ps1` から来るものであり、そのインストールも必要です。

**Codex** — ネイティブプラグインは一つのコマンドでインストールします:

```bash
commitlore plugin install-codex
```

Codex 自身の CLI を通じて marketplace と plugin を登録し、設定や cache を直接編集しません。下の標準 installer も Codex を検出すれば同じコマンドを実行します。インストール後は新しい Codex session を開始してください — plugin の skill と MCP server はインストール時ではなく session 開始時に読み込まれます。下の CLI が repository command を提供します。

どちらの経路も前提条件は Node.js 22+ と Git です。スクリプトは何かを書き込む前に両方を確認します。

**その他のコーディングエージェント** — CLI をインストールします:

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v0.8.0/install.sh | sh
```

**Windows** — PowerShell で同じインストールを行います:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/MongLong0214/commitlore/v0.8.0/install.ps1))) v0.8.0
```

**Hermes** — CLI をインストールした後、host integration を設定します:

```bash
commitlore hermes install
```

どの host に対応しているか、各インストール経路が何を必要とするか: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。

**前のエージェントが得た判断を、次のエージェントに渡しましょう。**

### 次に、各リポジトリで

検証フック、ローカル index、リポジトリ所有の agent procedure を使う各リポジトリで、
続けて `commitlore init` を実行します。installer は対応するコーディングエージェントを
検出し、安全に可能な場所でローカル MCP server を登録します。

```bash
cd your-repository
commitlore init
commitlore context .
```

そのあとは:

- 普段どおりコミットします。ほとんどのコミットには record がありません。
- record がある場合、commit-msg hook が検証します。record を作成することはありません。
- delivery と capture は別の layer です。次の節で host ごとの二つの layer を正確に説明します。

コーディングエージェントとの作業を続けます。変更に diff が保存できない意思決定コンテキストがあるときは、エージェントに CommitLore record をコミットへ含めるよう頼んでください。

<details>
<summary>インストールを確認または固定したいですか？</summary>

この一行は利便性のためです。レビュー済みまたは固定されたインストールが必要なら、まず `install.sh` をダウンロードして確認するか、リポジトリを clone してください。スクリプトは固定タグのソースチェックアウトと、`node <checkout>/dist/commitlore.mjs` を実行する薄い wrapper だけをインストールします — コンパイル済み成果物のダウンロードもビルド手順もないため、マシンに置かれるのは読めるソースです。

```bash
# installer を固定してダウンロードし、確認してから実行します。
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v0.8.0/install.sh
sh install.sh v0.8.0

# あるいはスクリプトを使わずに。スクリプトが作るチェックアウトは自分でも作れます。
git clone --depth 1 --branch v0.8.0 https://github.com/MongLong0214/commitlore
node commitlore/dist/commitlore.mjs --version
```

</details>

## 実際に動かす

`src/pricing.ts` を編集する前に、エージェントは説明ではなく record そのものである
この payload を受け取ります:

```
commitlore: active records for src/pricing.ts

Limit
  [claim]      r-price01  87e36511  calculatePrice owns final checkout pricing only

Ruled-out
  [claim]      r-price01  87e36511  Reuse checkout pricing for admin quotes | eligibility
                                    and rounding semantics differ between the two flows
```

`[claim]` には意味があります。この record の author string は、リポジトリが
directive 用に設定した文字列と一致しないため、エージェントは命令ではなく情報として
評価するよう伝えられます。既定の author-string mode の `[directive]` は、その文字列を
制約として扱うというリポジトリの選択であり、身元の証明ではありません。commit author が
文字列を選ぶため、commit を書ける者は誰でも偽装できます。
`commitlore.requireSignedDirective=true` では、検証者の trust store で Git が検証した
signature も必要です。その signature も権限や record の真実を証明しません。delivery は
コンテキストを渡すものであり、編集を止めるものではありません。

## 自動になること、ならないこと

**Delivery** は path を編集する前に record がエージェントへ届くことです。
**Capture** は決定が検証済みの commit-time flow に入れることです。二つは別の layer です:

| Host | Delivery | Capture |
|---|---|---|
| Claude Code | **はい — plugin により自動です。** | **はい — plugin により可能です。** |
| Codex | **はい — plugin により自動です。** | **はい — plugin により可能です。** |
| Hermes | **はい — `commitlore hermes install`.** | **はい — `commitlore hermes install`.** |
| その他の `AGENTS.md` convention host | **procedure であり自動ではありません。** `commitlore init` が編集前 delivery instruction を書きます。host が従う場合も従わない場合もあります。 | **procedure であり自動ではありません。** host が従う場合も従わない場合もあります。 |

「はい」は layer がインストールされるという意味であり、すべての commit に record が
付くという意味ではありません。自動 integration は最初の三行だけです。その他の
`AGENTS.md` host では二つの手順は hook ではなく instruction です。host が capture を
開始し、candidate が検証を通ってから commit hook が付加します。commit-msg hook は
record があれば検証しますが、新しく作ることはありません。

## これが役に立たない場合

インストールする前に読んでください。

- **測定されたのは弱いほうの等級です。** 1,160 回の研究ではすべてのレコードが
  `[claim]` として描画され、これはエージェントに命令ではなく情報として扱うよう
  伝えます。`[directive]` 等級はその後に到達可能になり、ここでは測定されていません
  —— 研究自身の判定文が、この数値は「強いほうへは転移しない」と述べています。
  directive がより良いか悪いか同等かは、**どちらの方向にも測定されていません**。
- **モデル 1 つ、ハーネス 1 つ、構成されたフィクスチャ 10 個です。** オラクルは
  最終的な実装状態を読みます。したがってレコードを受け取ったエージェントのほうが
  排除済みの手法を提案しにくかったことは示しますが、そのいずれかが何かを読んだ
  ことは示しません。
- cryptographic author verification、repository-wide record coverage、symbol anchor、interactive record builder は未実装です: [#28](https://github.com/MongLong0214/commitlore/issues/28)、[#32](https://github.com/MongLong0214/commitlore/issues/32)、[#33](https://github.com/MongLong0214/commitlore/issues/33)、[#34](https://github.com/MongLong0214/commitlore/issues/34)。
- M4 は guard の効果を検証していません。row に `guard_exposure` がないため treatment exposure を検証できません: [#122](https://github.com/MongLong0214/commitlore/issues/122)。
- Guard（ruled-out alternative matching）は実験的参考情報です: precision 44.8%（95% Wilson CI 32.7%–57.5%）、recall 22.0%、417-decision corpus 基準（[ADR-0020](docs/adr/ADR-0020-guard-is-an-experimental-advisory.md)）。空の guard 結果は、提案がすべての ruled-out alternative を回避したという保証ではありません — recall 22% では、見逃しが一般的です。

完全な方法、除外、arm ごとの truncation split は [bench/VERDICT-M5.md](bench/VERDICT-M5.md) と
[示していないこと](docs/evidence.md) にあります。delivery の方法と retrieval の根拠は
[bench/DECISION-DELIVERY.md](bench/DECISION-DELIVERY.md) にあります。

## コードは残った。決定は残らなかった。

*同じ悪い案を二度レビューしない。*

**CommitLore なしの場合。** 新しいセッションが入力の似た2つの関数を見て、一方を再利用します。

```ts
calculatePrice(input, { isAdminPreview: true, skipCoupon: true });
```

チームにはフラグが1つ、ラッパーが1つ、そしてその関数が担うつもりのなかったユースケースを
守る互換ブランチが1つ増えます。レビュアーは「それは既に却下した」と2度目を書きます。

**CommitLore ありの場合。** 編集の前に、エージェントは上で示した active record を
受け取り、レビューコメントから再構成した指示を受け取るのではありません。

モジュール境界が、レビューコメントとして後から届くのではなく、エージェントが変更を提案する
**前に**その目の前に置かれます。

1,160 回の登録済み実行で、却下済みの案を再提案する割合は **18.8%** から **2.8%**
になりました。この数字が示さないことは、上の
[これが役に立たない場合](#これが役に立たない場合)にあります。

## 詳しく言うと、何なのか

**コーディングエージェントのための Git ネイティブな decision layer。**

新しいエージェントは実装を受け継ぎます。しかし制約も、チームが却下した代替案も、警告も、
検証のギャップも受け継ぎません — 何かが運ばないかぎり、それらはコードと一緒には動きません。

CommitLore はその工学的判断を Git に保存し、次の編集の前に**今も有効な決定だけ**を届けます。
のちに置き換えられた決定や期限切れの決定が、まだ有効であるかのようにエージェントへ届くことは
ありません。

**リポジトリ所有 · lifecycle 認識 · 根拠検証 · エージェント非依存**

Claude Code · Codex · Cursor · Gemini CLI · OpenCode · Windsurf

ホスト型メモリサービスも、ベンダー固有のチャット履歴もありません。リポジトリが所有する、
レビュー可能な意思決定コンテキストだけです。commit trailer は commit と共に移動しますが、
notes-backed record は通常の clone には来ません。Git は既定で `refs/notes/*` を
fetch しないため、clone の後に notes fetch を構成する必要があります。

## パス問い合わせを見る



**新しいエージェント、チャット履歴はゼロ。それでも明白な修正案がなぜ除外されたかを手渡されます。** 変更する前に path を照会します。

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

## このリポジトリ自体がデモです

解決済みの問いをエージェントが再び決めないようにすると主張するツールなら、自身で何を捕まえたかも示せるべきです。このツールはその一覧を公開で保ち、このプロジェクトがすでに公開していたもののうち、後から誤りだと分かった項目も含めています。

- **どのインストールでも、README の主張が前提とした信頼 tier を生み出せなかった。** record はエージェントに `directive` または `claim` として届きます。インストール済みのどの surface も directive author string を構成していなかったため、grade は全員に対して `claim` へ fail-closed しましたが、注入された凡例は誰も到達できない tier を示していました。以前の二つの benchmark は `claim` 等級の配信を測定していました ([#415](https://github.com/MongLong0214/commitlore/issues/415)).
- **登録された benchmark 分析は、一度に四つの異なる実験を読んでしまうところでした。** しかも停止規則が行数だったため、その混入によって研究は自身の完全性ゲートを*通過*していたでしょう ([#441](https://github.com/MongLong0214/commitlore/issues/441)).
- **result-schema gate は何からも実行されていませんでした。** そのため schema は runner より五フィールド遅れ、二日間誰も気付きませんでした ([#392](https://github.com/MongLong0214/commitlore/issues/392)).
- **出荷済みの pre-push hook はすべての `git push` を停止させました。** 40 秒間に hook が 1,240 回呼ばれました。関数は十一回テストされていたのに、hook path は一度もテストされていなかったからです ([#422](https://github.com/MongLong0214/commitlore/issues/422)).

これらはすべて、このプロジェクトがインストールを勧める hook で検証されるコミット trailer の `Ruled-out:`、`Warn:`、`Limit:` の行であり、どこでも実行できるのと同じ `commitlore context` で読めます。

**それぞれが支払った代償を含む完全な一覧: [docs/SELF-AUDIT.md](docs/SELF-AUDIT.md)。**

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

**`git log` のベースラインは、自分で自分を測って出た値ではありません。** 同じ測定を、このプロジェクトが書いていない四つのリポジトリ — Django、SymPy、scikit-learn、Requests — に固定コミットで適用すると、あるパスの履歴のうち 800 トークンの切り詰めを生き残る割合は **37.4% から 55.6%** に収まります。上の 42.0% はその帯の中にあります。固定予算が一つのファイルの履歴の半分近くを落とすのは、大きく長命なリポジトリで `git log` が一般に行うことであり、このリポジトリ固有の性質ではありません。**転移しなかったのは仕組みのほうです。** 私たちのパスは中央値 1 コミットで 687 トークン、Django は 8 コミットで 213 トークン。つまり長いコミットメッセージは、固定予算のもとで通常の Git ベースラインをより悪くします — このプロジェクト自身の慣行が払っているコストです。[bench/EXTERNAL-CORPUS.md](bench/EXTERNAL-CORPUS.md) はそれらのリポジトリでの配信値も報告しますが、まず §9.0 と §9.5 を読んでください。そこでのレコードは revert コミットからプログラムが生成したものであり、見出しの数値は検索の結果ではなく付与述語が強制する値です。

レコードを一つ取り逃がせば、モデルはコンテキストを失います。すでに覆された意思決定を渡せば、正しさを損ないます。この[検索測定](bench/retrieval/result.md)では、ノイズが 0 件から 10,000 件までのすべてのサイズで、BM25、embedding top-k、hybrid RRF、パスフィルター付き embedding がそれぞれ廃止済みのレコードを一つ返しました。lifecycle を伴う CommitLore のパス範囲は古いレコードをゼロにし、現在の二つのレコード (2/2) を返しました。

再現率は補助的な結果です。検索はおおむねどちらでも同じレコードを見つけますが、どの意思決定がまだ有効かを知るルートは一つだけです。意思決定が覆されたときに違いが現れます。これはまさにこの製品が存在するケースです。

別の #167 の露出実行も重要です。10,002 件のうちモデルに届いたレコードは 2 件だけでした。

| ルート | モデルに見えるレコード | 関連レコード | モデルに見えるトークン |
|---|---:|---:|---:|
| すべて注入 | 10,002 | 2/2 | 1,004,554 |
| top-k 語彙検索 | 2 | 1/2 | 190 |
| CommitLore パス範囲 | 2 | 2/2 | 335 |

これは固定した 2 レコードの出力予算における露出と再現率の測定であり、トークンコスト、請求コスト、正確さ、エージェントの振る舞いを測るものではありません。これは一つのコーパス、一つのクエリ、一つの固定された embedding モデルによる結果です。再現率が並ぶ地点と、ほかに何が測定され何が測定されていないかは [docs/evidence.md](docs/evidence.md) にあります。

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

それはコミット768個のリポジトリでした。**コミット10万件では、インデックスを使った
`context` 問い合わせが p50 496 ms で応答します。** 背後で動くフックは `commit-msg` が
p50 185.85 ms、注入フックが p50 102.40 ms です。大きなリポジトリにこれを入れたままに
するかを決めるのはこれらの数値であり、主張ではなく測定です。同じ実行には見栄えの悪い
数値も含まれています。インデックスなしで同じ問い合わせをコミット10万件に対して行うと
86,673 ms かかります。インデックスは動いている問い合わせに乗せた最適化ではなく、その
規模で問い合わせを可能にするもの自体です。だから `init` がそれを作り、`doctor` が
それを確認します。

**ホスト型のチャット履歴製品が提供できない3つの性質**、そして権威をサービスではなく Git に
置いた理由:

| ツール | 覚えているもの |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | エージェントがどう働くべきか |
| ADR | 大きなアーキテクチャ決定を文書として |
| Chat memory / RAG | 過去の関連テキスト |
| [Lore](https://arxiv.org/abs/2603.15566) | 同じ発想、先に公表された — git trailer に載せた決定レコード |
| **CommitLore** | **このコードパスに今も適用される決定** |

類似検索は関連する決定を見つけられます。CommitLore はさらに、その決定が今も有効か、
置き換えられたか、期限切れかを知っていて — 最初のものだけを示します。

**三行目について。** [Lore](https://arxiv.org/abs/2603.15566)（2026年3月）は、この
リポジトリができる四か月前に、native な git trailer へ決定レコードを載せる方式を提案して
います。語彙はこちらとほぼ一対一で対応します。**プロトコルの発想はここで新しいものでは
なく**、そうでないと言っても論文を読む人の前では持ちません。Lore に対応物がないのは
lifecycle — `Supersedes:` と `Expires:`、そして上の表の最終行を真にするフィルタリング —
と信頼グレーディングであり、論文自身が「empirical validation path を*示す*」と書いていて
実験は行っていません。その検証を、失敗した部分も含めて持っていることが、このプロジェクト
が論文に対して持つものです
（[ADR-0029](docs/adr/ADR-0029-lore-is-prior-art-and-this-is-what-differs.md)）。

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

- テスト済みの Git workflow では、意思決定の履歴は rebase、remote transfer、path rename を経ても残る。squash merge は通常の trailer と同じく trailer block を捨てるため、`commitlore squash-preserve` かその GitHub Action が記録を引き継ぐ — テストはその経路を含む。
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

**1160 measurements across 1240 rows.** 80 row(s) are superseded by a re-run of the same task, arm and seed, and the analysis counts the survivor. No manifest declares how many runs the matrix was meant to produce, so completeness cannot be checked from the logs alone.

| Where it comes from | |
|---|---|
| Results | `bench/results/m5-seeds-1-10-rerun.jsonl` (200 rows), `bench/results/m5-seeds-11-20-rerun.jsonl` (200 rows), `bench/results/m5-seeds-21-30.jsonl` (200 rows), `bench/results/m5-seeds-31-40.jsonl` (200 rows), `bench/results/m5-seeds-41-50.jsonl` (200 rows), `bench/results/m5-seeds-51-58.jsonl` (160 rows), `bench/results/m5-seeds-55-58-rerun.jsonl` (80 rows) |
| Run id | `20260802T124657Z-ae3ba0`, `20260802T230855Z-00da79`, `20260803T100356Z-aeb38a`, `20260803T203631Z-77df15`, `20260806T230824Z-60e31e`, `20260807T095937Z-bf2b05`, `20260807T234037Z-6dd0a2` |
| Driver | `claude-headless` |
| Model | `sonnet` |
| Matrix | 10 tasks, seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58 |
| Status | final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-1-10-rerun.jsonl`), final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-11-20-rerun.jsonl`), final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-21-30.jsonl`), final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-31-40.jsonl`), final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-41-50.jsonl`), final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-51-58.jsonl`), final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-55-58-rerun.jsonl`) |

**Re-proposal and violation rates, every recorded run:**

| Condition | n | Re-proposed | Re-proposal rate | Runs with violations | Violation rate | Mean turns | Mean tokens |
|---|---|---|---|---|---|---|---|
| `commitlore-off` | 620 | 110 | 0.177 | 58 | 0.094 | 19.3 | 38488 |
| `commitlore-on` | 620 | 16 | 0.026 | 7 | 0.011 | 16.2 | 39265 |

**Analysis set — 1169 of 1240 rows** (71 excluded: error = 71). A row that failed carries `reproposed: false` because the field is required, not because the agent declined to re-propose; leaving it in the denominator would let the arm that crashed more often look like the arm that behaved better. The excluded runs are counted here, never dropped silently.

| Condition | n | Re-proposed | Re-proposal rate | Runs with violations | Violation rate | Mean turns | Mean tokens |
|---|---|---|---|---|---|---|---|
| `commitlore-off` | 584 | 110 | 0.188 | 58 | 0.099 | 20.4 | 40842 |
| `commitlore-on` | 585 | 16 | 0.027 | 7 | 0.012 | 17.1 | 41568 |

**Significance:**

| Quantity | Value |
|---|---|
| Arms | `commitlore-on` (treatment) vs `commitlore-off` (baseline) |
| Re-proposed / did not | `commitlore-on` 16/569, `commitlore-off` 110/474 |
| Fisher exact, two-tailed | p = 1.52e-20 |
| Rate difference, treatment minus baseline | -16.1pp, 95% CI [-19.6pp, -12.7pp] |
| Odds ratio | 0.1212 |
| Paired (task, seed) cells | 579 |
| Rows excluded from the analysis set | 71 |

**How the runs ended** — failures are reported, not filtered:

| Condition | completed | timeout | over-turns | over-tokens | error |
|---|---|---|---|---|---|
| `commitlore-off` | 414 | 3 | 157 | 10 | 36 |
| `commitlore-on` | 459 | 2 | 109 | 15 | 35 |

**Read these numbers with their limits:**

- Every rate here is conditional on the model that produced it. Re-proposal is a behaviour, and behaviours differ between models, so these figures are not evidence about any other model.
- 585 and 584 runs per arm: this matrix is only powered to detect a large effect, so a non-significant result from it is a statement about the sample size, not about CommitLore. The exact power table is in [`bench/README.md`](bench/README.md).
- Fisher exact treats the runs as independent while the design is paired by (task, seed). It is the pre-registered result, but it is not a valid paired-data test. See the correction in [`docs/VERDICT-M4.md`](docs/VERDICT-M4.md).
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

## コントリビュート

[spec](spec/SPEC.md)、[ADR](docs/adr/)、[`CONTRIBUTING.md`](CONTRIBUTING.md) を読んでください。CommitLore は [MIT License](LICENSE) の下で永久に無料のオープンソースです。
