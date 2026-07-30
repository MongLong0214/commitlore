# Gate A acceptance matrix

This file did not exist before this commit. `ADR-0020`, `ADR-0021`, `ADR-0022`
and `PRD-F9-unified-capture.md` all cite specific rows of a "CTO acceptance
matrix" (`P0-2`, `P0-3`, `P0-4`, `P1-5`, and others) as an authority those
documents depend on or are accepted against. No such file was ever committed.
An authority reference that points at nothing is exactly the failure
`A-001`'s own acceptance criterion warns against: *"authority 문서 없이
implementation 시작 불가."*

Every row below is reconstructed from where its label was actually cited —
grep the row number across `docs/adr/`, `docs/prd/`, `docs/tickets/` to verify
each one yourself rather than trusting this table. Two rows (`P0-1`, marked
below) had no prior citation to reconstruct from; their content is written
fresh, from the current ticket set, and is marked as such rather than
presented as recovered.

## Gate A rows (must close before the M5 milestone closes)

| Row | Asserts | Source authority | Closing ticket(s) | Verification |
|---|---|---|---|---|
| P0-1 | The published install one-liner references an immutable tag, never `dev`, and the version pin matches `package.json` | `docs/tickets/release.md` (fresh — first written as this table's row, no prior citation existed for `P0-1`) | T-1031 (#211) | `docs/tickets/release.md` T-1031 AC table, three rows already specified: one-liner excludes `/dev/`, matches a `/vX.Y.Z/` tag, pin equals `package.json` version |
| P0-2 | Guard's MCP description, README disclosure, and CLI wording state measured precision/recall everywhere guard is exposed, and never claim an empty result as a verdict | ADR-0020 | T-1020 (#208), T-1021 (#209), T-1022 (#210) | ADR-0020 falsification conditions; each ticket's AC table |
| P0-3 | The capture pipeline (prepare → verify → stage → apply → consume) enforces maker–checker separation: the agent supplies only a draft, CommitLore owns the source snapshot, verification result, and every state transition | ADR-0021 | T-1001–T-1009 (#193–#201) | ADR-0021 §7 falsification conditions; T-1009's AC row "Verify cannot be bypassed" |
| P0-4 | The P0-3 architecture is proven end-to-end — real CLI invocation, real MCP call sequence, real Git commit — not only unit-level per-ticket AC | PRD-F9-unified-capture.md line 4 cites this row and no ticket closes it | **T-1023 (new, see below)** | New ticket's AC table |
| P0-5 | The README (or `commitlore demo`) carries a concrete before/after scene demonstrating lifecycle filtering, not only the positioning claim | ADR-0022 | T-1010–T-1016 (#202–#207, #212) | ADR-0022 "Risked" section; F10 ticket AC tables |
| P0-6 | README positioning (hero, section order) across all four languages ships as one coordinated change, never partially | ADR-0022 §"Consistency across languages" | T-1014, T-1015 (#206, #207) | F11 ticket doc's explicit merge-ordering note against T-1021 |
| P0-7 | *(no prior citation anywhere in `docs/`.)* Reconstructed from an operational gap, not a recovered definition: `PRD-F9-unified-capture.md`'s 14 requirements never mention pending-transaction cleanup, and no ticket owns deleting a `.git/commitlore/pending/*.json` file. T-1002's prepare step writes a file on every capture attempt, including ones that verify empty; nothing ever removes it. The numbering gap between T-1018 and T-1020, and between P0-6 and P0-8, is circumstantial — not evidence this row previously had different content. | *(none — this document is the first place it is asserted)* | **T-1019 (new, see below)** | New ticket's AC table |
| P0-8 | Guard integration into the capture pipeline | PRD-F9-unified-capture.md "Non-goals" | *(none — explicitly Gate B)* | Not required for Gate A; listed here only because the label is cited |

`P1-5` (user-editable policy file) is cited in ADR-0021 §7 and PRD-F9 "Non-goals" as explicitly Gate B. It is listed for completeness, not required for Gate A.

## New tickets this document adds

### T-1019 Pending-transaction recovery and garbage collection (M) — new · depends on T-1001, T-1018

**Owns**: `src/core/pending-gc.ts` (new), `src/commands/capture.ts` (extend with `status`/`discard`/`gc` subcommands), `test/pending-gc.test.ts` (new).

**Depends on**: T-1001 (transaction primitives), T-1018 (consumption finalisation — GC must never touch a file another process is finalising).

**Forbidden scope**: Release gate, `bench/fixtures/`, `README*`, any version string, `src/mcp/server.ts`, `src/hooks/`.

**RED test**: `test/pending-gc.test.ts` — "gc removes an expired, unconsumed pending file and leaves a staged-but-unexpired one untouched". Must fail before the change because no GC function exists and pending files, once written, are never deleted.

**Minimum GREEN**: Export `gcPending(cwd): { removed: string[], kept: string[] }`, `discardPending(cwd, nonce): boolean`, `statusPending(cwd): PendingSummary[]` from `src/core/pending-gc.ts`. `gcPending` removes files where `now > expires_at` **and** `phase` is not `staged`/`applied` with an in-window retry, since an applied-but-not-yet-consumed file may still be legitimately finalised by a delayed `post-commit` run. A `consumed:true` file older than a retention window (default 24h) is also eligible for removal — it is historical, not actionable. `discardPending` removes exactly the named nonce regardless of expiry, refusing only a file with `phase:"staged"` or `phase:"applied"` for a commit still in progress (heuristic: the CLI declines with a named reason; it does not attempt to detect an in-progress commit process). `statusPending` reports every current pending file's phase, age, and expiry without mutating anything. Wire `commitlore capture status`, `commitlore capture discard <nonce>`, and `commitlore capture gc` to these three functions.

**AC ↔ test**:

| AC | Test | Source |
|---|---|---|
| Expired unconsumed file is removed by gc | `gc removes expired prepared/verified file` | P0-7 |
| Staged/applied file within expiry is kept | `gc keeps unexpired staged file` | P0-7, ADR-0021 §3 (does not weaken the five-gate check) |
| Consumed file older than retention window is removed | `gc removes consumed file past 24h` | P0-7 |
| Consumed file within retention window is kept | `gc keeps recent consumed file` | P0-7 (inspection value) |
| discard removes a named nonce | `discard removes exact file, others untouched` | P0-7 |
| discard refuses a staged/applied nonce | `discard on staged file returns false with reason` | wrong-target/partial-state safety, matching T-1004/T-1018's existing refusal pattern |
| status lists phase and age without mutation | `status is read-only, file mtimes unchanged` | P0-7 |
| gc never touches a file mid-finalisation by another process | `concurrent post-commit claim is not removed by a simultaneous gc run` | ADR-0021 consequence: post-commit and gc must not race |

**Commands**:
- Focused: `npx vitest run test/pending-gc.test.ts`
- Full suite: `npx vitest run`
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0

**Evidence invalidation**: Bound to the exact HEAD SHA at test execution; void if T-1001's phase transitions or T-1018's finalisation matching change.

**Stop / escalate**: Stop if (a) a reliable way to detect "a commit is currently in progress" does not exist cross-platform (the discard refusal may need to be phase-only, not process-aware), (b) the default 24h consumed-retention window conflicts with a requirement written elsewhere that this ticket's author has not seen.

**Safety checks**: Fail-closed (gc that cannot determine a file's age skips it rather than guessing); wrong-target (gc never removes a `staged`/`applied` file within its expiry window, preserving T-1005/T-1018's retry path); partial state (removal is an unlink, not a rewrite — no partial-delete state is observable); privacy (gc reads only the fields already in the pending schema).

**Completion evidence**: Paste `npx vitest run test/pending-gc.test.ts` output, plus `npx tsc -p tsconfig.json --noEmit` exit 0.

---

### T-1023 Gate A integrated E2E acceptance (M) — new · depends on all of T-1001–T-1022

This is the ticket that closes `P0-4` and is the milestone's final gate, matching `RELEASE-GATE.md`'s existing convention of a command-checkable table rather than a narrative sign-off.

**Owns**: `test/e2e/gate-a.test.ts` (new). No production code — this ticket adds proof, not behaviour.

**Depends on**: Every T-1001–T-1022 ticket (transitively, all of F9/F10/F11).

**Forbidden scope**: Any production source file. If a scenario in this ticket fails, the fix belongs to the ticket that owns the failing behaviour, not to this one.

**RED test**: Each scenario below, run against `dev` before T-1001–T-1022 land, fails or does not exist.

**Required scenarios** (mirrors the source review's A-005, cross-checked against what each individual ticket's AC table already covers at unit level — this ticket proves the same properties hold when the pieces run together):

| Scenario | Proves |
|---|---|
| Happy path: CLI `capture` with a valid draft → `prepare-commit-msg` → real `git commit` → `post-commit` → record queryable | The full chain works against a real repository, not mocked modules |
| MCP happy path: `commitlore_prepare_capture` → `commitlore_verify_capture` → `commitlore_stage_capture` → same commit flow | MCP and CLI produce the same outcome (PRD-F9 AC row 5) |
| Wrong target: HEAD moves between prepare and commit | Record does not attach (T-1005's unit test proves the check exists; this proves the real hook invocation honours it) |
| Trust bypass: MCP `stage` called with a fabricated nonce, or a nonce from another repository's `.git` | Fails closed, no record attaches |
| Concurrent capture in a linked worktree | Each worktree's pending directory is independent (ADR-0021: "per-worktree and per-clone") |
| Existing hook preservation | A repository with a pre-existing foreign `prepare-commit-msg`/`post-commit` hook keeps it working (T-1018's containment requirement, exercised against real hook files) |
| Aborted commit (empty commit message, or `commit --no-edit` failure) | Pending record remains retriable, is not marked consumed |

**AC ↔ test**: Each row above is one test in `test/e2e/gate-a.test.ts`; the AC is the scenario passing against the real CLI binary and a real temporary Git repository, not against in-process module calls.

**Commands**:
- Focused: `npx vitest run test/e2e/gate-a.test.ts`
- Full suite: `npx vitest run`
- Release: both typechecks exit 0
- Manual: one full capture → commit cycle run by hand in a scratch repository, output pasted as completion evidence

**Evidence invalidation**: Bound to exact HEAD; every dependency ticket landing after this one invalidates prior evidence and requires a re-run.

**Stop / escalate**: Stop if any individual T-1001–T-1022 ticket has not landed — this ticket has nothing to prove against. Stop if a scenario cannot be constructed without a real filesystem/subprocess Git repository (it must not be mocked; that would defeat the ticket's purpose).

**Completion evidence**: `npx vitest run test/e2e/gate-a.test.ts` output showing every scenario passing at one exact HEAD SHA, plus the manual scratch-repository receipt.

## Execution constraint: `src/mcp/server.ts` is a shared-file conflict zone

T-1007 (#199), T-1008 (#200), T-1009 (#201) and T-1020 (#208) each add or edit a
section of `src/mcp/server.ts`. T-1009 already depends on T-1007 and T-1008, but
T-1007/T-1008 have no ordering between each other, and T-1020 depends only on
`ADR-0020` (already accepted) — meaning all four were eligible to start in
parallel and collide on the same file.

**Merge order, strict, one PR open against `src/mcp/server.ts` at a time**:

```
T-1007 → T-1008 → T-1009 → T-1020
```

Do not open a second PR touching `src/mcp/server.ts` while one of these four is
unmerged. This is a process constraint, not a code constraint — nothing enforces
it automatically, which is itself worth naming rather than assuming away.

## What this document deliberately does not do

It does not re-litigate ADR-0020/0021/0022 — those are Accepted and their
falsification conditions govern reopening them, not this table. It does not
invent Gate B or Gate C rows; `P0-8` and `P1-5` are listed only because their
labels are already cited elsewhere, not because Gate B is being scoped here.

## Falsification

This document is wrong, and should be corrected, if any cited row (`P0-1`
through `P1-5`) is found to have existed as prior text this reconstruction
missed — check `git log -p --all -- '**/*.md'` for the literal string before
assuming a row's content here is the first time it was written.
