# Annals

[English](README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | **日本語**

> **git コミット trailer を AI コーディングエージェントの組織的記憶に。**
> 永久に無料。サーバーなし、DB なし、有料プランなし — **git が唯一の信頼できる情報源（SSOT）です。**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-v0.1.0_開発中-orange.svg)](https://github.com/MongLong0214/annals/milestones)
[![Target](https://img.shields.io/badge/v0.1.0-2026--08--23-blue.svg)](https://github.com/MongLong0214/annals/milestone/4)
[![Protocol](https://img.shields.io/badge/protocol-Lore_v2-8A2BE2.svg)](docs/adr/ADR-0001-scope-v010.md)

> ⚠️ **ステータス**: プロトコル自体は**今日から**素の git だけで使えます（[今すぐ使う](#今すぐ使う素の-git)参照）。CLI・MCP サーバー・フック・GitHub Actions は **v0.1.0（目標 2026-08-23）** で出荷されます。この README のすべての主張は、今すぐ再現可能か、計画中と明示されているかのいずれかです — 数値は [AnnalsBench](docs/prd/PRD-F7-annalsbench.md) のログからのみ提示します。

---

## 問題: あなたのエージェントは、セッションごとに退職するシニアエンジニアだ

いまやコミットの多くを AI エージェントが書いています。作業中のエージェントは意思決定コンテキストの全体 — 発見した制約、試して却下した代替案、意図的にテストしなかった箇所 — を保持しています。そしてセッションが終わると、コンテキストウィンドウは消え、**diff だけが生き残ります**。

次のセッション（次のエージェント、次の同僚）はすべてを再導出し — そして**3 週間前に却下されたまさにそのアプローチを再提案**します。却下された事実も、その理由も、どこにも記録されていないからです。

これは 40 年間 *設計根拠キャプチャ問題（design rationale capture problem）* と呼ばれ、未解決のままでした。理由はただひとつ — 人間は根拠を書き残すコストを払わないからです。**エージェントはこの経済学を反転させます。** コミット時点で根拠はすでにエージェントのコンテキストにあり、直列化のコストは数百トークンです。Annals は「それをどこに置くか」に答えるプロトコルです。

## 3 行で

1. **キャプチャは無料** — エージェントは「なぜ」をすでに知っているので、どのみち作るコミットに構造化された *git trailer* として書き込みます。証拠を引用できない trailer は検証器が破棄します。
2. **消費は pull ではなく push** — エージェントがファイルに触れた瞬間、*そのパス*の有効な制約と過去の却下履歴が自動注入されます。誰も問い合わせを覚えておく必要はありません。
3. **git が唯一の真実** — 知識アトムはコミットメッセージと `refs/notes/annals` に住みます。それ以外（インデックス・ダッシュボード)はすべて捨てられる派生キャッシュです。`git clone` ひとつで記憶全体が移動します。

## 実際の姿

```text
Prevent silent session drops during long-running operations

The auth service returns inconsistent status codes on token
expiry, so the interceptor catches all 4xx responses and
triggers an inline refresh.

Limit: Auth service does not support token introspection
Record-Id: c-auth-01
Ruled-out: Extend token TTL to 24h | security policy violation
Ruled-out: Background refresh on timer | race condition
Certainty: high
Blast: narrow
Undo: clean
Warn: 4xx handling is intentionally broad
  -- do not narrow without verifying upstream behavior
Verified: Single expired token refresh (unit)
Unverified: Auth service cold-start > 500ms behavior
Annals-Version: 2.0
```

これは普通の git コミットです。書くのに道具は不要で、git 自身がパースできます — trailer は git ネイティブ機能です（`Signed-off-by`、Gerrit の `Change-Id`、Conventional Commits の footer と同じ仕組み）。

### Protocol v2 語彙

| Trailer | 目的 | 消費先 |
|---|---|---|
| `Limit:` | 決定を形づくった外部制約 | 注入、`annals constraints` |
| `Record-Id:` | 安定した同一性 — 廃止・継承のアンカー | ライフサイクル畳み込み |
| `Ruled-out:` | `代替案 \| 理由` — 試して捨てたもの | **`annals guard`**（再提案ブロック） |
| `Certainty:` | `firm` \| `tentative` \| `guess` | レビュールーティング |
| `Blast:` | `local` \| `module` \| `system` | 承認ゲートルーティング |
| `Undo:` | `easy` \| `costly` \| `permanent` | 承認ゲートルーティング |
| `Warn:` | 未来の変更者への警告 | 注入（信頼グレード適用） |
| `Verified:` / `Unverified:` | 検証したこと / していないこと | カバレッジ照会 |
| `Follows:` | 決定の連鎖をつなぐコミット | コンテキスト組み立て |
| `Supersedes:` | 既存の Record-Id を廃止 | **stale エンジン** |
| `Expires:` | 制約が終わる日付・条件 | stale エンジン |
| `Evidence:` | 主張→証拠リンク（`パス#アンカー`） | 収穫検証器 |
| `Provenance:` | `authored` \| `squashed-from <sha>` \| `reconstructed` | **信頼グレーディング** |
| `Decision-Id:` / `Annals-Version:` / `X-*` | 同一性・バージョン・拡張 | ツール群 |

設計ルール（[「死にフィールド禁止」](docs/adr/ADR-0006-push-injection.md)）: すべての trailer は最低 1 つの消費ルート（クエリ・ゲート・注入規則）を持ちます。誰も読まない語彙は仕様から削除されます。

## 今すぐ使う（素の git）

プロトコルにツールは一切不要です。コミットに trailer を書き（エージェントへの指示に任せても OK）、git 自身で照会します:

```bash
# 制約値の抽出、機械可読 — git ネイティブの trailer パーサー
git log --format='%h %(trailers:key=Limit,valueonly,separator=%x3B)'

# あるコミットの trailer ブロック全体をパース
git log -1 --format=%B <sha> | git interpret-trailers --parse

# 特定パスに関わった制約（リネーム追跡付き）
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

> 注意: `--grep` ではなく `%(trailers:...)` を使ってください。テキスト grep は本文の散文を誤検出し、複数行折り返しで壊れます — [この失敗モードを実際に再現済み](docs/tickets/F2-core-cli.md)で、CLI が存在する理由のひとつがこれを構造的に不可能にすることです。

## v0.1.0 で出荷されるもの（2026-08-23）

| レイヤー | 成果物 | マイルストーン |
|---|---|---|
| **L0 プロトコル** | `SPEC.md`、JSON Schema、適合性フィクスチャ、ルート契約テスト | [M1](https://github.com/MongLong0214/annals/milestone/1) |
| **L1 コア CLI** | `annals validate / context / constraints / rejected / directives / stale / index / doctor` — SQLite 増分インデックス、`--no-index` フォールバック、10 万コミット p50 < 100ms 目標 | [M2](https://github.com/MongLong0214/annals/milestone/2) |
| **L1 生存** | `annals squash-preserve`（squash マージ継承）、`refs/notes/annals` ミラー（rebase 生存）、`--follow` デフォルト | [M2](https://github.com/MongLong0214/annals/milestone/2) |
| **L2 エージェントファブリック** | `annals mcp`（MCP サーバー）、自動注入フック（パススコープ・予算制・決定論的）、transcript 収穫 + **証拠検証器**、`annals guard`、クリーンルーム skills | [M3](https://github.com/MongLong0214/annals/milestone/3) |
| **L3 信頼** | provenance × lifecycle グレーディング、**Warn 降格**（未検証の指示は*主張*としてのみレンダリング、決して命令にしない）、注入ヒューリスティクス、secret guard | [M3](https://github.com/MongLong0214/annals/milestone/3) |
| **L4 組織** | GitHub Actions: PR lint + 有効制約コメント、squash 継承自動化 — *あなた自身の* CI で動作、外部呼び出しゼロ | [M4](https://github.com/MongLong0214/annals/milestone/4) |
| **L5 AnnalsBench** | 再提案率（Annals on/off）、ノイズアブレーション、受理アトムあたりコスト — README の数値はすべてログから再生成 | [M1](https://github.com/MongLong0214/annals/milestone/1) / [M4](https://github.com/MongLong0214/annals/milestone/4) |

全体計画: [ADR](docs/adr/) · [PRD](docs/prd/) · [チケット仕様](docs/tickets/TICKETS.md) · [Issues](https://github.com/MongLong0214/annals/issues)

## 「それなら○○でいいのでは」への答え

| 代替案 | なぜ足りないか |
|---|---|
| **ADR / Wiki / Notion** | 別ファイルはコードから乖離して腐ります。trailer は diff と同じコミットオブジェクトに住むため、非同期は構造的に不可能で、`git clone` が一緒に運びます。 |
| **Slack/ドキュメントの RAG** | 低シグナルな成果物を読み取り時に検索するだけ。Annals は書き込み時に高シグナルな知識を*生成*し、説明対象のコードに束縛します。 |
| **エージェント記憶フレームワーク**（ベクトルストア） | 無キュレーションのエピソード記憶は SE エージェントの性能を実測で*悪化*させます（ノイズ）。Annals のアトムは型付き・証拠検証済み・パススコープ・寿命管理付き — それぞれが公開された失敗モードへの直接の回答です。 |
| **静的コンテキストファイル**（CLAUDE.md / AGENTS.md） | グローバルな一括投入で、実証結果もまちまち。Annals は*パス別*・*グレード別*・*有効なもののみ*をトークン予算内で注入します。 |
| **ナレッジベース SaaS** | 組織の意思決定史が他人のデータベースに住む理由はありません。ここには落ちるサーバーも解約するサブスクもない — リポジトリこそがデータベースです。 |

## セキュリティモデル（正直版）

コミットメッセージはエージェントへの指示チャネルになり、それは同時にインジェクション面になるということです。v0.1 は正直な最小防御を出荷します: **未検証の `Warn:` はすべての注入・照会出力で「主張」に降格**（外部コントリビューションは常に降格）、インジェクションパターンのヒューリスティクスが敵対的アトムを隔離、secret guard が資格情報の永久刻印をブロック。暗号署名（sigstore）は[計画済み](https://github.com/MongLong0214/annals/issues/28)で、グレーディングモデルは署名が消費側を壊さずに組み込めるよう設計されています。

## 設計原則

- **ユーザーコストはゼロ、永遠に。** MIT、有料ティアなし、テレメトリなし、サーバーなし。LLM 依存機能（収穫・backfill）は、すでに使っているエージェントセッションの中でオプトインでのみ実行。コアパス — parse・query・inject・guard — は決定論的で LLM 非依存。
- **証拠なきアトムなし。** 収穫検証器は transcript や diff を引用できない trailer を破棄します。偽のアトムより、無いほうがましです。
- **ワークフローは交渉対象ではない。** squash・rebase・リネーム — 知識があなたのワークフローを生き延びるべきで、ワークフローがツールに合わせるべきではありません。
- **数値か、沈黙か。** この README は `bench/results/` から再現できる測定値だけを引用します。

## FAQ

**本当に無料ですか？** はい — 全部、永久に、MIT です。クラウド版は存在せず、計画もありません。持続可能性は販売ではなく標準の採用から来ます（[ADR](docs/adr/ADR-0001-scope-v010.md)）。

**どのエージェントで使えますか？** シェルコマンドを実行できるものなら今日からプロトコルを読めます。v0.1.0 の統合対象: Claude Code（フック+skills）と、`annals mcp` 経由のあらゆる MCP 対応エージェント。コミット形式自体は、コミットを書くすべてのエージェント — そして人間 — と互換です。

**うちは全部 squash マージですが？** デフォルトでは trailer は破壊されます — 実際に再現しました。だからこそ `annals squash-preserve` + notes ミラー + GitHub Action があります（[ADR-0004](docs/adr/ADR-0004-workflow-survival.md)）。

**巨大リポジトリでは？** インデックスは `.git/annals/` 配下の増分 SQLite キャッシュで、コマンド一発で再構築でき、決してコミットされません。目標: 10 万コミットでパス照会 p50 < 100ms — 約束ではなく CI で測定します。

**Conventional Commits と併用できますか？** できます。Annals trailer は git footer であり、Conventional Commits が `BREAKING CHANGE` に使うのと同じ仕組みです。`feat:` / `fix:` の件名行はそのままに、本文の下に trailer を追加すれば commitlint と semantic-release はそのまま動きます。

## コントリビュート

仕様（F1）が最初に着地します — 適合性スイートが契約なので、代替実装を歓迎し、テストで検証できます。[good first issue](https://github.com/MongLong0214/annals/issues) から始め、「なぜ」は [ADR](docs/adr/) を読んでください。このリポジトリの履歴自体がプロトコルをドッグフーディングしています: ここでは `git log --format='%h %(trailers:key=Ruled-out,valueonly)'` が実際に動きます。

## ライセンス

[MIT](LICENSE)
