# ADR-0032: doctor's diagnostic model — typed checks, root-cause collapse, and an additive report schema

- Status: Proposed (2026-08-08)
- Issue: [#458](https://github.com/MongLong0214/commitlore/issues/458)
- Related: [#402](https://github.com/MongLong0214/commitlore/issues/402),
  [#400](https://github.com/MongLong0214/commitlore/issues/400) (the same
  failure category, collected in `docs/SELF-AUDIT.md` §4 as "The first screen
  lied"); ADR-0021 (the pending transaction whose silent expiry doctor failed
  to see); SPEC §10 (exit codes); `docs/DOCTOR-PRD.md` (the requirements this
  decision authorises)

## What the adversarial review changed

The first revision of this ADR and its PRD went through an adversarial review
that returned three blocking findings, seven major, three minor. The review
was right on every point we could verify against source, and two of its
findings were not refinements but reversals of claims this document stated as
fact. A silent fix would be the same failure this ADR exists to prevent, so
the corrections are listed here:

1. **`status: "ok"` was unreachable.** The first revision derived `degraded`
   from *any* non-optional skip. `squash-conservation`, `inject-runtime`, and
   `inject-version` skip routinely on ordinary healthy repositories, so the
   healthy default was permanent `degraded` — the #458 first-screen lie with
   its polarity flipped. Replaced by skip classes (§2): only a
   could-not-verify skip degrades; an observed true empty does not.
2. **The central invariant had three demonstrated holes.** A repaired-but-
   unfetched notes mirror could still aggregate `ok` (nothing consulted the
   remote's advertisement); a repository that never produced a record could
   aggregate `ok`; and `ok` with empty evidence typechecked. Closed by the
   `notes-availability` and `capture-liveness` checks (PRD §2.2) and by
   requiring evidence on every row, `ok` included (§8.3). One adjacent case
   is deliberately left open and named, with the reason (PRD §2.2).
3. **"No network. No socket, ever" was false as written.** The shipping
   command already probes remotes: `git fetch --dry-run`
   (`src/commands/doctor.ts:196`) and `git ls-remote` (`doctor.ts:248`). The
   ban is rescoped honestly in §8.1: doctor's own process opens no socket;
   git transport probes are existing, bounded, and degrade to `warn` offline.
4. **The exit-code reasoning was wrong, not merely overstated.** The first
   revision claimed SPEC §10 *forbids* doctor from exiting `3`. False: an
   unfetched notes mirror and shallow history are code `3`'s own named
   examples (`spec/SPEC.md:274`), and RELEASE-GATE §1 already requires
   `guard` to exit `3` on an unfetched mirror. It also claimed `init` depends
   on doctor's exit code; `init` branches on `needsAttention`
   (`src/commands/init.ts:104`) and ignores the exit code. §7 restates the
   decision on its true grounds — RELEASE-GATE §4 compatibility and SPEC's
   "a command need not use every code" — and leaves a narrow vision-gap `3`
   open instead of pretending SPEC closed it.
5. **The check-order table contradicted the migration.** It reordered checks
   relative to `runDoctor` while Step 1 promised byte-identical text.
   Registry order is now frozen to the shipping array order (§4, PRD §2.1).
6. **`blocked_by` had no algorithm**, and this ADR misattributed
   SetupDoctor's design: collapse there is construction-time, via a
   `blockingCause` helper each check calls (`SetupDoctor.swift:634`) — the
   runner does not stamp it. §5 now specifies one mechanical design: a
   factory constructor is `blockedBy`'s only producer, and the runner only
   normalises chains and asserts invariants.
7. **Provenance errors.** The severity quote sits at `SetupDoctor.swift:63-64`,
   not `:548` (that line is `severity(for:)`, a different comment); the scale
   is 3,754 lines across 21 `SetupDoctor*.swift` files (3,784 across 22 only
   if `DoctorTool.swift` is counted in); the #457 comment cited for `manual`
   is about check ordering, not the status's definition; several skip strings
   were quoted inexactly; and the "six skip sites" are ten return sites
   carrying six reasons. All corrected in place, against re-verified line
   numbers.
8. **Cut on review:** the `severity` field (a total function of `status` is a
   second spelling of `status`; nothing consumed it) and the dedicated
   install-source check (the entry path now rides `cli-runtime`'s evidence).
   `summary.durationMs` was two quantities under one name; it is now defined
   as wall time, with the per-check sum bounded by it (PRD §10.2).
9. **Kept against the review's advice, with reasons stated:** `--only` /
   `--category` (filters over registry data that the partial-honesty rule
   needs defined the moment they exist — PRD §5.5); the OpenClaw reference
   (it already claims filenames and nothing else).

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

A local checkout of logic-pro-mcp
(`Sources/LogicProMCP/Utilities/`) carries a doctor grown to 3,754 lines
across 21 `SetupDoctor*.swift` files (3,784 across 22 counting the
`DoctorTool.swift` entry point). The files read for this ADR:
`SetupDoctor.swift`, `SetupDoctor+CheckRegistry.swift`,
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
  `blocked_by: <root cause id>`, set at construction — each dependent check
  consults the shared `blockingCause(for:checks:)` helper
  (`SetupDoctor.swift:634`), which walks the declared dependency table and
  returns the first non-pass dependency; the runner does not stamp it.
  `computeFixPlan` (`SetupDoctor.swift:599`) filters blocked checks out and
  sorts the remainder fail-first, so the fix plan names causes, not symptoms.
- Additive-only schema versioning. The comments are explicit: `blockedBy` is
  `String?` "so the synthesized Codable emits `encodeIfPresent` — the
  `blocked_by` key is OMITTED when nil, keeping v3 a strict superset a v1/v2
  decoder never trips over" (`SetupDoctor.swift:88-91`), and CodingKeys
  "enumerate EVERY key — the six v1 keys keep their exact wire names so a v2
  payload stays a strict field-superset of v1" (`SetupDoctor.swift:96-98`).
- An honesty chokepoint: `clampStatusForPermissions`
  (`SetupDoctor+Rendering.swift:207`) makes it structurally impossible for the
  report to say `ok` while a required permission is ungranted — the invariant
  is owned by one tested function, not left emergent on each check.

### Reference 2: OpenClaw (not inspectable)

OpenClaw's doctor implementation is not on this machine. What exists is output
artefacts under `~/.openclaw/tmp/`: files named `doctor-ent-*`
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

SetupDoctor's fifth status, `manual` (`SetupDoctor.swift:9`), names an
operator attestation for setup steps the tool can neither perform nor verify.
The #457 comment in `SetupDoctor+CheckRegistry.swift:118-126` — which is
about ordering the attestation check after the staging it attests, not about
the status's definition — shows the surface class: manual MIDI Learn "that no
file presence can prove". CommitLore has no such surface: every remediation
this doctor can name is a command. A status no check can emit is a report
state every consumer must handle and none can ever observe. If a genuinely
unverifiable manual step ever appears, adding the status then is additive
under §6.

### 2. A skip carries a typed reason, and every reason carries a class

`skipReason` becomes a closed union alongside the human `detail`. Each member
is classified, in its declaration, as one of two classes:

- **`not_applicable`** — the check looked and observed a true empty: the
  world contains nothing for this check to inspect, and that observation is
  in evidence. Does **not** degrade the overall status.
- **`unverified`** — something exists that the check could not read. Degrades
  the overall status (§6), because "could not verify" is precisely what
  `degraded` exists to say.

The initial values are exactly the reasons the current checks already emit as
prose — ten return sites carrying six reasons (the first revision said "six
sites" and quoted several strings inexactly; both were review findings). Line
numbers are the `origin/dev` file:

| Reason | Class | Sites (exact `detail` on `origin/dev`) |
|---|---|---|
| `command_unrecognized` | `unverified` | inject-runtime `:608` ("not checked: configured command `<cmd>` is not recognised; running it might have side effects"), `:621` and inject-version `:703` ("not checked: the configured command is not recognised") |
| `hook_not_installed` | `not_applicable` | inject-version `:699` ("no installed hook to compare against `<version>`") |
| `probe_path_unavailable` | `not_applicable` | inject-runtime `:628` ("no recorded path is available for a runtime probe") |
| `version_unreadable` | `unverified` | inject-version `:721` ("`<executable>` did not report a version"), `:733` ("`<executable>` answered --version with something that is not a version") |
| `unborn_head` | `not_applicable` | squash-conservation `:934` ("no HEAD yet — nothing to compare against") |
| `nothing_applicable` | `not_applicable` | squash-conservation `:942` ("no local branch looks like the source of a squash — nothing to check"), `:992` ("`<n>` branch(es) looked like a squash source, but recorded nothing checkable") |

SetupDoctor's enum has 18 values because its check set earned them one at a
time; ours starts with the six we can point at and grows the same way. The
rule: a check may not report `skipped` without a reason from the union, and a
reason cannot be declared without a class — the type system enforces both.

### 3. Each check declares one of six categories

`runtime` (cli-runtime, git-trailers), `transport` (notes-refspec,
notes-push, notes-availability), `capture` (commit-msg-hook, hook-runtime,
pending-backlog, capture-liveness), `delivery` (inject-runtime,
inject-version, mcp-lifecycle), `history` (history-depth,
squash-conservation), `index` (index-health). Every category is non-empty and
answers the question a category exists to answer: which subsystem is broken,
and what can `--category` select.

The first revision also carried a `severity` field (`error | warning | info`,
derived totally from `status`). The review cut it: a field that is a total
function of another field is a second spelling of the same fact, and nothing
here consumed it — the fix plan orders by `status` directly (§7 of the PRD).
SetupDoctor carries one ("Display-grade severity derived from `CheckStatus`
… never drives the exit code", `SetupDoctor.swift:63-64` — the first revision
mis-cited this to `:548`, which is the `severity(for:)` mapping function)
because its renderer consumes it; ours had no consumer. If a multi-axis need
ever appears, adding a field is additive under §6.

### 4. Checks are registry entries, and dependencies are declared data

The hand-written array in `runDoctor` becomes a registry: an ordered array of
definitions `{ id, title, category, dependencies, optional, run }`. The
registry array order is the presentation order for text and JSON, and it is
frozen to `runDoctor`'s shipping array order (`src/commands/doctor.ts:1021-1036`)
— which presents `commit-msg-hook` before its dependency `hook-runtime`, so a
dependency edge may point forward in the array. The graph must be acyclic
(enforced by the registry-shape test); the runner completes dependencies
before dependents while emitting rows in registry order. The runner times
each check with a monotonic clock (`process.hrtime.bigint()`, whole
milliseconds, so a duration can never go negative across a clock step — the
same choice as SetupDoctor's `monotonicNowMs`), stamps `durationMs`, and
catches a thrown check into a `fail` row carrying the error as evidence.
Doctor must never die of its own check; today a throw in any `checkX` kills
the whole command.

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

### 5. Root-cause collapse: `blocked_by` annotates, never suppresses — and has one producer

The first revision described collapse in prose loose enough that two
implementers could satisfy it incompatibly (a review finding), and it
attributed the collapse to the runner — which is also not how SetupDoctor
works (its checks call `blockingCause` at construction,
`SetupDoctor.swift:634`). The specified design, normative in PRD §3:

1. The runner completes declared dependencies first and passes their finished
   rows into the dependent's `run`.
2. `blockedBy` has exactly one producer: the check factory's `blocked(dep, …)`
   constructor, which requires `dep` to be a declared dependency whose row is
   non-`ok`, and yields either a row whose status and detail derive from the
   dependency's row (the `commit-msg-hook` shape today,
   `doctor.ts:336-343`) or a `skipped` row with a typed reason (the
   `inject-version` shape today). A row built any other way has `blockedBy`
   unset, and the runner never adds it — so an independent defect can only be
   reported unblocked.
3. After the run, the runner normalises chains to the root (if A blocks B
   blocks C, C carries A) and asserts the invariants: `blockedBy` names a
   declared dependency; the target row is non-`ok`; a blocked row's status
   never exceeds its root's.
4. Every applicable registered check appears in `checks[]` exactly once —
   `blocked_by` never removes a row or its evidence. Only the fix plan and
   the overall-status derivation exclude blocked rows, because their root
   already represents them.

The fix plan (§7 of the PRD) is where collapse pays: blocked entries are
filtered out, so one dead hook runtime is one instruction, not four warnings.
The collapse fixtures in PRD §11 are the definition of this behaviour; where
prose and fixture disagree, the fixture wins.

### 6. The report is versioned, and the version contract is additive-only

`--json` gains an envelope: `schema: "commitlore_doctor.v2"`, `version` (the
CLI version), `status: "ok" | "degraded" | "failed"`, `installSource`,
`headline`, `summary`, `fixPlan`, and the existing `checks` and `exitCode`.
The current unversioned `{ checks, exitCode }` shape is retroactively v1, and
v2 is a strict superset of it: every v1 key keeps its exact name, type, and
meaning, including the camelCase `needsAttention` and `exitCode`.

The compatibility contract, taken directly from what SetupDoctor wrote down
and we verified (`SetupDoctor.swift:88-98`): new fields may be added without a
version bump; optional fields are **omitted when absent, never null** (the
JavaScript analogue of `encodeIfPresent`), so an old consumer never meets a
key it must learn to ignore as null; a field is never removed or repurposed —
that requires a new schema id and a superseding ADR. A consumer that pins
`commitlore_doctor.v2` and reads only the keys it knows is safe forever.

Overall `status` derives from non-optional rows whose `blockedBy` is unset:
any `fail` → `failed`; else any `warn`, or any `skipped` whose reason class
is `unverified` → `degraded`; else `ok`. The classes exist because the first
revision's rule — any non-optional skip degrades — made `ok` unreachable:
`squash-conservation` skips on every repository with no squash-shaped branch
(`doctor.ts:942`), `inject-runtime` on any repository with no recorded path
to probe (`doctor.ts:628`). Permanent `degraded` on a healthy repository is
the #458 lie with its polarity flipped, which is exactly what the adversarial
review caught. `degraded` is the state #458 needed a word for — usable, but
something this repository relies on has stopped or cannot be verified — and
both references treat it as a first-class state (SetupDoctor's
`ReportStatus.degraded`; OpenClaw's `doctor-degraded-*` artefacts).

### 7. Exit codes: `0` and `1`, with the earlier SPEC reasoning corrected

Doctor keeps two codes: `0` — ran, no non-optional check failed; `1` — ran,
at least one non-optional check failed. `1` is a finding, which is precisely
SPEC §10's meaning for it. `degraded` (warns, unverified skips) stays exit
`0` and lives in the `status` field.

The first revision justified this by claiming SPEC §10 *forbids* doctor from
exiting `3` for a degraded repository. **That was wrong**, and it is
corrected here rather than softened: SPEC §10 defines `3` as "Ran and
answered, but could not see everything — an unfetched notes mirror, shallow
history" (`spec/SPEC.md:274`). Those are `3`'s own named examples — the
shared protocol meaning, not a doctor-private one — and RELEASE-GATE §1
already requires `guard` to exit `3` on an unfetched mirror. What SPEC
actually forbids is a command-private meaning, and what it actually permits
is the licence doctor relies on: "A command need not use every code"
(`spec/SPEC.md:276`).

The decision therefore stands on its true grounds:

1. **Warn keeps exiting `0` for RELEASE-GATE §4 compatibility.** The gate
   requires `dist/commitlore.mjs doctor` on a fresh clone to exit 0 with no
   `fail`, and a fresh clone legitimately warns. This is compatibility debt,
   not protocol purity: a consumer that branches only on the exit code stays
   green while `status` says `degraded`, and a consumer that cares must read
   `status`. The documents say so plainly instead of dressing it as a SPEC
   theorem.
2. **A blanket `degraded → 3` would still be wrong** — a "no remote
   configured" warn is not a vision gap, and stretching `3` over it would be
   the private meaning SPEC forbids.
3. **Exit `3` for the vision-gap rows specifically** — `history-depth`'s
   shallow-clone warn (`doctor.ts:837-845`) and `notes-availability`'s
   unfetched-mirror warn — **remains open, and is arguably better aligned**
   with SPEC and with `guard`/`stale`. It is deferred, not rejected: the
   RELEASE-GATE §4 fresh-clone row (where notes are legitimately unfetched)
   would have to move in the same change, and that is a gate decision, not a
   doctor-local one.

The first revision also claimed `init`'s `doctor --fix` step depends on
warn-exits-zero. It does not: `init` branches on
`report.checks.some((entry) => entry.needsAttention)`
(`src/commands/init.ts:104`) and ignores the exit code entirely. The claim is
deleted. `2` remains what commander already emits for usage errors (an
unknown flag, an unknown `--only` id). Hooks are fail-open (ADR-0021 §5);
nothing doctor reports may ever block a commit, and nothing in this decision
touches a hook path.

### 8. What doctor must never do

1. **No non-git network.** The first revision said "No network, ever." That
   was false against the shipping command — the transport checks already
   probe remotes with `git fetch --dry-run` (`doctor.ts:196`) and
   `git ls-remote` (`doctor.ts:248`) — and the review caught it, so the ban
   is rescoped rather than quietly narrowed. The rule: doctor's own process
   opens no socket — no HTTP client, no update lookup (SetupDoctor made its
   update check opt-in, "nil ⇒ the opt-in update check is not emitted and no
   network is touched", `SetupDoctor.swift:302-303`; we do not ship the
   lookup at all), no telemetry, on any flag. Network I/O happens only inside
   spawned `git` transport commands against the repository's configured
   remotes, only in `transport`-category checks, and an unreachable remote
   degrades those rows to `warn` "could not verify" — never a `fail`, never a
   crash, never a hang without git's own timeout semantics. Version skew is
   checked against *local* executables (inject-version), and the #433 class
   of staleness is a distribution defect whose fix lives in distribution —
   `installSource` exists so the report can name which channel to update, not
   so doctor can go ask the internet.
2. **No writes without `--fix`**, and `--fix` applies only reversible local
   configuration (today: the notes fetch refspec), reporting each change in
   the check row it fixed (`fixed: true`). This is current behaviour,
   promoted to an invariant.
3. **No claim without evidence — on any status.** Every row records the
   observation that produced it: `ok` carries what was observed, not just
   asserted (the first revision required evidence only for non-ok rows,
   which let an implementer emit `ok` with empty evidence and typecheck — a
   review finding); absence of signal is `skipped` with a typed reason,
   never `ok`. This is the #458 rule, owned by the factory and the runner
   the way SetupDoctor owns its honesty clamp in one tested function
   (`clampStatusForPermissions`) — not left emergent on each check happening
   to behave.
4. **A partial run never masquerades as a full one.** Under `--only` or
   `--category` the report carries the selection, and its `status` speaks
   only for the selected checks.

### 9. Migration: the existing checks keep working, verbatim

The 12 checks on `origin/dev` (13 with #458's `pending-backlog`) keep their
ids, titles, statuses, and detail strings byte-for-byte, in their current
output order — the registry freezes `runDoctor`'s array order, it does not
reorder it. Each `const checkX` body becomes the `run` of a registry entry;
the `hookRuntime` parameter threading becomes the declared
`commit-msg-hook → hook-runtime` dependency built through the blocked
constructor, which reproduces today's copied status and detail exactly
(`doctor.ts:336-343`) — the only observable change is the additive
`blockedBy` key and the fix-plan membership. The ten skip return sites map
onto the §2 reasons without changing the text a human reads. Existing doctor
tests pass unchanged, and a new test asserts the v1 → v2 superset property
directly: every key of the old JSON shape is present with the same value in
the new one. The two checks this decision adds beyond `pending-backlog` —
`notes-availability` and `capture-liveness` (PRD §2.2) — are behaviour
changes by design and land after the mechanical steps. The exact sequencing
is in `docs/DOCTOR-PRD.md` §9.

## Rejected

- **`manual` status and `manual_action_required` report state** | no
  CommitLore check has a remediation outside a command; a status nothing
  emits is dead contract surface. Additive to add later if one appears
- **SetupDoctor's `strictExitCode` 0/1/2/3 mapping, wholesale** | a blanket
  `degraded → 3` gives `3` to warns that are not vision gaps — the private
  meaning SPEC §10 forbids — and any non-zero on warns breaks RELEASE-GATE
  §4. A narrow `3` for vision-gap rows only is *not* rejected; it is open
  (§7.3). The first revision's grounds for this rejection ("SPEC forbids
  doctor exiting 3"; "breaks `init`") were wrong and are corrected in §7
- **A `severity` field, derived or declared** | the first revision kept a
  derived field and rejected only an independently-declared axis; the review
  cut the field itself. A total function of `status` on the wire is a second
  spelling of `status`, and no CommitLore consumer reads it — the fix plan
  orders by `status`. SetupDoctor's field has a consumer (its renderer);
  ours would not
- **A dedicated install-source check** | it was either a fourteenth check
  (a behaviour change the migration would have to sequence) or buried
  evidence. The envelope keeps the `installSource` field (#433 justifies
  naming the channel), and the resolved entry path rides `cli-runtime`'s
  evidence as `entry_path` — inspectable without a new row
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
  `--category` cover the debugging and CI subset uses. The review suggested
  deferring `--only`/`--category` as well; they stay, because they are
  filters over registry data — not new code paths — and the partial-honesty
  rule (§8.4) must be defined the moment any filter exists. Revisit profiles
  only with a measurement showing the full set is too slow for a surface
- **Collapsing evidence stdout/stderr to `present`/`empty`**
  (`SetupDoctor.swift:497-515`) | SetupDoctor sanitises because its evidence
  can carry TCC paths and tokens; CommitLore's checks diagnose *from* stderr
  first lines (`hook-runtime`, `inject-runtime`) and have no secret-bearing
  streams. Evidence keeps bounded excerpts (first line, capped length)
  because removing them would delete the diagnosis
- **snake_case keys for the new JSON fields** | the surface being extended
  already speaks camelCase (`needsAttention`, `exitCode`); a consumer parses
  one report, not our style preference, and a mixed-case document is worse
  than a consistently legacy-cased one
- **A network update check, even opt-in** | see §8.1
- **A capture-recency heuristic** (flagging a repository whose records
  stopped recently while pending is clean) | SPEC line 155 makes a record
  per commit optional, so recent recordless commits are not evidence of
  breakage, and a ratio-or-recency guess would be the heuristic class SPEC
  §2.1 B3 already taught this project to refuse. The gap this leaves is
  named, not hidden: PRD §2.2
- **Patching #458 inside the current structure and stopping** | the pending-
  backlog check ships regardless (it is in flight on `doctor-pending-backlog`
  now), but a 13th ad-hoc function in a 1,159-line file leaves the next #458
  as likely as this one was

## Consequences

- `src/commands/doctor.ts` splits into a registry, a runner, per-check
  modules, and a renderer; the PRD fixes the layout and marks the split as
  cleanup that may trail the honesty fixes. The command's observable text
  output for existing checks does not change.
- `--json` becomes a documented, versioned contract; `docs/cli.md` documents
  the envelope and the additive rule, and the release gate can script against
  `status` instead of grepping.
- `pending ls`-shaped knowledge now has a place doctor can carry it to — the
  #458 check is the first registry entry in the `capture` category with a
  dependency-free root position.
- Two checks are added beyond #458's: `notes-availability` (the mirror-content
  gap that let "refspec fixed, nothing fetched" aggregate `ok` — the #402
  shape) and `capture-liveness` (the never-produced-a-record gap — #458's
  literal shape). Both are specified with mechanical predicates in PRD §2.2.
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
   invariant, restated as a property). One case is already named as open
   rather than closed — capture that produced records before, stopped, with
   a clean pending directory (PRD §2.2) — because no mechanical local
   predicate for it exists; producing such a predicate converts that case
   into this clause.
2. A `blocked_by` annotation that suppresses evidence of an independent
   failure — a check failing for its own reason rendered invisible in both
   `checks[]` and `fixPlan` because an unrelated dependency also failed.
3. A published v2 report that a correct v1 consumer (`report.checks.some(c =>
   c.status === 'fail')`, `report.exitCode`) mis-reads — any removed key,
   renamed key, or null-instead-of-omitted optional.
4. A doctor run that exits `2` for anything other than failure to run, or
   exits `1` on a report with no non-optional `fail` (which would break
   RELEASE-GATE §4). Adopting exit `3` for vision-gap rows falsifies nothing
   here — §7.3 leaves it open — provided RELEASE-GATE §4 moves in the same
   change.
5. A check crash that terminates doctor instead of producing a `fail` row.
6. A healthy repository — records present, hook current, mirror fetched —
   whose overall `status` is not `ok` (the polarity the adversarial review
   caught; PRD §11 pins it as a fixture).
7. The full check set measured slow enough on a real repository that users
   skip running doctor — which would reopen the profiles rejection with the
   measurement the rejection asked for.
