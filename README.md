# CommitLore

**English** | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

> **Git commit trailers as institutional memory for AI coding agents.**
> Free forever. No server, no database, no paid plan — **git is the single source of truth.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-v0.1.0_released-brightgreen.svg)](https://github.com/MongLong0214/commitlore/milestones)
[![Protocol](https://img.shields.io/badge/protocol-CommitLore_v2-8A2BE2.svg)](docs/adr/ADR-0001-scope-v010.md)

> ⚠️ **Status**: the protocol is usable **today** with plain git (see [Use it today](#use-it-today-plain-git)).
>
> **v0.1.0 is released.** The CLI, MCP server, hooks and GitHub Actions are implemented and green on `main`. Distribution is a git clone — no registry, no account, no publish step ([ADR-0011](docs/adr/ADR-0011-plugin-first-distribution.md)).
>
> A clone runs without installing or building: `dist/commitlore.mjs` is a bundle, so `validate`, `context`, `guard` and the MCP server work from a bare checkout. **The SQLite index is the exception** — it needs `better-sqlite3`, which the bundle does not carry, so a clone-only install answers by scanning history (`--no-index`) until you run `npm install`. [ADR-0012](docs/adr/ADR-0012-drop-the-native-dependency.md) removes that exception.
>
> Every claim in this README is either reproducible now or explicitly marked as planned, and numbers will only ever come from [CommitLoreBench](docs/prd/PRD-F7-commitlorebench.md) logs. This repository runs its own protocol against its own history in CI — see [dogfooding is enforced](CONTRIBUTING.md#dogfooding-is-enforced-not-aspirational).

---

## The problem: your agent is a senior engineer who dies every session

AI coding agents now write a large share of commits. While working, an agent holds the full decision context — the constraints it discovered, the alternatives it tried and rejected, the things it deliberately didn't test. Then the session ends, the context window dies, and **only the diff survives**.

The next session (or the next agent, or the next teammate) re-derives everything — and routinely **re-proposes the exact approach that was rejected three weeks ago**, because nothing recorded that it was rejected, or why.

For forty years this was called the *design rationale capture problem*, and it stayed unsolved for one reason: humans wouldn't pay the cost of writing the rationale down. **Agents change the economics.** The rationale is already sitting in the agent's context at commit time. Serializing it costs a few hundred tokens. CommitLore is the protocol for where to put it.

## The idea in three lines

1. **Capture is free** — the agent already knows why; it writes structured *git trailers* into the commit it was making anyway. A verifier rejects any trailer that can't cite its evidence.
2. **Consumption is push, not pull** — when an agent touches a file, the active constraints and past rejections for *that path* are injected automatically. Nobody has to remember to ask.
3. **Git is the single source of truth** — records live in commit messages and `refs/notes/commitlore`. Everything else (index, dashboards) is a derived, throwaway cache. A clone carries every record written into a commit message; **it does not carry the notes mirror**, because `git fetch` does not fetch notes by default — `commitlore doctor --fix` adds the refspec, and until it is added a query says so rather than reporting an empty answer.

## What it looks like

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

This is a normal git commit. No tool is required to write it, and git itself can parse it — trailers are a native git feature (`Signed-off-by`, Gerrit's `Change-Id`, and Conventional Commits footers are the same mechanism).

### Protocol v2 vocabulary

| Trailer | Purpose | Consumed by |
|---|---|---|
| `Limit:` | External limit that shaped the decision | injection, `commitlore limits` |
| `Record-Id:` | Stable identity — anchor for supersession | lifecycle fold |
| `Ruled-out:` | `alternative \| reason` — what was tried and dropped | **`commitlore guard`** (re-proposal review, advisory) |
| `Certainty:` | `firm` \| `tentative` \| `guess` | review routing |
| `Blast:` | `local` \| `module` \| `system` | approval gate routing |
| `Undo:` | `easy` \| `costly` \| `permanent` | approval gate routing |
| `Warn:` | Warning for future modifiers | injection (trust-graded) |
| `Verified:` / `Unverified:` | What was / wasn't verified | coverage queries |
| `Follows:` | Linked commits forming a decision chain | context assembly |
| `Supersedes:` | Retires an earlier Record-Id | **stale engine** |
| `Expires:` | Date or condition that ends a constraint | stale engine |
| `Evidence:` | Link from claim to proof (`path#anchor`) | harvest verifier |
| `Provenance:` | `authored` \| `inherited <sha>` \| `reconstructed` | **trust grading** |
| `CommitLore-Version:` / `X-*` | Identity, versioning, extensions | tooling |

Design rule (["no dead fields"](docs/adr/ADR-0006-push-injection.md)): every trailer has at least one consumer route — a query, a gate, or an injection rule. Vocabulary that nothing reads gets deleted from the spec.

## Quickstart

No registry, no package manager, no account. Get the code:

```bash
git clone https://github.com/MongLong0214/commitlore ~/.commitlore
```

Then pick the row for your agent. Every row ends in the same place: the agent
sees the decisions before it edits.

| Your agent | Setup |
|---|---|
| **Any MCP client** — Codex, Gemini CLI, Cursor, Cline, Windsurf, Zed, Qwen Coder, Kimi… | add the server config below |
| **Claude Code** | `/plugin marketplace add MongLong0214/commitlore` then `/plugin install commitlore` |
| **Any agent that runs shell commands** | copy [`AGENTS.md`](AGENTS.md) into your repo |
| **No agent at all** | plain `git log` — see [below](#use-it-today-plain-git) |

**MCP server config** — the same three tools (`commitlore_query`,
`commitlore_stale`, `commitlore_guard`) in any client that speaks MCP:

```json
{
  "mcpServers": {
    "commitlore": {
      "command": "node",
      "args": ["~/.commitlore/dist/commitlore.mjs", "mcp"]
    }
  }
}
```

**You write records as ordinary commit trailers** — the example above. Nothing
else to learn.

From a shell, with `~/.commitlore/dist/commitlore.mjs` aliased to `commitlore`:

```bash
commitlore context src/auth/                       # what this path decided
commitlore guard --proposal "switch to RabbitMQ"   # already rejected? exits 2, with the reason
```

**Honest expectation.** Records survive rebase, squash and rename, and queries
stay fast on large histories (p50 1.86ms over 100k commits). What is *not*
demonstrated is how much this changes an agent's behaviour. The previously
published benchmark result is withdrawn [below](#measured-results) because its
runs did not record provenance.

### Not a JavaScript shop?

Nothing here is distributed through a language package manager. There is no
registry account between you and this tool, and there is no version of it that
only JavaScript developers can install.

**The protocol needs no runtime at all.** A record is a git trailer, so any
language reads one with git itself:

```bash
git log --format='%(trailers:key=Ruled-out,valueonly,separator=%x3B)'
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

That covers reading and writing, in any stack, with zero install.

**The CLI needs Node**, and that is the one honest limit: the index, `guard`,
trust grading and the MCP server are TypeScript.
[ADR-0002](docs/adr/ADR-0002-language-runtime.md) chose that on a four-week
schedule and ruled out a single static binary for that reason alone — it is
tracked for re-evaluation in
[#39](https://github.com/MongLong0214/commitlore/issues/39). A clone gives you a
working CLI without a package manager, but it does not remove the runtime.

**Another language can implement the whole thing.** `spec/fixtures/` and
`spec/contract-cases/` are a conformance suite, not documentation: an
implementation in any language that passes them is a conforming implementation
([SPEC §9](spec/SPEC.md)). A Python or Go port is an anticipated path, not a
workaround.

## Use it today (plain git)

The protocol needs zero tooling. Write trailers in your commits (or let your agent's instructions do it), then query with git itself:

```bash
# extract constraint values, machine-readable — git's native trailer parser
git log --format='%h %(trailers:key=Limit,valueonly,separator=%x3B)'

# full parsed trailer block of a commit
git log -1 --format=%B <sha> | git interpret-trailers --parse

# limits that touched a path (rename-aware)
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

> Note: use `%(trailers:...)`, not `--grep`. Text-grepping matches prose false-positives and breaks on multiline folding — we [reproduced this failure mode](docs/tickets/F2-core-cli.md) and the CLI exists partly to make it impossible.

## What v0.1.0 ships (2026-08-23)

| Layer | Deliverable | Milestone |
|---|---|---|
| **L0 Protocol** | `SPEC.md`, JSON Schema, conformance fixtures, route contract tests | [M1](https://github.com/MongLong0214/commitlore/milestone/1) |
| **L1 Core CLI** | `commitlore validate / context / limits / ruled-out / warnings / stale / index / doctor` — SQLite incremental index, `--no-index` fallback, 100k-commit p50 < 100ms target | [M2](https://github.com/MongLong0214/commitlore/milestone/2) |
| **L1 Survival** | `commitlore squash-preserve` (squash-merge inheritance), `refs/notes/commitlore` mirror (rebase survival), `--follow` by default | [M2](https://github.com/MongLong0214/commitlore/milestone/2) |
| **L2 Agent Fabric** | `commitlore mcp` (MCP server), auto-injection hook (path-scoped, budgeted, deterministic), transcript harvesting + **evidence-checking verifier**, `commitlore guard`, clean-room skills | [M3](https://github.com/MongLong0214/commitlore/milestone/3) |
| **L3 Trust** | provenance × lifecycle grading, **Warn demotion** (unverified directives render as *claims*, never instructions), injection heuristics, secret guard | [M3](https://github.com/MongLong0214/commitlore/milestone/3) |
| **L4 Org** | GitHub Actions: PR lint + active-constraints comment, squash-inheritance automation — runs on *your* CI, zero external calls | [M4](https://github.com/MongLong0214/commitlore/milestone/4) |
| **L5 CommitLoreBench** | re-proposal rate (CommitLore on/off), noise ablations, cost-per-accepted-record — all README numbers regenerate from logs | [M1](https://github.com/MongLong0214/commitlore/milestone/1) / [M4](https://github.com/MongLong0214/commitlore/milestone/4) |

Full plan: [ADRs](docs/adr/) · [PRDs](docs/prd/) · [ticket specs](docs/tickets/TICKETS.md) · [issues](https://github.com/MongLong0214/commitlore/issues)

## Measured results

<!-- BENCH:WITHDRAWN -->

These benchmark numbers are withdrawn. The runs that produced them did not record the commit or the `dist/` digest they executed, so no dataset currently in the repository can prove which binary produced its rows. M3 was voided outright for that reason (§15) and is being re-run as M3-b. The verdict documents remain as dated records of what was concluded at the time: [`VERDICT-M1.md`](bench/VERDICT-M1.md), [`VERDICT-M1b.md`](bench/VERDICT-M1b.md), [`VERDICT-M2.md`](bench/VERDICT-M2.md), [`ROUTE-GAP.md`](bench/ROUTE-GAP.md), [`GUARD-CANNOT-BLOCK.md`](bench/GUARD-CANNOT-BLOCK.md), and [`DETECTOR-DEFECT.md`](bench/DETECTOR-DEFECT.md). Numbers return when a provenanced dataset exists, and not before.

## Why not just…

| Alternative | Why it isn't enough |
|---|---|
| **ADRs / wikis / Notion** | Separate files drift from code and rot. Trailers live in the same commit object as the diff — desync is structurally impossible, and `git clone` carries them. |
| **RAG over Slack/docs** | Read-time search over low-signal artifacts. CommitLore *generates* high-signal knowledge at write time, bound to the exact code it explains. |
| **Agent memory frameworks** (vector stores) | Uncurated episodic memory measurably *hurts* SE agents (noise). CommitLore records are typed, evidence-verified, path-scoped, and lifecycle-managed — each a direct answer to a published failure mode. |
| **Static context files** (CLAUDE.md / AGENTS.md) | Global dumps, mixed empirical results. CommitLore injects *per-path*, *graded*, *active-only* context under a token budget. |
| **A knowledge-base SaaS** | Your decision history shouldn't live in someone else's database. Here there is no server to die and no subscription to cancel — the repo *is* the database. |

## Security model (honest version)

Commit messages become an instruction channel for agents — which makes them an injection surface. CommitLore v0.1 ships the minimum honest defense: **unverified `Warn:` trailers are demoted to "claims"** in every injection and query output (external contributions always demote), injection-pattern heuristics quarantine hostile records, and a secret guard blocks credentials from being permanently inscribed. Cryptographic signing (sigstore) is [planned](https://github.com/MongLong0214/commitlore/issues/28), and the grading model is designed so signatures slot in without breaking consumers.

## Design principles

- **Zero user cost, forever.** MIT, no paid tier, no telemetry, no server. LLM-dependent features (harvesting, backfill) run inside the agent session you already pay for, opt-in only. The core path — parse, query, inject, guard — is deterministic and LLM-free.
- **No record without evidence.** The harvest verifier discards any trailer that can't cite the transcript or diff. A missing record is better than a false one.
- **Workflows are not negotiable.** Squash-merge, rebase, renames — knowledge must survive your workflow; your workflow must not adapt to the tool.
- **Numbers or silence.** This README will only ever cite measurements reproducible from `bench/results/`.

## FAQ

**Is it really free?** Yes — MIT, everything, forever. No cloud version exists or is planned. Sustainability comes from standard adoption, not sales ([ADR](docs/adr/ADR-0001-scope-v010.md)).

**Which agents does it work with?** Anything that can run shell commands reads the protocol today. v0.1.0 integration targets: Claude Code (hooks + skills) and any MCP-capable agent via `commitlore mcp`. The commit format works with every agent that writes commits, including none (humans welcome).

**We squash-merge everything. Doesn't that destroy the trailers?** By default, yes — we reproduced it. That's why `commitlore squash-preserve` + the notes mirror + the GitHub Action exist ([ADR-0004](docs/adr/ADR-0004-workflow-survival.md)).

**What about huge repos?** The index is an incremental SQLite cache under `.git/commitlore/`, rebuildable with one command, never committed. Target: p50 < 100ms path queries on 100k commits — measured in CI, not promised.

**Can it coexist with Conventional Commits?** Yes. CommitLore trailers are git footers, the same mechanism Conventional Commits uses for `BREAKING CHANGE`. Keep your `feat:` / `fix:` subject line and add CommitLore trailers below the body — commitlint and semantic-release keep working unchanged.

## Contributing

The spec (F1) lands first — the conformance suite is the contract, so alternative implementations are welcome and testable. Start with [good first issues](https://github.com/MongLong0214/commitlore/issues), read the [ADRs](docs/adr/) for the "why", and note the repo's own history dogfoods the protocol: `git log --format='%h %(trailers:key=Ruled-out,valueonly)'` works here.

## License

[MIT](LICENSE)
