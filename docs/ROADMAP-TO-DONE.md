# Roadmap to done — the three goals, sequenced by what unblocks what

Written 2026-07-27, after an external re-review returned FAIL / NO-GO at
`7efba5c` with seven blockers, six of which reproduced here.

This is not a wish list. Every phase has a gate that is a command, and no phase
starts before the previous gate passes. The order is chosen so that each phase
makes the next one *verifiable*, not merely because of severity.

---

## Phase 0 — CI green (blocks everything)

**Why first.** CI has been red for five commits. While it is red, no other fix can
be shown to work: the only evidence that matters is a clean runner, and a clean
runner currently fails for an unrelated reason. Every claim made on top of a red
CI is a claim about a local machine.

| item | what |
|---|---|
| B3 | Five `test/stale.test.ts` cases fail on a clean runner: identity passed with `-c` never reaches `writeRecord`'s own git. One further case differs on count. |

Also in scope: one shared repository factory, because these five tests repeated a
trap already documented in a sibling file's comment. A rule that lives in a
comment gets re-broken; a rule that lives in a function does not.

**Gate.** `gh run list` shows `success` at the pushed HEAD. Not a local run.

---

## Phase 1 — what the agent is told (the product's only claim)

Both of these decide what reaches a model. Nothing else in the backlog does.

| item | what |
|---|---|
| B4 | CLI prints the payload of a record graded `blocked`. `inject`, MCP and `guard` all withhold it. Agents run the CLI through a shell — that is the product's premise — so "a human reads the terminal" is not a defence. |
| B4b | `limits` and `ruled-out` show no grade at all, so `blocked` and `directive` render identically. An invisible grade does nothing. |
| B1 | `git config commitlore.bin /anything` redirects the hook to an arbitrary executable, and `hooks status` + `doctor` still report the hook healthy. |

**B1 is a tamper-detection bypass, not a privilege escalation.** Measured: the
malicious config does not survive `git clone`, and `.git/config` and `.git/hooks`
sit behind the same permission — an attacker who can set one can overwrite the
other. It is closed because *our own integrity check looks at a channel the hook
does not use*, and because setting a config key is quieter than writing an
executable into `.git/hooks`.

**Gate.** The two reproductions in `PRODUCTION-REREVIEW` no longer reproduce, shown
by command output; CI green.

---

## Phase 2 — the index cannot lie about being complete

| item | what |
|---|---|
| B5 | `rebuildIndex` commits a full DELETE, then reads git, then inserts. A failure between them leaves an index that is empty and reports itself healthy. |
| B5b | Audit the whole module. r-4b17f8 fixed this exact shape in `indexNotes` and the class survived in a sibling — a named-function fix left the pattern alive. |
| B6 | A query over an unfetched notes mirror exits 0. `guard` exits 3 for the same condition. One incompleteness, two exit codes. |

**Gate.** A rebuild interrupted mid-flight leaves the previous index intact,
proven by an injected failure; `context` and `guard` agree on the exit code for
an incomplete answer; CI green.

---

## Phase 3 — the documented installation is the one that works

| item | what |
|---|---|
| B2 | `plugin.json` declares `"hooks": "./hooks/hooks.json"` while that file already sits at the conventional path. The manifest field is documented as additive, so the PreToolUse hook is likely registered twice. |
| B7 | README says CI is green on `main`. It has not been for five commits. |

The manifest also has no test at all: nothing checks that its version matches
`package.json`, that its command paths exist, or that a clone carries the files.

**Honest limit:** a true Claude Code plugin install/load end-to-end needs Claude
Code in CI and cannot be faked. What is testable is the manifest and its
references, and the test must say so in its own header rather than implying more.

**Gate.** Manifest test suite green; a fresh clone carries every declared file;
`plugin.json` no longer re-declares a conventional path; CI green.

---

## Phase 4 — the evidence

| item | what |
|---|---|
| M3-b | Re-run the guard-route measurement from a clone pinned to a commit, outside this working tree, with its own `dist/`. §14 unchanged; §15 records why M3 was voided. |
| Gate | `docs/RELEASE-GATE.md`, every line, run and recorded. |

M3 was voided because the harness read `dist/` out of the tree its operator was
rebuilding. The clone is prepared; `dist_digest` now covers the whole tree, so a
mid-run change refuses at report time instead of passing silently.

**This phase produces a verdict, not a result we want.** M1, M1-b and M2 are null.
M3-b may be null too. The release gate deliberately does not require a positive
benchmark: a tool that answers honestly ships whether or not the effect is large.

---

## Phase 5 — goal 2: gitseed is a product, not a library

Done: four features, a pipeline that refuses to hide an incomplete run, a CLI
whose default cannot write, 147 tests, and five defects found by running it for
real rather than by testing it.

| item | what |
|---|---|
| G6 | CI. gitseed has none. Everything known about it comes from this machine. |
| G7 | The review queue has never completed a cycle: approval needs a TTY, and no run has reached it — the first was killed by a timeout, the second by an unencoded URL, the third by an exhausted quota. Prove one full cycle with a scripted pty, ending in a CommitLore trailer block that `commitlore validate` accepts. |
| G8 | The forbidden-resource branch of the 403 classifier is covered only by injected responses. Either exercise it or mark it unverified in the README. |

**No live star or follow is performed.** The cycle is proven up to the approval
and the trailer block. Performing the action against a third party is the owner's
to run, not this session's.

---

## Phase 6 — goal 3: the loop writes itself down

The feedback loop worked: gitseed's live use found six CommitLore or gitseed
defects that the test suites did not. What has not happened is folding what was
learned back into `~/.claude/skills/repo-factory` so the next project starts
ahead of this one.

| item | what |
|---|---|
| S1 | The recurring defect shape — *two different facts collapsed into one message* — appeared five times in four days: unfetched notes read as an empty repository, broken git read as no records, a `contains` probe read as an unknown key, a rate limit read as a refusal, and an incomplete scan read as a clean one. Write it into the skill as a review question, not as prose. |
| S2 | The verification rule that actually caught things: **test the fix against the incident, not against its own tests.** Two fixes for the M3 failure passed their own suites and did not cover the M3 failure. |
| S3 | The delegation rules earned this session: report `Test Files N` not just a count; never `git add -A`; a delegate's green suite is a claim to re-run. |

---

## Sequencing rules that hold throughout

**One delegated task at a time per repository.** Two concurrent runs in one
worktree produced a false test count (943 of a 1108 baseline) and a mixed diff.
Different repositories may run in parallel.

**Commit by named path.** `git add -A` swept documents into two unrelated commits
today.

**CI is checked before the word "green" is used.** It was claimed five times
today against a red CI, including in the commit that introduced the rule saying
not to.

**A delegate's report is a claim.** T9 reported a green suite for a fix that would
not have caught the incident it was written for; it was found by testing the fix
against the incident.
