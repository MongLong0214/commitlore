# F13 tickets — Capture advisory and policy resolution (M6)

> PRD: [PRD-F13-capture-advisory-and-policy.md](../prd/PRD-F13-capture-advisory-and-policy.md)
> ADR: [0020](../adr/ADR-0020-guard-is-an-experimental-advisory.md) (guard is an
> experimental advisory), [0021](../adr/ADR-0021-capture-pending-transaction.md) (capture
> pending transaction), [0006](../adr/ADR-0006-push-injection.md) (push injection)
> Acceptance: [`../GATE-B-ACCEPTANCE.md`](../GATE-B-ACCEPTANCE.md) rows `B-6`, `B-7`
> Baseline head: `e2b5725`. Full suite there: **65 files, 1,750 passed, 1 skipped.**

**Attribution warning.** T-1109 closes `B-6`, whose authority is
`PRD-F9-unified-capture.md`'s standalone "Non-goals" bullet. It does **not** close
acceptance row `P0-8` — that row is the unified `commitlore_before_change` tool and was
closed in Gate A by T-1024 (#219). PRD-F9 states the distinction itself. Do not re-label
this ticket with `P0-8`.

**Merge ordering**: T-1109 merges before T-1110, or T-1110 carries T-1109's advisory field
forward. Both touch the capture pipeline (`GATE-B-ACCEPTANCE.md` "Execution constraints").

---

## T-1109 Guard as a capture advisory that cannot block (M) — #273 · B-6

**Owns**

- `src/core/pending.ts` — `PendingRecord` (interface at line 18 at `e2b5725`): one new
  optional field
- `src/core/capture-prepare.ts` — `prepareCaptureContext` (line 60): populate the field
- `src/commands/capture.ts` — render the advisory in human and `--json` output
- `test/capture-guard-advisory.test.ts` (new)
- `dist/` — rebuild required

**Depends on**

- ADR-0020 accepted (already). Nothing else in this file

**Forbidden scope**

- **Guard must not change any exit code, any `phase` transition, or any gate decision.**
  This is the whole row; a diff that lets a match affect control flow is the failure
- Do not change guard's scoring, threshold, weights, or `DEFAULT_THRESHOLD`
- Do not change `PendingRecord.version` — it stays `1` (ADR-0021; a bump would falsify it)
- Do not make any existing field optional or change its meaning
- Do not touch `src/core/capture-stage.ts`, `src/core/capture-verify.ts`, or
  `src/hooks/prepare-commit-msg.ts`
- Do not touch the `commitlore_before_change` tool or `src/mcp/server.ts` — T-1024 shipped
  that and `P0-8` is closed
- Do not emit raw `GuardMatch` objects — see the trust-grading safety row below
- Do not add a policy key, a config option, or a way to turn the advisory into a gate

**RED test**

- File: `test/capture-guard-advisory.test.ts` (new)
- Assertions, all failing at `e2b5725` (no advisory field exists):
  1. a prepared pending record for a draft whose text revives a recorded ruled-out
     alternative carries an advisory with at least one match
  2. **differential**: the same capture run with the match forced on and forced off
     produces identical `phase`, identical exit code, and pending records that are equal
     on every field except the advisory
  3. a pending record written without the field is still read successfully by
     `readPending`
  4. when guard cannot complete (`GuardResult.history === 'unavailable'` or
     `notes === 'unfetched'`), the advisory records the gap and the capture still succeeds

**Minimum GREEN**

- `PendingRecord` gains one optional field:
  `guard_advisory?: { matches: RenderedGuardMatch[]; gaps: GuardGap[]; disclosure: string } | null`
- `gaps` is the **same closed, ordered set T-1024 fixed**: `history-unavailable`,
  `shallow-history`, `notes-unfetched`. No new vocabulary
- `matches` are produced by `renderGuardMatch` (`src/core/guard.ts:140`), never raw
  `GuardMatch`
- `disclosure` carries ADR-0020's measured figures with the same wording every other guard
  surface uses; an empty `matches` array is never rendered as "nothing applies"
- Guard is invoked with the draft record text as `proposal` and the staged diff's paths as
  `paths`; any thrown error is caught and becomes a gap, never a failure

**AC ↔ test**

| AC | Test assertion | Traces to |
|---|---|---|
| Advisory is attached on prepare | match present for a reviving draft | PRD-F13 req 1 |
| Field is additive | pre-field record still readable | PRD-F13 req 2 |
| **Cannot block** | differential equality except the advisory | PRD-F13 req 3; `bench/GUARD-CANNOT-BLOCK.md`; ADR-0006 |
| Disclosure present | advisory contains precision 44.8% and recall 22.0% | PRD-F13 req 4; ADR-0020 |
| Guard failure degrades | forced guard throw ⇒ gap recorded, capture succeeds | PRD-F13 req 5 |
| Caveats travel | `GuardResult.incomplete` maps into `gaps` | PRD-F13 req 6; T-1024's closed set |
| Trust grading preserved | a `blocked`-trust record's content is withheld in the advisory | ADR-0006; SPEC §7 |
| Format version unchanged | `expect(record.version).toBe(1)` | ADR-0021 |

**Commands**

| scope | command | expected |
|---|---|---|
| focused | `npx vitest run test/capture-guard-advisory.test.ts test/capture.test.ts test/pending.test.ts` | pass |
| full | `npx vitest run` | 66 files, 1,750+ passed, 1 skipped |
| release | `npm run build && git diff --exit-code dist/` | no drift |
| release | `npx tsc --noEmit && npx tsc --noEmit -p bench/tsconfig.json` | both exit 0 |
| manual | `node dist/commitlore.mjs capture --transcript … prepare` in a scratch repo carrying a ruled-out record | advisory printed; exit code identical to a run with no match |
| LIVE_NA | No model, no network. Guard is local and reads git | — |

**Evidence invalidation**

- Bound to `e2b5725`: `PendingRecord` at `src/core/pending.ts:18`,
  `prepareCaptureContext` at `src/core/capture-prepare.ts:60`, `renderGuardMatch` at
  `src/core/guard.ts:140`. Re-read all three before editing
- If T-1110 merges first, `policy_identity_hash`'s input has changed; the differential
  test must then force the same policy on both arms or it will compare two policies

**Stop / escalate**

- If attaching the advisory requires guard to run before the pending file exists in a way
  that changes phase ordering, stop: the phase machine is ADR-0021's and is not this
  ticket's to reshape
- If the differential test cannot be written because guard's result is not injectable,
  stop and report — an untestable "cannot block" claim is exactly what ADR-0020 forbids
  asserting

**Safety checks**

| check | response |
|---|---|
| fail-closed | Guard failing yields a recorded gap and a successful capture; it never blocks and never silently reports "clean" |
| wrong-target | A diff touching stage, verify, the hook, or `src/mcp/server.ts` is out of scope |
| ambiguity | The gap vocabulary is T-1024's closed set, reused verbatim |
| timeout | Guard is bounded by the index; on `--no-index` it is slower. Reuse the existing guard invocation path rather than adding a second one |
| partial state | The field is written in the same file write as the rest of prepare; there is no separate persistence step |
| privacy | Advisory content comes from the repository's own records, and the draft text is already in the pending file |
| **prompt injection** | Advisory text reaches a model. `renderGuardMatch` is mandatory: it is what withholds `blocked`-trust content, and emitting raw matches would route untrusted trailer text to a model as if it were trusted |

**Completion evidence**

- The differential test passing, quoted in the PR: same phase, same exit code, one field
  differing
- Focused and full suites green; both `tsc` exit 0; `dist/` no drift
- A `--json` sample showing the advisory with its disclosure, and an empty-match case that
  does not read as a clean bill

---

## T-1110 User-editable policy file, after consolidating the triplicated policy identity (L) — #274 · B-7, row `P1-5`

**Owns**

- `src/core/capture-policy.ts` (new) — the single definition of the policy defaults and
  `computePolicyIdentityHash`
- `src/core/capture-prepare.ts` — remove the local copy (`HARDCODED_DEFAULTS` and
  `computePolicyIdentityHash`, lines 24–30 at `e2b5725`) and import
- `src/core/capture-stage.ts` — remove the local copy (lines 30–36 at `e2b5725`) and
  import
- `src/hooks/prepare-commit-msg.ts` — remove the local copy (`CAPTURE_POLICY_DEFAULTS` and
  `computePolicyIdentityHash`, lines 129–135 at `e2b5725`) and import
- `test/capture-policy.test.ts` (new)
- `dist/` — rebuild required

**Depends on**

- ADR-0021 accepted (already), which **already fixes the migration**: the identity hash
  input changes from `sha256(hardcoded-defaults-json)` to `sha256(policy-file-contents)`
  and the pending format needs no breaking change
- T-1109 merged, or this ticket carries its advisory field forward

**Precondition — the triplication is removed first, in this ticket, before the input
changes**

Measured at `e2b5725`: `computePolicyIdentityHash` and its defaults object exist
**three** times, independently —

| file | line | constant name |
|---|---|---|
| `src/core/capture-prepare.ts` | 24 | `HARDCODED_DEFAULTS` |
| `src/core/capture-stage.ts` | 30 | `HARDCODED_DEFAULTS` |
| `src/hooks/prepare-commit-msg.ts` | 129 | `CAPTURE_POLICY_DEFAULTS` |

All three hash `JSON.stringify(<literal>)`, so they agree **only** because the three
object literals happen to list the same three keys in the same order — `JSON.stringify`
serialises in insertion order. Nothing tests that they agree. Changing the hash input in
three places, one of which is named differently, is how a stage-versus-consume comparison
starts silently disagreeing: the hook would compute a different hash from the one
`prepare` wrote and report a policy change that never happened.

Consolidation is therefore step 1 of this ticket, with its own test, and it must be a
**no-op on the hash value** — the same hex digest before and after.

**Forbidden scope**

- Do not change `PendingRecord.version` (ADR-0021; a bump falsifies it)
- Do not add a policy key beyond the three that exist (`mode`,
  `max_records_per_commit`, `require_verified_evidence`) — PRD-F13 non-goals
- Do not let the policy file influence path resolution, command execution, or anything
  touching Git history
- Do not let a missing or invalid file silently fall back to defaults
- Do not change guard's threshold or any guard behaviour through policy
- Do not touch `src/core/pending-gc.ts` or the GC retention window

**RED test**

- File: `test/capture-policy.test.ts` (new)
- Assertions:
  1. **consolidation is a no-op**: the identity hash for the default policy equals the
     digest produced at `e2b5725`, pinned in the test — fails if consolidation changes key
     order or content
  2. exactly one definition exists: no file other than `src/core/capture-policy.ts`
     defines `computePolicyIdentityHash` or a defaults object with those three keys —
     fails at `e2b5725`, where three do
  3. with no policy file, resolution equals today's defaults and today's hash — a pending
     record written before this ticket is still consumable
  4. with a policy file, the hash equals `sha256(file-contents)` and
     `record.version === 1`
  5. an invalid policy file produces a named error and leaves prior behaviour in place —
     it is never silently ignored
  6. an undeclared key is rejected, not merged
  7. repository-local and user-global files have an asserted precedence

**Minimum GREEN**

- `src/core/capture-policy.ts` exports the defaults, `resolvePolicy(cwd)` and
  `computePolicyIdentityHash(policy)`; all three former sites import it
- With no file: identical behaviour and identical digest to `e2b5725`
- With a file: `sha256(file-contents)` per ADR-0021, format version unchanged
- Invalid file: named, actionable error; previous behaviour retained; the identity hash
  never claims a policy that did not run
- Precedence between repository-local and user-global stated in the code and asserted in
  the test
- `npm run build` run and `dist/` committed

**AC ↔ test**

| AC | Test assertion | Traces to |
|---|---|---|
| One definition only | repository scan finds a single definition | PRD-F13 req 7 |
| Consolidation changes no digest | pinned digest equality | PRD-F13 req 8; ADR-0021 |
| Absent file ⇒ today's behaviour | old pending record still consumable | PRD-F13 req 8 |
| Present file ⇒ file-contents hash | hash equality; `version === 1` | PRD-F13 req 9; ADR-0021 |
| Invalid file is loud | named error, no silent default | PRD-F13 req 10 |
| One resolution path, stated precedence | CLI and hook agree in the test | PRD-F13 req 11 |
| Undeclared key rejected | rejection asserted | PRD-F13 req 12 |
| Stage-to-commit mismatch still detected | differing hash reported by the hook | PRD-F13 req 13 |

**Commands**

| scope | command | expected |
|---|---|---|
| focused | `npx vitest run test/capture-policy.test.ts test/capture.test.ts test/prepare-commit-msg.test.ts test/post-commit-capture.test.ts` | pass |
| full | `npx vitest run` | 67 files, 1,750+ passed, 1 skipped |
| release | `npm run build && git diff --exit-code dist/` | no drift |
| release | `npx tsc --noEmit && npx tsc --noEmit -p bench/tsconfig.json` | both exit 0 |
| manual | prepare a capture on the old code, upgrade, then consume | the hook's existing policy-change path behaves as it does today |
| LIVE_NA | No model, no network | — |

**Evidence invalidation**

- Bound to `e2b5725`: three sites at `capture-prepare.ts:24`, `capture-stage.ts:30`,
  `prepare-commit-msg.ts:129`. Re-derive with
  `grep -rn "computePolicyIdentityHash" src` before editing — if a fourth copy has
  appeared, the consolidation test is what should have caught it
- The pinned digest in assertion 1 is the value at `e2b5725`. It may only change in a
  commit that deliberately changes the default policy, and such a commit must say so

**Stop / escalate**

- If consolidation changes the digest, **stop**: every pending file in flight on any
  machine would report a false policy change. Find the ordering or content difference first
- If a policy key would need to influence anything outside capture, stop — that is a new
  decision and needs an ADR, not a ticket
- If repository-local and user-global cannot be given an unambiguous precedence, ship only
  one location; ambiguous precedence is worse than a missing feature

**Safety checks**

| check | response |
|---|---|
| fail-closed | An unreadable or invalid policy leaves the previous, stricter behaviour in place and says so |
| wrong-target | A diff that bumps `version` or adds a fourth policy key is out of scope |
| ambiguity | The key set is closed; unknown keys are rejected rather than merged |
| timeout | One small file read per invocation; the hook path must not gain a second read |
| partial state | Consolidation and the input change are separable commits inside one PR; the pinned-digest test guards the boundary between them |
| privacy | The policy file is the user's own content and is never echoed beyond the named error |
| **prompt injection** | The policy file is untrusted input. It may set only declared keys with validated values, never a path, a command, or free text that reaches a model |

**Completion evidence**

- `grep -rn "computePolicyIdentityHash" src` shows exactly one definition and three imports
- The pinned-digest test proving consolidation was a no-op
- Focused and full suites green; both `tsc` exit 0; `dist/` no drift
- A demonstrated old-pending-record consumption after the change
