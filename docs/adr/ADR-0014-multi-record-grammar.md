# ADR-0014: multi-record grammar, per-record squash inheritance, and squash-conservation detection

- Status: Accepted (2026-07-28)
- Supersedes: ADR-0004's squash inheritance decision (§1), which folded every
  inherited record into one merged record. The notes mirror decision (§2) and
  path tracking decision (§3) are unaffected.

## Context

bug-issue-60, filed and self-corrected twice by its own author before landing
on the real finding:

1. First framing: `git merge --squash` destroys every trailer block, measured
   0/20 survival. True, but it measures the operation *without*
   `squash-preserve` (ADR-0004) — a correct measurement of what happens when
   nobody runs the tool ADR-0004 already built.
2. Second framing: GitHub's squash button pastes full commit messages into
   the merge body, so the trailer *text* survives, but `git
   interpret-trailers --parse` — by SPEC §2.1 B1 — recognizes only the
   message's own last paragraph. Every earlier commit's trailer block sits in
   an earlier paragraph and is silently read as prose. `commitlore validate`
   passes; N records became 1 and said nothing.
3. Third framing, the one this ADR answers: `squash-preserve` (ADR-0004) does
   exist and does run correctly when invoked — but (a) nothing invokes it,
   and (b) even when it *is* invoked, it folds every inherited record from
   the range into one merged record. Two commits declaring different
   `Record-Id`s are two decisions, not one; the old fold kept an identity
   only when the range declared exactly one, discarding it entirely
   otherwise (`Record-Id may declare only one, so the merge record declares
   none`), and named the merge record's `Provenance:` after the newest
   source commit regardless of how many records actually contributed —
   correct for at most one of them, silently wrong for the rest.

## Decision

1. **Multi-record grammar (SPEC §2.4).** A message MAY carry more than one
   record block. The message's own last paragraph keeps its existing,
   unconditional recognition (SPEC §2.1 B1–B8, unchanged). Every *other*
   paragraph is an additional record block if and only if, tested in
   isolation, it is entirely trailer-shaped (B3) and declares a `Record-Id`.
   The identity requirement is what keeps this from reopening B2 — an
   incidental `Key: value`-shaped body paragraph declaring no identity (B2's
   own worked example) stays prose. A message with at most one `Record-Id`
   anywhere has exactly one block, so a single-record message parses
   byte-identically to before this ADR: backward compatibility is a property
   of the grammar, not a shim layered on top of it.

2. **`squash-preserve` emits one block per inherited record** (`core/squash.ts`
   `SquashPlan.blocks`, replacing the single `merged` record), each carrying
   its own `Record-Id` when its sources declared one, and its own
   `Provenance: inherited <sha>` naming *that record's* newest source — never
   a different record's. `renderMessage` and `attachToNotes`
   (`core/notes.ts` `writeRecordBlocks`) write the blocks as separate,
   blank-line-delimited paragraphs. The old format's `X-Inherited-From:`
   extension — the only way the single-merged-record format had to carry
   per-source provenance when identity was ambiguous — is no longer written;
   a canonical `Provenance:` inside each record's own block says the same
   thing correctly. Reading it is unaffected: `X-<Name>:` is an ordinary
   preserved extension (SPEC §3.2), so a note published before this ADR
   still resolves exactly as it did.

3. **`commitlore doctor` gains a `squash-conservation` check** that walks
   local branches not reachable from HEAD but sharing a common ancestor with
   it — the shape a `git merge --squash` leaves its source branch in — and
   warns when a `Record-Id` that branch declared does not appear anywhere in
   HEAD's history. This is detection, not prevention: nothing local can hook
   GitHub's server-side squash button, and refusing every local squash would
   teach people to stop writing records rather than to run
   `squash-preserve`.

## Ruled-out

- **A CI step comparing a PR's commits against its post-merge squash
  commit**, as the mechanism for finding 1 instead of a `doctor` check.
  Ruled out, not abandoned — it remains worth adding separately for exactly
  the case `doctor` cannot reach: a repository whose feature branch was
  deleted by the squash before the next local clone or fetch. It is not the
  first line of defense here because (a) it needs the GitHub API to
  reconstruct a PR's original commits, a dependency this tool takes nowhere
  else; (b) it can only run *after* the squash has already happened and been
  pushed — too late to fix without a second, corrective push; and (c)
  `doctor` catches the mistake at the moment it is cheapest to fix, right
  after a local `git merge --squash`, when the source branch this check
  looks for is, in the overwhelmingly common case, still sitting in
  `refs/heads`.
- **Minting a fresh `Record-Id` for an inherited record that never declared
  one**, so every block in a multi-record message would always be
  independently recoverable regardless of order. Ruled out: nowhere else in
  this codebase does the tool invent an identity — `Record-Id` is always
  author-declared (`core/harvest.ts` validates a declared id; nothing
  generates one). Inventing one on squash would be new scope beyond what this
  issue asked for. The accepted limitation: `squash-preserve` orders
  identified blocks first and unidentified ones last, so when exactly one
  inherited record has no id it is the message's own last paragraph and
  needs no identity to be found again; if more than one has no id, only the
  last survives a later re-parse of stored text. `SquashPlan.blocks` and
  `--json` output still name all of them at the moment the plan is computed
  — the limitation is in *re-parsing already-written text* later, not in
  the plan itself. `warningsFor` (`commands/squash-preserve.ts`) says so.
- **Splitting a message into record blocks by scanning for `Record-Id:` as a
  line pattern across the whole message.** Ruled out for the same reason
  SPEC §2.1 B3 forbids identifying a trailer block by `grep '^Key:'`: the
  grammar still delegates every trailer-or-prose judgement to git, paragraph
  by paragraph (`parseRecordBlocks`'s `asIsolatedBlock`); only the choice of
  which paragraphs to test, and whether to accept the result, is new.
- **Continuing to fold every inherited record into one merged record and
  only fixing the `Provenance:` field to list every source.** Considered
  because it is the smaller change. Ruled out because it does not fix
  finding 2 at all: `Record-Id` is still single-valued (SPEC §3.2), so a
  record folded from two identities still cannot carry both — nothing would
  become referenceable that was not already.

## Consequences

- `core/index-db.ts`'s schema moves to v2: a `trailers.block` column
  distinguishes rows from different record blocks on the same
  `(commit_sha, source)`, since `seq` alone (position within one block)
  repeats across blocks. The index is derived and disposable (ADR-0003), so
  this is an ordinary rebuild-on-mismatch, not a migration.
- `core/query.ts`'s record grouping is block-aware (`groupByCommit` keys on
  `(sha, source, block)`), so `commitlore context` and every other consumer
  route show each record recovered from a multi-block commit or note
  separately, with its own resolvable id.
- `commitlore validate` checks every record block a message carries, not
  only its last paragraph; `commitlore validate --commit HEAD` on a message
  that lost N-1 of N records to the old B1-only recognition now reports
  those N-1 blocks' own violations (if any) rather than silently agreeing
  the message was fine.
- A message or note built by `squash-preserve` before this ADR — one merged
  record, `X-Inherited-From:` and all — continues to read back exactly as it
  did; nothing in this change requires touching history that already exists.
