# ADR-0002: implementation language and runtime — TypeScript + Node 20, npm/npx distribution

> ⚠️ **The runtime floor was superseded by [ADR-0010](ADR-0010-node-floor.md).** The supported floor is **Node 22**, not Node 20 — Node 20 reached EOL on 2026-04-30, and two dependencies had already stopped honoring that floor.
> ⚠️ **The distribution channel was superseded by [ADR-0011](ADR-0011-plugin-first-distribution.md).** Distribution uses a **registry-free git clone**, not npm publish, and agent integration uses the MCP server and Claude Code plugin. The language (TypeScript strict) and single-package decisions remain valid. The npm references remaining in this document are preserved as decision history.
>
> The language (TypeScript strict), distribution channel (npm/npx), and single-package decisions **remain valid.** The "Node 20" references remaining in this document are preserved as decision history.

- Status: Accepted (2026-07-26) · Runtime clause Superseded by ADR-0010 (2026-07-26)

## Context

The CLI, MCP server, hooks, and GitHub Action must be implemented within 4 weeks. The distribution channels are npm (`npx commitlore`) and the skills.sh ecosystem. The owner's stack centers on TypeScript.

## Decision

- Language: TypeScript (strict), runtime: Node ≥ 20. Single package `commitlore` (bin: `commitlore`).
- Distribution: npm publish + `npx commitlore <cmd>`. The MCP server is a subcommand of the same package (`commitlore mcp`).
- Index storage: better-sqlite3 (allow 1 native dependency — because this is ADR-0003's derived cache, retain a no-index fallback path when it fails).
- git access: call the system `git` as a child process (`interpret-trailers`, `log --format=%(trailers)`, `notes`). No libgit2 bindings.

## Ruled-out

- Rust single binary | distribution and performance advantages are acknowledged, but it conflicts with the 4-week constraint and team stack. Can be reevaluated in the Backlog
- Bun runtime | cost of verifying compatibility with hook and CI environments. Node carries the least risk
- libgit2/isomorphic-git | git's native trailer functionality (`interpret-trailers`) is the source of correctness — delegating to system git is simplest and easiest to verify

## Consequences

- The core query path has 0 LLM or network dependencies (consistent with the 0-cost principle).
- In environments where better-sqlite3 installation fails (corporate proxies, etc.), the `--no-index` fallback must run more slowly without losing functionality (T-203 AC).
