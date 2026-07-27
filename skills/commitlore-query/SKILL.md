---
name: commitlore-query
description: Use when about to read, edit, or reason about a file and it would help to know its recorded decision history — active constraints, alternatives already ruled out, warnings left by a previous author, or which records have gone stale. Reads CommitLore records for a path or the whole repo without re-deriving them from raw git log. Trigger phrases include "what does commitlore know about this file", "why was X ruled out here", "any warnings on this path", "check for stale records", "has this approach been tried before", "이 파일에 대한 commitlore 기록 보여줘", "여기서 뭐가 기각됐는지 확인해줘".
---

# CommitLore query

Four commands read the same underlying record set for one or more paths;
`stale` reads it repo-wide. All of them read-only — none of them touch git
state.

## Reading records for a path

```
commitlore context src/core/types.ts
```
```
context for src/core/types.ts as of 2026-07-26T07:28:42.051Z — 2 limits, 5 ruled-out, 3 warnings, 16 other in 2 records (index, 2 commit record(s) scanned)

limits
  r-c0f4e2  3d249cd3  npm gitlore is held by an active same-domain CLI, so the owner's first-choice name was not available
  r-b2e7f1  00d348d1  Parsing must delegate to git interpret-trailers -- reimplementing the block rules would drift from the rest of the git ecosystem

ruled-out
  r-c0f4e2  3d249cd3  GitLore published as git-lore | the binary and search results still collide with the existing gitlore tool
  r-b2e7f1  00d348d1  line-matching Key: prefixes | prose containing a colon line parses as a record and feeds agents false context (verified B3)
  ...

warnings
  r-c0f4e2  3d249cd3  [directive]  ADR-0008 and ADR-0009 keep the literal string Annals on purpose -- mechanical substitution there destroys the decision trail
  ...

other
  r-c0f4e2  3d249cd3  Blast: system
  ...
```

`context` is every active record touching the path, grouped by section, each
line prefixed with its `Record-Id` and short commit sha. `limits`,
`ruled-out`, and `warnings` return the same underlying records filtered to
one key each — reach for those when only one kind of information matters:

```
commitlore limits src/core/types.ts
```
```
2 limits for src/core/types.ts as of 2026-07-26T07:28:42.946Z (index, 2 commit record(s) scanned)

  r-c0f4e2  3d249cd3  npm gitlore is held by an active same-domain CLI, so the owner's first-choice name was not available
  r-b2e7f1  00d348d1  Parsing must delegate to git interpret-trailers -- reimplementing the block rules would drift from the rest of the git ecosystem
```

All four take zero or more paths (`commitlore context a.ts b.ts` answers for
both). One path follows its rename lineage; with multiple paths Git cannot
follow renames, so query each path separately when historical names matter.
They share these flags:

- `--json` — the full structured answer instead of the printed summary: each
  record's `recordId`, `sha`, `committedAt`, `lifecycle`, `trust` grade
  (`directive` when the author is trusted and the record is `authored`, a
  claim otherwise — see SPEC §7), every path the commit touched, and its full
  `trailers` array.
- `--all-history` — include superseded and expired records too, each labelled
  as such. Without it, only records currently `active` are returned.
- `--no-index` — answer from `git` directly instead of the local
  `.git/commitlore/index.db` cache (see `commitlore-setup`). Slower, but
  correct even if the index is stale or missing.
- `--at <ISO 8601 instant>` — evaluate as of a past instant instead of now,
  for asking "what was known at commit X".
- `--limit <n>` — cap the number of records returned.

## Records that have gone stale

```
commitlore stale
```
```
stale at 2026-07-26T07:28:43.176Z — 0 superseded, 0 expired, 0 for review, of 20 record(s) in 30 commit(s)
```

Repo-wide, no path argument: lists records that are `superseded` (by a later
`Supersedes:`), `expired` (past their `Expires:` date, or matching a
free-text `Expires:` condition flagged for review), or a `Certainty: guess`
record surfaced for re-examination. Scans the most recent 1000 commits by
default; `--all-history` scans everything. Takes `--json` and `--at` the same
as the commands above.

## Why not `git log --grep`

`git log --grep 'Warn:'` looks tempting — it's already installed, no new tool
needed. It also produces false positives that CommitLore's real parser does
not, because git trailer parsing is not line-matching.

Per SPEC §2.1 (verified against `git interpret-trailers --parse`): a trailer
block only exists if it is the message's **last** paragraph, and **every**
line in that paragraph is a `Key: value` line or a continuation of one. A
paragraph that mixes a colon-shaped line with a line of ordinary prose is
prose from end to end — none of it is a trailer, including the line that
looks like one. `grep` cannot see that distinction; it matches the substring
wherever it sits.

Concretely, this message has a colon-prefixed line but is not a CommitLore
record — the paragraph's second line is plain prose, so the whole paragraph
fails the trailer-block test:

```
Simplify retry loop timing

Refactored the shared retry helper for clarity and consolidated the
backoff calculation into one place.

Note: this touches the shared client wrapper, so double check
downstream callers before merging the release.
```

`git log --grep 'Note:'` (or any grep for `^[A-Za-z-]*:`) matches that
`Note:` line and would report this commit as carrying a record. Running the
actual message through `commitlore parse` returns zero trailers:

```
commitlore parse --message-file message.txt --json
```
```
{
  "trailers": []
}
```

`context`/`limits`/`ruled-out`/`warnings`/`stale` all read through the same
grammar `parse` and `validate` use — delegated to `git interpret-trailers`,
never a line-by-line grep — so they never surface a body sentence as if it
were a recorded constraint.
