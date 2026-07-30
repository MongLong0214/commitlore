# F12 tickets — Universal adoption: platform reach, packaging, lifecycle, matrix (M6)

> PRD: [PRD-F12-universal-adoption.md](../prd/PRD-F12-universal-adoption.md)
> ADR: [0023](../adr/ADR-0023-windows-requires-containment-parity.md) (Windows containment
> parity), [0024](../adr/ADR-0024-musl-target-gated-on-feasibility.md) (musl gated on a
> spike), [0025](../adr/ADR-0025-package-manager-as-verified-pointer.md) (package manager
> as verified pointer)
> Acceptance: [`../GATE-B-ACCEPTANCE.md`](../GATE-B-ACCEPTANCE.md) rows `B-1`…`B-5`
> Baseline head: `e2b5725`. Full suite there: **65 files, 1,750 passed, 1 skipped.**

**Every ticket below is bound to `e2b5725`.** Line numbers and the "fails before"
justification are stale the moment another ticket in this file merges. The
**Evidence invalidation** block of each ticket says what to re-derive.

**Chain, not a wave**: `T-1101 → T-1102 → T-1103 → T-1104` is strictly ordered by
ADR-0023. `T-1105`, `T-1106`, `T-1107` are independent of the chain and of each other.
`T-1108` is independent. `T-1104` and `T-1106` must not merge in the same wave
(`GATE-B-ACCEPTANCE.md` "Execution constraints").

---

## T-1101 Converge the four `.pathname` path resolutions onto `fileURLToPath` (S) — #265 · B-1 step 1

**Owns**

- `scripts/adoption-range.mjs` — line 21 at `e2b5725`
- `scripts/build-binary.mjs` — line 62 at `e2b5725`
- `scripts/check-test-files-ran.mjs` — line 21 at `e2b5725`
- `scripts/check-engines.mjs` — line 21 at `e2b5725`
- `test/scripts-path-resolution.test.ts` (new)

**Depends on**

- ADR-0023 accepted (nothing else)

**Forbidden scope**

- Do not touch `src/` or `dist/` — this ticket changes no shipped code
- Do not touch `scripts/check-release-version.mjs`: line 37 already uses the target
  pattern and is the reference, not a subject
- Do not touch `.github/workflows/release.yml` or any matrix
- Do not touch `classifyBinTarget` or any hook file (that is T-1102)
- Do not add a Windows CI job (that is T-1103)

**RED test**

- File: `test/scripts-path-resolution.test.ts` (new)
- Assertion: every tracked file under `scripts/` that derives a filesystem path from
  `import.meta.url` uses `fileURLToPath`, and **no** tracked file matches
  `new URL(…, import.meta.url).pathname`.
- Fails at `e2b5725` because four files match the forbidden pattern. The test is a
  repository-wide invariant, so it also fails if a fifth is added later.

**Minimum GREEN**

- Each of the four sites becomes `resolve(fileURLToPath(new URL('..', import.meta.url)))`,
  with `fileURLToPath` imported from `node:url`, matching
  `scripts/check-release-version.mjs:37` exactly.
- No other change in those files.

**AC ↔ test**

| AC | Test assertion | Traces to |
|---|---|---|
| No script derives a path via `.pathname` | `expect(offenders).toEqual([])` | PRD-F12 req 1; ADR-0023 §Decision 1 |
| All four converge on the existing reference pattern | per-file `expect(src).toContain('fileURLToPath')` | ADR-0023 §Context (the pattern is already in-repo) |
| The invariant holds for files added later | test globs `scripts/**`, not a fixed list | ADR-0023 §Consequences |

**Commands**

| scope | command | expected |
|---|---|---|
| focused | `npx vitest run test/scripts-path-resolution.test.ts` | pass |
| full | `npx vitest run` | 66 files, 1,750+ passed, 1 skipped |
| release | `npx tsc --noEmit && npx tsc --noEmit -p bench/tsconfig.json` | both exit 0 |
| manual | `node scripts/check-engines.mjs && node scripts/check-test-files-ran.mjs` | both exit 0 — these scripts run in CI and must still work |
| manual | `npm run build:binary` | still produces a binary (the file changed is its own entry path resolution) |
| LIVE_NA | Windows behaviour is not verified by this ticket; it removes the crash cause, and T-1103 is where a Windows runner executes anything | — |

**Evidence invalidation**

- Bound to `e2b5725`. Re-derive the four line numbers with
  `grep -rn "new URL(" scripts` before editing; if any site has already been converged,
  drop it from **Owns** rather than re-editing.

**Stop / escalate**

- If a script needs the URL rather than a path for a legitimate reason, stop: the
  invariant is about filesystem paths and the test must exempt it explicitly, with the
  reason in the test.
- If `npm run build:binary` fails after the change, stop — the fix is wrong, not the build.

**Safety checks**

| check | response |
|---|---|
| fail-closed | If `fileURLToPath` cannot resolve, the script throws as before; no silent fallback to `.pathname` |
| wrong-target | A diff touching `src/`, `dist/` or `check-release-version.mjs` is wrong |
| ambiguity | The target pattern is quoted from a real line in the repository |
| partial state | Four independent one-line edits; a partial application still leaves the test red, never green with a gap |
| privacy | Path resolution only; no user data |
| prompt injection | No external input |

**Completion evidence**

- `git diff --stat` shows exactly four scripts plus one new test
- Focused test passes; full suite passes; both `tsc` exit 0
- `node scripts/check-engines.mjs` exits 0

---

## T-1102 Recognise `commitlore.exe`, and bind the two allowlists together (M) — #266 · B-1 step 2

**Owns**

- `src/core/hook-target.ts` — `classifyBinTarget` (line 61–63 at `e2b5725`)
- `src/hooks/commit-msg.ts` — the stub allowlist glob (line 98 at `e2b5725`:
  `*.mjs|*.js|*/commitlore|commitlore)`)
- `test/hook-target.test.ts` — extend the existing `classifyBinTarget` describe (line 21)
- `dist/` — rebuild required (CI byte-compares `dist/` to `src/`)

**Depends on**

- T-1101 (merged) — ADR-0023 makes the order binding
- ADR-0023 accepted

**Forbidden scope**

- **No prefix or fuzzy matching.** `basename(path) === 'commitlore'` becomes an exact
  membership test over an explicit set; it must not become `startsWith`
- Do not add any extension other than `.exe`
- Do not touch `.github/workflows/*` (T-1103, T-1104)
- Do not touch `README*` — Windows stays documented as unsupported until T-1104
- Do not change `commitlore.root` containment logic itself, only what counts as the binary

**RED test**

- File: `test/hook-target.test.ts`
- Assertions, all three failing at `e2b5725`:
  1. `classifyBinTarget('/x/commitlore.exe') === 'binary'` — currently `null`
  2. `classifyBinTarget('/x/commitlore-evil') === null` — passes today and must keep
     passing; it is the regression guard against a prefix match
  3. the stub allowlist string and `classifyBinTarget` accept the **same** set: for each
     of a fixed candidate list, the glob's verdict equals the function's verdict —
     currently disagrees on `commitlore.exe`

**Minimum GREEN**

- `classifyBinTarget` recognises exactly `commitlore` and `commitlore.exe`
- The stub glob becomes `*.mjs|*.js|*/commitlore|commitlore|*/commitlore.exe|commitlore.exe`
- The agreement assertion is a test, not a comment: one exported constant is the single
  source of the accepted basenames, and both the function and the generated stub derive
  from it
- `npm run build` run and `dist/` committed

**AC ↔ test**

| AC | Test assertion | Traces to |
|---|---|---|
| `.exe` classifies as binary | `expect(classifyBinTarget('/x/commitlore.exe')).toBe('binary')` | PRD-F12 req 2 |
| No prefix match | `expect(classifyBinTarget('/x/commitlore-evil')).toBeNull()` | ADR-0023 §Ruled-out item 2 |
| Function and stub agree | table-driven equality over a candidate list | PRD-F12 req 3 |
| Existing behaviour intact | the pre-existing `agrees with hasAllowedBinExtension` test (line 49) still passes | ADR-0023 §Falsification |

**Commands**

| scope | command | expected |
|---|---|---|
| focused | `npx vitest run test/hook-target.test.ts test/hooks.test.ts` | pass |
| full | `npx vitest run` | 66 files, 1,750+ passed, 1 skipped |
| release | `npm run build && git diff --exit-code dist/` | build committed, no drift |
| release | `npx tsc --noEmit` | exit 0 |
| manual | `node dist/commitlore.mjs hooks status` | no crash, unchanged output shape |
| LIVE_NA | Containment is **not** proven on Windows by this ticket. That is T-1103, and ADR-0023 forbids inferring it here | — |

**Evidence invalidation**

- Bound to `e2b5725`. If `hook-target.ts` or the stub changed since, re-read both before
  editing and re-derive line 63 / line 98.
- If T-1101 has not merged, this ticket is out of order — stop.

**Stop / escalate**

- If making the two allowlists share one source requires changing what the stub does at
  runtime (beyond the accepted-name set), stop: that is containment logic, not this ticket
- If any existing containment test flips from pass to fail, stop and report — that is the
  property #71 established

**Safety checks**

| check | response |
|---|---|
| fail-closed | An unrecognised basename stays `null`, i.e. not-a-binary, which is the safe verdict |
| wrong-target | A diff that loosens the match to a prefix is the failure mode this ticket exists to avoid |
| ambiguity | Accepted set is enumerated, never pattern-inferred |
| partial state | If only one of the two allowlists changes, the agreement test fails — that is why it exists |
| privacy | No user data |
| prompt injection | The stub is generated from a constant, not from input |

**Completion evidence**

- `git diff src/core/hook-target.ts src/hooks/commit-msg.ts` shows the enumerated set
- `git diff --exit-code dist/` clean after `npm run build`
- Focused and full suites pass; `tsc --noEmit` exits 0

---

## T-1103 Execute #71's containment attacks on `windows-latest` in CI (M) — #267 · B-1 step 3

**Owns**

- `.github/workflows/ci.yml` — one new job (`windows-containment`), added after the
  existing `binary` job (line 200 at `e2b5725`)
- `test/ci-windows-containment.test.ts` (new) — asserts the workflow's shape

**Depends on**

- T-1101 and T-1102, both merged. Without T-1102 the job asserts a property that is
  known false; without T-1101 the runner cannot get that far

**Forbidden scope**

- Do not add `windows-latest` to `.github/workflows/release.yml` (that is T-1104)
- Do not port the full suite to Windows; this job runs the containment tests only
- Do not mark the job `continue-on-error` or make it non-required — explicitly forbidden
  by ADR-0023 §Ruled-out and §Falsification
- Do not touch `src/`

**RED test**

- File: `test/ci-windows-containment.test.ts` (new)
- Assertion: `ci.yml` contains a job with `runs-on: windows-latest` that executes
  `test/hook-target.test.ts` and `test/hooks.test.ts`, and that the job declares no
  `continue-on-error: true`.
- Fails at `e2b5725` because `ci.yml` has no Windows job at all (jobs are `check`,
  `git-matrix`, `binary`, `install-script`).

**Minimum GREEN**

- The job checks out, installs Node at the repository's floor, and runs
  `npx vitest run test/hook-target.test.ts test/hooks.test.ts` on `windows-latest`
- The job is required: no `continue-on-error`, no `if:` that can skip it on a normal PR
- **The real verification is the run itself**, not the shape test: the job must pass on a
  real `windows-latest` runner in this ticket's own PR

**AC ↔ test**

| AC | Test assertion | Traces to |
|---|---|---|
| A Windows job exists and runs the containment tests | workflow-shape test | PRD-F12 req 4 |
| The job cannot be skipped or soft-failed | `expect(job).not.toHaveProperty('continue-on-error')` | ADR-0023 §Ruled-out item 4 |
| Containment actually holds on Windows | the job's own green result on this PR | ADR-0023 §Decision 3 — this is the row's real evidence |

**Commands**

| scope | command | expected |
|---|---|---|
| focused | `npx vitest run test/ci-windows-containment.test.ts` | pass |
| full | `npx vitest run` | 67 files, 1,750+ passed, 1 skipped |
| release | `npx tsc --noEmit` | exit 0 |
| LIVE | `gh pr checks <pr>` on this ticket's PR | `windows-containment` reports **success** on a real `windows-latest` runner |

**Evidence invalidation**

- The shape test asserts against `ci.yml` as parsed, not against line numbers; a
  reordering of jobs does not invalidate it. A rename of either test file does.
- If either containment test file is split or renamed by another ticket, update the job
  and the assertion together.

**Stop / escalate**

- **If the job fails on Windows for any reason other than `.exe` classification, stop.**
  Do not weaken the job, do not add `continue-on-error`, do not skip the failing
  assertion. Record the failure as its own issue. ADR-0023 §Consequences explicitly
  permits Gate B to end here with Windows still unsupported.
- If Windows runner minutes or availability block the run, that is a blocker to surface,
  not a reason to merge the workflow unverified

**Safety checks**

| check | response |
|---|---|
| fail-closed | A job that cannot run is a red check, never a skipped one |
| wrong-target | A diff touching `release.yml` belongs to T-1104 |
| ambiguity | The two test files are named explicitly |
| timeout | Windows runners are slower; give the job an explicit `timeout-minutes` rather than relying on the default |
| partial state | The job either runs both files or the shape test fails |
| privacy | CI logs contain no user data; no secrets are needed by this job |
| prompt injection | None — no external input |

**Completion evidence**

- `gh pr checks` on this ticket's PR shows `windows-containment` **success**
- The shape test passes; full suite passes
- The PR description quotes the Windows job's result, not a local run

---

## T-1104 Add `windows-latest` to the release build matrix (S) — #268 · B-1 step 4

**Owns**

- `.github/workflows/release.yml` — the build matrix `include:` list (lines 79–93 at
  `e2b5725`)
- `README.md`, `README.ko.md`, `README.ja.md`, `README.zh-CN.md` — the Windows bullet in
  Known limitations (line 283 in `README.md` at `e2b5725`)
- `docs/COMPATIBILITY.md` — the Windows row (created by T-1107)
- `install.sh` — the OS mapping (line 52–53 at `e2b5725`), only if a Windows asset is
  actually published

**Depends on**

- **T-1103 green on a real `windows-latest` runner.** This is the whole of ADR-0023
- T-1107 (compatibility matrix exists to hold the row)

**Forbidden scope**

- Do not merge in the same wave as T-1106 (`GATE-B-ACCEPTANCE.md` execution constraint)
- Do not use `continue-on-error` or `fail-fast: false` as a way to publish a partial
  asset set
- Do not soften the README bullet before the matrix change lands in the same commit
- Do not change the checksum or publish steps' logic

**RED test**

- File: `test/readme.test.ts` (extend) and `test/compatibility-matrix.test.ts` (from
  T-1107)
- Assertion: the release matrix contains a Windows target **and** no README states Windows
  is unsupported **and** the compatibility matrix Windows row reads supported — all three
  as one conjunction, so the state cannot be half-applied.
- Fails at `e2b5725` on all three.

**Minimum GREEN**

- `windows-latest` with target `x86_64-pc-windows-msvc` in the matrix
- The four README bullets removed together in one commit with the matrix change
- The compatibility matrix Windows row flipped in the same commit

**AC ↔ test**

| AC | Test assertion | Traces to |
|---|---|---|
| Matrix contains the Windows target | parse `release.yml`, expect the target present | PRD-F12 req 5 |
| No README claims Windows unsupported | all four files asserted together | ADR-0023 §Falsification item 2 |
| Matrix row and release agree | T-1107's sync test | `B-4` |
| No soft-fail | `expect(job).not.toHaveProperty('continue-on-error')` | ADR-0023 §Ruled-out item 4 |

**Commands**

| scope | command | expected |
|---|---|---|
| focused | `npx vitest run test/readme.test.ts test/compatibility-matrix.test.ts` | pass |
| full | `npx vitest run` | all files pass |
| release | `node scripts/check-readme-numbers.mjs` | exit 0 — the `BENCH:BEGIN`/`END` block is byte-checked and must not be touched |
| LIVE | the next release run after merge | 5 build jobs succeed; `SHA256SUMS` lists a Windows asset; the asset's checksum verifies |

**Evidence invalidation**

- The README line number moves whenever T-1014/T-1015-class section work lands. Re-derive
  by content (`grep -n "Windows is unsupported" README*.md`), never by line.
- If T-1103's Windows job was ever made non-required, this ticket's dependency is not
  satisfied regardless of what the workflow file says.

**Stop / escalate**

- If the Windows build produces an asset that cannot be executed on Windows, stop and
  revert the matrix change; a listed asset that does not run is worse than no asset
- If the release run's Windows job fails after merge, treat it as a release blocker and
  cut the target back out rather than shipping a partial `SHA256SUMS`

**Safety checks**

| check | response |
|---|---|
| fail-closed | If the Windows job fails, the release fails; no partial publish |
| wrong-target | Only the matrix and the platform statements change; no packaging manifest |
| ambiguity | Target triple written explicitly |
| partial state | The conjunctive RED test is what prevents a half-flipped claim |
| privacy | None |
| prompt injection | None |

**Completion evidence**

- A release run with 5 successful build jobs and a Windows entry in `SHA256SUMS`
- The Windows asset downloaded on a machine that did not build it, checksum verified,
  `--version` correct
- All four READMEs and the compatibility matrix agree with the matrix

---

## T-1105 musl feasibility spike: answer the question, record the answer (M) — #269 · B-2

**Owns**

- `docs/spikes/SPIKE-musl-feasibility.md` (new; creates `docs/spikes/`)
- `test/spike-musl.test.ts` (new) — asserts the document's required sections exist

**Depends on**

- ADR-0024 accepted. Independent of the Windows chain

**Forbidden scope**

- **Publish no asset.** No change to `.github/workflows/release.yml`
- **Add no Docker step to the release build matrix** — the recorded constraint. If Docker
  turns out to be the only route, that is a finding, not a licence
- Do not touch `install.sh`. Its musl failure is already correct and ADR-0024 keeps it
- Do not touch `README*` musl bullets
- Do not weaken the existing ruled-out record; a musl target still may not be justified as
  an installer or CI-verification fix

**RED test**

- File: `test/spike-musl.test.ts` (new)
- Assertion: `docs/spikes/SPIKE-musl-feasibility.md` exists and contains all of: a route
  table with an outcome per route, a `## Recommendation` section, and a
  `## What this could not determine` section.
- Fails at `e2b5725` because neither the file nor the directory exists.

**Minimum GREEN**

- The document records, per attempted route (unofficial musl Node build, static link,
  cross-toolchain, non-Docker container step): what was attempted, what was observed, and
  whether the resulting provenance is defensible
- A recommendation: yes, no, or yes-conditional — with the condition named
- An explicit list of routes **not** attempted, marked as not attempted rather than
  impossible (PRD-F13-style honesty applied here: a check states what it could not see)
- **A "no" recommendation closes this row.** That is written into the document so the
  result is not later read as an unfinished task

**AC ↔ test**

| AC | Test assertion | Traces to |
|---|---|---|
| The document exists with a route table | section-presence test | PRD-F12 req 6 |
| A recommendation is present | `expect(doc).toMatch(/^## Recommendation/m)` | ADR-0024 §Decision 1 |
| Undetermined routes are declared | `expect(doc).toMatch(/^## What this could not determine/m)` | PRD-F12 req 7 |
| No asset was published | `git diff` touches no workflow file | ADR-0024 §Decision 3, §Falsification |

**Commands**

| scope | command | expected |
|---|---|---|
| focused | `npx vitest run test/spike-musl.test.ts` | pass |
| full | `npx vitest run` | all files pass |
| manual | `git diff --name-only origin/dev...HEAD` | contains no `.github/workflows/*` path |
| LIVE | whatever the spike actually runs | recorded verbatim in the document, including failures |

**Evidence invalidation**

- The spike's measurements are bound to the Node version at the time. Record the exact
  Node version and runner image; a later Node release does not retroactively change the
  answer but does bound it.

**Stop / escalate**

- If a route requires publishing an artifact built from an unattributed third-party
  runtime, stop: ADR-0024 rules it out and the spike should record it as ruled out
- If the answer is yes, **stop before publishing**. Publishing is a separate ticket

**Safety checks**

| check | response |
|---|---|
| fail-closed | No route working means the recommendation is no; no fallback that ships something |
| wrong-target | A diff touching `install.sh` or `release.yml` is out of scope |
| ambiguity | "Feasible" is defined as: builds in the matrix, without Docker, with defensible provenance — all three |
| timeout | Each route gets a stated time box, and a timed-out route is recorded as not determined |
| privacy | No user data |
| prompt injection | Third-party build instructions are read as data; nothing is executed without being read first |

**Completion evidence**

- The committed document with the route table, recommendation and undetermined list
- `git diff --name-only` proving no workflow or installer change
- The focused test passing

---

## T-1106 Generate a Homebrew formula from the published release, with a drift check (M) — #270 · B-3

**Owns**

- `scripts/gen-brew-formula.mjs` (new)
- `Formula/commitlore.rb` (new)
- `.github/workflows/ci.yml` — one drift step inside the existing `check` job (line 12)
- `test/brew-formula.test.ts` (new)
- `README.md` + the three translations — one install line placed **after** `git clone`
  and `install.sh`

**Depends on**

- ADR-0025 accepted. Independent of the Windows chain
- Must not merge in the same wave as T-1104

**Forbidden scope**

- **No build step in the formula.** It downloads a published asset, nothing else
- No hand-written version or digest: both come from the release
- No `homebrew-core` submission (ADR-0025 §Ruled-out)
- No Scoop or WinGet manifest — there is no Windows asset until T-1104
- Do not present the tap ahead of `git clone` or `install.sh`
- Do not touch the `BENCH:BEGIN`/`BENCH:END` block

**RED test**

- File: `test/brew-formula.test.ts` (new)
- Assertion: regenerating the formula from the current release produces a file
  byte-identical to `Formula/commitlore.rb`, and the formula contains no build directive.
- Fails at `e2b5725` because neither the generator nor the formula exists.

**Minimum GREEN**

- `scripts/gen-brew-formula.mjs` reads the release tag, asset URL and the digest from the
  release's `SHA256SUMS`, and writes `Formula/commitlore.rb` deterministically
- CI regenerates and fails on any diff — the same protection `dist/` has
- The formula's install step copies the extracted binary; it compiles nothing

**AC ↔ test**

| AC | Test assertion | Traces to |
|---|---|---|
| Formula is regenerable byte-for-byte | `expect(generated).toBe(committed)` | PRD-F12 req 10; ADR-0025 §Decision 4 |
| Version equals the tag | assert the formula's version against `package.json`/tag | ADR-0025 §Decision 2 |
| Digest equals the published one | assert against `SHA256SUMS` | ADR-0025 §Decision 3 |
| No build directive | `expect(formula).not.toMatch(/system "make"|def install.*build/s)` | ADR-0025 §Decision 1, §Falsification |
| Channel is listed last | README assertion on ordering | ADR-0025 §Decision, §Falsification |

**Commands**

| scope | command | expected |
|---|---|---|
| focused | `npx vitest run test/brew-formula.test.ts test/readme.test.ts` | pass |
| full | `npx vitest run` | all files pass |
| release | `node scripts/gen-brew-formula.mjs && git diff --exit-code Formula/` | no drift |
| release | `node scripts/check-readme-numbers.mjs` | exit 0 |
| **LIVE (required)** | `brew install` through the tap **on a machine that did not build the asset**, then `commitlore --version` | installs; version equals the tag. PRD-F12 req 12 — a passing suite does not satisfy this |

**Evidence invalidation**

- The formula is bound to a specific release tag. After any release, regenerate; a stale
  digest is a broken install, and the CI drift check is what catches it.
- If the asset naming scheme changes, the generator changes with it in the same commit.

**Stop / escalate**

- If the tap cannot resolve the digest without an authenticated API call, stop: ADR-0025
  requires the digest to come from the published `SHA256SUMS`, which is unauthenticated
- If the real install fails, do not merge on the strength of the passing tests

**Safety checks**

| check | response |
|---|---|
| fail-closed | A digest mismatch fails the install; it is never a warning |
| wrong-target | A diff adding a Windows manifest is out of scope |
| ambiguity | "Verified pointer" is defined by ADR-0025's four mechanical properties |
| timeout | Generation is local and fast; the live install is the slow step and is manual |
| partial state | A committed formula that does not match the generator is a red CI check |
| privacy | The formula contains a URL and a digest; nothing else |
| prompt injection | The release name is read from the release, not from user input, and is not interpolated into a shell command |

**Completion evidence**

- `node scripts/gen-brew-formula.mjs && git diff --exit-code Formula/` clean
- CI drift step green
- A transcript of a real `brew install` on a machine that did not build the asset, with
  `--version` matching the tag

---

## T-1107 One compatibility matrix, kept honest by a test (M) — #271 · B-4

**Owns**

- `docs/COMPATIBILITY.md` (new)
- `test/compatibility-matrix.test.ts` (new)
- `README.md` + three translations — one pointer line in Known limitations

**Depends on**

- Nothing. Independent of every other ticket, and T-1104 depends on it

**Forbidden scope**

- Do not remove the existing Windows/musl README bullets — the matrix is an addition, and
  those bullets stay until their assets exist
- Do not change `install.sh`
- Do not claim a target the release does not build
- Do not collapse `unsupported` and `undecided` into one status

**RED test**

- File: `test/compatibility-matrix.test.ts` (new)
- Assertions, all failing at `e2b5725` (the document does not exist):
  1. every target in `release.yml`'s matrix has a row with status `supported`
  2. every row not in `release.yml` has status `unsupported` or `undecided` **and** cites
     an issue or record
  3. the OS and architecture set in `install.sh` (lines 52–63) matches the matrix's
     supported rows

**Minimum GREEN**

- `docs/COMPATIBILITY.md` with one row per target: OS, architecture, libc, status,
  reason/citation
- Rows for the four published targets as `supported`; Windows citing #95 and ADR-0023;
  musl citing #99, the ruled-out record and ADR-0024 — as `undecided` until T-1105
  answers, then `unsupported` with a reason
- The three assertions above implemented against the real files, not fixtures

**AC ↔ test**

| AC | Test assertion | Traces to |
|---|---|---|
| Published target with no row fails | add-a-target simulation in the test | PRD-F12 req 21 |
| Row claiming an unbuilt target fails | inverse direction asserted | PRD-F12 req 21 |
| `install.sh` mapping agrees | parse the `case` arms | PRD-F12 req 22 |
| Unsupported rows carry reasons | regex for an issue or record reference per row | PRD-F12 req 23 |
| `unsupported` ≠ `undecided` | both statuses present and distinct in the schema | ADR-0024 §Consequences |

**Commands**

| scope | command | expected |
|---|---|---|
| focused | `npx vitest run test/compatibility-matrix.test.ts` | pass |
| full | `npx vitest run` | all files pass |
| manual | add a fake target to a copy of `release.yml` and re-run the focused test | it fails — proving the test bites |
| LIVE_NA | No network, no platform execution; this ticket asserts agreement between files | — |

**Evidence invalidation**

- Bound to `release.yml`'s matrix at `e2b5725` (4 targets) and `install.sh` lines 52–63.
  The test reads both at runtime, so a matrix change invalidates the **document**, not the
  test — which is the intent.

**Stop / escalate**

- If `install.sh`'s mapping and the release matrix already disagree at `e2b5725`, stop and
  report: that is a pre-existing defect and this ticket must not paper over it by writing
  a matrix that matches only one of them

**Safety checks**

| check | response |
|---|---|
| fail-closed | A target with no row fails the build rather than defaulting to supported |
| wrong-target | No change to installer logic or workflows |
| ambiguity | Status vocabulary is a closed set: `supported`, `unsupported`, `undecided` |
| partial state | One document; a row is either complete with a citation or the test fails |
| privacy | None |
| prompt injection | The matrix is repository-authored, not user input |

**Completion evidence**

- `docs/COMPATIBILITY.md` committed with citations on every non-supported row
- The focused test demonstrated failing on an injected fake target, then passing
- Full suite green

---

## T-1108 `commitlore uninstall`: remove what `install.sh` wrote, and nothing else (L) — #272 · B-5

**Owns**

- `src/commands/uninstall.ts` (new)
- `src/core/agent-configs.ts` (new) — the single source of the agent config paths
- `src/cli.ts` — one `register` line (imports at lines 17–35 at `e2b5725`)
- `test/uninstall.test.ts` (new)
- `test/agent-configs.test.ts` (new) — asserts agreement with `install.sh`
- `dist/` — rebuild required

**Depends on**

- Nothing. Independent of every other ticket in this file

**Forbidden scope**

- Do not duplicate per-repository uninstall: `commitlore hooks uninstall` and
  `commitlore inject uninstall-claude-hook` already own that and this command points at
  them (PRD-F12 req 19)
- Do not remove any config entry the installer did not write
- Do not reformat or rewrite a config file beyond removing the entry
- Do not touch `install.sh`'s behaviour in this ticket; only read its paths
- Do not delete a binary at the target path that does not identify itself as CommitLore

**RED test**

- File: `test/uninstall.test.ts` (new)
- Assertion: given a temporary HOME with (a) an agent config containing both a
  `commitlore` MCP entry and an unrelated MCP entry, and (b) a fake CommitLore binary at
  the install path, `uninstall` removes the binary and the `commitlore` entry, and the
  unrelated entry plus every other key survives byte-for-byte.
- Fails at `e2b5725` because no `uninstall` command exists — `grep -rn "uninstall" src`
  finds only per-repository hook removal.
- Second RED file: `test/agent-configs.test.ts` asserts every config path in `install.sh`
  (`wire_claude_code`, `wire_codex`, `wire_gemini`, `wire_cursor`, `wire_windsurf`,
  `wire_opencode`, and the generic `wire_mcp_servers_json` callers — lines 282–410 at
  `e2b5725`) has an entry in `src/core/agent-configs.ts`. Fails because `src/` currently
  contains **no** agent config knowledge at all (`grep -rln "mcp_servers" src` is empty).

**Minimum GREEN**

- `src/core/agent-configs.ts` exports one table: agent name, config path, config format
- `test/agent-configs.test.ts` parses `install.sh` and asserts the two agree in both
  directions — this is the lesson from the triplicated policy hash: two sources of the
  same truth diverge silently
- `commitlore uninstall` removes the installed binary (only if it self-identifies) and the
  `commitlore` entry from each config in the table
- Reports per agent: removed / left / not found, with a reason — the shape `install.sh`
  already uses
- Idempotent: a second run removes nothing and exits 0
- `--dry-run` prints the plan and changes nothing
- `npm run build` run and `dist/` committed

**AC ↔ test**

| AC | Test assertion | Traces to |
|---|---|---|
| Written entries removed | entry absent after run | PRD-F12 req 14 |
| Unrelated entry survives | deep-equality on the rest of the config | PRD-F12 req 15 |
| Per-agent report | assert the three outcome categories | PRD-F12 req 16 |
| Idempotent | second run: nothing removed, exit 0 | PRD-F12 req 17 |
| Refuses a foreign binary | fake non-CommitLore binary is left in place, named reason | PRD-F12 req 18 |
| Per-repository state untouched | hook files still present after run | PRD-F12 req 19 |
| Config path table matches `install.sh` | bidirectional agreement test | the triplication lesson; PRD-F13 req 7 rationale |

**Commands**

| scope | command | expected |
|---|---|---|
| focused | `npx vitest run test/uninstall.test.ts test/agent-configs.test.ts` | pass |
| full | `npx vitest run` | all files pass |
| release | `npm run build && git diff --exit-code dist/` | no drift |
| release | `npx tsc --noEmit` | exit 0 |
| manual | `node dist/commitlore.mjs uninstall --dry-run` in a scratch HOME | prints a plan, changes nothing |
| **LIVE (required)** | real `install.sh` → `uninstall` cycle in a scratch HOME, with an unrelated MCP entry present beforehand | binary and entry gone; unrelated entry intact |

**Evidence invalidation**

- Bound to `install.sh` lines 282–410 at `e2b5725`. If a `wire_*` function is added or a
  path changes, the agreement test fails by design — that is the mechanism, not a
  breakage.

**Stop / escalate**

- If removing an entry cannot be done without rewriting the whole config file (a format
  with no safe partial edit), stop and report: silently reformatting a user's config is
  worse than declining, and declining with a reason is an acceptable outcome for that
  agent
- If a config file is not parseable, leave it untouched and report it — never rewrite on a
  guess

**Safety checks**

| check | response |
|---|---|
| fail-closed | Anything not recognised as installer-written is left alone |
| wrong-target | A foreign binary at the install path is never deleted |
| ambiguity | The config table is explicit; no globbing for config files |
| timeout | Local filesystem only |
| partial state | Per-agent operations are independent and reported individually; one failure does not abort the rest, and none is reported as done unless it was |
| privacy | Config files may contain tokens for other servers. The command reads them to remove one entry and **must not echo any other entry's contents** into its report |
| prompt injection | Config contents are data; no value from a config is executed |

**Completion evidence**

- Focused and full suites pass; `tsc --noEmit` exits 0; `dist/` has no drift
- A transcript of the real install-then-uninstall cycle showing the unrelated entry intact
- The bidirectional `install.sh` agreement test passing
