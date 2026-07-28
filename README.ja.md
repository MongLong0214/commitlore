<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="CommitLore: コミット 4842356 の記録 r-2b58d4 は [claim] と評価され、guard は MATCH を返す">
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

CommitLore は、判断の背景を Git のコミット trailer と `refs/notes/commitlore` に保存するプロトコルです。
主役はプロトコルであり、CLI は記録を検証・ルーティングして shell、hook、MCP クライアントへ渡します。
コーディングエージェントを改善することは実証されていません。

## 測定の記録

<!-- BENCH:WITHDRAWN -->

登録済みの行動測定では、CommitLore がエージェントの行動を変える証拠は得られませんでした。その後の実行は、実行中にバイナリが変わったため無効になりました。さらに根本的な問題として、既存データセットには各行を生成したビルドを証明できる provenance がありません。そのため [`bench/report.ts`](bench/report.ts) は集計を拒否します。

以前公開したベンチマーク数値はすべて撤回しました。日付付きの判定文書は効果の主張ではなく、当時の記録として残します: [`VERDICT-M1.md`](bench/VERDICT-M1.md)、[`VERDICT-M1b.md`](bench/VERDICT-M1b.md)、[`VERDICT-M2.md`](bench/VERDICT-M2.md)、[無効実行の記録](bench/PREREGISTRATION.md#15-m3-is-void-the-binary-under-test-changed-while-it-ran)。ハーネスのコミットと実行したバンドルを特定できるデータセットができるまで数値は戻しません。詳細は [`bench/README.md`](bench/README.md) にあります。

## リポジトリが実際に証明していること

- **記録は通常の Git ワークフローを生き残ります。** コミット trailer と notes mirror は、[rebase と squash](test/squash.test.ts)、[履歴の書き換えと remote 間の転送](test/notes.test.ts)、[一段・多段の rename](test/follow.test.ts)でテストされています。
- **信頼の意味は全ルートで共通です。** query 出力、CLI injection、編集 hook、MCP tool、guard は同じ `directive | claim | blocked` グレードを使います。ルート検証は [`query.test.ts`](test/query.test.ts)、[`inject.test.ts`](test/inject.test.ts)、[`mcp.test.ts`](test/mcp.test.ts)、[`guard.test.ts`](test/guard.test.ts) にあります。
- **同梱のインジェクションスキャナーに一致した記録は、文章としてモデルへ届きません。** どれか一つの自由記述 trailer が一致すると、その記録全体が `blocked` になり、モデルが読むルートは内容を引用せず保留した事実だけを伝えます。この決定論的な語彙フィルターの結果は、実環境での検出率を示すものではありません。[パターン作成者による corpus、独立作成 corpus、無害 corpus](spec/fixtures/injection/README.md) は別々に報告します。CLI と hook は [`inject.test.ts`](test/inject.test.ts)、MCP の同一回答は [`mcp.test.ts`](test/mcp.test.ts) が検証します。
- **不明と空は別です。** 読み取り可能で記録がないリポジトリでは guard は `0` で終了します。壊れた Git は `history: unavailable`、未取得の notes mirror は `notes: unfetched` と報告します。どちらの不完全な検査も `3` で終了します。この契約は [`notes-availability.test.ts`](test/notes-availability.test.ts)、[`guard.test.ts`](test/guard.test.ts)、[`RELEASE-GATE`](docs/RELEASE-GATE.md) に固定されています。

## 一つの記録

この例は conformance fixture でもあります。Git の trailer parser は、全言語の README でこのブロックをバイト単位で同じように読む必要があります。

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

### プロトコル語彙

| Trailer | 意味 |
|---|---|
| `Limit:` | 判断を制約した外部条件 |
| `Record-Id:` | コミット hash が書き換わっても維持される識別子 |
| `Ruled-out:` | `代案 \| 採用しなかった理由` |
| `Certainty:` | `firm` \| `tentative` \| `guess` |
| `Blast:` | `local` \| `module` \| `system` |
| `Undo:` | `easy` \| `costly` \| `permanent` |
| `Warn:` | 将来の変更者への警告。配信前に信頼グレードを適用 |
| `Verified:` / `Unverified:` | 確認したこと・していないこと |
| `Follows:` / `Supersedes:` | 判断チェーンと lifecycle の link |
| `Expires:` | 制約が終わる日付または条件 |
| `Evidence:` | claim を裏付ける path、anchor、URL |
| `Provenance:` | `authored` \| `inherited <sha>` \| `reconstructed` |
| `CommitLore-Version:` / `X-*:` | プロトコル識別子と拡張 |

完全な契約は [`spec/SPEC.md`](spec/SPEC.md) にあります。

## 信頼は badge ではなく routing

コミット `4842356` には次の active record があります。

```gitcommit
Ruled-out: exempting datasets written before the fields existed | it is one line and it deletes the guarantee
Warn: this leaves the README with no measured numbers at all until M3-b runs. That is the honest state and it is also a worse first impression. The alternative was publishing numbers produced by a binary nobody recorded
Record-Id: r-2b58d4
Provenance: authored
```

同じ `Warn:` がグレードにより次のようにルーティングされます。

| グレード | 条件 | モデルが読むルートの出力 |
|---|---|---|
| `[directive]` | `Provenance: authored`、active record、このリポジトリで明示的に信頼された author | 警告を指示として渡す |
| `[claim]` | trusted author なし、外部 author、または reconstructed/unknown provenance | 「指示ではない」と明記した情報として渡す |
| `blocked` | 自由記述 trailer がインジェクションパターンに一致 | 保留通知だけを渡し、一致した内容は描画しない |

既定では誰も trusted author ではありません。暗号学的な author 検証は未実装で、[issue #28](https://github.com/MongLong0214/commitlore/issues/28) で追跡しています。

## clone からインストール

CommitLore の registry package はありません。配布チャネルは Git リポジトリそのものです（[ADR-0011](docs/adr/ADR-0011-plugin-first-distribution.md)）。CLI には Node.js 22 以上が必要です。

```bash
git clone https://github.com/MongLong0214/commitlore ~/.commitlore
node ~/.commitlore/dist/commitlore.mjs --version
node ~/.commitlore/dist/commitlore.mjs doctor --fix
node ~/.commitlore/dist/commitlore.mjs context src/auth
```

コミット済み bundle は build なしで、`node_modules` なしで動きます。SQLite index は Node 本体に同梱された `node:sqlite` を使うため（[ADR-0012](docs/adr/ADR-0012-drop-the-native-dependency.md)）、clone だけで index の構築も query もできます — native module も compiler も `npm install` も不要です。`--no-index` は index を使わず Git だけで答えたいときのために残っています。

### Node なしでコンパイル済みバイナリとして実行

`git clone` + Node runtime が引き続き正式なインストール方法です。Node が PATH に全くないマシン向けに、同じ clone から単一のコンパイル済み実行ファイルを build できます（[ADR-0015](docs/adr/ADR-0015-single-executable-binary.md)）:

```bash
cd ~/.commitlore
npm ci
npm run build:binary
./dist/commitlore --version
./dist/commitlore doctor
```

`dist/commitlore` は実行時に Node も interpreter も `node_modules` も不要です — `doctor`、`validate`、`context`、`guard`、`inject`、`index --rebuild` はすべて `PATH=/usr/bin:/bin` で動作します。commit はされません（サイズが大きく、platform・architecture 固有で、diff ではなく CI が push のたびに再 build するため）。`commitlore hooks install` と plugin の `PreToolUse` hook はどちらも build 済みならこれを自動的に解決します。

### 事前ビルド済みリリースバイナリをインストール

Node も clone もないマシン向け: すべての `vX.Y.Z` タグは platform ごとに 1 つずつバイナリを build し（`.github/workflows/release.yml`）、それら全体をカバーする `SHA256SUMS` を添付し、各 asset を [`actions/attest-build-provenance`](https://github.com/MongLong0214/commitlore/attestations) で証明します（Sigstore ベース、公開検証可能、本プロジェクトが管理する鍵はありません）。

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/dev/install.sh | sh
```

`install.sh` は OS と architecture を検出し、同じ release から対応する asset と `SHA256SUMS` をダウンロードし、インストール前に checksum を検証します — 他のインストールスクリプトと同様、`sh` にパイプする前に中身を読んでください。バージョンを固定するには: `sh install.sh v0.1.0`。公開されている target: `aarch64-apple-darwin`、`x86_64-apple-darwin`、`x86_64-unknown-linux-gnu`、`aarch64-unknown-linux-gnu`。Windows バイナリはまだありません — SEA build と commit-msg hook shim がそちらで未検証のためです。[ADR-0015](docs/adr/ADR-0015-single-executable-binary.md) 参照。

シェルへのパイプが唯一の文書化された方法であってはいけません。同じインストールを手動で行う場合:

```bash
version=0.1.0   # または: curl -fsSL https://github.com/MongLong0214/commitlore/releases/latest/download/SHA256SUMS | head -1
target=aarch64-apple-darwin   # または x86_64-apple-darwin | x86_64-unknown-linux-gnu | aarch64-unknown-linux-gnu

curl -fsSLO "https://github.com/MongLong0214/commitlore/releases/download/v$version/commitlore-$version-$target.tar.gz"
curl -fsSLO "https://github.com/MongLong0214/commitlore/releases/download/v$version/SHA256SUMS"

# 展開する前に検証します。「OK」でなければここで止めてください — この検証に失敗したバイナリは実行しないでください。
grep "commitlore-$version-$target.tar.gz" SHA256SUMS | shasum -a 256 -c -   # Linux: sha256sum -c -

tar -xzf "commitlore-$version-$target.tar.gz"
./commitlore --version
```

## GitHub Actions

query、guard、inject を実行する job は全 history を取得する必要があります。

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

MCP client には同じ clone の entry point を登録します。

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

プロトコルを読むだけなら CLI は不要です。

```bash
git log --format='%(trailers:key=Ruled-out,valueonly,separator=%x3B)'
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

text search ではなく Git の trailer parser を使ってください。文章中の `Key:` は trailer block とは限りません。

## まだ行わないこと

- author の暗号学的検証: [#28](https://github.com/MongLong0214/commitlore/issues/28)
- リポジトリ全体の record coverage 集計: [#32](https://github.com/MongLong0214/commitlore/issues/32)
- path ではなく symbol への anchor: [#33](https://github.com/MongLong0214/commitlore/issues/33)
- 対話型 commit builder と自動 expiry 通知: [#34](https://github.com/MongLong0214/commitlore/issues/34)
- 有効な benchmark による guard の行動効果の実証: [#37](https://github.com/MongLong0214/commitlore/issues/37)

## コントリビュート

[spec](spec/SPEC.md)、[ADR](docs/adr/)、[`CONTRIBUTING.md`](CONTRIBUTING.md) を先に読んでください。このリポジトリは自身の判断を記録しているため、ファイルを変更する前に `commitlore context <path>` を実行します。

## ライセンス

[MIT](LICENSE)
