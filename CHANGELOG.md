# Changelog

## Unreleased

### `parse` recognizes every record block, not only the message's own — bug-issue-89

`commitlore parse` still answered from `parseCommitMessage` alone after
bug-issue-60 taught `context`, `validate` and the index to recognize every
record block a message carries (SPEC §2.4): for a message with more than one
block, `parse` reported only the message's own last paragraph, while
`context` correctly reported all of them — the exact pre-#86 answer next to
the exact post-#86 one, for the same message. `parse --help` describes
itself as "the command" for asking this question, so it is the one place a
human or agent was still guaranteed a wrong answer.

`parse` now reports every block (`core/trailers.ts` `labelRecordBlocks`),
labeled `own` (the message's own last paragraph, SPEC §2.1 B1) or `earlier`
(a block the grammar recovered). A single-block message is unaffected —
verified byte-for-byte identical, text and `--json`, against the previously
shipped `dist/commitlore.mjs`, across every fixture in `spec/fixtures/`. The
multi-block form is additive: `--json`'s `trailers` key keeps meaning what it
always meant (the message's own block), with a new `blocks` array alongside
it only when there is more than one.

Also checked: two blocks in one message declaring the same `Record-Id`.
Neither `commitlore context --json` nor `commitlore validate` flags this
today — `core/stale.ts`'s `findIdCollisions` (the mechanism behind
`identityCollision`) only fires when a *notes*-sourced record disagrees with
a commit's own content; a group with no `notes` record in it, which is what
two same-message commit blocks are, never reaches it, and the two blocks are
silently merged instead. `parse` now detects this itself — a check local to
the one message being parsed, independent of `findIdCollisions` — and
reports it on stdout (`identityCollision: true` per block in `--json`, a
`Record-Id collision` marker in text) and stderr. Whether `context`/`validate`
should also catch the same-message case is open; SPEC and those commands are
unchanged here.

### Multi-record grammar (SPEC §2.4) — bug-issue-60

A message MAY now carry more than one record block. `squash-preserve` used to
fold every inherited record from a squashed branch into one merged record —
correct only when the branch declared at most one `Record-Id`, and silently
wrong about `Provenance:` whenever it declared more than one. It now emits one
block per inherited record (`SquashPlan.blocks`), each keeping its own
identity and its own accurate `Provenance:`. `commitlore validate`,
`commitlore context`, and the index all recognize every block a message or
note carries, not only the last paragraph — which is also the fix for a
silent GitHub squash-button defect: when the squash button pastes full commit
messages into the merge body, `git interpret-trailers` (SPEC §2.1 B1) only
ever read the last one, and the rest silently became prose. A single-record
message parses byte-identically to before.

`commitlore doctor` gained a `squash-conservation` check: it warns when a
local branch that looks like an un-preserved squash source declared a
`Record-Id` that HEAD's history cannot find. Nothing invokes `squash-preserve`
automatically — for a local `git merge --squash` this check catches the
oversight; for GitHub's server-side squash button, nothing local can, and that
remains a documented gap (ADR-0014).

`X-Inherited-From:`, the previous format's only way to carry per-source
provenance when identity was ambiguous, is no longer written — each block's
own `Provenance:` says the same thing correctly. A note published before this
change still reads back exactly as it did (`X-<Name>:` is an ordinary
preserved extension, SPEC §3.2).

See `docs/adr/ADR-0014-multi-record-grammar.md`.

### Breaking

Exit codes are now one contract across every command (SPEC §10), not a
per-command habit: `0` ran, nothing to report; `1` ran, found what the caller
asked about (a violation, a match, a block); `2` could not run (usage error,
unresolvable ref, missing dependency, missing input file, no repository); `3`
ran and answered, but could not see everything (unfetched notes, shallow
history).

`guard` was the one command that disagreed with itself: `1` meant a broken
invocation and `2` meant a match, both opposite of `validate`'s `1`/`2`, and
`--help` documented neither. **`guard`'s `1` and `2` are now swapped** — a
match is `1`, a usage error is `2` — which is a breaking change for anything
scripted against the old numbers. Everything else was consistency work, not a
new behavior: `context`/`limits`/`ruled-out`/`warnings` now use `2` instead of
`1` for "no repository" or a bad flag (`3`, for an unfetched notes mirror, is
unchanged); `parse`, `harvest`, and `index --rebuild` now use `2` instead of
`1` for a missing input file or a missing dependency, matching what
`harvest-verify`, `inject`, `hooks`, and `squash-preserve` already did.

Every command now documents its exit codes in `--help`.

## 0.1.0 — 2026-07-26

First release. Protocol v2.0.0.

### The protocol

Sixteen trailer keys, every one of them with a consumer route — a key nothing
reads does not enter the spec. `spec/SPEC.md` is canonical; an implementation
that passes `spec/fixtures/` (25 conformance fixtures) and
`spec/contract-cases/` (14 cases) is a conforming implementation in any
language.

Parsing is delegated to `git interpret-trailers`, never to line matching. Eight
boundary behaviours (B1–B8) are pinned by fixture, including the two that make
grepping wrong: prose containing a colon line yields **zero** trailers (B3), and
a trailer block with no subject line yields zero as well (B8).

### The CLI

`validate` `parse` `context` `limits` `ruled-out` `warnings` `stale` `index`
`doctor` `guard` `inject` `harvest` `harvest-verify` `squash-preserve`
`backfill` `hooks` `mcp`.

Exit codes are a contract: `0` clean, `1` the check found something, `2` usage
error. (`guard` overloads `2` for "matched" — documented, not accidental.)

- SQLite incremental index with a `--no-index` fallback that returns identical
  rows from git alone. Measured p50 **1.86ms** for a path-scoped query over a
  100k-commit repository, against a 100ms criterion; the fallback answers the
  same query in 105ms.
- Records survive rebase, amend, squash merge (`squash-preserve`) and rename
  (`--follow` by default), mirrored in `refs/notes/commitlore`.
- Trust grading: `Warn:` renders as an instruction only when provenance is
  `authored` and the committer is trusted. Everything else is a claim. Trust
  defaults to nobody.
- Secret scanning refuses to inject a record whose value looks like a live
  credential, redacted to four characters.

### For agents

`commitlore mcp` (stdio MCP server), a path-scoped and budgeted injection hook,
transcript harvesting with an evidence-checking verifier, and `guard` for
pre-tool-use blocking.

### Measured, and what is not

Every figure in the README is regenerated from `bench/results/` by
`bench/report.ts` and CI fails if one byte differs.

The re-proposal benchmark ran 60 registered runs against frozen code and came
back **without a significant difference**: `commitlore-on` 5/30, `commitlore-off`
7/30, Fisher exact two-tailed **p = 0.7480**. It is published rather than
withheld. Two documents say why it is weaker evidence than it looks:

- `bench/VERDICT-M1.md` — power to detect the observed effect at n=30/arm was
  **5.1%**, and 4 of 10 tasks were silent in both arms.
- `bench/ROUTE-GAP.md` — the matrix delivered `Ruled-out:` as injected context,
  which SPEC §5 assigns to `Limit:` and `Warn:`. The route §5 assigns to
  `Ruled-out:` is `guard`, and it was never invoked. Replaying the same runs
  through `guard` stops 3 of the 5 re-proposals before execution, at a
  false-alarm cost that has to be designed against.

CPAA is not measured: `harvest` carries no model by design, so no bench row
prices it, and `metrics.ts` reports `not-instrumented` rather than a number.
The `no-scope` ablation arm is inert because the bench injector never scoped.

### Known limits

- One model and one CLI version behind every behavioural figure.
- `guard` matches lexically, not semantically: it finds a revival that reuses
  the words, not one that paraphrases them.
- Node >= 22 (ADR-0010; Node 20 reached end of life 2026-04-30).
