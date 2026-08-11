# ADR-0030: capture runs unattended, and a record nobody read cannot direct an agent

- Status: **Accepted** (2026-08-07), approved by the owner
- Related: [ADR-0021](ADR-0021-capture-pending-transaction.md) (the pending
  format and phase vocabulary this would extend) ·
  [ADR-0028](ADR-0028-suggest-is-a-host-side-convention.md) (which left this
  decision unbuilt and named the ADR it needs) · SPEC §3 (`Provenance:`) ·
  SPEC §7 (trust) · [#415](https://github.com/MongLong0214/commitlore/issues/415)

Approved 2026-08-07. ADR-0028 said the thing it declined to build "needs its own
ADR **and its own approval**" — this is the ADR, and the approval is recorded
here because the change it authorises touches SPEC vocabulary, which binds every
implementer of the protocol and not just this codebase.

**Landing in order.** Decision 2 — the `drafted` value and the grading cap —
ships first and alone, because it is the guarantee the rest depends on: it is
additive, an implementation that does not know the value reads it as `unknown`
and also grades `claim`, and nothing about capture changes until it is in place.
Decisions 1, 3 and 5 (unattended staging, promotion by supersession, the off
switch) follow separately.

## Context

The product goal is that one install is the last thing a user does: no command,
no decision, no instruction, and the system runs in the background.

Most of that is already true. After `commitlore init` the following happen with
no user input at all — verified end to end against a `dev` build:

| what | when |
|---|---|
| a path's records injected before an agent edits it | PreToolUse hook |
| the record block validated | `commit-msg` |
| the staged record applied to the message | `prepare-commit-msg` |
| the record written to the notes mirror | `post-commit` |
| the mirror published | `pre-push` (#416) |
| the mirror collected | any `git fetch`, via the refspec `doctor --fix` writes |
| the index built, refreshed, and discarded when stale | every query (#406) |
| concurrent hooks kept on the index instead of a full scan | #420 |

**One thing still asks.** `skills/commitlore-commits/SKILL.md` step 4 shows the
verified records and stages only what the user keeps. ADR-0028 put it there
deliberately, and was explicit that it is a convention: `stage` "has no way to
ask whether a human ever saw the record," and a host that stages without asking
"violates no check here and is within contract."

So removing the prompt requires no permission from the core. The question is
what should be true instead.

## The finding that changes the shape of the problem

The obvious objection to unattended capture is that it mints instructions nobody
read. `gradeRecord` returns `directive` for a record that is `Provenance:
authored`, active, from a configured author string, and free of injection
patterns — and, in the opt-in signature mode, only after Git also verifies the
signature in the verifier's trust store. In default author-string mode, the
match is not identity proof because the commit author selected it; a commit the
user made satisfies that policy test whether or not they read the trailer block.

**That objection does not currently bite, and the reason is itself a defect.**
`CLAUDE_HOOK_COMMAND` is `commitlore inject --hook-input <marker>`, with no
`--trusted-author`, and `inject` defaults `trustedAuthors` to `[]`, on which
`gradeRecord` is fail-closed. Measured on a repository whose record was authored
by its own committer: **0 lines `[directive]`, 6 lines `[claim]`.** No installed
surface can produce a directive (#415).

Two things follow.

1. Removing the prompt **today** would produce `claim` records only. There is no
   security regression available in the shipped configuration.
2. That safety is **accidental**. At this ADR's adoption #415 still had to
   decide whether configured author strings would make directives reachable;
   once it did, unattended capture could mint directives and the fix would
   otherwise be retrofitted onto records already in history. The current
   signature opt-in adds a further condition without changing that finding.

Building the guarantee while it costs nothing is the whole argument for doing it
now rather than after.

## Requirement

**A record no person has read must not be able to direct an agent.** It may be
recorded, served, indexed, mirrored and searched. It may not be rendered as an
instruction.

The signal has to survive into the commit, because grading reads a commit's
trailers and not the pending file. So it is a property of the record, not of the
transaction that produced it.

## Options

### 1. Remove the prompt, change nothing else

Correct today, for the wrong reason (see above). Rejected: it makes the product's
safety depend on the absence of a feature it intends to add.

### 2. An `approved` phase in the pending transaction

The shape ADR-0028 sketched. It fails on inspection: a phase gate decides
whether the record is *applied at all*, and unattended capture wants the record
applied. Used as a gate it deletes the feature; used as a flag it never reaches
the commit, where grading reads.

`approved` may still be worth having for a host that wants a blocking review.
It does not answer this requirement.

### 3. An `X-` extension trailer, e.g. `X-Reviewed: no`

Rejected by the protocol's own rule. SPEC §3 defines `X-<Name>:` as an
organization extension "never interpreted by the core." A grading rule that read
one would make the core interpret it, and would license every other reader to
invent grading keys.

### 4. A new `Provenance:` value — **recommended**

`Provenance:` is already the axis grading consults for exactly this kind of
question, and already has a value that means "real, but not directly authored":
`reconstructed`, which `backfill` writes and which grades `claim` with the reason
*"rebuilt from history, never directly authored."*

Add `drafted`: **produced by the capture pipeline from a transcript and staged
without a person reading it.** Grading treats it as `reconstructed` is treated —
never above `claim` — and says so in the reason.

This costs a SPEC §3 vocabulary addition and a conformance fixture. It costs no
change to ADR-0021's phase list, no `version` bump, and no policy identity hash
change, because nothing about the transaction changes: only the value the
pipeline writes into a trailer it already writes.

### 5. Endorsement through the notes mirror

Considered because a note can be attached to an existing commit without
rewriting history, and because #409 made a notes-sourced record graded by the
identity that wrote the note — so a human's endorsement would carry that human's
trust.

**It does not work for promoting the same record**, and the reason is worth
recording. #409 also established that a record arriving from several sources is
graded on each and keeps the **floor**. A `drafted` record in the commit plus an
endorsement note under the same `Record-Id` grades `claim` — the floor — no
matter who wrote the note. The mechanism that closed the forgery closes this too.

## Decision (proposed)

1. **Unattended by default.** The skill's step 4 is removed. Capture prepares,
   verifies and stages without asking, and the record reaches the commit through
   the hooks that already exist.

2. **`Provenance: drafted`** is written by the capture pipeline for any record
   staged without a recorded human review. SPEC §3 gains the value; `grade.ts`
   caps it at `claim`; a conformance fixture pins both sides.

3. **Promotion is a new record, not an edit.** A commit message is immutable
   without rewriting history, so a `drafted` record is never upgraded in place.
   A person who reads one and stands behind it writes a record that
   `Supersedes:` it, with `Provenance: authored`. The vocabulary already
   supports this and the lifecycle fold already retires the superseded one.

4. **Promotion is optional and rare.** A repository where nobody ever promotes
   anything is a repository where every record is a `claim`, which is what every
   installed CommitLore serves today (#415). Nothing degrades. The user doing
   nothing is the supported path, not a fallback.

5. **An off switch.** A repository that does not want unattended capture sets
   it off, and the setting lives with the capture policy ADR-0021 §7 already
   hashes, so a change between stage and commit is already detected.

## Costs, stated

- **A SPEC vocabulary addition** binds other implementers. It is additive — a
  reader that does not know `drafted` falls to `unknown`, which also grades
  `claim`, so an old reader is safe rather than wrong. That property is why this
  option is recommended over a new key.
- **Noise.** With no person in the loop the pipeline decides what is worth
  recording, and the skill's own guidance is that most commits carry nothing and
  `{"records": []}` is the common correct answer. A record costs a future reader
  attention; unattended capture spends that budget without asking. This is the
  real cost of the decision and it is not mitigated by anything above.
- **Removal is expensive.** Trailers live in commit messages. A bad record is
  retired with `Supersedes:`, never deleted.

## What this does not decide

- **Whether configured author strings should make `directive` reachable at
  all** — that was #415. This ADR was written so that answering it either way
  was safe; the default remains an unauthenticated string policy, with Git
  signature verification now available as an opt-in boundary.
- **Whether the injection legend should stop advertising `[directive]` and
  `[blocked]`** when neither can occur. That changes injected bytes, which
  changes `cacheKey` and breaks the byte-identity `test/inject.test.ts` pins —
  deliberately deferred until M5 lands, so a measurement mid-flight does not
  acquire a second uncontrolled difference.
- **When any of this ships.** Not before M5's verdict and the release that
  follows it.
