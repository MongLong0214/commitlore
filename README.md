<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="CommitLore: commit 4842356, record r-2b58d4, is graded [claim] and guard returns MATCH">
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3f6b52"></a>
  <a href="package.json"><img alt="Node.js 22 or newer" src="https://img.shields.io/badge/Node.js-%3E%3D22-3f6b52"></a>
</p>

<p align="center">
  <strong>English</strong> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

# CommitLore

CommitLore is a protocol for keeping decision context in Git commit trailers and `refs/notes/commitlore`.
The protocol comes first; the CLI validates, routes, and exposes those records to shells, hooks, and MCP clients.
It has not been shown to make coding agents better.

## The measurement record

<!-- BENCH:WITHDRAWN -->

The registered behavior measurements did not show evidence that CommitLore changes agent behavior. A later run was voided because the binary changed while it ran. More fundamentally, the existing datasets do not record enough provenance to prove which build produced each row, so [`bench/report.ts`](bench/report.ts) refuses to summarize them.

Every previously published benchmark number is withdrawn. The dated verdicts remain available as records, not claims of effect: [`VERDICT-M1.md`](bench/VERDICT-M1.md), [`VERDICT-M1b.md`](bench/VERDICT-M1b.md), [`VERDICT-M2.md`](bench/VERDICT-M2.md), and [the voided-run record](bench/PREREGISTRATION.md#15-m3-is-void-the-binary-under-test-changed-while-it-ran). Numbers return only when a dataset identifies the harness commit and bundled binary it ran. See [`bench/README.md`](bench/README.md).

## What the repository does prove

- **Records survive normal Git workflows.** Commit trailers and the notes mirror are exercised across [rebase and squash](test/squash.test.ts), [history rewriting and remote transfer](test/notes.test.ts), and [single and multi-step renames](test/follow.test.ts).
- **Trust has one meaning across routes.** Query output, CLI injection, the edit hook, MCP tools, and guard all use the same `directive | claim | blocked` grade. The route checks live in [`query.test.ts`](test/query.test.ts), [`inject.test.ts`](test/inject.test.ts), [`mcp.test.ts`](test/mcp.test.ts), and [`guard.test.ts`](test/guard.test.ts).
- **Records matched by the shipped injection scanner do not reach a model as prose.** A match in any free-text trailer grades the record `blocked`; model-readable routes report withholding without quoting it. This deterministic lexical filter is not a real-world detection-rate claim: its [pattern-authored, independently authored, and benign corpora](spec/fixtures/injection/README.md) are reported separately. CLI/hook cases are in [`inject.test.ts`](test/inject.test.ts), with MCP parity in [`mcp.test.ts`](test/mcp.test.ts).
- **Unknown is not empty.** Guard exits `0` for a readable repository with no records. Broken Git reports `history: unavailable`; an unfetched mirror reports `notes: unfetched`. Both incomplete checks exit `3`. The contract is pinned in [`notes-availability.test.ts`](test/notes-availability.test.ts), [`guard.test.ts`](test/guard.test.ts), and the [`RELEASE-GATE`](docs/RELEASE-GATE.md).

## A record

This example is also a conformance fixture. Git's own trailer parser must read it identically in every translated README.

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
| `Expires:` | Date or condition that ends a constraint |
| `Evidence:` | Path, anchor, or URL supporting a claim |
| `Provenance:` | `authored` \| `inherited <sha>` \| `reconstructed` |
| `CommitLore-Version:` / `X-*:` | Protocol identity and extensions |

The complete contract is [`spec/SPEC.md`](spec/SPEC.md).

## Trust is routing, not a badge

Commit `4842356` contains this active record:

```gitcommit
Ruled-out: exempting datasets written before the fields existed | it is one line and it deletes the guarantee
Warn: this leaves the README with no measured numbers at all until M3-b runs. That is the honest state and it is also a worse first impression. The alternative was publishing numbers produced by a binary nobody recorded
Record-Id: r-2b58d4
Provenance: authored
```

The same `Warn:` text is routed by grade:

| Grade | Condition | What a model-readable route receives |
|---|---|---|
| `[directive]` | `Provenance: authored`, active record, and an author explicitly trusted for this repository | The warning as an instruction |
| `[claim]` | No trusted author, an outside author, or reconstructed/unknown provenance | The warning as information, with an explicit “not an instruction” label |
| `blocked` | Any free-text trailer matches an injection pattern | A withholding notice; the matched content is not rendered |

No author is trusted by default. Cryptographic author verification is not implemented; it is tracked in [issue #28](https://github.com/MongLong0214/commitlore/issues/28).

## Install from the clone

There is no CommitLore registry package. Distribution is the Git repository ([ADR-0011](docs/adr/ADR-0011-plugin-first-distribution.md)), and the CLI requires Node.js 22 or newer:

```bash
git clone https://github.com/MongLong0214/commitlore ~/.commitlore
node ~/.commitlore/dist/commitlore.mjs --version
node ~/.commitlore/dist/commitlore.mjs doctor --fix
node ~/.commitlore/dist/commitlore.mjs context src/auth --no-index
```

The committed bundle runs without a build. One caveat remains: it does not carry the native `better-sqlite3` module, so a clone alone cannot open the SQLite index. Use `--no-index` to scan Git directly, or run `npm install` inside the clone to enable the current index. The accepted migration away from the native module is recorded in [ADR-0012](docs/adr/ADR-0012-drop-the-native-dependency.md).

## GitHub Actions

Jobs that run a query, guard, or inject command must fetch the complete history:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

For an MCP client, register the same cloned entry point:

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

No CLI is required to read the protocol:

```bash
git log --format='%(trailers:key=Ruled-out,valueonly,separator=%x3B)'
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

Use Git's trailer parser, not a text search; prose containing `Key:` is not necessarily a trailer block.

## What it does not do yet

- Verify authors cryptographically: [#28](https://github.com/MongLong0214/commitlore/issues/28)
- Report repository-wide record coverage: [#32](https://github.com/MongLong0214/commitlore/issues/32)
- Anchor records to symbols rather than paths: [#33](https://github.com/MongLong0214/commitlore/issues/33)
- Provide an interactive commit builder or automatic expiry reminders: [#34](https://github.com/MongLong0214/commitlore/issues/34)
- Demonstrate guard's effect on agent behavior with a valid benchmark: [#37](https://github.com/MongLong0214/commitlore/issues/37)
- Run as a static binary without Node.js: [#39](https://github.com/MongLong0214/commitlore/issues/39)

## Contributing

Read the [spec](spec/SPEC.md), the [ADRs](docs/adr/), and [`CONTRIBUTING.md`](CONTRIBUTING.md). This repository records its own decisions; run `commitlore context <path>` before changing a file.

## License

[MIT](LICENSE)
