# PRD — `commitlore doctor`: the diagnostic rebuild

- ADR: [ADR-0032](adr/ADR-0032-doctor-diagnostic-model.md) (the decisions;
  this document is the requirements). Both documents were revised after an
  adversarial review; what was wrong and what replaced it is listed in the
  ADR's "What the adversarial review changed" section.
- Issue: [#458](https://github.com/MongLong0214/commitlore/issues/458) ·
  Category: `docs/SELF-AUDIT.md` §4, "The first screen lied"
- References: logic-pro-mcp SetupDoctor (inspected — file paths in ADR-0032);
  OpenClaw doctor artefacts (filenames only — its implementation was not
  available for inspection, and nothing below depends on details of it)

## Goal

A user who runs `commitlore doctor` learns, in one screen, whether this
repository can carry and share records — and when it cannot, the first line
tells them the one thing to fix first. A CI job that runs `doctor --json`
gets a versioned document it can pin without fear of the next release.

The failure this rebuild exists to prevent is #458: a repository where
capture had silently stopped for eight days, and doctor reported every check
`ok`. The information existed in `commitlore pending ls`; the command people
actually run did not carry it. The rebuild makes that shape structurally
hard: a subsystem doctor reports on cannot be verifiably stopped while the
report says `ok`, and "we did not look" is a typed state, never a pass. The
inverse lie is banned with the same force: a healthy repository must be able
to reach `status: "ok"` — the first revision of this document failed that
(routine skips made `ok` unreachable) and §5.1 now pins both directions.

## Non-goals

- **Profiles** (`--profile`, per-surface check subsets). Rejected in
  ADR-0032 with the reopening condition: a measurement showing the full set
  is too slow for a surface.
- **A capability/operation-readiness matrix.** SetupDoctor needs one because
  it routes operations across channels; CommitLore has no operation router.
- **Any non-git network access** — no HTTP client, no update check even
  opt-in, no telemetry. The git transport probes doctor already performs are
  kept and scoped in §8.1; they are not a licence for anything else.
- **A `manual` check status.** No CommitLore remediation is outside a
  command.
- **A `severity` field.** Cut on review: derived totally from `status`, it
  was a second spelling of the same fact with no consumer (ADR-0032 §3).
- **Structured remediation objects.** `fix` stays `string | null`; every
  remediation this doctor names is a shell command, and SetupDoctor's
  `{type, value}` shape exists for System Settings deep links we do not have.
- **Changing any hook path.** Hooks are fail-open (ADR-0021 §5) and stay so.
- **A capture-recency heuristic.** See §2.2 — the one invariant hole this
  document leaves open, named, with the reason.
- **Watch mode, daemons, HTML output, trend history.**

## User stories

- As a user whose captures have silently stopped, I run `commitlore doctor`
  and the first line names the stopped subsystem and the command that shows
  me the stranded work — I do not need to know `pending ls` exists.
- As a user with a broken hook runtime, I see one instruction, not four
  warnings that all mean "your hook does not run".
- As a user on a healthy repository, I see `status: "ok"` — not a permanent
  `degraded` manufactured from checks that had nothing to inspect.
- As a CI author, I run `doctor --json`, pin `schema:
  "commitlore_doctor.v2"`, branch on `status` (the exit code alone cannot
  distinguish `ok` from `degraded` — §7), and never re-read the docs when
  CommitLore upgrades.
- As a contributor adding a check, I write one registry entry and one test
  against an injected context; I cannot forget a category, a skip reason, or
  an evidence field, because the types refuse.

## 1. The check model

Every check produces one row:

```ts
interface DoctorCheck {
  // v1 fields — names, types and meanings frozen (ADR-0032 §6)
  id: string;                    // stable, kebab-case, e.g. 'hook-runtime'
  title: string;
  status: 'ok' | 'warn' | 'fail' | 'skipped';
  needsAttention: boolean;
  detail: string;                // one human sentence; existing texts unchanged
  fix: string | null;            // the command that makes this check ok
  fixed: boolean;                // whether this run's --fix changed it
  // v2 additive fields
  category: 'runtime' | 'transport' | 'capture' | 'delivery' | 'history' | 'index';
  evidence: Record<string, string>;          // §1.3 — non-empty on EVERY status
  durationMs: number;                        // monotonic clock, whole ms
  blockedBy?: string;            // §3 — omitted, never null, when unset
  skipReason?: SkipReason;       // §1.2 — present iff status === 'skipped'
  optional: boolean;             // §1.4
}
```

Requirements:

1. `status` values and meanings are unchanged from the shipping type
   (`src/commands/doctor.ts:62-67`): `fail` — the tool cannot work correctly
   here; `warn` — incomplete but nothing answers wrongly locally; `skipped` —
   nothing to inspect, which is not a pass.
2. Every check is built through one factory. A row constructed outside it —
   a skip without a reason, empty evidence, a hand-set `blockedBy` — must
   not typecheck.
3. There is no `severity` field. The first revision derived one from
   `status`; the review cut it (see Non-goals). Ordering (§4.2) uses
   `status` directly.

### 1.2 Typed skip reasons, in two classes

`SkipReason` is a closed union, and every member declares a class at its
definition — a reason without a class does not typecheck:

- **`not_applicable`** — the check looked and observed a true empty; the
  observation is in evidence. Does not degrade the overall status (§5.1).
- **`unverified`** — something exists that the check could not read.
  Degrades the overall status: "could not verify" is what `degraded` means.

Initial values, each mapped to an existing skip site whose `detail` text
does not change. There are **ten** return sites carrying six reasons — the
first revision counted "six sites", a review finding (line numbers are
`src/commands/doctor.ts` on `origin/dev`):

| Reason | Class | Emitting sites |
|---|---|---|
| `command_unrecognized` | `unverified` | inject-runtime `:608`, `:621`; inject-version `:703` |
| `hook_not_installed` | `not_applicable` | inject-version `:699` |
| `probe_path_unavailable` | `not_applicable` | inject-runtime `:628` |
| `version_unreadable` | `unverified` | inject-version `:721`, `:733` |
| `unborn_head` | `not_applicable` | squash-conservation `:934` |
| `nothing_applicable` | `not_applicable` | squash-conservation `:942`, `:992` |

Two classification notes, because they carry the honesty argument: a skip
whose row carries `blockedBy` never degrades on its own — its root already
does (§3.5), which is why `version_unreadable` under a dead `inject-runtime`
does not double-count; and `command_unrecognized` is `unverified` because a
hook *is* configured and doctor declined to run it — that is a gap in what
was verified, not an empty world. (SetupDoctor's equivalent enum holds 18
values grown one check at a time; this table is expected to grow the same
way, per check, never speculatively.)

### 1.3 Evidence

`evidence` is a flat `Record<string, string>`: snake_case keys, string
values. Rules:

1. **Every row carries non-empty evidence, whatever its status.** A non-ok
   row records what produced the status (the exit code observed, the path
   probed, the count found); an `ok` row records the observation that
   licenses the claim; a `not_applicable` skip records the observed empty
   (`branches_seen: "0"`). The first revision required evidence only for
   non-ok rows, which let `ok` with `{}` evidence typecheck — the review's
   sharpest hole in the central invariant. The factory rejects an empty
   evidence object for any status, and a test asserts it over every fixture.
2. Process output appears as a bounded excerpt: first line, hard cap 200
   characters, plus `<stream>_truncated: "true"|"false"`. The excerpt stays
   because CommitLore's checks diagnose from stderr first lines
   (hook-runtime, inject-runtime); the bound exists so `--json` output size
   is independent of what a broken tool prints.
3. Evidence never contains an absolute `$HOME` prefix — paths are rendered
   home-relative (`~/...`), matching what the text output already avoids
   leaking into pasted bug reports.

### 1.4 Optionality

`optional: true` marks a check that informs but never gates: it is excluded
from the overall `status` derivation and from the exit code. No shipping
check is optional at introduction; the field exists so a future informational
check (and `--only` selections of it) does not force a semantics debate into
a patch. An optional check that should gate is a one-line change, visible in
review.

### 1.5 Per-check timing

`durationMs` is stamped by the runner from a monotonic clock
(`process.hrtime.bigint()`), rounded to whole milliseconds, never negative.
The current doctor's per-check wall time is **unmeasured**; this field is how
the budget in §10 becomes a measurement instead of an assertion.

## 2. The registry

Checks are declared as data, in one ordered array:

```ts
interface CheckDefinition {
  id: string;
  title: string;
  category: Category;
  dependencies: string[];        // ids of registry entries; acyclic
  optional: boolean;
  run: (ctx: DoctorContext, deps: Record<string, DoctorCheck>) => DoctorCheck;
}
```

Requirements:

1. The registry is the only source of check ordering, and its order is
   **frozen to `runDoctor`'s shipping array order**
   (`src/commands/doctor.ts:1021-1036`). Text output, JSON `checks[]`, and
   the fix plan all derive their order from it. The first revision's table
   reordered checks while §9 promised byte-identical output — both could not
   hold (a review finding); order now wins and the table below matches the
   code.
2. `dependencies` must form an acyclic graph over registry ids — cycles and
   unresolvable ids are a build-time error, tested by a registry-shape test
   (ids unique, dependencies resolvable, categories non-empty). Forward
   references are allowed, because the frozen presentation order puts
   `commit-msg-hook` before its dependency `hook-runtime`; the runner
   completes dependencies before dependents (§3.1) while emitting rows in
   registry order.
3. `run` receives an injected `DoctorContext` (cwd, git runner, spawn,
   clock, index opener) and the completed rows of its declared dependencies,
   so every check is unit-testable without a real repository where the probe
   allows it. This is SetupDoctor's `Runtime` struct-of-functions pattern,
   in plain TypeScript.
4. The runner wraps every `run` in a try/catch. A thrown check becomes a
   `fail` row for that id with the error message in evidence
   (`error: <first line>`). Doctor never terminates because one of its own
   checks threw; today it does.
5. `--only a,b` and `--category capture` filter the registry before the run.
   An unknown id or category is a usage error: exit `2`, nothing runs.

### 2.1 The shipping check set

The 12 checks on `origin/dev`, in their exact current output order,
unchanged in id, title, and detail text:

| id | category | dependencies |
|---|---|---|
| cli-runtime | runtime | — |
| notes-refspec | transport | — |
| notes-push | transport | — |
| commit-msg-hook | capture | hook-runtime |
| hook-runtime | capture | — |
| inject-runtime | delivery | — |
| inject-version | delivery | inject-runtime |
| mcp-lifecycle | delivery | — |
| git-trailers | runtime | — |
| history-depth | history | — |
| index-health | index | — |
| squash-conservation | history | — |

Plus three additions, appended (the migration freezes whatever `dev` order
exists when Step 1 lands; `pending-backlog`'s final position is set by its
own merge):

| id | category | dependencies |
|---|---|---|
| pending-backlog (#458, in flight) | capture | — |
| notes-availability (§2.2) | transport | notes-refspec |
| capture-liveness (§2.2) | capture | commit-msg-hook, hook-runtime |

The declared dependencies are the ones with a demonstrated collapse:
`commit-msg-hook` already consumes `hook-runtime`'s result as a parameter;
`inject-version` already defers to `inject-runtime` by comment ("Saying it
twice would be noise"); the §2.2 checks would each restate their listed
dependency's failure verbatim if it were broken. No other edge is declared —
a speculative edge is how a fix plan hides a real failure.

### 2.2 The two checks this PRD adds

The adversarial review demonstrated that without these, the specified design
still reports healthy on two broken repositories. Each is a mechanical
predicate, not an aspiration.

**`notes-availability`** (transport, depends on notes-refspec) — closes the
"repaired refspec, unfetched mirror" hole. Today `notes-refspec` reports `ok`
after `--fix` while nothing was fetched (its detail says so; its status does
not — `doctor.ts:211-225`), `notes-push` reports `ok` "no local mirror yet —
nothing to push" (`doctor.ts:239-246`), and nothing consults mirror content —
so a repository whose teammates' records sit unfetched upstream aggregates
`ok`. `notesAvailability()` (`src/core/notes.ts:287`) cannot power this
alone: it reads config only and deliberately reports `absent` for a
written-but-never-fetched refspec (its comment explains why). The missing
signal is the remote's advertisement, which doctor already holds from
`notes-push`'s `git ls-remote` probe (one probe per run, shared):

- local `refs/notes/commitlore` resolves → `ok` (evidence: `local_sha`).
- else, no remotes → `skipped` / `not_applicable` — "no remote, so there is
  nowhere for unseen records to be" (the same reasoning
  `notesAvailability()` documents for its `absent`).
- else, the `ls-remote` probe failed → `skipped` / `unverified` (degrades).
- else, the remote advertises the ref → **`warn`**: records exist upstream
  and have never been fetched here; fix: `git fetch <remote>
  '<notes refspec>'`. This fires after `doctor --fix` writes the refspec,
  so "fixed but unfetched" can never aggregate `ok` — the #402 shape,
  closed at the aggregate.
- else → `ok`: upstream advertises nothing; the empty mirror is a true empty
  (evidence: `remote_advertises: "false"`).
- `notes-refspec` non-ok → blocked skip (§3), `blockedBy: "notes-refspec"`.

**`capture-liveness`** (capture, depends on commit-msg-hook and
hook-runtime) — closes the "capture never worked and nothing was stranded"
hole. #458's literal shape was 815 commits, zero records, all checks green;
`pending-backlog` catches the stranded form, but an expired-and-cleaned
pending directory leaves nothing for it to see:

- either dependency non-ok → blocked skip (§3) — a dead hook explains zero
  records; saying it again would be the noise §3 exists to collapse.
- records exist (message trailers or notes, via the existing query path) or
  pending entries exist → `ok` (evidence: `records_seen`, `commits_seen`).
- zero records anywhere and HEAD has ≥ `MIN_COMMITS_FOR_LIVENESS` commits →
  **`warn`**: the capture chain is green yet no commit here has ever carried
  a record. `fix: null`; the detail says what clears it — the first captured
  commit — and names `commitlore pending ls` for the stranded case.
  `MIN_COMMITS_FOR_LIVENESS = 50`, a named constant: far below #458's 815,
  above a day-one repository, and changing it is a reviewed diff, not a
  buried literal. A long-lived repository that adopts CommitLore today will
  warn until its first capture; that is honest — capture is unverified
  end-to-end until one record flows — and the detail says so.
- zero records and fewer commits than the threshold → `skipped` /
  `not_applicable`: too little history to judge (evidence: `commits_seen`).

**The hole this document does not close, and why.** A repository that
produced records before, stopped, and has a clean pending directory still
aggregates `ok`. SPEC line 155 makes a record per commit optional — "A
commit with no trailers is not an error" — so recent recordless commits are
not evidence of breakage, and a recency-or-ratio heuristic would be the
guessing SPEC §2.1 B3 taught this project to refuse. `pending-backlog`
covers the stranded form of that failure; `capture-liveness` covers the
never-fired form; the strip between them is open, named here, and wired into
ADR-0032's falsification clause 1: a mechanical local predicate for it, when
one exists, converts the open case into a falsifier.

## 3. Dependency collapse and `blocked_by`

The first revision stated intent ("the runner sets `blockedBy` only when the
non-ok status is the dependency's failure surfacing again") without an
algorithm — two implementers could satisfy it incompatibly, and the design it
attributed to SetupDoctor is not SetupDoctor's (whose checks set `blockedBy`
at construction via `blockingCause`, `SetupDoctor.swift:634`; its runner does
not stamp it). The normative design:

1. The runner completes declared dependencies before dependents (the
   registry-shape test proves the graph acyclic) and passes each completed
   dependency row into the dependent's `run` as `deps`.
2. `blockedBy` has exactly one producer: the factory's `blocked(dep, ...)`
   constructor. It requires `dep` to be a declared dependency whose row is
   non-`ok` (asserted), and yields one of two shapes:
   - **inherited** — status and detail derived from the dependency row: the
     `commit-msg-hook` shape today (`doctor.ts:336-343` copies the runtime
     row's status and embeds its detail), reproduced byte-for-byte;
   - **blocked skip** — `status: 'skipped'` with a typed reason: the
     `inject-version` shape today (`did not report a version` when the
     runtime probe is the thing that is broken).
3. A row built by any other constructor has no `blockedBy`, and the runner
   never adds one. An independent defect can therefore only be reported
   unblocked; burying it would require the check to reach for the blocked
   constructor explicitly, which is visible in review and pinned by the §11
   fixture.
4. After the run, the runner normalises chains to the root — while
   `blockedBy` names a row that itself carries `blockedBy`, follow it (if A
   blocks B blocks C, C carries A) — then asserts: `blockedBy` names a
   declared dependency; the named row is non-`ok`; a blocked row's status
   never exceeds its root's.
5. Collapse annotates; it never suppresses. Every applicable registered
   check appears in `checks[]` exactly once, with its own evidence, whatever
   `blockedBy` says. Rows with `blockedBy` set are excluded from the fix
   plan (§4) and from the overall status derivation (§5.1) — their root
   already represents them there.
6. The §11 collapse fixtures are the definition of this section. Where this
   prose and a fixture disagree, the fixture wins and the prose is the bug.

## 4. The fix plan

`fixPlan` is an ordered array of check ids:

1. **Membership:** checks whose status is `fail` or `warn` and whose
   `blockedBy` is unset. Root-cause collapse is the noise control: one dead
   hook runtime is one entry, not four.
2. **Order:** `fail` entries before `warn` entries; registry order within
   each tier. Status sorts, declaration order breaks ties — stable across
   runs.
3. **No cap.** A cap would hide findings, which is the one thing this
   command exists not to do. The wall-of-text control is collapse (§3) plus
   render-time dedup: the human renderer prints one line per entry
   (`N. [status] id — detail (fix)`) and prints each distinct `fix` string
   once, on its first appearance (SetupDoctor's `seenRemediations` dedup,
   `SetupDoctor+Rendering.swift:109-122`).
4. `headline` is derived from `fixPlan[0]`: `Next action [<id>]: <detail> —
   <fix>`. With an empty fix plan the headline distinguishes a clean run
   from a merely-unverified one: `status: "ok"` → healthy wording; `status:
   "degraded"` with no actionable entry (unverified skips only) → "usable;
   some checks could not be verified". Never "healthy" while status is
   non-ok.

## 5. The report envelope and `--json`

```jsonc
{
  "schema": "commitlore_doctor.v2",
  "version": "<CLI version>",
  "status": "ok" | "degraded" | "failed",
  "installSource": "plugin" | "npm" | "npx" | "source" | "unknown",
  "headline": "Next action [pending-backlog]: ...",
  "summary": { "total": 15, "ok": 11, "warn": 2, "fail": 1, "skipped": 1, "durationMs": 412 },
  "fixPlan": ["hook-runtime", "pending-backlog"],
  "selection": ["capture"],      // only under --only / --category; omitted on a full run
  "checks": [ /* §1 rows, registry order */ ],
  "exitCode": 0
}
```

1. `status` derives from non-optional rows whose `blockedBy` is unset: any
   `fail` → `failed`; else any `warn`, or any `skipped` whose reason class
   is `unverified` → `degraded`; else `ok`. Both directions are pinned by
   tests: the #458 fixture must not reach `ok`, and the healthy fixture —
   records present, hook current, mirror fetched, no squash-shaped branches
   (so `squash-conservation` skips `not_applicable`) — **must** reach `ok`.
   The first revision's rule (any non-optional skip degrades) made `ok`
   unreachable on ordinary repositories; the review caught it as a
   first-screen lie of the opposite polarity, and the class split in §1.2 is
   the fix.
2. `summary` counts satisfy `ok + warn + fail + skipped === total ===
   checks.length`, asserted in tests.
3. **The additive contract (ADR-0032 §6):** v2 is a strict superset of the
   current unversioned shape. Every v1 key (`checks[].{id, title, status,
   needsAttention, detail, fix, fixed}`, `exitCode`) keeps its exact name,
   type, and meaning. New optional fields are omitted when absent, never
   null. Fields are added without a version bump; removal or repurposing
   requires a new schema id and a superseding ADR. A regression test decodes
   a v2 report with a v1-shaped reader and must pass forever.
4. New keys are camelCase, matching the surface they extend (`exitCode`,
   `needsAttention`). Rejected: snake_case for new keys — a mixed-case
   document costs every consumer more than a consistently legacy-cased one.
5. A partial run (`--only`, `--category`) always carries `selection`, and
   its `status`/`headline` speak only for the selected checks. A partial
   report must not be publishable as the repository's health: the headline
   prefixes `N of M checks run`.

### 5.1 Install source

`installSource` is detected without spawning anything: `CLAUDE_PLUGIN_ROOT`
in the environment or the resolved entry path under the plugin root →
`plugin`; entry path under a global `node_modules` prefix → `npm`; under an
npx cache segment (`_npx`) → `npx`; a checkout (entry next to a `.git` with
this package's name) → `source`; otherwise `unknown`. These heuristics are
asserted per-surface in tests; until a surface has a test, its detection is
marked `unknown` rather than guessed. The resolved entry path is recorded as
`entry_path` in `cli-runtime`'s evidence — a v2-additive evidence key on an
existing check, so the classification is inspectable without the dedicated
fourteenth check the first revision implied (a review finding: that check
was either a behaviour change the migration would have to sequence, or
buried evidence). Why the field earns its place: #433 — an installed plugin
pinned three releases behind meant no fix reached that user; a report that
names its channel lets the remediation name the right updater.

SetupDoctor's fourth source, `homebrew`, and its brew-probing detection
(`SetupDoctor+InstallChecks.swift:193-216`) are not carried: CommitLore is
Node-only by decision (ADR-0026) and has no brew channel.

## 6. Text output

1. Line one is `headline`. Line two is the summary roll-up
   (`11 ok, 2 warnings, 1 failed, 1 skipped (412ms)`).
2. Then the fix plan (§4.3 rendering), then one line per check in registry
   order — the current `status  title — detail` format and the current
   detail strings, unchanged.
3. `--verbose` adds evidence keys, `skipReason`, and `durationMs` under each
   check. The default stays one line per check.
4. No color unless a TTY, and none under `NO_COLOR`. Plain output is
   byte-stable for the release gate's greps.

## 7. Exit codes

| Code | Meaning |
|---|---|
| `0` | Ran; no non-optional check failed (`ok` or `degraded`) |
| `1` | Ran; at least one non-optional check failed (SPEC §10: a finding) |
| `2` | Could not run: usage error, unknown `--only`/`--category` value |

1. `degraded` exits `0`, and the distinction lives in `status`. The
   grounds, stated honestly: `docs/RELEASE-GATE.md` §4 requires fresh-clone
   doctor to exit 0 with warns present, and SPEC §10 permits a command not
   to use every code (`spec/SPEC.md:276`). This is **compatibility debt,
   not protocol purity**: a consumer that branches only on the exit code
   stays green while `status` says `degraded`; a consumer that cares must
   read `status` (the CI user story above says so).
2. **Correction.** The first revision claimed SPEC §10 forbids doctor from
   exiting `3`. That was false: an unfetched notes mirror and shallow
   history are code `3`'s own named examples (`spec/SPEC.md:274`), and
   RELEASE-GATE §1 already requires `guard` to exit `3` on an unfetched
   mirror. A blanket `degraded → 3` would still be wrong — a "no remote"
   warn is not a vision gap — but exit `3` for the vision-gap rows
   specifically (`history-depth`'s shallow warn, `doctor.ts:837-845`;
   `notes-availability`'s unfetched warn) is SPEC-aligned and **remains
   open**, deferred only because RELEASE-GATE §4's fresh-clone row would
   have to move in the same change (ADR-0032 §7.3). The first revision also
   said `init`'s `doctor --fix` step depends on the exit code; it does not
   — `init` branches on `needsAttention` (`src/commands/init.ts:104`).
3. There is no `manual` state, so nothing maps to SetupDoctor's exit `2` for
   `manual_action_required` — and CommitLore's `2` is already taken by
   "could not run".
4. `--help` documents the codes (SPEC §10 requires it); the current help
   line is updated to name `2`.

## 8. What doctor must never do

1. **No non-git network.** Doctor's own process opens no socket — no HTTP,
   no update lookup, no telemetry, on any flag — enforced by a test that
   runs the full check set with Node's socket APIs stubbed to throw.
   Network I/O happens only inside spawned `git` transport commands against
   configured remotes — today `git fetch --dry-run` (`doctor.ts:196`) and
   `git ls-remote` (`doctor.ts:248`, shared with `notes-availability`) —
   only in `transport`-category checks, and an unreachable remote degrades
   those rows to `warn` "could not verify" (`doctor.ts:199-208`,
   `:249-256`), never a `fail`, never a crash: a second test points every
   remote at an unreachable host and requires the full run to complete with
   exit `0`. The first revision said "No network. No socket, ever" — false
   against the shipping command, a review finding, corrected here rather
   than narrowed silently.
2. **No writes without `--fix`.** A plain run is read-only including under
   failure; `--fix` applies only reversible local config and reports every
   change via `fixed: true` on the row it fixed.
3. **No claim it cannot evidence.** Every row carries the observation that
   produced it, `ok` included (§1.3.1) — the first revision required
   evidence only for non-ok rows, and the review showed `ok` with `{}`
   evidence typechecked. Absence of signal is `skipped` + typed reason. The
   #458 property is owned by one tested invariant, not left emergent: no
   report may have `status: "ok"` while any non-optional, unblocked check
   is non-`ok` — including checks the runner had to synthesize from a crash
   (§2.4).
4. **No crash from its own checks.** §2.4.
5. **No partial run presented as full.** §5.5.

## 9. Migration

The existing checks keep working. Exactly:

1. **Step 1 — envelope and registry, no behaviour change.** Move each
   `const checkX` body into a registry entry's `run` unchanged. Registry
   order is `runDoctor`'s array order at that moment, frozen — no
   reordering (the first revision's table reordered checks while this step
   promised byte-identical text; both could not hold). Wrap the result in
   the v2 envelope. Text output for existing checks is byte-identical
   (snapshot-tested); `--json` gains only new keys. All existing doctor
   tests pass without edits; a new superset test (§5.3) locks v1
   compatibility.
2. **Step 2 — typed skips.** Map the **ten** existing skip return sites
   (three in inject-runtime, four in inject-version, three in
   squash-conservation) onto the six §1.2 reasons and their classes.
   `detail` strings unchanged; only `skipReason` appears.
3. **Step 3 — declared dependencies.** Replace the `checkHook(opts,
   hookRuntime)` parameter with the declared edge built through the blocked
   constructor, which reproduces today's copied status and detail
   byte-for-byte (`doctor.ts:336-343`) — the observable changes are the
   additive `blockedBy` key and fix-plan membership, nothing in
   `checks[].status` or `detail`. Add the `inject-version →
   inject-runtime` edge the same way. Behavioural test: with a dead hook
   runtime, `commit-msg-hook` carries `blockedBy: "hook-runtime"` and
   `fixPlan` contains `hook-runtime` but not `commit-msg-hook`.
4. **Step 4 — the added checks.** `notes-availability` and
   `capture-liveness` (§2.2) land here, each with its fixtures. They change
   behaviour by design; that is the point of #458.
5. **Step 5 — file split.** `src/commands/doctor/` with `registry.ts`,
   `runner.ts`, `report.ts`, `render.ts`, `checks/<category>-<id>.ts`. The
   public import surface (`runDoctor`, `formatReport`, `register`) is
   re-exported so callers (`init`, tests) do not change. This step is
   cleanup, not the honesty fix — it may trail the others.
6. `pending-backlog` (#458, in flight on `doctor-pending-backlog`) merges on
   the current structure first; it becomes a registry entry in step 1 like
   the other twelve. This PRD does not block that fix, and that fix does not
   wait for this PRD.

Steps 1–3 change no exit code, no check id, no detail string. Step 4 adds
checks — new rows, new possible statuses — and is the only step that does.

## 10. Performance

Unmeasured today; made measurable by §1.5, then fixed:

1. A full `doctor` run on this repository (the reference used by the
   RELEASE-GATE fresh-clone row) completes within a budget recorded in the
   acceptance test at the time of measurement. The budget is set from the
   measured baseline plus headroom — this document deliberately does not
   invent the number before the instrument exists (the same rule commit
   1f8b4be applied to the 100k-commit criterion).
2. `summary.durationMs` is the **wall time of the whole run**, from the same
   monotonic clock — this is the quantity §10.1's budget binds. The sum of
   per-check `durationMs` is asserted to be ≤ `summary.durationMs`; the
   difference is runner overhead, itself now visible. (The first revision
   defined `summary.durationMs` as the per-check sum while budgeting wall
   time — two quantities under one name, a review finding.)
3. `squash-conservation` keeps its existing cap
   (`MAX_SQUASH_CANDIDATE_BRANCHES = 200`, `doctor.ts:849`). Today the cap
   truncates silently (`.slice(0, MAX_SQUASH_CANDIDATE_BRANCHES)` over the
   branch list, `doctor.ts:875`); under this PRD a
   truncated scan must say so — `branches_seen` and `branches_checked` in
   evidence, and a detail that names the limit — because an `ok` over an
   unstated subset is the §8.3 rule violated in miniature.

## 11. Acceptance

Every line is a command or a test that decides the answer.

| check | command | pass |
|---|---|---|
| #458 shape closed | doctor on a repo with stranded staged captures | `status` ≠ `ok`; `pending-backlog` in `fixPlan`; headline names it |
| never-fired capture caught | doctor on a repo with ≥50 commits, green hook chain, zero records, empty pending | `status` ≠ `ok`; `capture-liveness` is `warn` |
| unfetched mirror caught | doctor after `--fix` in a clone whose remote advertises `refs/notes/commitlore`, local ref absent | `status: "degraded"`; `notes-availability` is `warn` with the fetch fix |
| `ok` is reachable | doctor on a healthy fixture: records present, hook current, mirror fetched, no squash-shaped branches | `status: "ok"`, exit 0 — skips present are all `not_applicable` |
| v1 superset | decode `doctor --json` with a v1-shaped reader | every v1 key present, same types, `exitCode` unchanged |
| schema pinned | `doctor --json \| jq -r .schema` | `commitlore_doctor.v2` |
| collapse | dead hook runtime fixture | `commit-msg-hook.blockedBy == "hook-runtime"`, its status/detail byte-identical to today's copied text; fixPlan omits the blocked id, keeps the root |
| independent failure survives collapse | fixture failing both a dependency and the dependent for its own reason | dependent appears in `fixPlan` with `blockedBy` unset |
| typed skips | every `skipped` row in the suite's fixtures | carries a §1.2 `skipReason`, whose class matches the §1.2 table |
| evidence everywhere | every row in the suite's fixtures, all statuses | non-empty `evidence` |
| crash containment | registry entry whose `run` throws (test-only) | doctor exits normally; that id is a `fail` row with `error` evidence |
| exit codes | fixtures for ok / degraded / failed / bad `--only` | `0` / `0` / `1` / `2` |
| release gate unchanged | `dist/commitlore.mjs doctor` on a fresh clone | exit 0, no `fail` (RELEASE-GATE §4 row still passes) |
| no non-git network | full run with Node socket APIs stubbed to throw | all checks complete |
| offline honesty | full run with every remote pointed at an unreachable host | run completes, exit 0; transport rows `warn` "could not verify" |
| read-only | full run without `--fix` under a watched fs | zero writes |
| partial honesty | `doctor --only cli-runtime --json` | `selection` present; headline prefixed `1 of 15 checks run` |
| summary invariant | property test over fixtures | counts sum to `total == checks.length`; per-check `durationMs` sums to ≤ `summary.durationMs` |
| budget | timed run per §10.1 | `summary.durationMs` within the recorded budget |

Each fix in this table has a test that fails when that one fix is reverted —
reverting is the evidence, as the release gate already requires of its own
sections.
