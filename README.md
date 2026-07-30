<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="CommitLore: a coding agent must not revive a decision the repository already reversed.">
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

## A coding agent must not revive a decision the repository already reversed.

**Git-native decision authority for AI-assisted codebases.** CommitLore tracks which decisions are still in force and which have been reversed—directly in Git—so a coding agent sees only current decisions when it queries a path.

No hosted memory service. No vendor-specific chat history. Just reviewable decision context, owned by and portable with the repository.

Install once. Your coding agent can record the decisions worth carrying forward, while CommitLore validates and preserves them in Git.

**Claude Code** — one plugin registers the MCP server, the pre-edit context hook and the skills:

```
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

Prerequisites for the plugin path: Node.js 22+ and Git.

**Any other coding agent** — install the CLI:

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v0.4.1/install.sh | sh
```


## See it work

<p align="center">
  <img src="./assets/readme/commitlore-demo.svg" width="100%" alt="commitlore demo: lifecycle filtering shows only active decisions">
</p>

**A fresh agent. Zero chat history. It still knows why the obvious fix was rejected.** Query a path before changing it:

```bash
commitlore context install.sh
```

The output includes the active record that ruled out publishing a `-musl` target as the fix for the installer defect, including its reason. The hook returns context; it does not claim to block the edit.

```console
context for install.sh as of <timestamp> — 0 limits, 1 ruled-out, 1 warnings, 2 other in 1 record (no index, 1 commit record(s) scanned)

ruled-out
  r-instci99a  <commit>  [claim]  Publish a -musl release target | a release.yml/build-matrix change, not an install.sh or CI-verification fix

warnings
  r-instci99a  <commit>  [claim]  Revisit this wording if a musl target ships
```

<details>
<summary>Reproduce the exact PreToolUse hook path</summary>

```bash
printf '%s\n' '{"tool_name":"Edit","tool_input":{"file_path":"install.sh"}}' \
  | node dist/commitlore.mjs inject --hook-input --budget 5000
```

</details>

## Retrieval can find records. Path scope keeps reversed decisions out.

Missing a record costs the model context. Handing it a decision that was already reversed costs it correctness. In this [retrieval measurement](bench/retrieval/result.md), at every size from 0 to 10,000 distractors, BM25, embedding top-k, hybrid RRF, and embedding with a path filter each returned one superseded record. CommitLore path scope with lifecycle returned zero stale records and both current records (2/2).

Recall is the supporting result: retrieval finds broadly the same records either way, but only one route knows which are still current. On #166's corpus with no superseded records, embedding retrieval matched path scope at 2/2. The advantage appears when decisions have been reversed—the case this product exists for.

The separate #167 exposure run still matters: only 2 of 10,002 records reached the model.

| route | model-visible records | relevant records | model-visible tokens |
|---|---:|---:|---:|
| inject everything | 10,002 | 2/2 | 1,004,554 |
| top-k lexical | 2 | 1/2 | 190 |
| CommitLore path scope | 2 | 2/2 | 335 |

This measures exposure and recall at a fixed two-record output budget—not token cost, billed cost, accuracy, or agent behaviour. It is one corpus, one query, and one pinned embedding model.

Then run `commitlore init` in each repository where you want validation hooks and a local index. The installer detects supported coding agents and registers the local MCP server where it can do so safely.

## What happens after init

- Commit normally. Most commits carry no record.
- If a record is present, the commit-msg hook validates it; it never creates one.
- Agents query decision context through MCP or receive it from the `PreToolUse` hook.
- Before changing a path, they see its active limits, ruled-out alternatives, warnings, and verification gaps.

## Try it in a repository

```bash
cd your-repository
commitlore init
commitlore context .
```

Then keep working through your coding agent. When a change contains decision context the diff cannot preserve, ask the agent to include a CommitLore record in the commit.

<details>
<summary>Prefer to inspect or pin the installation?</summary>

The one-liner is for convenience. For a reviewed or pinned install, download and inspect `install.sh` first, clone the repository, or manually download a release asset and verify its `SHA256SUMS`. The script checksum-verifies the binary it downloads; it does not authenticate the script already piped to `sh`.

```bash
# Pin and inspect the installer before executing it.
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v0.4.1/install.sh
sh install.sh v0.4.1

# Or verify the release binary yourself before extracting it.
version=0.4.1; target=aarch64-apple-darwin
curl -fsSLO "https://github.com/MongLong0214/commitlore/releases/download/v$version/commitlore-$version-$target.tar.gz"
curl -fsSLO "https://github.com/MongLong0214/commitlore/releases/download/v$version/SHA256SUMS"
grep "commitlore-$version-$target.tar.gz" SHA256SUMS | shasum -a 256 -c - # Linux: sha256sum -c -
```

</details>

## What makes it different

- **CLAUDE.md tells the agent how to work. CommitLore tells it why this code exists.**
- **ADRs document architecture. CommitLore documents the decisions hidden inside the diff.**
- **Not another memory database. A decision protocol built into Git.**

The authority is ordinary commit trailers and `refs/notes/commitlore`. Indexes and reports are derived and rebuildable from those Git records.

## How records get created

You do not hand-write a trailer for every commit. Most commits should carry no record at all. Add one only for a decision the diff cannot recover: an external constraint, a rejected alternative, a warning, or a verification gap.

### Through a coding agent

Ask the agent to commit normally and preserve only the decision context the diff cannot explain:

> Commit this change. Add a CommitLore record only if the diff cannot recover an important constraint, rejected alternative, warning, or verification gap.

Most commits should still carry no record. The agent instructions live in `skills/commitlore-commits/`, and the commit hook validates any record the agent adds.

### Advanced: harvest

`commitlore harvest` builds a prompt contract from a session transcript and staged diff; `commitlore harvest-verify` checks a draft against them. They support drafting, not automatic commits. Interactive record building is not implemented.

### By hand

As an escape hatch, a human can write ordinary Git trailers by hand. The commit-msg hook validates records that are already present; it never invents or silently adds one.

## A minimal record

A record can be small. Include only the context that would otherwise be lost:

```text
Fix expired-token refresh

Ruled-out: Extend token TTL to 24h | security policy violation
Warn: Do not narrow the 4xx handler without verifying upstream behavior
```

Most records do not need every protocol field. Identity, lifecycle, risk, provenance, and verification fields are available when the decision needs them.

## A complete record

This example is also a conformance fixture. Git's trailer parser reads the code block identically in every translated README.

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

Read a path's history with `commitlore context <path>`, or use Git directly:

```bash
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

Use Git's trailer parser, not a text search: prose containing `Key:` is not necessarily a trailer.

## What the repository proves

- Decision history survives rebase, squash, remote transfer, and path renames in the tested Git workflows.
- Every route uses the same trust grading, so untrusted text is information rather than an instruction.
- Injection-like text in free-form trailers is withheld from model-readable routes.
- A readable repository with no records is distinct from incomplete history or an unfetched notes mirror.

These are product claims about Git-bound, human-verifiable decision history. They do not depend on a claim that CommitLore improves agent performance.

## Evidence: a narrower product claim

112 experiments were recorded, but M4 recorded no per-run guard exposure. Whether the treatment was present is unverifiable, so it does not test, support, or refute the agent-behavior claim. The narrower product claim above rests on independently testable behavior; read the [M4 verdict](bench/VERDICT-M4.md) for the clean dataset and withdrawal.

### Latency, cost, and break-even

At 100,000 commits, indexed `context` p50 is 496 ms; CommitLore's own `--no-index` fallback is 86,673 ms. That internal fallback gap grows 4.8× at 1k, 36× at 10k, and 175× at 100k ([complete deterministic run](https://github.com/MongLong0214/commitlore/blob/2fade893f25917fce1ffb497aab96b1eb271a185/bench/results/deterministic-20260729T032652Z.md)); it is a scaling shape, not a product-versus-alternative result.

The guard costs injected context plus measured hook overhead: 185.85 ms p50 for commit-msg and 102.40 ms p50 for the injection hook ([deterministic measurements](bench/results/deterministic-20260727T174801Z.md)).

A break-even figure would require a per-turn ledger of provider-reported token usage and an observed cost for work spent on an alternative the repository had already rejected.

<details>
<summary>Full benchmark record (112 experiments)</summary>

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

## Install from source

To inspect or run the source distribution:

```bash
git clone https://github.com/MongLong0214/commitlore ~/.commitlore
node ~/.commitlore/dist/commitlore.mjs init
node ~/.commitlore/dist/commitlore.mjs context src/auth
```

## Known limitations

- Windows is unsupported: [#95](https://github.com/MongLong0214/commitlore/issues/95).
- Alpine and other musl Linux hosts are unsupported: [#99](https://github.com/MongLong0214/commitlore/issues/99).
- Cryptographic author verification, repository-wide record coverage, symbol anchors, and an interactive record builder are not implemented yet: [#28](https://github.com/MongLong0214/commitlore/issues/28), [#32](https://github.com/MongLong0214/commitlore/issues/32), [#33](https://github.com/MongLong0214/commitlore/issues/33), [#34](https://github.com/MongLong0214/commitlore/issues/34).
- M4 did not test a guard effect: its rows have no `guard_exposure`, so treatment exposure is unverifiable ([#122](https://github.com/MongLong0214/commitlore/issues/122)).
- Guard (ruled-out alternative matching) is an experimental advisory: precision 44.8% (95% Wilson CI 32.7%–57.5%), recall 22.0% on the 417-decision corpus ([ADR-0020](docs/adr/ADR-0020-guard-is-an-experimental-advisory.md)). An empty guard result does not guarantee a proposal avoids all ruled-out alternatives — at 22% recall, a miss is the common case.

## Contributing

Read the [spec](spec/SPEC.md), the [ADRs](docs/adr/), and [`CONTRIBUTING.md`](CONTRIBUTING.md). CommitLore is free forever and open source under the [MIT License](LICENSE).
