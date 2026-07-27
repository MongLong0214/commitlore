# F2 tickets — Core CLI (M2)

> PRD: `docs/prd/PRD-F2-core-cli.md` · ADR: 0002, 0003
> Package structure (canonical):
> ```
> src/cli.ts            # commander entry point (bin: commitlore)
> src/core/git.ts       # git subprocess wrapper (interpret-trailers/log/notes)
> src/core/trailers.ts  # parse/serialize round trip
> src/core/schema.ts    # ajv loader (uses spec/schema)
> src/core/index-db.ts  # better-sqlite3 + fallback
> src/core/query.ts     # shared engine for 4 query types
> src/core/stale.ts     # active-set fold
> src/core/doctor.ts
> test/                 # vitest; loads spec/fixtures and contract-cases
> ```

---

## T-201 Parser module (M) — #4 · depends on T-102

**Implementation outline**
- `trailers.ts`: `parseCommitMessage(msg): Trailer[]` — internally call `git interpret-trailers --parse --no-divider` (input on stdin), apply schema validation to output. `serializeTrailers(trailers): string` (canonical order: vocabulary-table order).
- `git.ts`: `execGit(args, {stdin})` wrapper — structured error on failure (code and stderr).
- Forbidden: `--grep`-based classification, custom regular-expression trailer parsing (delegate folding and boundaries to git).

**Test**: all 20 F1 fixtures + round-trip identity.
**AC**: pass all fixtures. 0 `--grep` occurrences in code (checked by a grep test).

---

## T-202 commitlore validate + commit-msg hook (M) — #5 · depends on T-201

**Implementation outline**
- `commitlore validate [--message-file <f> | --commit <sha> | --range a..b]` — output violations as `{line, rule, got, want}` JSON (input format for the bounded repair loop), exit 1.
- `commitlore hooks install|uninstall` — create a `.git/hooks/commit-msg` shell stub (preserve existing hooks by chaining), idempotent.

**Test**: block all invalid fixtures / pass valid fixtures / hook installation→commit scenario (temporary repository) / repeated installation is idempotent.
**AC**: PRD-F2 requirement 3.

---

## T-203 Incremental SQLite index + fallback (L) — #6 · depends on T-201

**Implementation outline**
- Schema: `trailers(id, commit_sha, key, value, path, committed_at, provenance, source)` + `meta(last_indexed_sha)` + FTS5(value).
- Incremental: batch-parse only new commits from `git rev-list <last>..HEAD` with `--format=%H%x00%(trailers)`. Join paths from `--name-only`.
- Accept notes records (`refs/notes/commitlore`) in the same table with source='notes' (define only the T-301 integration-point interface in advance).
- `commitlore index [--rebuild]` / automatically update on query / `--no-index` fallback (scan rev-list directly, same results).
- Storage location `.git/commitlore/index.db` (do not commit — ADR-0003).

**Test**: synthetic-repository generator script (10 ten-thousand commits, 1% with trailers) + benchmark (p50<100ms) / rebuild identity (dump diff 0 before and after) / fallback-result identity.
**AC**: PRD-F2 requirement 4 + AC 2·4.

---

## T-204 4 query commands (M) — #7 · depends on T-203

**Implementation outline**
- `commitlore context|limits|ruled-out|warnings [-- <path>] [--json] [--all-history]`
- Shared engine `query.ts`: path scope (`--follow` by default; latest N across the repository when no path is given), stale filter (T-205), include grade field (reserve T-501 interface).
- `context` combines all 4 types + an active-summary header.

**Test**: 0 false positives in the D2 reproduction case (trailer-like prose) / query succeeds after D4 rename / `--json` schema snapshot.
**AC**: PRD-F2 AC 3.

---

## T-205 stale engine v0 (M) — #8 · depends on T-201

**Implementation outline**
- `stale.ts`: record stream (chronological) → fold: latest state by Record-Id, apply Supersedes, evaluate Expires (date), keep prose conditions active + `review` flag.
- `commitlore stale [--json]`: list retired, expired, and review-target records.

**Test**: load and execute `spec/contract-cases/stale-*.yaml` directly (cases 1~4).
**AC**: pass all contract cases.
