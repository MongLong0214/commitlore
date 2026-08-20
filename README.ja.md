<!-- README:BRAND -->
<p align="center">
  <img src="./assets/readme/commitlore-logo.svg" width="440" alt="CommitLore">
</p>

<h1 align="center">CommitLore</h1>

<h3 align="center">あなたのコーディングエージェントは、チームがすでに却下した案を何度も提案します。</h3>

<p align="center">
  <strong>Git が所有する、コーディングエージェントの意思決定の権威。</strong><br>
  制約、却下した代替案、警告を Git に残し、今も有効なものだけを届けます。
  それならエージェントは、リポジトリがすでに覆した決定を現在の指針として受け取りません。
</p>

<p align="center">
  <strong>CommitLore にホスティングサービスはありません。record はリポジトリが所有します。</strong>
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml/badge.svg">
  </a>
  <a href="https://github.com/MongLong0214/commitlore/releases">
    <img alt="最新リリース" src="https://img.shields.io/github/v/release/MongLong0214/commitlore?display_name=tag">
  </a>
  <a href="spec/SPEC.md">
    <img alt="プロトコル 2.0 stable" src="https://img.shields.io/badge/protocol-2.0%20stable-3FB950">
  </a>
  <a href="package.json">
    <img alt="Node.js 22.23.2 以上" src="https://img.shields.io/badge/node-22.23.2%2B-3FB950">
  </a>
  <a href="LICENSE">
    <img alt="MIT ライセンス" src="https://img.shields.io/badge/license-MIT-3FB950">
  </a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.ko.md">한국어</a> ·
  <strong>日本語</strong> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>一度インストールします。</strong> その後、使いたい各リポジトリを初期化します。
</p>

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.sh | sh -s v1.2.0
```

<details>
<summary>先にインストーラーを読みたいですか？</summary>

```bash
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.sh
sh install.sh v1.2.0

# あるいはスクリプトを使わずに。スクリプトが作るチェックアウトは自分でも作れます。
git clone --depth 1 --branch v1.2.0 https://github.com/MongLong0214/commitlore
node commitlore/dist/commitlore.mjs --version
```

固定されたソースチェックアウトと、`node <checkout>/dist/commitlore.mjs` を実行する wrapper を
インストールします。コンパイル済みダウンロードもビルド手順もありません。

</details>

<p align="center">
  <img
    src="./assets/readme/demo.gif"
    width="900"
    alt="commitlore のデモは src/pricing.ts に記録された二つの決定を出力し、limit と退けた代替案を持つ active な一つだけを届け、superseded な決定は Git には残るが現在の指針としては届けないことを示します。"
  >
</p>

---

> **コードは残る。判断は残らない。**

エージェントがある手法を提案します。チームは自明でない制約のために却下します。最終コードは
結果を残しても、その代替案をなぜ退けたかはたいてい残しません。後のエージェントはコードだけを見て、
同じ案をもう一度提案します。

CommitLore はその判断をコードのそばに残します。

## CommitLore がすること

| | 振る舞い | 製品上の経路 |
|---|---|---|
| **Capture** | diff が示せない制約、却下した代替案、警告を保存します。候補を session transcript と staged diff に照合します。 | `commitlore capture` |
| **Preserve** | ホスト型メモリデータベースではなく、承認済み record を Git trailer または notes に保存します。 | commit hook · `refs/notes/commitlore` |
| **lifecycle を追跡** | active、superseded、expired の決定を区別します。 | `commitlore stale` |
| **範囲を絞る** | エージェントがこれから編集する path の決定を選びます。 | `commitlore context` |
| **信頼を等級付け** | record を directive、claim、または保留された内容として届けます。 | 既定 / signed mode |
| **Delivery** | 対応エージェントに編集前の現在のコンテキストを渡します。 | plugin hook · MCP |

ほとんどの commit に record は不要です。CommitLore はすべての変更を説明するためではなく、
コードが保存できない判断のためにあります。

<!-- README:QUICKSTART -->
## 60 秒で decision-aware agent にする

### 1. CLI をインストール

macOS と Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.sh | sh -s v1.2.0
```

Windows:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.ps1))) v1.2.0
```

Node.js 22.23.2+ と Git が必要です。スクリプトは何かを書き込む前に両方を確認します。

### 2. エージェントを接続

Claude Code:

```text
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

Codex:

```bash
commitlore plugin install-codex
```

plugin は `commitlore` を `PATH` に置かないため、下のコマンドには CLI のインストールも必要です。
インストーラーは安全にできる範囲で対応 MCP host を検出して配線します。正確な表は下にあります。

### 3. リポジトリを初期化

```bash
cd your-repository
commitlore init
commitlore context .
```

plugin をインストールまたは更新した後は、新しいエージェント session を始めます。実行中の session は
読み込んだ runtime を保持します。

その後は普段どおり作業して commit します。対応する skill integration では、通常の commit 要求中に
CommitLore が検討され、残す価値がなければ黙っています。毎回 CommitLore を名指しする必要はありません。

record ごとの確認なしに承認済み record を stage したい場合、リポジトリは一度
`commitlore auto on` を選べます。この方針はリポジトリが所有してチームに適用されるため、
このページが勝手に有効にはしません。

<!-- README:PAYLOAD -->
## エージェントが受け取るもの

`src/pricing.ts` を編集する前に:

```text
commitlore: active records for src/pricing.ts

Limit
  [claim] r-price01  calculatePrice owns final checkout pricing only

Ruled-out
  [claim] r-price01  Reuse it for admin quotes |
                     eligibility and rounding semantics differ
```

`[claim]` は「情報として吟味する」という意味です。リポジトリは、より強い signed-authority mode を
選べます。delivery はエージェントにコンテキストを渡すだけで、編集を止めません。

[セキュリティモデル →](SECURITY.md)

## なぜ Git なのか

**リポジトリは、そのコードの背後にある判断を所有すべきです。**

CommitLore は record を通常の Git trailer と notes に保存します。だから record は、説明するコードと
一緒に branch、merge、clone、review を通り、provider が変わっても残ります。

SQLite は再構築可能な index にすぎません。消しても record は Git に残ります。

## 古い決定を見つけるだけでは足りない

一般的な memory または retrieval system はこう尋ねます。

> どの古い text が関係ありそうか？

CommitLore はこう尋ねます。

> 記録された決定のうち、今この path に適用されるものはどれか？

superseded な決定は大いに関係があり得ても、現在の指針としては誤りです。関連性と権威は
別の問いです。

## 仕組み

<p align="center">
  <img src="./assets/readme/hero.svg" width="720" alt="src/pricing.ts では Git 履歴の active な決定が、次の編集前に届けられるコンテキストへ進み、その limit と退けた代替案を伴います。管理者見積もりも対象だった以前の決定は superseded となり、履歴には残っても現在の指針としては進みません。">
</p>

1. **Capture** — エージェントは diff では示せない決定コンテキストだけを起草します。
2. **Verify** — CommitLore は草稿を session と staged diff に照合します。
3. **Preserve** — 承認された record は identity と lifecycle を持って Git に残ります。
4. **Deliver** — 後の編集の前には、その path の active な record だけを返します。

ほとんどの commit に record はありません。commit hook は record があるときに検証しますが、発明はしません。

既存の hook は上書きしません。 `commitlore init` は `core.hooksPath` を尊重し、すでにある hook を
`<hook>.commitlore-chained` へ移してから先に呼びます。 `commitlore hooks uninstall` は元に戻します。

<!-- README:CAPABILITY -->
## 自動になること、ならないこと

| Host | 編集前 delivery | 検証済み capture workflow | 毎 commit で決定的な capture |
|---|---|---|---|
| Claude Code | plugin を通じて自動 | plugin skill で利用可能 | **certified ではない** |
| Codex | plugin を通じて自動 | plugin skill で利用可能 | **certified ではない** |
| Hermes | `commitlore hermes install` 後に利用可能 | host install 後に利用可能 | **certified ではない** |
| Gemini CLI, Cursor, Windsurf, opencode | host が登録を使う場合の MCP delivery | MCP で公開される procedure | いいえ |
| `AGENTS.md` host | procedure のみ | procedure のみ | いいえ |

「利用可能」は prepare → verify → stage workflow が存在することを意味します。すべての適格 commit が
自動で評価されるという意味ではありません。

対応 skill host の利用者は、毎回「これを CommitLore に記録して」と言う必要はありません。
残る制約は record ごとのユーザー命令ではなく、host が開始するかどうかです。

## 現場報告であって測定ではない

無関係な一つのリポジトリで、初めて v1.2.0 を入れた人の一回の実行です。ここでは何も測定されず、
evidence log にもありません。上の段落が表で扱っていない loop を主張しているため、このページにあります。

その人は agent に丸めの不具合を直すよう頼み、decimal library はすでに検討して却下したと付け加え、
最後に「commit して」と言いました。CommitLore は一度も名指しされませんでした。commit が持った一部です。

```
Ruled-out: adopting a decimal library such as Decimal.js | the backend is a
  number contract, so it is meaningless
Warn: do not revert the test file to console.assert: it exits 0 even on
  failure, so CI passes silently
Provenance: drafted
```

`Warn` は agent に口述したものではありません。作業中に罠に出会い、次の人のために残しました。
`Provenance: drafted` は人が record を読まなかったことを記し、`claim` に格付けします。
つまり命令ではなく、吟味する報告として届けられます。

共有履歴のない後の session は、結局 decimal library を採用するよう頼まれました。採用せず、その理由として
record を挙げました。また grade も読みました。 `claim` は指示ではないため、同意する前に記された理由を
コードと照合しました。

## メモリ保存とは異なる

| | 一般 memory / RAG | **CommitLore** |
|---|---|---|
| 主な問い | どの古い text が関連するか？ | 今ここにどの決定が適用されるか？ |
| 権威 | memory store または provider | Git |
| 範囲 | 意味的な類似 | repository path |
| lifecycle | 多くは append-first | active · superseded · expired |
| 信頼 | 取得した text | directive · claim · blocked |
| capture | transcript または note の保存 | 根拠照合済みの決定 record |
| 可搬性 | backend に依存 | 通常の Git |

CommitLore は意図的に狭いものです。一般の user-memory system、会話 archive、vector database の
代替ではありません。

<!-- README:EVIDENCE -->
## 根拠: 検索はレコードを見つけられる

| 問い | 測定結果 | 境界 |
|---|---|---|
| 登録された研究で claim grade のコンテキストは再提案を変えたか？ | CommitLore ありで **2.8%** (16/580)、なしで **18.8%** (109/579) | モデル一つ、harness 一つ、構成した task |
| lifecycle filtering は測定した active projection で retired record を届けたか？ | **retired record 0 件** | superseded record はあり、expiry はなし |
| index 付き lookup は規模に対応するか？ | **100k commit で p50 496 ms** | index なし fallback はずっと遅い |

index の構築時間は commit 数ではなく *record* 数に従います。高コストの処理は record ごとに一度だけ走るので、
record が少ない長い履歴は、record が密な短い履歴より早く構築されます。

path scope が大きな履歴を model に届けないようにします。#167 corpus では、10,002 件の record のうち
届いたのは 2 件だけでした。

| route | モデルに見えるレコード | 関連レコード | モデルに見える token |
|---|---:|---:|---:|
| すべてを inject | 10,002 | 2/2 | 1,004,554 |
| top-k lexical | 2 | 1/2 | 190 |
| CommitLore path scope | 2 | 2/2 | 335 |

これは固定した二 record 予算での exposure と recall の測定です。token cost、請求額、正確さ、agent の
振る舞いは測りません。一つの corpus、一つの query、一つの固定 embedding model です。

agent study は普遍的な model 効果を確立しません。delivery は model が record を読んだ、または従った
証拠ではありません。

[手法、全表、除外、negative result →](docs/evidence.md)

<!-- README:LIMITS -->
## これが役に立たない場合

- **Capture は補助されるもので決定的ではありません。** 対応 skill は通常の commit 要求を検討しますが、
  すべての適格 commit を評価する host は certified ではありません。
- **既定の directive mode は authentication ではありません。** commit author header を照合しますが、
  commit を書ける人なら誰でもその header を設定できます。だから既定 mode の `[directive]` は identity の
  証明ではなく policy metadata です。signature mode には Git 自身の verified status と repository-local
  `commitlore.trustedSigner` allowlist の一致も必要です。signer allowlist がない、空、または読めない場合は
  誰も認可されないため、この mode は fail-closed です。
- **Guard は実験的な参考情報**であり安全網ではありません: precision 44.8% (95% Wilson CI 32.7%–57.5%)、
  recall 22.0%、417-decision corpus に基づきます。空の guard 結果は安全判定ではありません。
- **Delivery は一致する tool call ごとに token を使います。** 編集前 hook は `Read` のほか `Edit`、`Write`、
  `MultiEdit`、`NotebookEdit` でも走るので、editing agent が commit するよりずっと頻繁に実行されます。
  一回につき既定で 800 token まで payload を使い、`--budget` で変えます。record のないリポジトリは何も使わず、
  これはインストールではなく採用とともに生じるコストです。
- **答えは部分的な場合があります。** coverage は開示され、部分結果にないことは record がない証明ではありません。
  repository-wide coverage、symbol anchor、interactive record builder は未解決です:
  [#32](https://github.com/MongLong0214/commitlore/issues/32)、
  [#33](https://github.com/MongLong0214/commitlore/issues/33)。
- **commit trailer は clone とともに来ますが、notes は来ません。** Git は既定で `refs/notes/*` を fetch しないため、
  `refs/notes/commitlore` の record は `commitlore init` がその mirror を構成するまで通常の clone にはありません。
- **ホスト型 backend はありません。** ただし server または hook がコンテキストを返した後は、host が自身のポリシーで
  それを扱います。CommitLore はそのデータフローを制御しません。

[セキュリティ](SECURITY.md) ·
[互換性](docs/COMPATIBILITY.md) ·
[根拠](docs/evidence.md)

<details>
<summary><strong>セキュリティと信頼モデル</strong></summary>

record は grade が付くまで信頼できません。既定の author matching は authentication ではなく policy metadata です。
signed directive mode には Git verification と repository-local signer allowlist が必要で、allowlist がないか読めない場合は
誰も認可されません。injection の形をした payload は model-readable route から保留されます。

[完全なセキュリティモデル →](SECURITY.md)

</details>

<details>
<summary><strong>インストール、アップグレード、古い hook 世代</strong></summary>

CLI installer は知らないリポジトリ内の hook を書き換えられず、実行中の host session は読み込んだ runtime を保ちます。
`commitlore doctor` は両方の状態と修復を示し、`commitlore upgrade` は新しい release があるかを報告します。

[インストールとアップグレード →](docs/install.md)

</details>

<details>
<summary><strong>プロトコルと Git storage</strong></summary>

record は通常の Git trailer または notes です。Protocol 2.0 は lifecycle、trust grade、validation、compatibility を定義します。

[人向けガイド →](docs/protocol.md) ·
[規範仕様 →](spec/SPEC.md)

</details>

<details>
<summary><strong>根拠と negative result</strong></summary>

リポジトリは手法、除外、失敗した測定、元の benchmark や診断が誤っていた事例を公開します。

[根拠 →](docs/evidence.md) ·
[self-audit →](docs/SELF-AUDIT.md)

</details>

<hr>

<p align="center">
  <strong>履歴のあるリポジトリで試してください。</strong><br>
  <sub>path scope、lifecycle、capture、installation が壊れる場所を教えてください。</sub>
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/issues/new">失敗事例を報告</a>
  ·
  <a href="docs/SELF-AUDIT.md">self-audit を読む</a>
</p>

<hr>

<!-- README:DOCS -->
## ドキュメント

- [インストール、アップグレード、アンインストール](docs/install.md)
- [CLI リファレンス](docs/cli.md)
- [Capture workflow](docs/capture.md)
- [Record protocol](docs/protocol.md)
- [セキュリティモデル](SECURITY.md)
- [根拠と制約](docs/evidence.md)
- [本番契約](docs/PRODUCTION-READINESS-SSOT.md)
- [ドキュメント索引](docs/README.md)

## コントリビュート

[CONTRIBUTING.md](CONTRIBUTING.md) は、このリポジトリが自ら守る record protocol、release gate、
根拠の再現方法を説明しています。

## ライセンス

MIT — [LICENSE](LICENSE) を参照してください。
