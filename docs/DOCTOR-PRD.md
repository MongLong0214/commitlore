# PRD — `commitlore doctor`: the diagnostic rebuild

- ADR: [ADR-0032](adr/ADR-0032-doctor-diagnostic-model.md) (the decisions;
  this document is the requirements)
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
report says `ok`, and "we did not look" is a typed state, never a pass.

## Non-goals

- **Profiles** (`--profile`, per-surface check subsets). Rejected in
  ADR-0032 with the reopening condition: a measurement showing the full set
  is too slow for a surface.
- **A capability/operation-readiness matrix.** SetupDoctor needs one because
  it routes operations across channels; CommitLore has no operation router.
- **Any network access**, including an opt-in update check. Version skew is
  checked against local executables; distribution staleness (#433) is fixed
  in distribution.
- **A `manual` check status.** No CommitLore remediation is outside a
  command.
- **Structured remediation objects.** `fix` stays `string | null`; every
  remediation this doctor names is a shell command, and SetupDoctor's
  `{type, value}` shape exists for System Settings deep links we do not have.
- **Changing any hook path.** Hooks are fail-open (ADR-0021 §5) and stay so.
- **Watch mode, daemons, HTML output, trend history.**

## User stories

- As a user whose captures have silently stopped, I run `commitlore doctor`
  and the first line names the stopped subsystem and the command that shows
  me the stranded work — I do not need to know `pending ls` exists.
- As a user with a broken hook runtime, I see one instruction, not four
  warnings that all mean "your hook does not run".
- As a CI author, I run `doctor --json`, pin `schema:
  "commitlore_doctor.v2"`, branch on `status`, and never re-read the docs
  when CommitLore upgrades.
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
  severity: 'error' | 'warning' | 'info';   // derived from status, total
  evidence: Record<string, string>;          // §1.3
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
2. `severity` is derived from `status` at the single check factory (`fail` →
   `error`; `warn` → `warning`; `ok`/`skipped` → `info`) and is display
   ordering only. It never drives the exit code.
3. Every check is built through one factory. A check constructed outside it
   (inconsistent severity, a skip without a reason) must not typecheck.

### 1.2 Typed skip reasons

`SkipReason` is a closed union. Initial values, each mapped to an existing
skip site whose `detail` text does not change:

| Reason | Emitting check(s) |
|---|---|
| `command_unrecognized` | inject-runtime, inject-version |
| `hook_not_installed` | inject-version |
| `probe_path_unavailable` | inject-runtime |
| `version_unreadable` | inject-version |
| `unborn_head` | squash-conservation |
| `nothing_applicable` | squash-conservation |

Adding a skip site requires adding or reusing a union member; a bare
`'skipped'` with no reason is unrepresentable. (SetupDoctor's equivalent enum
holds 18 values grown one check at a time; this table is expected to grow the
same way, per check, never speculatively.)

### 1.3 Evidence

`evidence` is a flat `Record<string, string>`: snake_case keys, string
values. Rules:

1. Any non-`ok` status carries the evidence that produced it (the exit code
   observed, the path probed, the count found). A status with empty evidence
   and a non-ok value fails the test suite.
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
  dependencies: string[];        // ids of earlier registry entries only
  optional: boolean;
  run: (ctx: DoctorContext) => DoctorCheck;
}
```

Requirements:

1. The registry is the only source of check ordering. Text output, JSON
   `checks[]`, and the fix plan all derive their order from it.
2. `dependencies` may name only ids declared **earlier** in the array —
   cycles and forward references are a build-time error, tested by a
   registry-shape test (ids unique, dependencies resolvable, categories
   non-empty).
3. `run` receives an injected `DoctorContext` (cwd, git runner, spawn,
   clock, index opener) so every check is unit-testable without a real
   repository where the probe allows it. This is SetupDoctor's `Runtime`
   struct-of-functions pattern, in plain TypeScript.
4. The runner wraps every `run` in a try/catch. A thrown check becomes a
   `fail` row for that id with the error message in evidence
   (`error: <first line>`). Doctor never terminates because one of its own
   checks threw; today it does.
5. `--only a,b` and `--category capture` filter the registry before the run.
   An unknown id or category is a usage error: exit `2`, nothing runs.

### 2.1 The shipping check set

The 12 checks on `origin/dev` plus #458's `pending-backlog`, unchanged in id,
title, and detail text:

| id | category | dependencies |
|---|---|---|
| cli-runtime | runtime | — |
| git-trailers | runtime | — |
| notes-refspec | transport | — |
| notes-push | transport | — |
| commit-msg-hook | capture | hook-runtime |
| hook-runtime | capture | — |
| pending-backlog | capture | — |
| inject-runtime | delivery | — |
| inject-version | delivery | inject-runtime |
| mcp-lifecycle | delivery | — |
| history-depth | history | — |
| squash-conservation | history | — |
| index-health | index | — |

The two declared dependencies are the two that exist implicitly today:
`commit-msg-hook` already consumes `hook-runtime`'s result as a parameter,
and `inject-version` already defers to `inject-runtime` by comment ("Saying
it twice would be noise"). No other edge is declared without a demonstrated
collapse — a speculative edge is how a fix plan hides a real failure.

## 3. Dependency collapse and `blocked_by`

1. When a declared dependency's status is not `ok`, the dependent check
   carries `blockedBy` set to the **earliest non-ok ancestor's id** (chains
   resolve to the root), and reports `skipped` when it could not meaningfully
   probe, or its natural status when it could.
2. `blockedBy` never points at an `ok` check.
3. Collapse annotates; it never suppresses. Every applicable registered
   check appears in `checks[]` exactly once, with its own evidence, whatever
   `blockedBy` says. Only the fix plan (§4) filters blocked entries.
4. A check that fails for its own reason keeps `blockedBy` unset even when a
   dependency also failed. The runner sets `blockedBy` only when the check's
   non-ok status is the dependency's failure surfacing again — a check that
   observed an independent defect reports it unblocked, so the fix plan
   cannot bury it.

## 4. The fix plan

`fixPlan` is an ordered array of check ids:

1. **Membership:** checks whose status is `fail` or `warn` and whose
   `blockedBy` is unset. Root-cause collapse is the noise control: one dead
   hook runtime is one entry, not four.
2. **Order:** `fail` entries before `warn` entries; registry order within
   each tier. Severity sorts, declaration order breaks ties — stable across
   runs.
3. **No cap.** A cap would hide findings, which is the one thing this
   command exists not to do. The wall-of-text control is collapse (§3) plus
   render-time dedup: the human renderer prints one line per entry
   (`N. [status] id — detail (fix)`) and prints each distinct `fix` string
   once, on its first appearance (SetupDoctor's `seenRemediations` dedup,
   `SetupDoctor+Rendering.swift:110-122`).
4. `headline` is derived from `fixPlan[0]`: `Next action [<id>]: <detail> —
   <fix>`. With an empty fix plan the headline distinguishes a clean run
   from a merely-unverified one: `status: "ok"` → healthy wording; `status:
   "degraded"` with no actionable entry (non-optional skips) → "usable; some
   checks could not be verified". Never "healthy" while status is non-ok.

## 5. The report envelope and `--json`

```jsonc
{
  "schema": "commitlore_doctor.v2",
  "version": "<CLI version>",
  "status": "ok" | "degraded" | "failed",
  "installSource": "plugin" | "npm" | "npx" | "source" | "unknown",
  "headline": "Next action [pending-backlog]: ...",
  "summary": { "total": 13, "ok": 9, "warn": 2, "fail": 1, "skipped": 1, "durationMs": 412 },
  "fixPlan": ["hook-runtime", "pending-backlog"],
  "selection": ["capture"],      // only under --only / --category; omitted on a full run
  "checks": [ /* §1 rows, registry order */ ],
  "exitCode": 0
}
```

1. `status` derives from non-optional checks only: any `fail` → `failed`;
   else any `warn` or non-optional `skipped` → `degraded`; else `ok`.
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
this package's name) → `source`; otherwise `unknown`. The resolved entry
path goes into the report's evidence trail via a `runtime`-category check so
the classification is itself inspectable. These heuristics are asserted
per-surface in tests; until a surface has a test, its detection is marked
`unknown` rather than guessed. Why the field earns its place: #433 — an
installed plugin pinned three releases behind meant no fix reached that user;
a report that names its channel lets the remediation name the right updater.

SetupDoctor's fourth source, `homebrew`, and its brew-probing detection
(`SetupDoctor+InstallChecks.swift:193-216`) are not carried: CommitLore is
Node-only by decision (ADR-0026) and has no brew channel.

## 6. Text output

1. Line one is `headline`. Line two is the summary roll-up
   (`9 ok, 2 warnings, 1 failed, 1 skipped (412ms)`).
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

1. `degraded` exits `0`. The distinction lives in `status`, not the exit
   code. This preserves `docs/RELEASE-GATE.md` §4 (fresh-clone doctor exits
   0 with warns present) and `init`'s `doctor --fix` step, and it keeps `3`
   from acquiring a doctor-private meaning SPEC §10 forbids (`3` means the
   *command* could not see everything; a shallow clone is something doctor
   sees perfectly well).
2. There is no `manual` state, so nothing maps to SetupDoctor's exit `2` for
   `manual_action_required` — and CommitLore's `2` is already taken by
   "could not run".
3. `--help` documents the codes (SPEC §10 requires it); the current help
   line is updated to name `2`.

## 8. What doctor must never do

1. **No network.** No socket, ever, on any flag. Enforced by a test that
   runs the full check set with network syscalls stubbed to throw.
2. **No writes without `--fix`.** A plain run is read-only including under
   failure; `--fix` applies only reversible local config and reports every
   change via `fixed: true` on the row it fixed.
3. **No claim it cannot evidence.** `ok` requires an observation, recorded
   in the row; absence of signal is `skipped` + typed reason. The #458
   property is owned by one tested invariant, not left emergent: no report
   may have `status: "ok"` while any non-optional check is non-`ok` —
   including checks the runner had to synthesize from a crash (§2.4).
4. **No crash from its own checks.** §2.4.
5. **No partial run presented as full.** §5.5.

## 9. Migration

The existing checks keep working. Exactly:

1. **Step 1 — envelope and registry, no behaviour change.** Move each
   `const checkX` body into a registry entry's `run` unchanged. Wrap the
   result in the v2 envelope. Text output for existing checks is
   byte-identical (snapshot-tested); `--json` gains only new keys. All
   existing doctor tests pass without edits; a new superset test (§5.3)
   locks v1 compatibility.
2. **Step 2 — typed skips.** Map the six existing skip sites to §1.2
   reasons. `detail` strings unchanged; only `skipReason` appears.
3. **Step 3 — declared dependencies.** Replace the `checkHook(opts,
   hookRuntime)` parameter with the declared edge; add the
   `inject-version → inject-runtime` edge. Behavioural test: with a dead
   hook runtime, `commit-msg-hook` carries `blockedBy: "hook-runtime"` and
   `fixPlan` contains `hook-runtime` but not `commit-msg-hook`.
4. **Step 4 — file split.** `src/commands/doctor/` with `registry.ts`,
   `runner.ts`, `report.ts`, `render.ts`, `checks/<category>-<id>.ts`. The
   public import surface (`runDoctor`, `formatReport`, `register`) is
   re-exported so callers (`init`, tests) do not change.
5. `pending-backlog` (#458, in flight on `doctor-pending-backlog`) merges on
   the current structure first; it becomes a registry entry in step 1 like
   the other twelve. This PRD does not block that fix, and that fix does not
   wait for this PRD.

Steps land in order, each green on its own. No step changes an exit code, a
check id, or a detail string.

## 10. Performance

Unmeasured today; made measurable by §1.5, then fixed:

1. A full `doctor` run on this repository (the reference used by the
   RELEASE-GATE fresh-clone row) completes within a budget recorded in the
   acceptance test at the time of measurement. The budget is set from the
   measured baseline plus headroom — this document deliberately does not
   invent the number before the instrument exists (the same rule commit
   1f8b4be applied to the 100k-commit criterion).
2. `summary.durationMs` equals the sum of per-check `durationMs`, asserted
   in tests, so a future regression names its check.
3. `squash-conservation` keeps its existing cap
   (`MAX_SQUASH_CANDIDATE_BRANCHES = 200`). Today the cap truncates
   silently (`.slice(0, 200)` over the branch list); under this PRD a
   truncated scan must say so — `branches_seen` and `branches_checked` in
   evidence, and a detail that names the limit — because an `ok` over an
   unstated subset is the §8.3 rule violated in miniature.

## 11. Acceptance

Every line is a command or a test that decides the answer.

| check | command | pass |
|---|---|---|
| #458 shape closed | doctor on a repo with stranded staged captures | `status` ≠ `ok`; `pending-backlog` in `fixPlan`; headline names it |
| v1 superset | decode `doctor --json` with a v1-shaped reader | every v1 key present, same types, `exitCode` unchanged |
| schema pinned | `doctor --json \| jq -r .schema` | `commitlore_doctor.v2` |
| collapse | dead hook runtime fixture | `commit-msg-hook.blockedBy == "hook-runtime"`; fixPlan omits the blocked id, keeps the root |
| independent failure survives collapse | fixture failing both a dependency and the dependent for its own reason | dependent appears in `fixPlan` with `blockedBy` unset |
| typed skips | every `skipped` row in the suite's fixtures | carries a §1.2 `skipReason` |
| crash containment | registry entry whose `run` throws (test-only) | doctor exits normally; that id is a `fail` row with `error` evidence |
| exit codes | fixtures for ok / degraded / failed / bad `--only` | `0` / `0` / `1` / `2` |
| release gate unchanged | `dist/commitlore.mjs doctor` on a fresh clone | exit 0, no `fail` (RELEASE-GATE §4 row still passes) |
| no network | full run with sockets stubbed to throw | all checks complete |
| read-only | full run without `--fix` under a watched fs | zero writes |
| partial honesty | `doctor --only cli-runtime --json` | `selection` present; headline prefixed `1 of 13 checks run` |
| summary invariant | property test over fixtures | counts sum to `total == checks.length`; `durationMs` sums |
| budget | timed run per §10.1 | within the recorded budget |

Each fix in this table has a test that fails when that one fix is reverted —
reverting is the evidence, as the release gate already requires of its own
sections.
