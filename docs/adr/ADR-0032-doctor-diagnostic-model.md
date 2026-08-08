# ADR-0032: doctor's diagnostic model — typed checks, root-cause collapse, and an additive report schema

- Status: Proposed (2026-08-08)
- Issue: [#458](https://github.com/MongLong0214/commitlore/issues/458)
- Related: [#402](https://github.com/MongLong0214/commitlore/issues/402),
  [#400](https://github.com/MongLong0214/commitlore/issues/400) (the same
  failure category, collected in `docs/SELF-AUDIT.md` §4 as "The first screen
  lied"); ADR-0021 (the pending transaction whose silent expiry doctor failed
  to see); SPEC §10 (exit codes); `docs/DOCTOR-PRD.md` (the requirements this
  decision authorises)

## Context

`commitlore doctor` is the command a user runs to learn whether this
repository can carry and share records. Today it is a single 1,159-line file
(`src/commands/doctor.ts`, including the in-flight #458 check; 1,072 lines on
`origin/dev`) whose model is two interfaces:

```ts
interface DoctorCheck { id, title, status, needsAttention, detail, fix: string|null, fixed: boolean }
interface DoctorReport { checks: DoctorCheck[], exitCode: number }
```

Twelve checks are written as ad-hoc `const checkX = (opts) => DoctorCheck`
functions and assembled in a hand-written array inside `runDoctor`. `--json`
dumps the struct verbatim: no schema identifier, no version field, no
machine-readable evidence. `skipped` exists as a status but its reason is a
free-text `detail` string. One dependency between checks exists, and it is
expressed by passing one check's result into another's parameter list
(`checkHook(opts, hookRuntime)`).

What forced this ADR is #458. A repository with 815 commits and **zero**
CommitLore records had doctor report all ten of its checks `ok`. Four captures
sat stranded in `.git/commitlore/pending/` for eight days — one of them staged
with a passing validation. Every component behaved as designed (ADR-0021's
five-minute staged expiry did its job) and the net effect was that the product
had silently stopped producing records while its diagnostic said everything
was fine. The information existed — `commitlore pending ls` printed it — but
the command people actually run did not carry it. That is #402 (`init`
reported ready on an unfetched mirror) and #400 (`index --rebuild` reported
unqualified success on a mirror it could not read) again: the first screen
lied, this time by not looking.

A check-by-check patch closes #458. It does not close the category. The
category needs a model in which "we did not look" is structurally distinct
from "we looked and it is fine", in which one broken dependency does not
produce twelve derivative warnings, and in which `--json` is a contract a CI
consumer can build against.

### Reference 1: logic-pro-mcp SetupDoctor (inspected)

`/Users/isaac/projects/logic-pro-mcp/Sources/LogicProMCP/Utilities/` carries a
doctor grown to 3,784 lines across 22 `SetupDoctor*.swift` files. The files
read for this ADR: `SetupDoctor.swift`, `SetupDoctor+CheckRegistry.swift`,
`SetupDoctor+CheckRunner.swift`, `SetupDoctor+Rendering.swift`,
`SetupDoctor+V4.swift`, and the install-source detection in
`SetupDoctor+InstallChecks.swift`. Its verified model:

- Check statuses `pass | warn | fail | manual | skipped`; report statuses
  `ok | degraded | failed | manual_action_required`.
- A closed 18-value `DoctorSkipReason` enum — a skip always says *why* in a
  value a machine can branch on.
- 27 checks declared as data (`checkDefinitions` in
  `SetupDoctor+CheckRegistry.swift`): id, dependencies, inclusion rule,
  optionality, remediation anchor. A runner walks the registry, times each
  check with a monotonic clock, and stamps `duration_ms`.
- Root-cause collapse: a check whose declared dependency is not `pass` carries
  `blocked_by: <root cause id>`; `computeFixPlan` (SetupDoctor.swift:599)
  filters blocked checks out and sorts the remainder fail-first, so the fix
  plan names causes, not symptoms.
- Additive-only schema versioning. The comments are explicit: `blockedBy` is
  `String?` "so the synthesized Codable emits `encodeIfPresent` — the
  `blocked_by` key is OMITTED when nil, keeping v3 a strict superset a v1/v2
  decoder never trips over" (SetupDoctor.swift:88-91), and CodingKeys
  "enumerate EVERY key — the six v1 keys keep their exact wire names so a v2
  payload stays a strict field-superset of v1" (SetupDoctor.swift:96-98).
- An honesty chokepoint: `clampStatusForPermissions`
  (SetupDoctor+Rendering.swift:207) makes it structurally impossible for the
  report to say `ok` while a required permission is ungranted — the invariant
  is owned by one tested function, not left emergent on each check.

### Reference 2: OpenClaw (not inspectable)

OpenClaw's doctor implementation is not on this machine. What exists is output
artefacts under `/Users/isaac/.openclaw/tmp/`: files named `doctor-ent-*`
(440), `doctor-cli-*` (40), and `doctor-degraded-*` (40), counted by filename
prefix. The taxonomy is evidence that per-surface report profiles and a
distinct `degraded` overall state are established practice in a shipped tool.
Nothing more is claimed: the sampled files contain approval-store state, not
report bodies, so OpenClaw's check model, schema, and exit codes are unknown
here and this ADR does not cite them.

## Decision

### 1. The check statuses stay `ok | warn | fail | skipped`; there is no `manual`

The four wire values already shipping in `CheckStatus`
(`src/commands/doctor.ts:67`) are kept unchanged, with their existing
meanings: `fail` — the tool cannot work correctly here; `warn` — the setup is
incomplete but nothing gives a wrong answer locally; `skipped` — the check
exists but had nothing it could inspect, which is not a pass.

SetupDoctor's fifth status, `manual`, names an operator attestation for setup
steps the tool can neither perform nor verify (macOS TCC panels, MIDI Learn —
see the #457 comment in `SetupDoctor+CheckRegistry.swift:118-126`). CommitLore
has no such surface: every remediation this doctor can name is a command. A
status no check can emit is a report state every consumer must handle and none
can ever observe. If a genuinely unverifiable manual step ever appears, adding
the status then is additive under §6.

### 2. A skip carries a typed reason

`skipReason` becomes a closed union alongside the human `detail`. The initial
values are exactly the reasons the current checks already emit as prose, one
per distinct site:

| Reason | Current site (detail text on `origin/dev`) |
|---|---|
| `command_unrecognized` | "not checked: the configured command is not recognised" (inject-runtime, inject-version) |
| `hook_not_installed` | "no installed hook to compare against" (inject-version) |
| `probe_path_unavailable` | "no recorded path is available for a runtime probe" (inject-runtime) |
| `version_unreadable` | "did not report a version" / "answered --version with something that is not a version" (inject-version) |
| `unborn_head` | "no HEAD yet — nothing to compare against" (squash-conservation) |
| `nothing_applicable` | "no local branch looks like the source of a squash" / "recorded nothing checkable" (squash-conservation) |

SetupDoctor's enum has 18 values because its check set earned them one at a
time; ours starts with the six we can point at and grows the same way. The
rule: a check may not report `skipped` without a reason from the union, so
adding a new skip site forces the taxonomy to grow — the type system enforces
what a free string cannot.

### 3. Category and severity are derived at one chokepoint

Each check declares one of six categories: `runtime` (cli-runtime,
git-trailers), `transport` (notes-refspec, notes-push), `capture`
(commit-msg-hook, hook-runtime, pending-backlog), `delivery` (inject-runtime,
inject-version, mcp-lifecycle), `history` (history-depth,
squash-conservation), `index` (index-health). Every category is non-empty and
answers the question a category exists to answer: which subsystem is broken,
and what can `--category` select.

Severity is `error | warning | info`, derived totally from status (`fail` →
error; `warn` → warning; `ok`/`skipped` → info) in the single `check(...)`
factory, exactly as SetupDoctor derives it (SetupDoctor.swift:548, "Display-
grade severity derived from `CheckStatus` … never drives the exit code"). It
orders the fix plan and the headline. An independent severity axis was
considered and rejected below.

### 4. Checks are registry entries, and dependencies are declared data

The hand-written array in `runDoctor` becomes a registry: an ordered array of
definitions `{ id, title, category, dependencies, optional, run }`. The
runner walks it, times each check with a monotonic clock
(`process.hrtime.bigint()`, whole milliseconds, so a duration can never go
negative across a clock step — the same choice as SetupDoctor's
`monotonicNowMs`), stamps `durationMs`, and catches a thrown check into a
`fail` row carrying the error as evidence. Doctor must never die of its own
check; today a throw in any `checkX` kills the whole command.

What the registry buys, concretely: stable ordering that tests can assert;
`--only <id,...>` and `--category <name>` as filters over data instead of new
code paths; each `run` testable in isolation with an injected context (the
pattern SetupDoctor's `Runtime` struct of function fields exists for); and a
place to hang the two dependencies that already exist implicitly —
`commit-msg-hook → hook-runtime` (today a parameter:
`checkHook(opts, hookRuntime)`) and `inject-version → inject-runtime` (today
a comment: "`checkInjectRuntime` owns 'the hook does not run at all'. Saying
it twice would be noise"). Only demonstrated dependencies are declared;
speculative edges are how a fix plan hides a real failure.

### 5. Root-cause collapse: `blocked_by` annotates, never suppresses

When a check's declared dependency is not `ok`, the check carries
`blockedBy: <the earliest non-ok ancestor's id>` and reports `skipped` if it
could not meaningfully probe, or its natural status if it could. Three
invariants bound what collapse may do:

1. Every applicable registered check appears in `checks[]` exactly once —
   `blocked_by` never removes a row or its evidence.
2. `blockedBy` never points at an `ok` check, and chains resolve to the root
   (if A blocks B blocks C, C carries A).
3. A check that fails *for its own reason* keeps `blockedBy` unset even when
   a dependency also failed. Collapse is for failures the root cause
   explains; attributing an independent defect to the root cause is exactly
   the hiding this section's invariants exist to prevent.

The fix plan (§7 of the PRD) is where collapse pays: blocked entries are
filtered out, so one dead hook runtime is one instruction, not four warnings.

### 6. The report is versioned, and the version contract is additive-only

`--json` gains an envelope: `schema: "commitlore_doctor.v2"`, `version` (the
CLI version), `status: "ok" | "degraded" | "failed"`, `installSource`,
`headline`, `summary`, `fixPlan`, and the existing `checks` and `exitCode`.
The current unversioned `{ checks, exitCode }` shape is retroactively v1, and
v2 is a strict superset of it: every v1 key keeps its exact name, type, and
meaning, including the camelCase `needsAttention` and `exitCode`.

The compatibility contract, taken directly from what SetupDoctor wrote down
and we verified (SetupDoctor.swift:88-98): new fields may be added without a
version bump; optional fields are **omitted when absent, never null** (the
JavaScript analogue of `encodeIfPresent`), so an old consumer never meets a
key it must learn to ignore as null; a field is never removed or repurposed —
that requires a new schema id and a superseding ADR. A consumer that pins
`commitlore_doctor.v2` and reads only the keys it knows is safe forever.

Overall `status` derives from non-optional checks only: any `fail` → `failed`;
else any `warn` or non-optional `skipped` → `degraded`; else `ok`. `degraded`
is the state #458 needed a word for — usable, but something this repository
relies on has stopped or cannot be verified — and both references treat it as
a first-class state (SetupDoctor's `ReportStatus.degraded`; OpenClaw's
`doctor-degraded-*` artefacts).

### 7. Exit codes: `0` and `1`, exactly as SPEC §10 assigns them

Doctor keeps two codes: `0` — ran, no non-optional check failed; `1` — ran,
at least one non-optional check failed. `1` is a finding, which is precisely
SPEC §10's meaning for it. `degraded` (warns, skips) stays exit `0` and lives
in the `status` field.

SetupDoctor maps its four report statuses onto 0/1/2/3
(`strictExitCode`, SetupDoctor+Rendering.swift:181). That mapping is not
carried over, for a reason SPEC §10 states outright: a code "must mean the
same thing regardless of which command produced it", `2` means *could not
run*, and `3` means *the command itself could not see everything*. A degraded
repository is not doctor failing to run, and doctor reporting a shallow clone
is doctor seeing fine — the incompleteness belongs to the repository, not to
doctor's own vision. Mapping `degraded → 3` would give `3` a meaning no other
command gives it, which §10 forbids. `2` remains what commander already emits
for usage errors (an unknown flag, an unknown `--only` id).

Two existing contracts also depend on warn-exits-zero and would break:
`docs/RELEASE-GATE.md` §4 requires `dist/commitlore.mjs doctor` on a fresh
clone to exit 0 with no `fail` (a fresh clone legitimately warns), and `init`
runs `doctor --fix` on its success path. Hooks are fail-open (ADR-0021 §5);
nothing doctor reports may ever block a commit, and nothing in this decision
touches a hook path.

### 8. What doctor must never do

1. **No network, ever.** Not opt-in, not with a flag. SetupDoctor made its
   update lookup opt-in and its default airtight ("nil ⇒ the opt-in update
   check is not emitted and no network is touched",
   SetupDoctor.swift:302-303); we go further and do not ship the lookup.
   Version skew is already checked against *local* executables
   (inject-version), and the #433 class of staleness (a plugin pinned three
   releases behind) is a distribution defect whose fix lives in distribution
   — `installSource` exists so the report can name which channel to update,
   not so doctor can go ask the internet.
2. **No writes without `--fix`**, and `--fix` applies only reversible local
   configuration (today: the notes fetch refspec), reporting each change in
   the check row it fixed (`fixed: true`). This is current behaviour,
   promoted to an invariant.
3. **No claim without evidence.** A check may not report `ok` about a
   subsystem it did not observe; absence of signal is `skipped` with a typed
   reason, never `ok`. Every non-ok check carries the evidence that produced
   its status. This is the #458 rule, and it is owned by the registry runner
   the way SetupDoctor owns its honesty clamp in one tested function — not
   left emergent on each check happening to behave.
4. **A partial run never masquerades as a full one.** Under `--only` or
   `--category` the report carries the selection, and its `status` speaks
   only for the selected checks.

### 9. Migration: the existing checks keep working, verbatim

The 12 checks on `origin/dev` (13 with #458's `pending-backlog`) keep their
ids, titles, statuses, and detail strings byte-for-byte. Each `const checkX`
body becomes the `run` of a registry entry; the `hookRuntime` parameter
threading becomes the declared `commit-msg-hook → hook-runtime` dependency
with identical observable behaviour; the six skip-detail strings map onto the
§2 reasons without changing the text a human reads. Existing doctor tests
pass unchanged, and a new test asserts the v1 → v2 superset property
directly: every key of the old JSON shape is present with the same value in
the new one. The exact sequencing is in `docs/DOCTOR-PRD.md` §9.

## Rejected

- **`manual` status and `manual_action_required` report state** | no
  CommitLore check has a remediation outside a command; a status nothing
  emits is dead contract surface. Additive to add later if one appears
- **SetupDoctor's `strictExitCode` 0/1/2/3 mapping** | collides with SPEC
  §10's fixed protocol-wide meanings for 2 and 3; breaks RELEASE-GATE §4 and
  `init`'s doctor invocation. The distinction it encodes lives in the
  `status` field instead
- **Independent severity axis (severity declared per check, not derived)** |
  two axes that can disagree ("a `fail` marked `info`") make every consumer
  resolve the disagreement; deriving at one chokepoint makes inconsistency
  unrepresentable. SetupDoctor reached the same conclusion
- **SetupDoctor's capability/operation-readiness matrix** (`capabilities`,
  `OperationReadinessRow`) | it exists because logic-pro-mcp routes
  operations across channels with per-operation planners; CommitLore has no
  operation router, and the category roll-up already answers "which subsystem
  is broken". Carrying it would be structure without a consumer
- **Profiles (`--profile`, per-surface check sets)** | both references have
  them (SetupDoctor's `DoctorProfile`; OpenClaw's `ent`/`cli`/`degraded`
  filenames), but a profile that omits checks reproduces the #458 shape — the
  screen that lied by not looking. CommitLore has one install shape per
  repository and no check yet measured expensive enough to need exclusion;
  not-applicable is expressed per check via typed skip, and `--only`/
  `--category` cover the debugging and CI subset uses. Revisit only with a
  measurement showing the full set is too slow for a surface
- **Collapsing evidence stdout/stderr to `present`/`empty`**
  (SetupDoctor.swift:497-515) | SetupDoctor sanitises because its evidence
  can carry TCC paths and tokens; CommitLore's checks diagnose *from* stderr
  first lines (`hook-runtime`, `inject-runtime`) and have no secret-bearing
  streams. Evidence keeps bounded excerpts (first line, capped length)
  because removing them would delete the diagnosis
- **snake_case keys for the new JSON fields** | the surface being extended
  already speaks camelCase (`needsAttention`, `exitCode`); a consumer parses
  one report, not our style preference, and a mixed-case document is worse
  than a consistently legacy-cased one
- **A network update check, even opt-in** | see §8.1
- **Patching #458 inside the current structure and stopping** | the pending-
  backlog check ships regardless (it is in flight on `doctor-pending-backlog`
  now), but a 13th ad-hoc function in a 1,159-line file leaves the next #458
  as likely as this one was

## Consequences

- `src/commands/doctor.ts` splits into a registry, a runner, per-check
  modules, and a renderer; the PRD fixes the layout. The command's observable
  text output for existing checks does not change.
- `--json` becomes a documented, versioned contract; `docs/cli.md` documents
  the envelope and the additive rule, and the release gate can script against
  `status` instead of grepping.
- `pending ls`-shaped knowledge now has a place doctor can carry it to — the
  #458 check is the first registry entry in the `capture` category with a
  dependency-free root position.
- The report grows fields (`durationMs`, `evidence`) that make doctor's own
  performance and claims measurable. The current per-check wall time is
  unmeasured; per-check timing is how the PRD's budget stops being an
  assertion (the same move as commit 1f8b4be made for the 100k-commit
  criterion).
- No new runtime dependency. Node 22+ (ADR-0010), TypeScript strict, and the
  existing zero-native-dependency posture (ADR-0012) are unchanged.

## Falsification

This ADR's model is falsified — and must be revised — if any of the following
is demonstrated:

1. A repository state in which a subsystem doctor reports on has verifiably
   stopped working while the report's overall `status` is `ok` (the #458
   invariant, restated as a property).
2. A `blocked_by` annotation that suppresses evidence of an independent
   failure — a check failing for its own reason rendered invisible in both
   `checks[]` and `fixPlan` because an unrelated dependency also failed.
3. A published v2 report that a correct v1 consumer (`report.checks.some(c =>
   c.status === 'fail')`, `report.exitCode`) mis-reads — any removed key,
   renamed key, or null-instead-of-omitted optional.
4. A doctor run that exits `2` or `3` for a repository finding, or exits
   non-zero for a `degraded` report — either would give a SPEC §10 code a
   doctor-private meaning.
5. A check crash that terminates doctor instead of producing a `fail` row.
6. The full check set measured slow enough on a real repository that users
   skip running doctor — which would reopen the profiles rejection with the
   measurement the rejection asked for.
