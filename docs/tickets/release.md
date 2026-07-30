# Release ticket — v0.1.0 (M4)

---

## T-901 v0.1.0 release (S) — #27 · depends on T-601, T-704

**Checklist**
- [x] Tag push + GitHub release — no registry (ADR-0011)
- [ ] git tag `v0.1.0` + GitHub Release — release notes cite only measured numbers (bench/results)
- [x] After `git clone`, smoke `node dist/cli.js --version` / `doctor`
- [ ] Public-transition checklist: final README review → `gh repo edit --visibility public` **after owner approval** (approval gate — no automatic transition)
- [ ] After going public, confirm skills.sh registration (`npx skills add MongLong0214/commitlore`)

**AC**: entire checklist above. npm distribution and tagging can be completed while still private.

---

## T-1030 Diagnostic honesty: doctor hook-failure message (S) — #192

**Owns**

- `src/commands/doctor.ts` — the hook-failure diagnostic at line 453 (at `dd6dfe2`), specifically the template string `the hook fails when git's PATH carries no node: ${said}`

**Depends on**

- Nothing — this is a standalone honesty fix

**Forbidden scope**

- Do NOT fix the intermittent hook failure itself — this ticket owns the diagnostic message only
- Do NOT modify the release gate, merge anything, or tag anything
- Do NOT touch `src/mcp/server.ts`, `src/hooks/`, or any hook registration logic
- Do NOT alter exit codes or the `check()` function signature
- A root-cause fix for the intermittency is NOT guaranteed by this ticket

**Scope (CEO amendment — binding).** This ticket is **diagnostic honesty only**. It does not
explain, reproduce or fix the intermittent failure, and it **may not close #192 on its own**:
#192 has been split, and the node-22 intermittency is tracked separately. Closing this ticket
means the probe stops asserting a cause it cannot determine — nothing more.

**RED test**

- File: `test/doctor.test.ts` (new or addition to existing)
- Reason: a test simulates a hook that exits non-zero with stderr containing a node stack trace (e.g., `at Object.<anonymous> (/path/dist/mcp/server.js:49:1)`) and asserts the diagnostic message does NOT claim "git's PATH carries no node". The test must fail on `dd6dfe2` because the current code unconditionally interpolates `${said}` into the sentence "the hook fails when git's PATH carries no node: ..." regardless of whether the stderr indicates a missing-node problem or a runtime error.

**Minimum GREEN**

1. The diagnostic distinguishes at least two cases:
   - stderr suggests node is missing (e.g., `node: not found`, `ENOENT`, no stack trace): message says the hook cannot find node
   - stderr contains a node stack trace or other runtime error: message says the hook ran but failed, and quotes the first line of stderr without asserting a cause
2. If the cause cannot be determined from stderr, the message says so explicitly rather than guessing
3. The `'ok'` path message is unchanged
4. The diagnostic never names a cause it has not verified from the stderr content

**AC <-> test**

| AC | Test assertion | Traces to |
|----|----------------|-----------|
| Node-missing case diagnosed correctly | stderr `"sh: node: not found"` → message mentions missing node | #192 |
| Runtime-error case does not claim missing node | stderr with stack trace → message does NOT contain "carries no node" | #192 |
| Unknown case names uncertainty | stderr with unexpected content → message contains "cause unclear" or equivalent | #192 |
| OK path unchanged | hook exits 0 → message unchanged | Forbidden scope |

**Commands**

| scope | command | expected |
|-------|---------|----------|
| focused | `npx vitest run test/doctor.test.ts` | pass, including new assertions |
| full | `npx vitest run` | 45 files, 1500+ passed, 1 skipped |
| release | `npx tsc --noEmit && npx tsc --noEmit -p bench/tsconfig.json` | both exit 0 |
| manual | `node dist/commitlore.mjs doctor` in a repo with a working hook | ok message |
| LIVE_NA | Cannot reproduce #192's intermittent failure on demand — the diagnostic honesty is testable via mock, the intermittency itself is not | intermittent by nature |

**Evidence invalidation**

- Bound to HEAD `dd6dfe27ff295c497d73f3cf64fbbd4d75ad5d15`. If `src/commands/doctor.ts` line 453 region changes on another branch first, rebase and re-verify line targeting.

**Stop / escalate**

- If the hook-failure diagnostic is used in more places than line 453, audit all call sites before changing the pattern
- If determining "node is missing" vs "node threw" requires parsing more than the first line of stderr, document the heuristic explicitly and accept false-uncertain over false-confident

**Safety checks**

| check | response |
|-------|----------|
| fail-closed | If the heuristic cannot determine the cause, it says "cause unclear" — never fabricates a diagnosis |
| wrong-target | Only the diagnostic string at ~line 453; a diff touching the hook execution logic itself is wrong |
| ambiguity | The exact current string is quoted above; the replacement must be strictly more honest |
| timeout | Single-file change; no build time risk |
| partial state | The diagnostic is a single code path; atomic |
| privacy | stderr may contain file paths — acceptable to quote as diagnostic context |
| prompt injection | stderr comes from a subprocess, not user text input; but it may contain attacker-controlled content if the hook processes untrusted input — quote only the first line, do not eval |

**Completion evidence**

- `git diff src/commands/doctor.ts` shows only the diagnostic string change
- `npx vitest run test/doctor.test.ts` passes with all case-distinction assertions
- Full test suite: 45 files, 1500+ passed, 1 skipped
- `npx tsc --noEmit` exits 0

---

## T-1031 README install one-liner and pin correction (S) — #211 · UNBLOCKED by v0.3.0

**Owns**

- `README.md` line 26 (install one-liner: `curl ... /dev/install.sh`)
- `README.md` lines 71–72 (pinned install example: `v0.2.0`)
- Equivalent lines in `README.ko.md`, `README.ja.md`, `README.zh-CN.md` if they carry the same install block

**Depends on**

- **SATISFIED PREREQUISITE:** `v0.3.0` exists and resolves to merge commit
  `16e2cfdabe22097969d47462d40d4c47425b0b19`; the public release contains four
  platform assets plus `SHA256SUMS`. Re-resolve the tag before implementation
  and stop if it no longer points to that immutable commit.

**Forbidden scope**

- Do NOT create a git tag — tagging is owner-gated and part of the release process (T-901)
- Do NOT modify the release gate, merge anything, or tag anything
- Do NOT alter the `BENCH:BEGIN`/`BENCH:END` block (byte-checked by `scripts/check-readme-numbers.mjs`)
- Do NOT change `package.json` version
- Do NOT alter `install.sh` logic
- The release itself is owner-gated and outside this ticket

**RED test**

- File: `test/readme.test.ts` (new or addition)
- Reason: a test asserts (a) the install one-liner references a tag (not a branch name like `dev`), and (b) the pinned version string matches `package.json` version. This test must fail on `dd6dfe2` because line 26 references the `dev` branch and lines 71-72 say `v0.2.0` while `package.json` is `0.3.0`.

**Minimum GREEN**

1. Install one-liner at README.md:26 references a tagged release (e.g., `v0.3.0`), not the mutable `dev` branch
2. Pinned example at README.md:71-72 says `v0.3.0` (matching `package.json`)
3. Equivalent corrections in other language README files if they carry the same install examples
4. `scripts/check-readme-numbers.mjs` still passes

**AC <-> test**

| AC | Test assertion | Traces to |
|----|----------------|-----------|
| One-liner does not reference `dev` branch | `expect(line26).not.toContain('/dev/')` | P0-1 (supply-chain exposure) |
| One-liner references a tag | `expect(line26).toMatch(/\/v\d+\.\d+\.\d+\//)` | P0-1 |
| Pin matches package.json | `expect(pinVersion).toBe(packageJsonVersion)` | P0-1 |
| BENCH block untouched | `check-readme-numbers.mjs` passes | Forbidden scope |

**Commands**

| scope | command | expected |
|-------|---------|----------|
| focused | `npx vitest run test/readme.test.ts` | pass (only after v0.3.0 tag exists) |
| full | `npx vitest run` | 45 files, 1500+ passed, 1 skipped |
| release | `npx tsc --noEmit && npx tsc --noEmit -p bench/tsconfig.json` | both exit 0 |
| manual | `curl -fsSL <new-url> \| sh` in a clean environment | installs the tagged version, not dev |
| LIVE_NA | Cannot test installation from a tag that does not yet exist — manual verification is post-tag only | tag prerequisite |

**Evidence invalidation**

- Bound to HEAD `dd6dfe27ff295c497d73f3cf64fbbd4d75ad5d15`. This ticket becomes actionable only after a `v0.3.0` tag exists. If the README install section is edited by another ticket first, rebase.

**Stop / escalate**

- If `v0.3.0` tag does not exist, this ticket CANNOT proceed — do not invent a tag or reference a nonexistent version
- If `install.sh` does not support tag-based download (only branch-based), escalate — the install script needs a change first

**Safety checks**

| check | response |
|-------|----------|
| fail-closed | If the tag does not exist, the ticket is blocked — never reference a nonexistent version |
| wrong-target | Only install-related lines in README files; a diff touching any other section is wrong |
| ambiguity | The exact lines are identified by number; the target version comes from `package.json` |
| timeout | Static file edits; no build time risk |
| partial state | All README files must be updated together; a PR with only the English README is incomplete |
| privacy | No PII |
| prompt injection | Static content; no user input involved |

**Completion evidence**

- `git diff README.md README.ko.md README.ja.md README.zh-CN.md` shows install URL and pin version changes only
- `node scripts/check-readme-numbers.mjs` passes
- `git tag -l 'v0.3.0'` confirms the tag exists (prerequisite)
- `npx vitest run` full suite passes
