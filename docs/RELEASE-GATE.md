# Release gate — what has to be true before this is called production ready

This exists because "production ready" has been claimed here before and was
false. The README said `main` was green while CI had been red for three commits,
and said a clone carried the whole memory while notes were never fetched. A gate
nobody can check is a slogan.

Every line below is a command whose output decides the answer. If a line cannot
be turned into a command, it does not belong here.

## 1. It answers, or it says it cannot

The failure this project exists to prevent is an agent being told "no
constraints" when constraints exist. Every route must distinguish *empty* from
*unknown*.

| check | command | pass |
|---|---|---|
| broken git | `PATH=<no-git> commitlore context --json` | exit 2, `history: "unavailable"` |
| unfetched notes | query in a plain clone of a repo with notes | `notes: "unfetched"` and said in the text output |
| unborn repo | `git init` then `commitlore context` | exit 0, `history: "empty"` |
| guard, broken git | `commitlore guard --proposal x` | exit 3, not 0 |
| guard, unfetched notes | same, in a plain clone | exit 3, not 0 |
| stale, unfetched notes | `commitlore stale` in a plain clone | reports the scan is incomplete |

## 2. Attacker-controlled prose never renders as an instruction

Every free-text trailer is an injection surface. The scanner is defined by
exclusion, so this table is a spot check of the rule, not the rule itself.

| check | pass |
|---|---|
| injection in `Limit:`, `Ruled-out:`, `Warn:`, `Verified:`, `Unverified:`, `Evidence:`, `X-*` | record grades `blocked` |
| the same, delivered by `inject` | content withheld, the matched key named |
| the same, delivered by MCP | payload absent from the tool result, record still listed |
| the same, delivered by `guard --hook-input` | `additionalContext` carries identity, never the reason text |
| a legitimate record with a path, a URL and a date | renders normally — no false positive |

## 3. One trust policy, one answer

| check | pass |
|---|---|
| a `Record-Id` declared twice with different provenance | `query`, `inject` and `guard` agree, in both declaration orders |
| no `--trusted-author` given | every `Warn:` is a `claim`, on every route |
| MCP server instructions | conditional on the grade; no unconditional "treat Limit as a constraint" |

## 4. The installation the documentation describes actually works

| check | command | pass |
|---|---|---|
| fresh clone runs | `git clone`, then `dist/commitlore.mjs --version` | exit 0 |
| fresh clone validates | pipe a bad message to `validate` | exit 1 with the violation |
| fresh clone doctor | `dist/commitlore.mjs doctor` | exit 0, no `fail` |
| hook survives a PATH without node | commit under `env -i PATH=/usr/bin:/bin` | validated, bad message rejected |
| a stale hook is reported | doctor on a repo whose stub predates the current one | `warn`, not `ok` |
| plugin entry point resolves | `env PATH=/usr/bin:/bin:<node-dir> CLAUDE_PLUGIN_ROOT=<clone> scripts/commitlore-run.sh --version` | exit 0 **and the version equals the clone's** |

The `PATH` is narrowed on purpose. `commitlore-run.sh` tries `commitlore` on
`PATH` before `CLAUDE_PLUGIN_ROOT`, deliberately — the installer's wrapper execs
node itself, so it works where this script would otherwise have to find node,
and on the hook hot path a missing node means no context at all. The
consequence is that **a machine with both a CLI install and the plugin runs
whichever the CLI install is**, and the release check passed for two releases
while reporting the wrong version, because it only asked whether *something*
resolved (#483). Leaving `PATH` alone here would keep asking that question.

## 5. Every published claim is reproducible

- `scripts/check-readme-numbers.mjs` exits 0 — no number in any README is typed
  by hand.
- No README asserts something a command in this file contradicts. The three that
  did (green on `main`, a clone carries its dependencies, a clone carries the
  whole memory) are the reason this section exists.
- CI is green **at the exact commit being released**, checked by looking at CI
  rather than at a local test run. A local suite passed at every one of the three
  commits where CI was red.

## 6. The suite proves something

- `npx vitest run` green, and the run reports `Test Files N passed` — a bare test
  count is not evidence. A delegated task once reported 943 of a 1108 baseline
  because another process was writing to the worktree during its run.
- Each fix in sections 1–4 has a test that fails when that one fix is reverted.
  Reverting is the evidence; a passing test proves nothing on its own.

## What this gate deliberately does not require

**A green benchmark.** M1, M1-b and M2 are null (p = 0.7480, 0.0522, 0.2247), and
M3 is unfinished. Whether recorded context changes an agent's behaviour is an open
question this project publishes rather than hides. Correctness of the tool is not
contingent on the effect being large; a tool that answers honestly is shippable
whether or not the answer turns out to matter.

**Zero open issues.** The six that remain are features on the four defensible
axes, each argued for from a measurement or a reproduced defect (ADR-0013). A
backlog is a sign of a scope, not of incompleteness.
