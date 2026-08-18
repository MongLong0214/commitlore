# F16 tickets — Knowing a newer release exists (#742)

> PRD: [PRD-F16-release-awareness.md](../prd/PRD-F16-release-awareness.md)
> ADR: [0037](../adr/ADR-0037-the-cli-does-not-replace-itself.md) (no second installer), [0038](../adr/ADR-0038-update-invokes-the-installer.md) (`update` updates, by invoking the installer)
> Issue: [#742](https://github.com/MongLong0214/commitlore/issues/742)
> Baseline head: `5433704`. Revision 4 — see PRD-F16 "What the prior art actually does" for what changed and why.

**Ordering is strict.** T-1601 → T-1602 → T-1603 → { T-1604, T-1605 } → T-1606 → T-1607. The comparison lands before anything calls the network, the network lands before anything prints, and nothing changes the machine until everything above it is right.

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
COMMITLORE_NO_UPDATE_CHECK set   no check at all
COMMITLORE_NO_AUTO_UPDATE set    the check still runs and still reports; `init` and `update`
                                 do not act. Named for HOMEBREW_NO_AUTO_UPDATE, and it means
                                 the same thing -- the naming convention is part of the standard
DO_NOT_TRACK set                 off        its stated scope names autoupdates, not just analytics
NO_UPDATE_NOTIFIER set           off        the de-facto convention; honouring it costs one line
a config-file switch             off        an org can ship a file to a fleet; it cannot guarantee
                                            an env var in every shell (Terraform's disable_checkpoint)
cache younger than 24h           no request; the cached answer, with its age
```

**The two switches are not the same switch**, and a test asserts it: `COMMITLORE_NO_AUTO_UPDATE` must still let the notice and `update --check` report, because an operator who declines automatic action has not asked to stop being told.

**Context-dependent gates (`CI`, TTY, hook subcommand) are NOT here.** They belong to the notice, and T-1604 owns them. A module that applies them is a module `commitlore update --check` cannot use.

**Acceptance**

- With git unreachable, a spawn that fails, a non-zero exit, a timeout, output that matches no tag, and a repository with no tags at all: **each returns "unknown" and none throws.** Six named cases, because they are six different code paths and one shared `catch` hides which one ran.
- **A failed check is cached, by kind.** `gh` writes its state only after a successful fetch (`update.go:103`), so an offline machine retries on every single invocation forever — an outbound attempt per command, which is what an egress-monitoring organisation flags. But one blanket interval is the opposite error: a five-minute outage must not buy a day of silence about the staleness this feature exists to expose. Three intervals, three named tests: **unreachable → 1 hour, doubling to a 24-hour ceiling**; **refused by the remote → 24 hours**; **output no tag matched → 1 hour, and logged under `--debug`**, because that is a parsing bug rather than a network condition and burying it for a day hides it.
- Two consecutive calls inside one interval produce **one** spawn; the interval elapsing produces a second.
- The timeout is enforced by a test that never waits for it in real time — an injected clock or an aborted controller, not a sleep. `verify-the-fix-not-just-the-tests`: a property timed against a real clock passes vacuously on a slow machine.
- **Cancellation is a mechanism, and each part of it is its own case.** "The process is gone" is an outcome that two different implementations can satisfy differently, and only one of them is right. Named: the child runs in **its own process group** so the signal reaches an SSH client or credential helper `git` spawned; a **hard timeout** bounds it independently of the caller, because `commitlore --version` finishes in milliseconds and cancel-on-completion is not a bound; `SIGTERM` then `SIGKILL` after a grace period; the child is **reaped**, asserted by a test that runs many checks and finds no zombies; `GIT_TERMINAL_PROMPT=0` and non-interactive credentials, so it can never block on input nobody will type.
- A fixture that hangs — a remote that accepts and never answers — is cancelled and leaves nothing running. This is the case the mechanism exists for, and a test that only kills a fast child proves nothing.
- A cache file that is truncated, empty, from a future schema, or owned by another user reads as absent.
- Two concurrent calls do not corrupt the cache and neither throws.
- `COMMITLORE_INSTALL_SOURCE` is honoured, asserted by pointing it at a local fixture repository — which also gives every test above a real remote to run against without touching the network.

**Not in scope** — printing anything. This ticket has no output.

---

## T-1603 `commitlore update --check` — the read-only form (S)

**Owns**

- `src/commands/update.ts` (new)
- `src/cli.ts` — one registration
- `test/update-command.test.ts` (new)
- `docs/cli.md`, the four READMEs — one row each

**Depends on** — T-1602.

**Behaviour**

```
commitlore update --check    current, latest, and the install command. Reports only. Exit 0.
commitlore update --json     { current, latest, updateAvailable, command, source, checkedAt }
```

**The acting form is T-1606's**, and it must not be reachable from here: this ticket ships the read-only half first so that the reporting is trustworthy before anything acts on it. A test asserts `--check` and `--json` spawn no installer.

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
- **`doctor` is deliberately absent from the silence list and from the notice.** It is the third class (T-1605) and carries staleness inside its report instead. A test asserts `doctor` emits no trailing notice, so the two mechanisms cannot both fire and print it twice.

---

## T-1605 `doctor` reports staleness as a finding (S)

**Owns**

- `src/commands/doctor.ts` — one finding, one `--json` field
- `test/doctor-release.test.ts` (new)

**Depends on** — T-1602.

**Why it is not the notice.** `doctor` already reports a hook interpreter on a different version from the CLI, and that report is what found #735 — a newer release existing is the same kind of fact. Revision 2 left it in neither class, and the gap had teeth: T-1604 silences every `--json` invocation, so **the one structured contract anybody consumes could not carry staleness, and the notice could not appear there either.** It would have been invisible in the output built for programs to read.

**Acceptance**

- Staleness appears in `doctor`'s prose report and as a field in `doctor --json`. **Both, asserted separately** — a field with no prose is invisible to a human, prose with no field is invisible to a script, and this ticket exists because one of those already happened.
- **`doctor --json` carries it**, which is the case that makes this ticket necessary rather than cosmetic.
- It ignores `CI` and TTY, like the command and unlike the notice: a report that omits part of itself when piped lies to whatever is reading it.
- It honours the explicit off-switches, and when one is set it says checking is disabled rather than reporting up to date.
- **`doctor`'s exit code is unchanged**, including when a newer release exists. A newer release is not a violation, on the same reasoning `--check` exits 0.
- With the check unavailable, `doctor` reports that it does not know — never "up to date".
- No trailing notice is printed after `doctor`, asserted here as well as in T-1604, because a double report is what two mechanisms owning one fact produces.

---

## T-1606 `commitlore update` performs the upgrade (M)

**Owns**

- `src/commands/update.ts` — the four-step call
- `test/update-apply.test.ts` (new)

**Depends on** — T-1603, and [ADR-0038](../adr/ADR-0038-update-invokes-the-installer.md).

**Why last.** It is the first part of F16 that changes the machine, and it is worth nothing until the version it targets is resolved correctly by everything above it.

**The shape is ADR-0038's, and step 2's comparison is the part that is easy to get subtly wrong:**

```
1  exec  <data-root>/current/install.sh <target-tag>      may be old; its clone is sound
2  readlink current, compare to <data-root>/v<target>     NOT "did it change" -- "is it right"
3  if not the target: exec <data-root>/v<target>/install.sh   the new tree's installer
4  compare again; if still wrong, non-zero + the canonical one-liner (not the local script)
```

**The negative control has to reproduce #735, not its outcome**

A fixture that exits 0 without touching `current` traverses none of `ln -sfn` → `mv -h` → `mv -T` → `rm -f && mv -f` → `readlink`, and does not produce the machine #735 actually made. It catches a CLI that trusts an exit code — worth catching, and *not* the claim being defended.

The real state, from reading `install.sh:603-671`: the wrapper is written and renamed at **`install.sh:625`, before** the `current` move at 648. So a #735 machine has

```
wrapper on PATH      -> the NEW checkout's dist/commitlore.mjs
<data-root>/current  -> the OLD checkout, unchanged
inside the old checkout: a stray `current.commitlore-install.<pid>` symlink
the installer:       exited 0 and printed success
```

That is a half-upgraded machine where `commitlore --version` reports the new build while every hook resolving through `current` runs the old one. **The fixture must build that**, and a test asserts each of the three artefacts, so a future fixture that drifts back to a plain outcome stub fails visibly.

**Acceptance**

- With that fixture as the on-disk installer: the command does **not** report success, step 3 runs, and the upgrade completes. `verify-the-fix-not-just-the-tests` — and here the check is stronger than usual, because a stub that passes for the wrong reason is what this ticket was rewritten to prevent.
- **A wrong-but-successful move is caught.** A fixture that moves `current` to some *other* installed version exits 0 and changes the link; step 2 must still fail it. Revision 1 said "if it did not move", which this fixture satisfies, and the retry would never have fired.
- After a successful update, `current` resolves to the target tag, asserted by reading the link rather than by the command's own report.
- When both steps leave `current` wrong, the command exits non-zero and prints **the canonical install one-liner**, not the local `install.sh` — those are the bytes that just failed twice. The failure text names `doctor`, because a link that is right over a checkout that is wrong is beyond what this command can see.
- **No clone, move, or unpack is implemented here.** A test asserts the only processes spawned are the installer invocations — ADR-0037's narrowed core, enforced where it can fail rather than stated in a comment (#723's precedent).
- `update --check` and `update --json` spawn no installer, asserted separately. The read-only form must stay read-only.
- `COMMITLORE_NO_AUTO_UPDATE` stops the action and **not** the report: `update` says what it would have done and exits 0.
- It refuses to act when the target is not newer, unless `--force` is passed, so a typo cannot silently downgrade a machine.
- The Windows path invokes `install.ps1` through the same four steps, with the link check expressed the way that platform allows — and it is the platform CI can run that must fail on a regression here (`guard-a-platform-ci-cannot-run`).

---

## T-1607 `commitlore init` updates first (S)

**Owns**

- `src/commands/init.ts` — one call before the existing work
- `test/init-update.test.ts` (new)

**Depends on** — T-1606.

**Why this is the point of the feature.** `init` writes `commitlore.bin` through `<data-root>/current`, verified on a real machine:

```
$ git config --local --get commitlore.bin
/Users/isaac/.local/share/commitlore/current/dist/commitlore.mjs
```

The repository then validates every commit with whatever `current` resolves to. Initialising on a stale install wires a repository to a stale protocol, which is #742's opening sentence — and this is the one command that can prevent it rather than report it.

**Acceptance**

- `init` updates before it writes anything, asserted by ordering: a fixture where the update changes `current` must show the recorded `commitlore.bin` resolving to the new build.
- It updates **only** when an update exists, outside CI, off a pipe, and with no off-switch set. Four named negative cases.
- **It says what it did**, in one line, before its own output. A command that silently changes what validates commits on the whole machine is the thing this feature exists to prevent, and doing it quietly here would be that failure wearing the fix's clothes.
- `COMMITLORE_NO_AUTO_UPDATE` makes `init` report and continue, never act, and **still succeed**.
- **A failed update does not fail `init`.** The repository still gets wired, with the older build and a stated warning. This is the ticket where "nothing in this feature may make a command fail" is most tempting to break and most important to keep.
- A test asserts `init` is the only command besides `update` that can act. `status`, `query`, `doctor` and every hook subcommand spawn no installer.
