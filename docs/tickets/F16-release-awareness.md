# F16 tickets — Knowing a newer release exists (#742)

> PRD: [PRD-F16-release-awareness.md](../prd/PRD-F16-release-awareness.md)
> ADR: [0037](../adr/ADR-0037-the-cli-does-not-replace-itself.md) (the CLI does not reimplement installing)
> Issue: [#742](https://github.com/MongLong0214/commitlore/issues/742)
> Baseline head: `5433704`. Revision 2 — see PRD-F16 "What the prior art actually does" for what changed and why.

**Ordering is strict.** T-1601 → T-1602 → T-1603 → T-1604. The comparison lands before anything calls the network, and the network lands before anything prints.

**Nothing in this feature may make a command fail.** Every ticket's acceptance includes a case that breaks its own dependency and requires the command to succeed anyway. A release check that can break `commit` is worse than no release check.

**The notice and the command do not share a suppression table.** This is the correction that revision 1 most needed: a notice nobody asked for defers to context (`CI`, no TTY, hook subcommand), and a command the operator typed does not. Wiring both to one table makes `commitlore update --check` return a silent "unknown" inside the nightly job it exists to serve. T-1602 owns the mechanism; T-1603 and T-1604 own their own gates.

---

## T-1601 Compare two versions, the way the installer already does (S)

**Owns**

- `src/core/release-version.ts` (new) — parse and compare
- `test/release-version.test.ts` (new)

**Depends on** — nothing.

**Why first.** Every later ticket is worthless if this is wrong, and it is the piece with no I/O, so it can be exhaustively tested.

**Match the installer, do not invent a second ranking.** `install.sh:396-411` already ranks tags, zero-pads each field to avoid `sort -V`, and considers only `vMAJOR.MINOR.PATCH` so a pre-release cannot tie with its release and win on string length. Two rankings that disagree is a defect with no symptom until the day it has one.

**Acceptance**

- `1.1.10` is newer than `1.1.9`. That exact pair is a named case, because it is the one a string comparison gets wrong and the one a real release stream reaches.
- `1.2.0` newer than `1.1.99`; `2.0.0` newer than `1.99.99`; `v10.0.0` newer than `v9.0.0` — the case `install.sh:396-400` exists to fix.
- A prerelease is **older** than its release: `1.2.0-rc.1` < `1.2.0`. Whether one is ever offered is T-1602's question; comparing them cannot be left undefined.
- Equal versions are not newer. `0.0.0-unknown` — what `runtimeIdentity` returns when the manifest is unreadable — compares as older than everything and never triggers a notice, because "we do not know what is running" must not become "you are out of date".
- **If either side fails to parse, the answer is "not newer", never a throw and never a silent zero.** `gh` takes the same line (`update.go:186`: the comparison is `ve == nil && we == nil && ...`), and it is the safe direction — an unparseable version produces silence, not a false alarm.
- A test feeds the ranking the same tag list `install.sh` would see and asserts both pick the same winner.

---

## T-1602 Ask git, once a day, and never fail because of it (M)

**Owns**

- `src/core/latest-release.ts` (new) — resolve, cache, and the mechanism the gates are built from
- `test/latest-release.test.ts` (new)

**Depends on** — T-1601.

**The source is `git ls-remote --tags --refs`, not the GitHub API.** PRD-F16 records the correction: revision 1 justified the API by claiming the install path already used it, and `install.sh` contains zero `api.github.com` calls. Using `git ls-remote` against the `COMMITLORE_INSTALL_SOURCE`-aware URL removes the 60-per-hour unauthenticated rate limit entirely, works where `api.github.com` is blocked but git is not, and follows a mirror for free.

**Owns the off-switches — the ones that express a decision, not a context:**

```
COMMITLORE_NO_UPDATE_CHECK set   off
DO_NOT_TRACK set                 off        its stated scope names autoupdates, not just analytics
NO_UPDATE_NOTIFIER set           off        the de-facto convention; honouring it costs one line
a config-file switch             off        an org can ship a file to a fleet; it cannot guarantee
                                            an env var in every shell (Terraform's disable_checkpoint)
cache younger than 24h           no request; the cached answer, with its age
```

**Context-dependent gates (`CI`, TTY, hook subcommand) are NOT here.** They belong to the notice, and T-1604 owns them. A module that applies them is a module `commitlore update --check` cannot use.

**Acceptance**

- With git unreachable, a spawn that fails, a non-zero exit, a timeout, output that matches no tag, and a repository with no tags at all: **each returns "unknown" and none throws.** Six named cases, because they are six different code paths and one shared `catch` hides which one ran.
- **A failed check is cached too, and this is a deliberate departure from `gh`.** `gh` writes its state only after a successful fetch (`update.go:103`), so an offline machine retries on every single invocation forever. Cheap in latency, but it is an outbound attempt per command — exactly what an egress-monitoring organisation flags. A test asserts that two consecutive calls with the network down produce **one** spawn.
- The timeout is enforced by a test that never waits for it in real time — an injected clock or an aborted controller, not a sleep. `verify-the-fix-not-just-the-tests`: a property timed against a real clock passes vacuously on a slow machine.
- **Cancellation kills the child process.** The source is a spawned `git`, not a socket, so an aborted check that leaves `git ls-remote` running has not been cancelled. A test asserts the process is gone.
- A cache file that is truncated, empty, from a future schema, or owned by another user reads as absent.
- Two concurrent calls do not corrupt the cache and neither throws.
- `COMMITLORE_INSTALL_SOURCE` is honoured, asserted by pointing it at a local fixture repository — which also gives every test above a real remote to run against without touching the network.

**Not in scope** — printing anything. This ticket has no output.

---

## T-1603 `commitlore update` (S)

**Owns**

- `src/commands/update.ts` (new)
- `src/cli.ts` — one registration
- `test/update-command.test.ts` (new)
- `docs/cli.md`, the four READMEs — one row each

**Depends on** — T-1602.

**Behaviour**

```
commitlore update            current, latest, and the exact install command. Exit 0.
commitlore update --check    the same answer without prose. Exit 0.
commitlore update --json     { current, latest, updateAvailable, command, source, checkedAt }
```

**Acceptance**

- **`--check` exits 0 whether or not an update exists**, and the decision is made here rather than deferred. `src/commands/auto.ts:16` settled the shape — *"with 0 whether the setting is on or off (the answer is not a finding)"* — and `stale` exits 0 even when it finds something. A version query has no violation to report. Scripts branch on `--json`, as they do with `doctor`. Non-zero remains reserved for a check that could not be performed at all (2, usage) — never for "you are out of date".
- **It answers inside CI and off a terminal.** A test runs it with `CI=1` and no TTY and asserts a real answer, not silence. This is the revision-1 defect: the shared suppression table would have made the one scriptable command unusable in the one place scripts run.
- It still honours the explicit off-switches, and says so: with `COMMITLORE_NO_UPDATE_CHECK` set, it reports that checking is disabled rather than reporting "up to date".
- With the check unavailable, `update` says it **does not know** rather than "you are up to date". Those are different answers and only one of them is true.
- ADR-0037 is enforced, not merely stated: **a test asserts the command spawns no process other than the `git ls-remote` the check owns, and writes nothing outside the cache.** A comment saying it does not self-update is not the guard; #723 is the precedent for putting the rule where it is enforced.
- The printed command matches the README's install one-liner exactly, asserted against the README rather than duplicated as a literal — the two drifting is #727's shape. **And it is the right platform's line**: a test asserts the Windows path prints the `install.ps1` invocation, because naming a command that cannot work is the failure `gh` avoids by printing a URL instead, and we only get to be more helpful than `gh` if the command is correct.

---

## T-1604 The passive notice (M)

**Owns**

- `src/cli.ts` — the one place the notice is emitted, and the gates that are its alone
- `test/update-notice.test.ts` (new)

**Depends on** — T-1603 merged and used at least once by hand.

**Owns the context gates.** These do not live in T-1602 because they apply to an uninvited line, not to an answered question:

```
CI set                            silent
stdout OR stderr is not a TTY     silent      gh requires both (update.go:88); the notice goes to
                                              stderr, so a redirected stderr is a polluted log
hook-invoked subcommand           silent
--json anywhere                   silent
the command itself failed         silent      gh's cmd.go:253; they are already reading an error
```

**Latency is zero by construction, not by timeout.** `gh` starts the check in a goroutine (`cmd.go:143-152`) and calls `updateCancel()` before reading the result (`cmd.go:255`), so a slow network aborts and the notice is simply skipped. Take the same shape: start it concurrently with the command, cancel at completion, print only what already finished.

**Acceptance, and this ticket is mostly negative cases**

- **Silent for `prepare-commit-msg`, `post-commit`, `pre-push`, `mcp`, and every `--json` invocation.** The first writes the commit message file, so a stray line is a corrupted commit; the fourth speaks a protocol. Each is a named case rather than one loop, so a future command added to the list cannot be quietly dropped from the test.
- The notice goes to **stderr**, never stdout.
- Silent when stdout is a TTY but stderr is not, and the reverse. Two cases, because one `isatty` call passes both by accident.
- A command's exit code is identical with the notice enabled and disabled, including when the command itself failed — and in that case no notice is printed at all.
- **A command's wall-clock is unchanged when the check hangs**, asserted with a check that never resolves. This is the property the concurrency buys; if it is not tested, the design is decoration.
- At most one notice per invocation, and at most one per day per machine.
- Breaking the release check entirely leaves every command's behaviour unchanged, asserted by a case that injects a throwing check.
