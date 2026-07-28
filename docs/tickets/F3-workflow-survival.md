# F3 tickets — Workflow survival (M2)

> PRD: `docs/prd/PRD-F3-workflow-survival.md` · ADR: 0004
> Modules: `src/core/notes.ts`, `src/core/squash.ts` (+ doctor extension)

---

## T-301 notes mirror module + doctor refspec (M) — #9 · depends on T-201

**Implementation outline**
- `notes.ts`: `writeRecord(sha, trailers)` / `readRecord(sha)` — `git notes --ref=commitlore add|show`; reuse the T-201 canonical format for record serialization.
- Merge the notes source into the query engine (T-204) (dedupe against commit trailers by Record-Id or content hash).
- `commitlore doctor`: ①inspect and automatically add notes fetch refspec (`+refs/notes/commitlore:refs/notes/commitlore`) ②push guidance ③hook installation state ④index health.

**Test**: round trip between clone A/B through a temporary remote (bare repo) — record in A→push→B doctor→fetch→successful query.
**AC**: PRD-F3 AC 3.

---

## T-302 commitlore squash-preserve (L) — #10 · depends on T-301

**Implementation outline**
- `commitlore squash-preserve <base>..<head> [--target <merge-sha>|--message-file <f>]`
  1. Collect records from commits in the range (T-201) → dedupe by Record-Id/content hash → on conflict (same Id, opposing values), newest wins + warning
  2. `--message-file`: rewrite a proper trailer block into the draft merge commit message (supports both local squash and GitHub merge-message editing)
  3. `--target`: attach records to notes on the merge commit SHA (mark each with `Provenance: inherited <original-sha>`)
- Extract core logic into a function so Action (T-602) can reuse it.

**Test**: turn the D3 reproduction script directly into a test — `commitlore limits -- <path>` succeeds after squash / survives through notes after `rebase -i` rewrite / dedupe and conflict cases.
**AC**: PRD-F3 AC 1·2.

---

## T-303 --follow accuracy regression (S) — #11 · depends on T-204

**Implementation outline**: fixture repository with a rename chain (a.ts→b.ts→c/d.ts, 2 stages), fixed query regression test.
**AC**: records are reached through both the D4 single rename + 2-stage rename. Explicit warning on paths where `--follow` is unsupported (multiple path arguments).
