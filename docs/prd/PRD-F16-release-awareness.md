# PRD F16 — Knowing a newer release exists (#742)

- ADR: 0037 (the CLI does not reimplement installing), 0011 (distribution is a git clone)
- Issue: [#742](https://github.com/MongLong0214/commitlore/issues/742)
- Status: specified — revision 2, after the references below were read rather than recalled

## The problem is not "no upgrade command"

`commitlore init` records the hook's interpreter as `<data-root>/current/dist/commitlore.mjs`. A repository then validates every commit with whatever `current` resolves to, and nothing in an ordinary day names that release. `doctor` reports the split when asked — that is how #735 was found — but nobody runs `doctor` on a machine that appears to work.

So a stale install is not an inconvenience. It is **a repository quietly enforcing an older protocol**, with the tool reporting success throughout. That is the failure mode this project exists to remove, arriving through the absence of a feature rather than the presence of a bug.

## What the prior art actually does

Revision 1 of this document asserted a convention from memory and got it backwards. Each row below was read at the source; the mistakes are recorded because they changed the design.

| tool | self-replaces? | how it suppresses | notes |
|---|---|---|---|
| `gh` | **no** — notifies only | `GH_NO_UPDATE_NOTIFIER`, `CODESPACES`, `ci.IsCI()`, **both stdout and stderr must be TTY**, 24h state file, and a **build-time** `updaterEnabled` that compiles the checker out entirely | the model for this feature |
| `rustup` | **yes** | `auto-self-update` config (`disable`/`enable`/`check-only`), `--no-self-update` per invocation | **enabled by default.** Revision 1 cited this as supporting "does not replace itself" — the opposite of what it does |
| `deno` | **yes** — `deno upgrade` replaces the executable in place | `--dry-run`, `--output` to write elsewhere | |
| `bun` | **yes** — `bun upgrade` | | |
| `npm` / `update-notifier` | no | `NO_UPDATE_NOTIFIER` (any value), `--no-update-notifier`, CI, `NODE_ENV=test`, TTY, 24h interval, per-module `optOut` file | the source of the `NO_UPDATE_NOTIFIER` convention |
| Terraform / HashiCorp checkpoint | no | `CHECKPOINT_DISABLE` env var **and** `disable_checkpoint` in the CLI config file | the config-file switch is the enterprise-relevant half: an org can ship a file to a fleet, it cannot guarantee an env var in every shell |
| `DO_NOT_TRACK` | — | a cross-tool convention whose stated scope explicitly includes **autoupdates**, not just analytics | revision 1 omitted it |

**Self-updating is not the deviant choice; it is the majority one.** Three of the six replace themselves. ADR-0037 therefore cannot rest on convention, and no longer does — it rests on two facts about this repository, and it has been narrowed to what those facts support.

Two details from `gh`'s implementation changed this design rather than confirming it:

**The check runs concurrently with the command and is cancelled when the command ends.** `cmd.go:143-152` starts it in a goroutine; `cmd.go:255` calls `updateCancel()` before reading the result. A slow network costs nothing, because the in-flight request is aborted the moment the command finishes and the notice is simply skipped. This is a better answer than tuning a timeout, and it is what revision 1's open question 2 was groping for.

**`gh` does not print the notice when the command failed** (`cmd.go:253`), and does not print an upgrade command it cannot verify — Homebrew users get `brew upgrade gh`, everyone else gets a URL, and Homebrew users are additionally silenced for 24 hours after a release because the bump has not reached homebrew-core yet. Telling someone to run a command that will not work is worse than telling them nothing.

That last constraint does not bind us. README:73 states the plugin "puts no `commitlore` on `PATH`", so the CLI comes from `install.sh` / `install.ps1` on every platform and there is exactly one upgrade command per platform to print. We can print the command `gh` cannot.

## Goal

An operator learns that a newer release exists, without being asked to remember to check, and without the tool doing anything to their machine on its own.

## Non-goals

- **Reimplementing the installer.** ADR-0037. `install.sh` is the single implementation and it verifies its own work (#735). A second one in TypeScript duplicates both, or worse, duplicates only the first half. **Invoking it is not reimplementing it** — `commitlore update --apply` is in scope, and ADR-0038 specifies the two-phase call that keeps the installer the only implementation.
- Telling anyone anything about the machine. The check is a `git ls-remote`; nothing is sent that it does not carry.
- Working when the network is gone. It degrades to silence, not to an error.
- Pinning, channels, or beta streams. One stream: the newest `vMAJOR.MINOR.PATCH` tag.
- Changing what `install.sh` does. It is already the upgrade path and is unchanged by this.

## Where the version comes from — and the correction that forced it

Revision 1 chose the GitHub releases API and justified it like this:

> *"The releases API is what the install path already uses, but it is also the rate-limited one."*

**That is false about this repository's own code, and I verified it rather than taking the report.** `install.sh` contains zero `api.github.com` calls. It resolves the newest tag at `install.sh:405-411` with `git ls-remote --tags --refs "$SOURCE_URL"`, and the comment above it at `install.sh:384-386` says why:

> *"the newest semver tag is resolved with `git ls-remote`, which needs no API token and no rate limit."*

So the API was chosen on a false premise, and choosing it would have been a **regression to a constraint the installer had already escaped**.

**The check uses `git ls-remote --tags --refs`, the same mechanism, against the same `COMMITLORE_INSTALL_SOURCE`-aware URL.** Consequences, all of them improvements:

- No rate limit, so a shared egress IP is not a failure mode. The 60-per-hour ceiling on unauthenticated API requests is real and current, and it would have been hit by a fleet behind one NAT on a cold cache — the exact population this feature is for. (`gh` escapes this only because its check is authenticated with the user's own token, `cmd.go:321`; ours would not be.)
- It works in an organisation that blocks `api.github.com` but permits git to `github.com`, which is common.
- `COMMITLORE_INSTALL_SOURCE` is honoured for free, so a mirror-installed fleet checks its mirror instead of a host it may not reach.
- The tag ordering logic already exists and is already correct about `v10` versus `v9` (`install.sh:396-404`). T-1601 must match it, not invent a second ranking.

The cost is that `git` is spawned rather than a socket opened, and **cancellation therefore has to be specified as a mechanism, not as an outcome.** `gh` aborts an HTTP request; we have to end a process that can outlive us and can have children of its own — `git ls-remote` may spawn an SSH client or a credential helper, and an orphan of either is worse than a missed notice. Revision 2 asserted the property ("a test asserts the process is gone") without saying how, which is a specification that cannot be implemented twice the same way:

- the child is started in **its own process group**, so the signal reaches the helpers as well as `git`
- a **hard timeout** bounds it regardless of the caller, because the notice's cancel-on-completion is not a bound: `commitlore --version` finishes in milliseconds and would signal a `git` that had barely started
- termination is `SIGTERM`, then `SIGKILL` after a grace period
- the child is **reaped**, so a long-running host process does not accumulate zombies
- `GIT_TERMINAL_PROMPT=0` and a non-interactive credential configuration, so the child can never block waiting for input nobody will type

**The exposed surface is every command that is not a hook subcommand.** Hooks already have the check switched off, so the leak cannot happen there; it is `status`, `query`, `doctor` and the rest that start a check and may finish before it does.

## What "enterprise-grade" has to mean here, concretely

| condition | required behaviour |
|---|---|
| git to `github.com` blocked or proxied away | silence, and **the failure is cached** — see below |
| a fleet behind one egress IP | not a consideration any more: `git ls-remote` has no rate limit |
| air-gapped, or policy forbids outbound calls | `COMMITLORE_NO_UPDATE_CHECK`, `NO_UPDATE_NOTIFIER`, `DO_NOT_TRACK`, **and a config-file switch** so an org can disable it fleet-wide without relying on every shell exporting a variable |
| CI | off |
| output consumed by a program | off whenever stdout **or** stderr is not a terminal, and never inside `--json` |
| hook-invoked subcommands | off unconditionally. `prepare-commit-msg` writes the commit message file; a stray line there is a corrupted commit |
| the command the operator ran failed | off. They are already reading an error |
| the cache is stale, corrupt, or from a future version | treated as absent |
| two processes check at once | last writer wins, and neither fails |
| `1.1.10` versus `1.1.9` | compared as versions, by the same ordering `install.sh:396-404` uses |

**Negative results are cached — by kind, and never for as long as a success.** `gh` writes its state file only after a successful fetch (`update.go:103`), so a machine that cannot reach the network retries on *every* invocation forever. Caching failures fixes the outbound-attempt-per-command problem, and revision 2 applied one 24-hour interval to all of them, which was wrong in the other direction: **a five-minute outage would have bought a full day of silence about exactly the staleness this feature exists to expose.** The three failures are not the same event and do not deserve the same interval:

| what happened | interval | why |
|---|---|---|
| the network was unreachable | **1 hour**, doubling to a 24-hour ceiling | transient by default. A laptop that was on a plane should learn on landing, not tomorrow |
| the remote answered and refused us | **24 hours** | a decision by something upstream. Retrying sooner will not change it |
| git answered with output no tag matched | **1 hour**, and it is logged under `--debug` | not a network condition at all. This is a bug in the parsing or a repository shaped unexpectedly, and burying it for a day hides it |

The air-gapped case is not what justifies this, and revision 2 said it was. That case is already served without any cache, by the explicit off-switches below — an organisation that forbids outbound calls sets one, fleet-wide, through the config file. Failure caching is for the machine whose operator set nothing, and it should mute that machine for as short a time as the failure warrants.

## The three pieces, and they do not share a suppression table

Revision 1 gave two pieces one table. That was wrong in both directions, and the split is now the load-bearing part of the design. Revision 2 fixed the split and then left `doctor` in neither class — an omission with a concrete consequence, described below.

**A passive notice** — nobody asked for it, so it defers to everything. One line to stderr after the command completes, naming both versions and the platform's install command. Suppressed by every row above.

**`commitlore update`** — the operator typed it, so it is not a notification and does not inherit the notification's rules. **`CI`, TTY, and the hook-subcommand rules do not apply**: a nightly job running `commitlore update --check` has `CI` set and no terminal by construction, and under revision 1's shared table it would have returned a silent "unknown" — defeating the one command whose entire purpose is to be scripted. Only the explicit off-switches (`COMMITLORE_NO_UPDATE_CHECK`, `DO_NOT_TRACK`, the config file) apply, because those express a decision rather than a context.

```
commitlore update            current, latest, and the exact install command. Exit 0.
commitlore update --check    the same answer, no prose. Exit 0.
commitlore update --json     { current, latest, updateAvailable, command, source, checkedAt }
commitlore update --apply    invokes the installer for the target tag, then verifies
                             the move itself. ADR-0038. Never implied, never on a timer.
```

**`doctor` is a diagnostic, and it is the third class.** It was in neither table, and the gap is not cosmetic: `doctor` already reports a hook interpreter on a different version from the CLI — that report is what found #735 — so a newer release existing is the same kind of fact it exists to state. Yet the notice's rules silence every `--json` invocation, which means the one structured contract anybody consumes could not carry it, while the notice could not appear there either. **The staleness would be invisible in the output built for programs to read.**

So it is neither: staleness becomes **a finding in `doctor`'s own report**, in prose and as a field in `doctor --json`, rather than a line appended after it. It obeys the explicit off-switches like the command does, and it ignores TTY and `CI` like the command does, because a report suppressing part of itself when piped is a report that lies to a script.

`doctor`'s exit code is unchanged by this. A newer release is not a violation, on the same reasoning `--check` exits 0.

## Resolved by review

**Which commands carry the notice** — every command, gated on the table above. `gh`'s answer, and the operator who never runs `doctor` is the one this is for.

**What it costs on a slow network** — nothing, by construction rather than by timeout. Start the check concurrently, cancel it when the command ends, print only if it already finished.

**`--check`'s exit code** — **0 whether or not an update exists.** `auto status` settled this shape already: `src/commands/auto.ts:16` — *"with 0 whether the setting is on or off (the answer is not a finding)"* — and `stale` exits 0 even when it finds something. A version query has no violation to report; `|| upgrade` is an idiom that treats a normal state as a failure. Scripts branch on `--json`, which is what `doctor` does.

**Which source** — `git ls-remote`, above. The question closed itself once the premise was checked.

## Success

- An operator running any interactive command on a stale install learns so within a day, once, in one line.
- No command's exit code changes because of the check, and no command's latency does either.
- No network call happens in CI, in tests, on a non-TTY, in a hook subcommand, or when switched off — and no *repeated* call happens on a machine that cannot reach the network.
- `commitlore update --check` answers inside CI and off a terminal, because that is where scripts run.
- The cache file is readable, hand-editable, and its absence costs one `git ls-remote`.

## Sources

- [gh — `internal/update/update.go`](https://github.com/cli/cli/blob/trunk/internal/update/update.go), [`internal/ghcmd/cmd.go`](https://github.com/cli/cli/blob/trunk/internal/ghcmd/cmd.go)
- [The rustup book — basics](https://rust-lang.github.io/rustup/basics.html)
- [`deno upgrade`](https://docs.deno.com/runtime/reference/cli/upgrade/) · [`bun upgrade`](https://bun.com/docs/pm/cli/update)
- [update-notifier](https://github.com/yeoman/update-notifier)
- [Terraform CLI configuration — `disable_checkpoint`](https://developer.hashicorp.com/terraform/cli/config/config-file)
- [DO_NOT_TRACK](https://donottrack.sh/)
- [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
