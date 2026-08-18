# PRD F4 — Agent Fabric (MCP · injection · harvest+verifier · guard · skills)

- Milestone: M3 (08-16) · ADR: 0006

## Goal
Turn pull into push (D8) + make capture free (D5 · reverse Grudin). This feature is the heart of the product.

## Non-goals
GCC-style session-memory integration (Backlog), embedding search (Backlog).

## User stories
- As a Claude Code user, when I open a file, a summary of active constraints for that path automatically arrives in context — I do not need to remember anything.
- At commit time, the agent drafts decision context, the verifier discards unsupported records, and I only approve.
- If I propose a rejected approach again, `commitlore guard` shows "rejected in abc1234 due to 'race condition'" before execution.

## Requirements
1. `commitlore mcp`: resource `commitlore://context/<path>` + query tool set (stdio).
2. Injection hook: Claude Code PreToolUse(Read|Edit|Write|MultiEdit|NotebookEdit) → inject a path-scoped deterministic projection. Budget cap (equivalent to 800 tokens by default) + grade routing (ADR-0005) + exclude stale records.
3. Automatic harvest: Stop/pre-commit hook → generate draft trailers from the transcript (use the user's existing agent session, no separate API cost).
4. Harvest verifier: each trailer requires a transcript/diff evidence citation; discard it if citation verification fails. After ≤ 2 bounded repairs, commit without a record + log.
5. `commitlore guard`: warn on a deterministic match between proposal text ↔ path Ruled-out records (keyword+Record-Id).
6. Clean-room rewrite of 3 skills (commits/query/setup) — all internals call the CLI, with no marketing language (D10).

## AC
- [ ] After hook installation, verify injection occurs, respects the budget, and excludes stale records in a file-editing scenario
- [ ] Test that unsupported fabricated records are mechanically discarded in the harvest→verification pipeline
- [ ] guard emits a warning in a rejected-history re-proposal scenario (same fixture as the CommitLoreBench re-proposal-rate metric)
- [ ] 3 skills install and work under the skills directory specification
