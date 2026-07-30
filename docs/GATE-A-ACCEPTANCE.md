# Gate A acceptance matrix

`ADR-0020`, `ADR-0021`, `ADR-0022` and `PRD-F9-unified-capture.md` each cite
rows of an acceptance matrix as an authority they depend on or are accepted
against. This file is that authority. An authority reference that points at
nothing cannot be checked, which is why the rows live here rather than in a
working document.

**The source review is the primary authority for every row.** Each row's
assertion is derived from it directly. `docs/adr/`, `docs/prd/` and
`docs/tickets/` are cross-checks, not sources: grep a row number across them to
confirm the row and its tickets agree, and treat a disagreement as a defect in
whichever document drifted rather than as a competing definition.

That ordering is not a preference. An earlier version of this table derived its
rows from where each label happened to be cited instead of from the review, and
the result was wrong in five of eight rows: `P0-4`, `P0-7` and `P0-8` had the
wrong subject entirely, and `P0-1` and `P0-5` had been narrowed to one sub-item
each. Deriving from citations reproduces whatever the citing document assumed.

## Gate A rows (must close before the M5 milestone closes)

**Status semantics.** A row's *Ticketed to close* column names the tickets that are expected to close
it. At the canonical base `a10679cafdcb36bff59cd98122e5007807aa4031` every one of those tickets is **OPEN work**. A row
records that the source recommendation was accepted and ticketed — never that it is
complete. Row completion is decided by the named tickets' acceptance criteria, not by the
existence of this table.

**What each corrected row had been.** `P0-4` had become an end-to-end proof requirement,
`P0-7` pending-transaction cleanup, and `P0-8` capture-pipeline guard integration — three wrong
subjects. `P0-1` had been narrowed to the install one-liner alone and `P0-5` to a README scene.
None of the five is what the review says. The two tickets an earlier session created to close the
wrong-subject `P0-4` and `P0-7` claim no row now and survive on their own merits — see below.

| Row | Asserts | Source authority | Ticketed to close | Verification |
|---|---|---|---|---|
| P0-1 | The v0.3.0 release is closed end to end — partially true at this base, and the remainder is OPEN work: #192's flaky failure and its misreported cause are resolved, the promotion PR is re-verified at its exact head, the tag and four platform assets with checksums are published, and the README default install one-liner references the immutable release tag — never `dev` — with the pinned example matching `package.json` | Source review §8 P0-1 | T-1031 (#211) for the README install path; T-901 (#27) and T-1030 (#192) for the release process | T-1031's AC table in `docs/tickets/release.md` (one-liner excludes `/dev/`, matches a `/vX.Y.Z/` tag, pin equals `package.json` version); T-1030's AC table (#192) for the diagnostic that must stop asserting a cause it cannot determine; T-901's release-process evidence (#27) — promotion PR green at its exact head, tag present, four platform assets published with checksums, and `--version` agreeing across `dev`, `package.json`, tag and binary |
| P0-2 | Guard's MCP description, README disclosure, and CLI wording state measured precision/recall everywhere guard is exposed, and never claim an empty result as a verdict | Source review §8 P0-2; ADR-0020 | T-1020 (#208), T-1021 (#209), T-1022 (#210) | ADR-0020 falsification conditions; each ticket's AC table |
| P0-3 | The capture pipeline (prepare → verify → stage → apply → consume) enforces maker–checker separation: the agent supplies only a draft, CommitLore owns the source snapshot, verification result, and every state transition | Source review §8 P0-3; ADR-0021 | T-1001–T-1009 (#193–#201) and T-1018 (#213) | ADR-0021 §7 falsification conditions; T-1009's AC row "Verify cannot be bypassed"; T-1018's AC table for the consume step this row's assertion names |
| P0-4 | The MCP server exposes `commitlore_prepare_capture`, `commitlore_verify_capture` and `commitlore_stage_capture`; no `commitlore_write_record` tool exists; all three write only to `.git/commitlore/pending/`; the same verification and pending-transaction contract applies whichever agent calls them | Source review §8 P0-4; `docs/prd/PRD-F9-unified-capture.md` line 4 | T-1007 (#199), T-1008 (#200), T-1009 (#201) | PRD-F9 requirement 6 (no `commitlore_write_record`); T-1009's AC row "Verify cannot be bypassed"; each ticket's AC table |
| P0-5 | `commitlore demo` is deterministic: it creates its own temporary repository, seeds one active and one superseded decision, shows that lifecycle filtering excludes the stale record where similarity retrieval does not, needs no network and no model, removes what it created, and finishes inside a minute | Source review §8 P0-5; ADR-0022 "Risked" section | T-1010 (#202), T-1011 (#203), T-1016 (#212) | T-1011's AC table (temporary repository removed even on failure, user repository never written, lifecycle filtering shown); ADR-0022 consequences |
| P0-6 | The README is restructured into the review's explicit product-first order — problem scene, core sentence, short demo, install, what happens automatically after install, how records get created, the lifecycle differentiator, how it differs from `CLAUDE.md`/ADRs/RAG, verified claims, benchmarks, known limitations, protocol reference — so the measurement no longer precedes the product, and hero plus order ship across all four languages as one coordinated change, never partially | Source review §8 P0-6; ADR-0022 §"Consistency across languages" | T-1014 (#206), T-1015 (#207) | T-1014's AC table (hero and positioning, all four language files as one change); T-1015's AC table (the explicit product-first section order, measurement below the product, `BENCH` block untouched, exposure table retained, four-language coordination); F11's merge-ordering note against T-1021, which owns the same README files |
| P0-7 | The default `init` output is result-oriented — it reports readiness rather than internal step names, stays short enough to read at a glance on a clean run, and never hides a warning or a failure; today's `[1/4]`…`[4/4]` step detail moves behind `--verbose`, and `--json` (which already exists) is unchanged | Source review §8 P0-7 | T-1012 (#204), T-1013 (#205) | T-1012's AC table (clean run is result-oriented, no internal command names, a failure stays visible); T-1013's AC table (`--verbose` restores the step detail) |
| P0-8 | One MCP tool `commitlore_before_change` accepts `{path, proposal?}` and returns `{active_decisions, verification_gaps, possible_revival_matches, guard_confidence: "experimental", cache_key}`: context only when no proposal is given, plus an experimental guard result when one is, with the two confidence levels kept visibly separate so an agent has one tool to remember | Source review §8 P0-8 | T-1024 (#219) | T-1024's AC table; must show one tool call replacing a separate guard and context call, and must not present an experimental signal at the same confidence as path-scoped context |

`P1-5` (user-editable policy file) is cited in ADR-0021 §7 and PRD-F9 "Non-goals" as explicitly Gate B. It is listed for completeness, not required for Gate A.

## Tickets this document adds — independent audit findings

Neither ticket closes an acceptance-matrix row. Both were created by an earlier session to
close rows P0-7 and P0-4 as it had reconstructed them; those reconstructions were wrong, and
the real P0-4 and P0-7 are ticketed to close by the MCP and `init` tickets respectively, and those issues are OPEN work. Each ticket is
kept here because the gap it names is real, audited independently, and reduced to one
responsibility.

### T-1019 Pending-transaction garbage collection (S) — #215 · P1 · depends on T-1001, T-1006, T-1018

Independent audit finding. It closes no acceptance-matrix row. An earlier session created it to
close `P0-7` as that session had reconstructed the row; the reconstruction was wrong. Reduced
from three responsibilities (`status`, `discard`, `gc`) to one: garbage collection. `status` and
`discard` were operator conveniences with no defect behind them and were dropped rather than
carried.

**Why it survives the reduction.** `T-1002`'s prepare step writes a file under
`.git/commitlore/pending/` on every capture attempt, including attempts whose verification
returns nothing. No ticket from `T-1001` to `T-1018` owns deleting one. Once `T-1002` lands the
directory grows without bound. That is an operational defect, not a data-integrity or security
one, which is why it is `P1` and not a gate row.

**Owns**: `src/core/pending-gc.ts` (new), `src/commands/capture.ts` (add the `gc` subcommand only), `test/pending-gc.test.ts` (new).

**Depends on**: T-1001 (transaction primitives), T-1006 (owns `src/commands/capture.ts` — this ticket lands after it, never beside it), T-1018 (finalisation; gc must never remove a file another process is finalising).

**Forbidden scope**: The release gate, `bench/fixtures/`, `README*`, any version string, `src/mcp/server.ts`, `src/hooks/`. Do not add `status` or `discard`: they were removed deliberately.

**RED test**: `test/pending-gc.test.ts` — "gc removes an expired, unconsumed pending file and leaves a staged-but-unexpired one untouched". It must fail before the change because no GC function exists and a pending file, once written, is never deleted.

**Minimum GREEN**: Export `gcPending(cwd): { removed: string[], kept: string[] }` from `src/core/pending-gc.ts`. It removes a file when `now > expires_at` **and** `phase` is neither `staged` nor `applied` — those two phases are protected regardless of expiry, because an applied-but-unconsumed file may still be finalised by a delayed `post-commit`. A `consumed: true` file older than a retention window (default 24h) is also eligible: it is history, not state. A file whose age or phase cannot be determined is skipped. Wire `commitlore capture gc` to this one function.

**AC ↔ test**:

| AC | Test | Source |
|---|---|---|
| An expired unconsumed file is removed | `gc removes expired prepared/verified file` | This ticket; ADR-0021 §2 expiry field |
| A staged or applied file is kept regardless of expiry | `gc keeps staged/applied file even past expires_at` | ADR-0021 §3 — gc must not weaken the five-gate application check |
| A consumed file past the retention window is removed | `gc removes consumed file past 24h` | This ticket |
| A consumed file inside the retention window is kept | `gc keeps recent consumed file` | This ticket — recent history stays inspectable |
| A file whose age or phase cannot be read is skipped | `gc skips file with missing or corrupt created_at` | Fail-closed check below |
| gc never removes a file another process is finalising | `concurrent post-commit claim is not removed by a simultaneous gc run` | ADR-0021 — post-commit and gc must not race |

**Commands**:
- Focused: `npx vitest run test/pending-gc.test.ts`
- Full: `npx vitest run` — no regression against the baseline established at the branch head
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0
- Manual: `LIVE_NA` — gc has no interactive surface; the concurrency AC is exercised by the focused test, not by hand

**Evidence invalidation**: Bound to the exact head SHA at execution. Void if T-1001's phase transitions or T-1018's finalisation matching change.

**Stop / escalate**: Stop if the default 24h consumed-retention window contradicts a requirement written elsewhere that this ticket's author has not seen. The process-aware refusal the wider version needed is gone with `discard`: protection is decided by phase alone, which is readable from the file.

**Safety checks**: *Fail-closed* — gc that cannot determine a file's age or phase skips it rather than guessing. *Wrong-target* — gc never removes a `staged` or `applied` file at all, expiry notwithstanding, preserving T-1005's application path and T-1018's retry. *Ambiguity* — two files claiming the same nonce is not gc's decision to resolve; it skips both and reports them. *Timeout* — expiry comes from the record's own `expires_at`; a file without one is skipped, never treated as expired. *Partial state* — removal is an unlink rather than a rewrite, so no partially deleted state is observable and a crash mid-run leaves every remaining file valid. *Security and privacy* — gc reads only fields already in the pending schema and never opens a transcript.

**Completion evidence**: `npx vitest run test/pending-gc.test.ts` output, both typecheck exits, and the full-suite summary line at one exact head SHA.

---

### T-1023 Capture pipeline E2E integration (M) — #216 · depends on T-1001–T-1009, T-1018

Independent audit finding. It closes no acceptance-matrix row. An earlier session created it to
close `P0-4` as that session had reconstructed the row; the real `P0-4` is the MCP capture
write-side, ticketed to close by T-1007, T-1008 and T-1009. Dependencies here were narrowed from
"all of T-1001–T-1022" to the pipeline this ticket actually exercises, which makes it the last
**capture-pipeline integration** ticket to become startable. It is not the last Gate A ticket:
T-1024 sits behind its own dependency chain on `src/mcp/server.ts`.

**Why it survives.** Every capture ticket proves its own slice against constructed inputs. None
runs the chain — prepare, verify, stage, a real `git commit`, the hook applying, `post-commit`
consuming, the record queryable — as one continuous sequence, and none drives the three MCP
tools over a single nonce. Those are real integration gaps, not restatements of the unit ACs.

**Owns**: `test/gate-a-e2e.test.ts` (new — `test/` is flat in this repository; only `test/fixtures/` has subdirectories). No production code. If a scenario fails, the fix belongs to the ticket that owns the failing behaviour, not to this one.

**Depends on**: T-1001–T-1009 and T-1018 (#193–#201, #213). It does not depend on the guard, `init` or README tickets: it proves nothing about them.

**Forbidden scope**: Any production source file. Any change that makes a scenario pass by weakening what it asserts.

**RED test**: Every scenario below, run before its dependency tickets land, must fail or fail to exist. This ticket must not become green by construction: each scenario drives the real CLI binary against a real temporary Git repository, so a scenario that cannot fail has been written wrongly.

**Minimum GREEN**: One test file whose scenarios are exactly the table below, each driving real subprocesses and a real repository rather than in-process module calls.

**AC ↔ test**:

| Scenario (one test each) | Proves |
|---|---|
| CLI `capture` with a valid draft → `prepare-commit-msg` → real `git commit` → `post-commit` → record queryable | The chain works against a real repository, not mocked modules |
| MCP `prepare` → `verify` → `stage` over one nonce, then the same commit flow | MCP and CLI reach the same outcome (PRD-F9 requirement for an agent-agnostic contract) |
| HEAD moves between prepare and commit | No record attaches — T-1005 proves the check exists, this proves the real hook invocation honours it |
| `stage` called with a fabricated nonce, or one from another repository's `.git` | Fails closed, nothing attaches |
| Concurrent capture in a linked worktree | Each worktree's pending directory is independent (ADR-0021: per-worktree and per-clone) |
| Aborted commit (empty message, or a failing `commit`) | The pending record stays retriable and is not marked consumed |

**Commands**:
- Focused: `npx vitest run test/gate-a-e2e.test.ts`
- Full: `npx vitest run` — no regression against the baseline established at the branch head
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0
- Manual: one capture-to-commit cycle run by hand in a scratch repository, output pasted as completion evidence

**Evidence invalidation**: Bound to the exact head SHA. Any dependency ticket landing after this one voids prior evidence and requires a re-run.

**Stop / escalate**: Stop if any of T-1001–T-1009 or T-1018 has not landed — there is nothing to prove against. Stop if a scenario cannot be built without a real filesystem and subprocess Git repository; mocking it would defeat the ticket.

**Safety checks**: *Fail-closed* — the fabricated-nonce and cross-repository scenarios assert refusal, not tolerance. *Wrong-target* — the moved-HEAD and linked-worktree scenarios are the wrong-target proof. *Ambiguity* — a scenario whose outcome could be produced by two different code paths is split until it cannot. *Timeout* — each scenario bounds its subprocess wait and fails on expiry rather than hanging CI. *Partial state* — the aborted-commit scenario is the partial-state proof. *Security and privacy* — scratch repositories are created under a temporary directory, removed on both success and failure, and no scenario writes into the developer's own repository.

**Completion evidence**: `npx vitest run test/gate-a-e2e.test.ts` showing every scenario passing at one exact head SHA, both typecheck exits, and the manual scratch-repository receipt.

---

## Execution constraint: `src/mcp/server.ts` is a shared-file conflict zone

T-1007 (#199), T-1008 (#200), T-1009 (#201), T-1020 (#208) and T-1024 each add or edit
a section of `src/mcp/server.ts`. T-1009 already depends on T-1007 and T-1008, but
T-1007/T-1008 have no ordering between each other, and T-1020 depends only on
`ADR-0020` (already accepted) — meaning all four were eligible to start in
parallel and collide on the same file.

**Merge order, strict, one PR open against `src/mcp/server.ts` at a time**:

```
T-1007 → T-1008 → T-1009 → T-1020 → T-1024
```

Do not open a second PR touching `src/mcp/server.ts` while one of these five is
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
