# F10 tickets — First-run experience (M5)

> PRD: `docs/prd/PRD-F10-first-run-experience.md` · ADR: 0022, 0013
> Package structure (planned):
> ```
> src/commands/demo.ts          # demo command registration + lifecycle
> src/demo/fixture.ts           # static scenario data (active, superseded, proposal)
> src/commands/init.ts          # modified: summary output + --verbose
> test/demo.test.ts             # demo command tests
> test/init-verbose.test.ts     # --verbose flag tests
> README.md                     # positioning + scene + order
> README.ko.md                  # Korean positioning + scene + order
> README.ja.md                  # Japanese positioning + scene + order
> README.zh-CN.md               # Chinese positioning + scene + order
> ```

---

## T-1010 Demo scenario fixture (S) — #202

**Summary:** Define the fixed active/superseded decision pair and the fixed proposal as static data. No command, no CLI surface — only the data module that T-1011 will consume.

**Owns**

- `src/demo/fixture.ts` (new file)
- `test/demo-fixture.test.ts` (new file)

**Depends on**

- None (leaf ticket)

**Forbidden scope**

- No CLI command registration
- No filesystem operations (the fixture is pure data, not a temp repo creator)
- No changes to `src/commands/`, `src/cli.ts`, or any existing source file

**RED test**

- File: `test/demo-fixture.test.ts`
- Reason: imports `src/demo/fixture.ts` which does not exist → module resolution fails. The test asserts: (a) the fixture exports an active decision, a superseded decision linked by `Supersedes`, and a proposal; (b) each is a valid `CommitMessage` per `spec/schema`; (c) the superseded record's `Record-Id` appears in the active record's `Supersedes` field.

**Minimum GREEN**

- `src/demo/fixture.ts` exports the three records as static objects that pass schema validation and satisfy the lifecycle relationship.

**AC ↔ test**

| AC | Test assertion | PRD-F10 requirement |
|---|---|---|
| Fixture contains an active decision | `expect(active.lifecycle).toBe('active')` | 6 |
| Fixture contains a superseded decision | `expect(superseded.lifecycle).toBe('superseded')` | 6 |
| Lifecycle link is correct | `expect(active.supersedes).toBe(superseded.recordId)` | 6 |
| Fixture contains a proposal | `expect(proposal.lifecycle).toBe('proposal')` | 6 |
| All pass schema validation | `validate(record)` returns no errors for each | 6 |

**Commands**

| Scope | Command | Expected result |
|---|---|---|
| Focused | `npx vitest run test/demo-fixture.test.ts` | 5 tests pass |
| Full | `npx vitest run` | 45 files, 1500+ passed, ≤1 skipped |
| Release | `npx tsc --noEmit && npx tsc -p bench/tsconfig.json --noEmit` | Both exit 0 |
| Manual | `LIVE_NA` — no CLI surface to exercise manually | — |

**Evidence invalidation**

- Bound to HEAD `dd6dfe27ff295c497d73f3cf64fbbd4d75ad5d15`. If HEAD advances and `spec/schema` changes such that the fixture format is invalid, re-validate the fixture against the new schema.

**Stop / escalate**

- If `spec/schema` does not support the `Supersedes` field or `lifecycle` enum values needed for the fixture, escalate to the architect — a schema extension is required before this ticket can proceed.

**Safety checks**

| Check | Mechanism |
|---|---|
| Fail-closed | Fixture validation runs against live schema; a schema-invalid fixture fails the test, not the validator |
| Wrong-target | Fixture is a pure data module with no side effects; cannot modify any file |
| Ambiguity | Fixture records are deterministic constants, not generated |
| Timeout | Schema validation is synchronous and sub-millisecond |
| Partial state | N/A — no filesystem or git state |
| Privacy | Fixture contains only synthetic data (no real repository content) |
| Prompt injection | Fixture text is static constants, not user input |
| Unsupported platform | Pure data — platform-independent |

**Completion evidence**

- `npx vitest run test/demo-fixture.test.ts` passes
- `npx tsc --noEmit` exits 0
- `src/demo/fixture.ts` exists and exports 3 records

---

## T-1011 `commitlore demo` command (M) — #203 · depends on T-1010

**Summary:** Implement the `commitlore demo` command that creates a temporary Git repository, populates it with the fixture from T-1010, runs init + context query, displays the lifecycle filtering result, and removes the temporary directory. Must never write into the user's repository.

**Owns**

- `src/commands/demo.ts` (new file)
- `src/cli.ts` (command registration only — one `import` + one `.addCommand()`)
- `test/demo.test.ts` (new file)

**Depends on**

- T-1010 (fixture data)

**Forbidden scope**

- No network calls (no fetch, no https, no DNS)
- No model or LLM invocation
- No modification to any existing command's behaviour
- No changes to `init` logic (only *calls* `runInit`)
- No `--json` flag on demo (not needed)

**RED test**

- File: `test/demo.test.ts`
- Reason: imports `src/commands/demo.ts` which does not exist → module resolution fails. The test asserts: (a) demo runs without error; (b) the temporary directory does not exist after completion; (c) the user's cwd is not a git repository and remains untouched; (d) on simulated unsupported platform, demo prints a reason and exits non-zero; (e) temporary directory does not exist after a simulated crash.

**Minimum GREEN**

- `commitlore demo` creates a temp repo, populates it with fixture records as git commits with trailers, runs `runInit` + path query, prints the lifecycle-filtered result, removes the temp directory, and exits 0.

**AC ↔ test**

| AC | Test assertion | PRD-F10 requirement |
|---|---|---|
| Demo completes without error | Process exits 0 on supported platform | 1 |
| Temp directory removed on success | `fs.existsSync(tmpDir)` is false after run | 4 |
| Temp directory removed on crash | Simulated throw → `fs.existsSync(tmpDir)` is false | 4 |
| Temp directory removed on SIGINT | Signal handler registered; dir cleaned on signal | 4 |
| User repo untouched | cwd has no `.git/commitlore` after run; no new commits | 2 |
| No network calls | Test stubs `net.connect` / `fetch`; any call fails the test | 3 |
| Unsupported platform message | Mocked `process.platform = 'win32'` → stderr contains reason, exit 1 | 5 |
| Output shows lifecycle filtering | stdout includes the active record, excludes the superseded one | 1 |
| Completes in <30s | Test has a 30-second timeout | 1 |

**Commands**

| Scope | Command | Expected result |
|---|---|---|
| Focused | `npx vitest run test/demo.test.ts` | 9 tests pass |
| Full | `npx vitest run` | 46 files, 1510+ passed, ≤1 skipped |
| Release | `npx tsc --noEmit && npx tsc -p bench/tsconfig.json --noEmit` | Both exit 0 |
| Manual | `commitlore demo` | Prints scenario, exits 0, no leftover in `$TMPDIR` |

**Evidence invalidation**

- Bound to HEAD `dd6dfe27ff295c497d73f3cf64fbbd4d75ad5d15`. If `runInit` signature changes or platform detection moves, re-verify the integration.

**Stop / escalate**

- If `runInit` cannot accept a `cwd` option pointing to the temp directory, escalate — the function signature needs an interface change that affects other callers.
- If the fixture records cannot be committed as valid trailers in a fresh repo (schema requires fields only available post-init), escalate — T-1010 fixture design needs revision.

**Safety checks**

| Check | Mechanism | Named test |
|---|---|---|
| Fail-closed | If temp directory creation fails, exit with error before any git operation | Assert: error path exits non-zero with message |
| Wrong-target (temp dir leak) | `finally` block + signal handlers unconditionally call `fs.rmSync(tmpDir, {recursive: true, force: true})` | **"temp directory removed on crash"** — simulated throw in mid-execution → assert dir gone |
| Wrong-target (user repo write) | Demo asserts `path.resolve(tmpDir) !== path.resolve(cwd)` before any git write; all git commands receive explicit `--git-dir` / `--work-tree` pointing at tmpDir | **"user repo untouched"** — run demo from a git repo cwd → assert no new commits, no `.git/commitlore` |
| Ambiguity | Scenario is deterministic (static fixture); no random IDs, no timestamps in assertions |
| Timeout | Vitest test timeout 30s; demo itself sets a 25s internal timeout and cleans up on expiry |
| Partial state | Cleanup in `finally` — partial state (half-created repo) is still removed |
| Privacy | No user data read; fixture is synthetic |
| Prompt injection | No user input processed; scenario text is static |
| Unsupported platform | Platform check is first operation; on unsupported → print reason → exit 1 → no temp dir created |

**Completion evidence**

- `npx vitest run test/demo.test.ts` passes (all 9 assertions)
- `commitlore demo` manual run produces output and leaves no temp dir
- `npx tsc --noEmit` exits 0
- `ls /tmp/ | grep commitlore` returns nothing after demo completes

---

## T-1012 Result-oriented default `init` output (M) — #204

**Summary:** Replace the default `init` output with a result summary that communicates readiness without requiring knowledge of internal command names. The current `[1/4]`…`[4/4]` detail output moves behind `--verbose`.

**Owns**

- `src/commands/init.ts` — `formatInitReport` function (rewrite to summary style); new `formatInitReportVerbose` or equivalent preserving today's format
- `test/init.test.ts` — updated assertions for new default output
- `test/init-output.test.ts` (new file if needed)

**Depends on**

- None (modifies existing code)

**Forbidden scope**

- No changes to `runInit` logic, step order, exit codes, or `--json` output
- No changes to `InitReport` interface
- No new CLI options in this ticket (`--verbose` is T-1013)
- Must not hide any warning or failure from the output

**RED test**

- File: `test/init-output.test.ts`
- Reason: test imports `formatInitReport` and asserts it produces a summary-style output (≤6 lines for a clean run, names failures). Current `formatInitReport` produces `[1/4]`…`[4/4]` format → assertion fails on line count and content shape.

**Minimum GREEN**

- `formatInitReport` produces a concise summary: e.g., "✓ Hooks installed · ✓ Index built (N records) · ✓ Agent integration registered · ✓ Ready" for clean runs; names each failed/attention step with actionable text. Total ≤6 lines for a clean 4/4 run.

**AC ↔ test**

| AC | Test assertion | PRD-F10 requirement |
|---|---|---|
| Clean run ≤6 lines | `output.split('\n').filter(Boolean).length <= 6` | 7 |
| No internal command names in default | Output does not contain `interpret-trailers`, `notes refspec`, `index --rebuild` as user-facing text | 7 |
| Failure is visible | Simulated step failure → output contains step name + actionable detail | 8 |
| Warning is visible | Simulated doctor warning → output contains the warning | 8 |
| All step outcomes represented | Each of 4 steps has a status indicator in output | 7, 8 |

**Commands**

| Scope | Command | Expected result |
|---|---|---|
| Focused | `npx vitest run test/init-output.test.ts test/init.test.ts` | All pass |
| Full | `npx vitest run` | 45 files, 1500 passed, 1 skipped |
| Release | `npx tsc --noEmit && npx tsc -p bench/tsconfig.json --noEmit` | Both exit 0 |
| Manual | `cd $(mktemp -d) && git init && commitlore init` | Summary output, ≤6 lines |

**Evidence invalidation**

- Bound to HEAD `dd6dfe27ff295c497d73f3cf64fbbd4d75ad5d15`. If `InitReport` interface gains new fields or step count changes from 4, re-verify output shape.

**Stop / escalate**

- If making the output result-oriented requires changing `InitReport` or `InitStep` interfaces, escalate — that touches the `--json` contract and is forbidden here.
- If existing test snapshots in `test/init.test.ts` are tightly coupled to the `[1/4]` format and cannot be updated without breaking `--json` assertions, escalate.

**Safety checks**

| Check | Mechanism |
|---|---|
| Fail-closed | If a step code is 1 or 2, the summary MUST include it; test verifies no code≥1 step is absent from output |
| Wrong-target | Only `formatInitReport` changes; `runInit`, exit codes, and `--json` path are untouched |
| Ambiguity | Output format is deterministic for a given report; no randomness |
| Timeout | N/A — formatting is synchronous string manipulation |
| Partial state | N/A — pure function, no side effects |
| Privacy | No user data in output beyond what `runInit` already reports |
| Prompt injection | N/A — no user input in formatting |
| Unsupported platform | Platform-independent (string formatting only) |

**Completion evidence**

- `npx vitest run test/init-output.test.ts` passes
- `npx vitest run test/init.test.ts` passes (updated assertions)
- `commitlore init` in a test repo produces ≤6-line summary
- `commitlore init --json` output is unchanged (same schema)
- `npx tsc --noEmit` exits 0

---

## T-1013 `init --verbose` flag (S) — #205 · depends on T-1012

**Summary:** Add `--verbose` flag to `init` that produces today's step-by-step `[1/4]`…`[4/4]` output with indented detail lines. This preserves the current output for users who want it, after T-1012 changes the default.

**Owns**

- `src/commands/init.ts` — option registration (`--verbose`), routing to verbose formatter
- `test/init-verbose.test.ts` (new file)

**Depends on**

- T-1012 (the default output must already be the summary; `--verbose` restores the old format)

**Forbidden scope**

- Do not add `--json` (it already exists — C7)
- Do not change `runInit` logic, step order, or exit codes
- Do not change `--json` output
- Do not remove or rename any existing option

**RED test**

- File: `test/init-verbose.test.ts`
- Reason: test invokes `commitlore init --verbose` which currently errors (unknown option) → the process either rejects the flag or produces the summary output instead of verbose. The test asserts: output contains `[1/4]`, `[2/4]`, `[3/4]`, `[4/4]` headings with indented detail lines.

**Minimum GREEN**

- `commitlore init --verbose` produces the `[1/4] hooks install` … `[4/4] doctor --fix (final check)` format with indented substep lines — identical to today's default output format.

**AC ↔ test**

| AC | Test assertion | PRD-F10 requirement |
|---|---|---|
| `--verbose` accepted | Process does not error on `--verbose` | 9 |
| Output matches today's format | Contains `[1/4]`, `[2/4]`, `[3/4]`, `[4/4]` headings | 9 |
| Detail lines indented | Lines after each heading start with 8-space indent | 9 |
| Failures visible in verbose | Simulated failure → output names it | 8, 9 |
| `--json` unchanged | `--json` still outputs JSON regardless of `--verbose` | 10 |

**Commands**

| Scope | Command | Expected result |
|---|---|---|
| Focused | `npx vitest run test/init-verbose.test.ts` | All pass |
| Full | `npx vitest run` | 45+ files, 1500+ passed, ≤1 skipped |
| Release | `npx tsc --noEmit && npx tsc -p bench/tsconfig.json --noEmit` | Both exit 0 |
| Manual | `cd $(mktemp -d) && git init && commitlore init --verbose` | `[1/4]`…`[4/4]` output |

**Evidence invalidation**

- Bound to HEAD `dd6dfe27ff295c497d73f3cf64fbbd4d75ad5d15`. If T-1012 changes the verbose formatter's function name or signature, update the import.

**Stop / escalate**

- If Commander.js has a conflict between `--verbose` and an existing global flag, escalate — needs a naming decision.

**Safety checks**

| Check | Mechanism |
|---|---|
| Fail-closed | `--verbose` routes to the verbose formatter; if the flag is somehow lost, the default (summary) still shows all failures |
| Wrong-target | Only adds an option and a format-routing branch; no behaviour change |
| Ambiguity | Flag is boolean; no value parsing needed |
| Timeout | N/A — formatting only |
| Partial state | N/A — no side effects |
| Privacy | Same as T-1012 |
| Prompt injection | N/A |
| Unsupported platform | Platform-independent |

**Completion evidence**

- `npx vitest run test/init-verbose.test.ts` passes
- `commitlore init --verbose` produces `[1/4]`…`[4/4]` output
- `commitlore init` (without `--verbose`) produces summary output (T-1012)
- `commitlore init --help` lists `--verbose`
- `npx tsc --noEmit` exits 0

---

## T-1014 README positioning and hero (M) — #206

**Summary:** Update the hero section (first heading, subheading, and opening paragraphs) across all four language README files to reflect the decision-authority positioning from ADR-0022. The hero leads with reversal: an agent must not revive a decision the repository already reversed.

**Owns**

- `README.md` — lines 1–25 (hero, badges, tagline, opening paragraphs)
- `README.ko.md` — equivalent hero section
- `README.ja.md` — equivalent hero section
- `README.zh-CN.md` — equivalent hero section
- `assets/readme/hero.svg` (alt text update if the SVG carries the tagline)

**Depends on**

- ADR-0022 (must be accepted before this ticket executes)

**Forbidden scope**

- Do not modify lines below the hero/install section boundary
- Do not touch the `<!-- BENCH:BEGIN -->` … `<!-- BENCH:END -->` block
- Do not delete the exposure table
- Do not alter the install one-liner URL (that is a release concern, not a positioning concern)
- Do not make an effect claim (ADR-0013 boundary)
- Do not modify `scripts/check-readme-numbers.mjs`

**RED test**

- File: `test/readme-positioning.test.ts`
- Reason: test reads all four README files and asserts: (a) the hero section contains "decision authority" or equivalent positioning language matching ADR-0022; (b) the hero does not contain "decision memory" as the primary framing; (c) all four files carry the positioning (not just English). Currently all four say "decision memory" → assertions (a) and (b) fail.

**Minimum GREEN**

- All four README hero sections reflect the decision-authority framing. Each is in its own language. "Decision memory" is no longer the leading framing (it may remain in the body as historical context).

**AC ↔ test**

| AC | Test assertion | PRD-F10 requirement |
|---|---|---|
| English hero has authority positioning | `README.md` hero matches ADR-0022 language | 11 |
| Korean hero has authority positioning | `README.ko.md` hero in Korean | 11, 15 |
| Japanese hero has authority positioning | `README.ja.md` hero in Japanese | 11, 15 |
| Chinese hero has authority positioning | `README.zh-CN.md` hero in Chinese | 11, 15 |
| No forbidden effect claims | None of the four contain "prevents mistakes", "saves cost", "writes better code" in hero | 11 |
| BENCH block untouched | `scripts/check-readme-numbers.mjs` passes | 13 |
| Exposure table preserved | All four contain the exposure/retrieval table | 13 |

**Commands**

| Scope | Command | Expected result |
|---|---|---|
| Focused | `npx vitest run test/readme-positioning.test.ts` | 7 tests pass |
| Full | `npx vitest run` | 45+ files, 1500+ passed, ≤1 skipped |
| Release | `npx tsc --noEmit && npx tsc -p bench/tsconfig.json --noEmit` | Both exit 0 |
| Manual | `node scripts/check-readme-numbers.mjs` | Exit 0 (BENCH block unchanged) |

**Evidence invalidation**

- Bound to HEAD `dd6dfe27ff295c497d73f3cf64fbbd4d75ad5d15`. If the hero section has been modified by another ticket between plan and execution, re-read and merge.

**Stop / escalate**

- If the `hero.svg` file embeds the tagline as baked-in text (not alt-text) and requires a graphic design tool to modify, escalate — this ticket scopes text changes, not SVG redesign.
- If translating the positioning into Korean/Japanese/Chinese requires a native speaker review and none is available, escalate — do not machine-translate positioning copy without review.

**Safety checks**

| Check | Mechanism |
|---|---|
| Fail-closed | `scripts/check-readme-numbers.mjs` runs in CI; any BENCH block byte change fails the build |
| Wrong-target | Changes scoped to hero section only; line ranges verified before edit |
| Ambiguity | ADR-0022 defines the positioning language; no creative interpretation needed |
| Timeout | N/A — text editing |
| Partial state | All four files must be updated atomically in one commit; partial update is a stop condition |
| Privacy | No user data |
| Prompt injection | N/A |
| Unsupported platform | N/A — markdown editing |

**Completion evidence**

- `npx vitest run test/readme-positioning.test.ts` passes
- `node scripts/check-readme-numbers.mjs` exits 0
- `git diff --stat` shows all four README files changed
- Visual inspection confirms no effect claims in hero text

---

## T-1015 README section order (M) — #207 · depends on T-1014

**Summary:** Reorder README sections across all four language files so a concrete scene (the demo scenario or an equivalent narrative showing lifecycle filtering) appears before the retrieval measurement section. Preserves #167's established sequence and does not delete evidence.

**Owns**

- `README.md` — section ordering (lines between hero and Known Limitations)
- `README.ko.md` — equivalent section ordering
- `README.ja.md` — equivalent section ordering
- `README.zh-CN.md` — equivalent section ordering

**Depends on**

- T-1014 (hero must be updated first so the scene follows the new positioning)
- T-1011 (if the scene references `commitlore demo` output; otherwise only needs the concept)

**Forbidden scope**

- Do not hand-edit the `<!-- BENCH:BEGIN -->` … `<!-- BENCH:END -->` block (byte-checked by CI)
- Do not delete the exposure table (PACKET-172 constraint)
- Do not overturn #167's sequence: product → local-first → install promise → install command → evidence. If the required scene placement conflicts with this order, **stop and escalate**.
- Do not modify `scripts/check-readme-numbers.mjs`
- Do not change the content of any section — only its position relative to others

**RED test**

- File: `test/readme-order.test.ts`
- Reason: test reads `README.md` and asserts: (a) a scene section (identified by a heading marker or content pattern) appears before the retrieval measurement heading; (b) the #167 sequence is preserved (product before local-first before install before evidence). Currently no scene section exists → assertion (a) fails.

**Minimum GREEN**

- All four READMEs contain a concrete scene section before the retrieval measurement. The #167 sequence is preserved. The BENCH block is byte-identical. The exposure table exists.

**AC ↔ test**

| AC | Test assertion | PRD-F10 requirement |
|---|---|---|
| Scene before measurement | Scene heading offset < measurement heading offset in `README.md` | 12 |
| #167 order preserved | product < local-first < install-promise < install-command < evidence (by line offset) | 14 |
| BENCH block byte-identical | `scripts/check-readme-numbers.mjs` passes | 13 |
| Exposure table present | All four files contain the exposure table markers or content | 13 |
| All four files ordered consistently | Same relative section order in all four | 15 |
| Korean in Korean | `README.ko.md` scene section text is Korean | 15 |
| Japanese in Japanese | `README.ja.md` scene section text is Japanese | 15 |
| Chinese in Chinese | `README.zh-CN.md` scene section text is Chinese | 15 |

**Commands**

| Scope | Command | Expected result |
|---|---|---|
| Focused | `npx vitest run test/readme-order.test.ts` | 8 tests pass |
| Full | `npx vitest run` | 45+ files, 1500+ passed, ≤1 skipped |
| Release | `npx tsc --noEmit && npx tsc -p bench/tsconfig.json --noEmit` | Both exit 0 |
| Manual | `node scripts/check-readme-numbers.mjs` | Exit 0 |

**Evidence invalidation**

- Bound to HEAD `dd6dfe27ff295c497d73f3cf64fbbd4d75ad5d15`. If README sections have been reordered by another ticket, re-read current state before executing.

**Stop / escalate**

- **If placing a scene before measurement requires breaking #167's sequence** (product → local-first → install promise → install command → evidence), this is a stop-and-escalate condition — not a judgement call. The ticket does not authorise overturning that order.
- If the BENCH block's byte position changes due to section moves and `check-readme-numbers.mjs` fails because it depends on absolute line numbers rather than markers, escalate — the script may need adjustment (but this ticket must not modify it).

**Safety checks**

| Check | Mechanism |
|---|---|
| Fail-closed | `scripts/check-readme-numbers.mjs` in CI blocks any BENCH block byte drift |
| Wrong-target | Only section *positions* change; no section content is modified |
| Ambiguity | #167 order is explicit and testable by line offsets |
| Timeout | N/A — text editing |
| Partial state | All four files must be updated together; a partial update (only English) is a stop condition |
| Privacy | No user data |
| Prompt injection | N/A |
| Unsupported platform | N/A — markdown editing |

**Completion evidence**

- `npx vitest run test/readme-order.test.ts` passes
- `node scripts/check-readme-numbers.mjs` exits 0
- `git diff --stat` shows all four README files changed
- Manual read confirms scene appears before measurement in each file
- #167 sequence remains intact (verified by test)

---

## T-1016 Deterministic README demo recording (S) — #212 · depends on T-1010, T-1011, T-1015

**Summary:** Generate the README GIF (or equivalent checked-in animation) from
the exact `commitlore demo` fixture and output. This closes the source review's
explicit requirement that the README recording and demo use the same scenario,
instead of maintaining a second hand-authored story.

**Owns**

- `scripts/record-demo.mjs` (new deterministic recorder)
- `docs/assets/commitlore-demo.gif` (new generated asset; an equivalent
  checked-in animation format is allowed only if all four README renderers
  support it)
- the single asset reference in each of `README.md`, `README.ko.md`,
  `README.ja.md`, `README.zh-CN.md`
- `test/demo-recording.test.ts` (new)

**Depends on**

- T-1010 (canonical fixture)
- T-1011 (canonical command output)
- T-1015 (final README section location)

**Forbidden scope**

- No alternate scenario text, fake terminal output, network call, or model call
- No screenshots containing local usernames, private paths, shell history, or
  unrelated repository content
- Do not alter the BENCH block, exposure table, install instructions, or demo
  command behaviour
- Do not introduce a browser/runtime dependency solely for recording if a
  repository-native terminal renderer already suffices

**RED test**

- File: `test/demo-recording.test.ts`
- Reason: no generated recording or reproducibility script exists, so the
  README cannot prove it shows the same fixture/output as `commitlore demo`.

**Minimum GREEN**

1. The recorder invokes the built `commitlore demo` against its fixed fixture
   with stable terminal dimensions, locale, and colour settings.
2. It normalises non-semantic clock/temp-path data before rendering.
3. It writes one checked-in animation and all four READMEs reference that same
   asset.
4. A `--check` mode regenerates to a temporary location and compares the bytes
   (or a canonical frame manifest) without modifying the repository.
5. The asset contains no absolute path, username, hostname, token, or private
   repository content.

**AC <-> test**

| AC | Test assertion | PRD-F10 requirement |
|---|---|---|
| Recording uses canonical fixture | captured scenario ids equal T-1010 fixture ids | 16 |
| Recording uses canonical output | frame manifest contains T-1011 output lines in order | 16 |
| Reproducible | `node scripts/record-demo.mjs --check` exits 0 | 16 |
| One shared asset | all four READMEs reference the same path | 15, 16 |
| Privacy clean | decoded frame text has no absolute/private identifiers | 16 |

**Commands**

| Scope | Command | Expected result |
|---|---|---|
| Focused | `npx vitest run test/demo-recording.test.ts` | all assertions pass |
| Reproduction | `node scripts/record-demo.mjs --check` | exit 0, no diff |
| README | `node scripts/check-readme-numbers.mjs` | PASS |
| Full | `npx vitest run` | 45+ files, 1500+ passed, <=1 skipped |

**Evidence invalidation**

- Any change to the demo fixture, demo output formatter, recorder, asset, or
  README asset reference invalidates the recording evidence and requires
  `--check` plus focused tests again.

**Stop / escalate**

- Stop if deterministic bytes are impossible across supported platforms;
  define and test a canonical frame manifest instead of accepting visual drift.
- Stop if the chosen renderer adds a production dependency or network access.
- Stop if any private identifier appears in decoded output.

**Safety checks**

| Check | Mechanism |
|---|---|
| Fail-closed | `--check` fails on any scenario/output/asset mismatch |
| Wrong-target | output path is a fixed repository-relative asset path |
| Ambiguity | one canonical fixture, one command, one shared asset |
| Timeout | recorder has an explicit upper bound and kills a hung demo |
| Partial state | generate to temporary sibling, atomic rename only after validation |
| Privacy | decoded text scanner rejects absolute paths/user/host/token patterns |
| Prompt injection | all content is the static fixture; no user input |

**Completion evidence**

- Reproducibility command and focused/full test output tied to exact HEAD
- Four README references re-read from the merged diff
- Asset privacy scan output
