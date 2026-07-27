# PRD F2 — Core CLI (parse / validate / query / index / stale)

- Milestone: M2 (08-09) · ADR: 0002, 0003

## Goal
Actually deliver the CLI that the paper only specified. 0 false positives (D2), full-history queries, mechanical rejection of format errors (D5), and constraint lifecycle (D6).

## Non-goals
coverage command (Backlog), interactive commit builder (Backlog — `commitlore commit --from-json` is included).

## User stories
- As an agent, I receive the active decision history for that path within 1 second using `commitlore context src/auth/`.
- As CI, I reject commits with malformed trailers through a nonzero `commitlore validate` exit code.

## Requirements
1. Parser: delegate to `git interpret-trailers --parse` + schema validation. No `--grep` scanning.
2. Query: `context | limits | ruled-out | warnings` — path scope, `--follow` by default, `--json` output.
3. `validate`: check enum, format, and evidence rules; output violation details (input to the bounded repair loop); commit-msg hook installation subcommand.
4. Index: incremental SQLite (scan only new commits), `--rebuild` on corruption, no-index fallback when absent.
5. `stale`: compute the active set from Supersedes/Expires.
6. `doctor`: inspect and automatically configure the notes refspec and hook installation state.

## AC
- [ ] Pass the entire F1 conformance suite + route-contract tests
- [x] Path-query p50 < 100ms in a synthetic repository with 10 myriad commits (index on) — **measured p50 1.86ms** (2026-07-26). 967 of 10 myriad commits contain records. The `--no-index` fallback returns the same result in 105ms (2284×). `COMMITLORE_PERF_LARGE=1 npx vitest run test/index-perf.test.ts`
- [ ] 0 false positives in the D2 reproduction case · successful query in the D4 rename case
- [ ] `--no-index` fallback works (same functionality, only slower)
