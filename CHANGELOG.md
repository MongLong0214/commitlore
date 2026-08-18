# Changelog

Release notes for 1.0.0, 1.0.1 and 1.0.2 are on the
[GitHub releases page](https://github.com/MongLong0214/commitlore/releases); they
were not written here.

## 1.1.4

One line changed for anyone using the tool, and the rest is the repository
telling the truth about itself.

**The pre-push hook says whose two seconds ran out.** Pushing a tag printed
`notes mirror (origin) failed: spawnSync git ETIMEDOUT`. Nothing was wrong with
the transport and nothing needed doing that the rest of the line did not already
say, but the sentence named the call that returned rather than the decision that
was made -- so it read as git having failed and sent whoever got it to look at a
remote that was fine. The budget is this hook's, and the line now says so, with
the value interpolated from the constant so the sentence cannot drift from what
it describes. Every other failure detail is untouched: a refused connection
still reports as a refused connection, because that one really is about the
transport.

Then the parts a user does not run but does rely on.

**A source-only pull request can become a product commit without anyone
rebuilding by hand.** `canonical-merge.yml` merges a contributor's source onto
`main`, runs the canonical build, and opens a second pull request carrying the
result -- so every required check runs on the tree that lands rather than one
resembling it. Observed end to end rather than argued: a source-only pull
request went in, the rebuilt commit came out matching its own source, and a
deliberately tampered bundle was refused by the same path.

**The job holding the App credential now checks what the rebuild handed it.**
The rebuild executes a contributor's `package.json` and every lifecycle script
it pulls in. The publishing job recomputes the merge itself from `main` and the
pull request ref, pins both parents, and allows a difference only inside `dist/`
and the manifest; it refuses a pull request that moved while the rebuild ran,
reads the pushed branch back by sha, and mints a token scoped to this
repository with two permissions rather than whatever the installation holds.

**The canonical builder is pinned by digest.** `node:24-bookworm` is a mutable
tag, so building twice in one job proved the builder deterministic that morning
and nothing about next month.

**The upgrade contract is three generations, not two.** `docs/COMPATIBILITY.md`
said hooks installed from v1.0.2 follow upgrades on their own, which was true of
the recorded path and false of the stub: one installed between v1.0.2 and v1.1.2
follows `current` and still refuses the commit under the `PATH` git gives a hook.
All four READMEs now carry the same table; three of them said nothing about
upgrading at all.

**`docs/PRODUCTION-READINESS-SSOT.md` is version 5.** It named a release two
versions old, said no feature work was planned on a day feature work shipped,
and listed a fixed defect as a current limitation. It now owns the contract and
nothing that moves on its own.

Also: the generated benchmark block has one owner instead of four copies of
which one was checked; a credential-bearing workflow that had answered its
question is retired; a guard describing a workflow that does not exist is gone;
and four historical documents that sat at the repository root reading as current
guidance are in the archive that already existed for them.

Nothing here changes what a record is, how one is validated, or what any command
outputs on success.

## 1.1.3

**Run `commitlore hooks install` once in every repository you have already set
up. After that, upgrading stops blocking commits.**

That instruction is the release, and it is not rhetorical: the fix below lives
in the hook file, and a hook file is written when it is installed. Upgrading to
1.1.3 does not rewrite the hooks already on disk, so the upgrade that delivers
this fix is not itself fixed by it.

`hooks install` records two values: `commitlore.bin` through
`<data-root>/current`, so a hook follows upgrades, and `commitlore.root` as the
physical `v<x>` that path resolved to at the time. An upgrade moves `current`
and leaves `root` behind, and the commit-msg hook compares them — so from 1.0.2
onward, every repository wired before an upgrade stopped using its recorded
interpreter afterwards.

Under a normal shell that went unnoticed: the hook falls through to a `PATH`
lookup and commits succeed. Under the `PATH` git actually gives a hook — a GUI
client, an IDE, anything launched outside a login shell — there is no
`commitlore` on `PATH`, and the commit was refused.

Three things changed, and they are one repair reported in three places.

**The hook tells an upgrade from a repointed path.** `hooks install` writes
`commitlore.bin` as a literal string ending `/current/dist/commitlore.mjs`, and
an upgrade moves an installer-owned symlink to a sibling tree without changing
that string. A `.git/config` edit — the case `commitlore.root` exists to
refuse — replaces the string itself, and can write neither the installer's
symlink nor a directory beside its versioned trees. So the upgrade shape rebinds
the trusted root to what `current` resolves to now and re-runs the same
containment check; everything else is refused exactly as before.

**The refusal says what happened.** It used to print `cannot find the CLI this
hook was installed with` for three different outcomes: nothing resolved, the
recorded path resolved and was refused, and the recorded install no longer
exists on disk. The first sentence was false for the other two, and it sent
operators looking for a missing file that was present and working. Each now has
its own message naming both recorded paths.

**`hooks install` reports the repair it performs.** It compared only
`commitlore.bin`, which does not change across an upgrade — so the one command
that fixes this printed `unchanged` after fixing it.

Separately, `commitlore init` no longer reports that a step needs attention
because of a process on the machine. `doctor` warns when more than one
CommitLore MCP server is answering, which is ordinary on a developer machine
because `<data-root>` keeps previous versions; `init` was treating that as work
left undone in the repository it had just set up.

Nothing here changes what a record is, how one is validated, or what any command
outputs on success. Nothing in this release reaches a repository on its own.

## 1.1.2

Upgrading no longer reports a version it did not install.

`install.sh` printed `current -> v1.1.1` and left `<data-root>/current`
pointing at the previous release. `commitlore init` records the hook's
interpreter as `<data-root>/current/dist/commitlore.mjs` precisely so hooks
follow upgrades, so every repository on that machine kept validating commits
with the old build while the CLI reported the new one.

The rename was the mechanism. When `current` already exists as a symlink to a
directory, BSD `mv` follows it and moves the source *into* it, returning 0 — so
the `&&` held and the success line printed while the temporary link sat inside
the old release directory. A first install creates the link and cannot reach
this, which is why it shipped in 1.0.2 and survived two releases.

Two changes, and the second is the one that matters. The rename now says it
means rename — `-h` on BSD, `-T` on GNU, falling back to unlink-and-rename,
which is not atomic but fails visibly rather than silently keeping the old
build. And the success line is printed only after reading the link back,
because every mechanism above can return zero without moving anything, and that
line is the only thing an operator reads before trusting the upgrade.

If you upgraded to 1.1.0 or 1.1.1 on macOS, check it:

```
readlink "$(commitlore --help >/dev/null 2>&1; echo ~/.local/share/commitlore)/current"
```

`commitlore doctor` reports the same split in its own words, and re-running the
installer at 1.1.2 repairs it.

Windows CI now exercises the host-detection branches that only a comment was
holding. A GitHub runner has no coding agents, so those branches never ran
there; a planted `claude.cmd` and `codex.cmd` make them run, and a leftover
`.claude.json` with no executable is required to stay `notDetected` — the rule
1.1.1 documented and nothing enforced.

## 1.1.1

Host wiring works on Windows. 1.1.0 said plainly that it did not; this is the
release that gets to say otherwise, and only for what was actually observed.

Two defects stood between a Windows install and a wired host, and 1.1.0 fixed
one of them. The other was in how a command was found and run:

- `hasCommand` joined each `PATH` entry with the bare command name and stopped
  there, never consulting `PATHEXT`. Windows installs `cursor.cmd`, `codex.cmd`,
  `claude.cmd` — there is no extensionless file — so detection was false for
  every host whose executable is a shim, and `claude-code` reported
  `notDetected` with its config sitting on disk.
- `spawnSync` ran with `shell: false`, which cannot execute a `.cmd` shim at
  all. That produced `codex mcp add failed`.

Resolution now finds one concrete executable through `PATHEXT` and both
detection and execution use it, so the two can no longer disagree about what
"present" means — which is what the original defect was. A batch shim is
invoked through an explicit `cmd.exe` argument vector with `shell: false`
preserved: the wrapper path and user config paths reach these calls, and a
shell would make quoting an attack surface.

Observed on Windows 10.0.19045.0 with agents installed: Codex, Gemini CLI and
Hermes all wire, verify through a live MCP `Initialize`, and appear in their
configs on disk. **`ok` is still false on that machine, and it should be** — a
`.cursor/mcp.json` that is zero bytes there is a user file, not a defect here,
and `claude-code` is `notDetected` because its executable is absent while its
config is present, an asymmetry that is still open (#716).

Two quieter repairs came out of reviewing that work. A trailing backslash in a
path — every Windows directory can carry one — was passed into the `cmd.exe`
argument vector unescaped, where the closing quote consumes it and the next
argument is absorbed. A `--verify` swallowed that way would have let a step
report `verified` for a verification that never ran, which is the failure this
project exists to remove. And executable resolution now checks `X_OK`: without
it a non-executable file of the same name earlier on `PATH` would be selected
and spawned, breaking macOS and Linux, where this works today.

A literal `%` in a path — legal on Windows, and present for any user whose name
contains one — is handled rather than refused, and the reason `%%` escaping is
not the answer is recorded in the code beside it.

A failed host also says why. The Hermes step ran with `stdio: 'ignore'`, so
whatever it printed about its own failure was thrown away and the report was a
bare `Hermes setup failed`. The reason now reaches the summary — which mattered
while Hermes was failing, and stopped mattering for that host when the
trailing-backslash repair turned out to be its cause. `--data-root` ends with a
backslash on Windows, so that was the argument being swallowed. The next
failure of any host still arrives with its reason attached rather than
requiring another trip to the machine.

## 1.1.0

A machine can now differ from the committed capture policy without modifying
it. `.commitlore-policy.local.json` sits beside `.commitlore-policy.json` and
wins **per key**: an overlay setting only `unattended` leaves `mode` and
`max_records_per_commit` as the repository set them. `commitlore auto on
--local` and `auto off --local` write it, and once it exists it is the file
`commitlore auto` writes — so opting in or out never touches the tracked file
again. Previously the only route was to edit the committed file, which left the
worktree permanently modified and stopped any release script that refuses a
dirty tree (#709, ADR-0035).

The policy identity hash is computed over the *effective* policy whenever an
overlay is present, so a record prepared under one is stamped with the policy
that produced it. A repository with no overlay keeps exactly the digest it had:
no capture in flight is refused by this upgrade.

A new `policy-overlay` doctor check names both files, the value beneath, the
value in the overlay and the one in force. It reports `ok` when they disagree —
that is the feature working — and warns only when a file cannot be used, since
then neither file's values are in force and capture runs on the built-in
defaults.

`doctor` no longer tells a repository whose captures never reached staging that
a record was "never written to the history". Nothing was dropped there: the
commit each draft was prepared for either never happened or happened without it
(#710).

On Windows the installer built every config's temporary file name out of the
whole target path — `path.split('/').pop()` returns its argument unchanged when
there is no `/` in it — so the write was `ENOENT` before it began and no host
was wired. **This does not mean host wiring works on Windows now.** A real
Windows run of 1.0.2 found a second cause that this release does not fix:
`hasCommand` never consults `PATHEXT`, so it cannot see `cursor.cmd` or
`claude.cmd`, and `spawnSync` with `shell: false` cannot execute a `.cmd` shim.
The installer reports these honestly — `ok:false`, per-host `outcome:"failed"`,
no config silently changed — but it cannot yet complete the work on that
platform (#716; the observation is #714).

The installer's host wiring was cut to the code that runs. `install.sh` and
`install.ps1` have delegated every detection, config write and MCP probe to one
shared TypeScript command since 0.9.0, and both files still carried the
superseded shell and PowerShell implementations below an unconditional exit —
845 lines that no install has executed, and that three readers in three days
took for live code (#691).

## 0.8.2

SHA-256 repositories now distinguish a full object id from a revision a user
typed. Canonical ids are exactly 40 or exactly 64 hexadecimal characters, and
a branch, tag, `HEAD~3`, or abbreviation is resolved by git to one full id
before it enters internal state. Previously one `{4,64}` pattern covered both
jobs, allowing a truncated or corrupted id to validate and persist as though it
were canonical.

The Node floor is `>=22.23.2`, the current Node 22 LTS. `node:sqlite` is
unflagged from 22.13, but its bundled SQLite supplies the FTS5 virtual-table
feature only from 22.16.0. The old 22.12.0 floor silently used the slower LIKE
path on 22.13–22.15; the new floor guarantees full-text search. The engine
floor check now records the FTS5 feature requirement rather than merely the
earlier module import. See ADR-0034.

Commits carrying only GitHub or DCO trailers such as `Signed-off-by:` or
`Co-authored-by:` are no longer rejected as malformed CommitLore records. This
lets `git commit -s` coexist with CommitLore while still rejecting unrecognized
trailer keys.

MCP handlers now enforce their advertised schemas at the handler boundary. A
missing, mistyped, or unknown argument is an error instead of silently widening
a request to the whole repository. A malformed decoded capture draft is also a
caller error rather than `validation_result: "empty"`, which was
indistinguishable from a session with no decision to record.

The pre-push notes sync now runs non-interactively and has a timeout, so an
unreachable or hanging remote cannot stall a branch push. The installer likewise
does not report success when a requested host's MCP registration cannot be
configured and live-verified.

The preserve GitHub Action now supplies a git identity when the workflow has
none, allowing it to write the note it found on a default runner. It also stops
attaching a record the merge commit already carries: squashing a single commit
keeps that commit's trailer block intact, so there was nothing to preserve and
attaching anyway left two copies of one record.

### Capture no longer stages a reference the commit-msg hook will refuse

`capture` treated `"validation_result": "pass"` as a shape question. The
hook then ran `validate --message-file`, which also asks whether `Follows:`
and `Supersedes:` resolve. A syntactically valid `Follows: r-zzzzzz` staged
cleanly and the next `git commit` failed over a record the user never wrote.

Verification now runs `findDanglingRefs` over the same declared set the hook
uses — historical identities plus other records in this capture — so a pass
from capture means a pass from validate. A dangling reference is a rejection
with its own reason.

### `context` builds the index it used to only read

On a repository with no `index.db`, `context` walked history every time and
persisted nothing. On a 21,770-commit repository that was 265s, then 271s
again. The same call against an index the commit-msg hook had already built
was 0.63s. `context` now builds and persists the index the way `validate`
does, so the second call is the cheap one.

A first call on a history that size still costs minutes if it is allowed to
finish, so the same scan budget the injection hook already used (3s) now
applies to `context`, MCP query, `before_change`, and the commit-msg
`validate` path. A truncated answer is labelled through `unreadCommits` —
never presented as complete — and a commit accepted against a partial
reference check prints `references not checked`, not `references ok`.
`--no-index` still writes nothing. `commitlore index` and `init` finish a
partial index; a leftover unread count is not treated as already current.

## 0.8.1

Three independent reviews ran against this candidate. They found twenty-one
blockers between them, and most of what follows is the answer to those — several
of them defects in the fixes made earlier in the same release.

### The capture procedure reaches every host

Four of the seven hosts `install.sh` wires — Gemini, Cursor, Windsurf, opencode
— receive an `mcpServers` entry and no skills. The MCP server's `instructions`
described only the read half of the protocol, so those hosts held the capture
tools with nothing saying what they were for. The server now describes both
halves, and it ships to every host by definition.

Verified with the plugin disabled and no `AGENTS.md` present: a real session
drove prepare, verify and stage and landed a `Provenance: drafted` record.

### `init` no longer writes AGENTS.md

Because it no longer has to. `--agents-md` writes it for a host that reads that
convention and not MCP instructions. It used to create the file in repositories
that use no such convention, and add a hundred lines to one that does.

### What is served, and what is claimed

- `commitlore_stale` served its records ungraded while `commitlore_query`
  withheld the same payloads. An expired `Warn:` — or an `Expires:` value —
  carrying prompt-injection text reached a model through a tool on the same
  server. Both fields are now withheld when a pattern matches, and the record
  is still listed.
- A trailer key in `STRUCTURAL_TRAILER_KEYS` was exempt from injection scanning
  on its name alone. Validation runs at commit time; grading runs on history.
- `init` reported `ready` over a repository whose capture server could not be
  registered. It now exits 1 and prints the `.mcp.json` to write.
- `doctor` called any launchable command a working capture server.
  `{"command": "false"}` read as healthy. An entry that is not the one `init`
  writes is preserved, and reported as unverified rather than as ready.
- Records were said to survive squash-merge. They do not, unless
  `commitlore squash-preserve` or its Action runs.
- "Evidence-verified" is now "Quote-checked": verification establishes that a
  cited quote occurs in the source, not that it supports the claim.

### Installing

- The advertised one-liner fetched a pinned URL and passed no version, so it
  installed whatever the newest tag was. It now installs the version its URL
  names.
- Ownership of an existing wrapper was inferred from a version string, then
  from a directory name, then from a file's existence. It is now the runtime
  answering with the version the wrapper claims.
- A registration naming a path that no longer exists is reported instead of
  counted as healthy — four hosts on the author's machine pointed at a temp
  directory deleted long ago.
- A config that merely contains the word `commitlore` is no longer taken for a
  registration.
- A requested version is bound to the runtime that answers, on both installers.
- The Node floor is `>=22.12.0`, which is what `node:sqlite` and the
  dependencies actually require, and both installers enforce it.
- Windows has an install command in the README for the first time.

### What CI now establishes

- `install-macos` and `install-alpine` (amd64 and arm64) run the installer on
  those hosts and then run `init`, `doctor` and `context` — the compatibility
  matrix claimed executions that no job performed.
- The dogfooding gate fetches the notes mirror and reads its report: `shape` and
  `reference` must each be `ok`. It used to pass with the reference half
  unperformed.
- `test/capture-pipeline-e2e.test.ts` drives the built server through prepare,
  verify, stage, commit and read-back.
- The engine-floor parser has tests. It read `>=22.5` as Node 5, which failed
  every required job before typecheck, build, tests or dogfooding ran.
- With the notes mirror finally fetched, the reference check ran for the first
  time and found one violation in this repository's own history: a `Follows:`
  written six minutes before the record it points at. It cannot be corrected
  without rewriting the commit that carries it, so it is named in
  `scripts/dogfood-baseline.json` with the reason, and the assertion subtracts
  only what that file names. The carried count prints on every run.
- The release gate matched required checks by name. Any GitHub App installed on
  the repository could open a check run called `check (22)`, conclude it
  `success`, and be read as CI having passed. The producing app must now be
  `github-actions`, and a run with no app attributed is refused.
- `npm audit` reported ten vulnerabilities on every green run, with no way to
  tell "assessed" from "never looked at". The production surface — which is
  what users receive, since `dist/` is committed and the installer never runs
  npm — is now a blocking check at zero, and the development surface is
  reported without failing the build. A separate step proves the premise by
  running the shipped tree with no `node_modules` present.

### Reporting a problem

`SECURITY.md` exists and GitHub's private vulnerability reporting is enabled,
so a vulnerability no longer has to be disclosed publicly to be disclosed at
all. It names what is in scope for a tool that serves recorded text to agents —
injection through served records, a trust grade that overstates, capture
writing without evidence — and what is not. Dependabot covers npm and the
workflow actions.

### Failing an installation, not a message

An installation missing `spec/` failed every commit with a raw `ENOENT` and a
usage line, so the screen showed a path the user never chose and usage for a
command they never typed. The message had not been examined. It now says what
is missing, that the message was not examined, and the command that restores
it — and exits 3 for an operational failure rather than 2 for usage.

## 0.8.0

Everything 0.7.1 promised about unattended capture is in a release for the
first time. 0.7.1 was published on 2026-08-09; the work it was credited with
merged on 2026-08-11, so the published artefact never carried `commitlore auto`
or `capture --unattended` at all (#525, #511). It does now.

### One command sets a repository up

`commitlore init` grew the step that had been missing: it registers this
repository's MCP server, so the tools that *start* a capture reach a host that
loads `.mcp.json`.

Without it the install was half a product and did not say so. The git hooks can
apply and finalise a record that something else already staged; they cannot
begin one, because a hook has a diff and a capture needs a transcript. Four
repositories ran with `unattended: true` and produced no records between them
until this was wired by hand.

`init` also writes the `AGENTS.md` capture procedure into the repository, so
the instruction travels with the work rather than with the machine. An
`AGENTS.md` that already exists keeps every line it had.

### Records get their own identity

A capture with no `Record-Id` in its draft used to land on the commit anonymous,
and nothing reported it. Supersession then had nothing to name, collision
detection had no key, and the injected payload rendered `-` where the id
belongs — so an agent could not cite the constraint it was about to follow.

The pipeline now mints one from the record's own content: stable if a capture
is retried, never replacing an id the draft supplied, and never minted for a
draft that was rejected.

### Hosts, and what each of them actually does

| Host | Delivery | Capture |
|---|---|---|
| Claude Code | plugin | plugin |
| Codex | plugin — `commitlore plugin install-codex` | plugin |
| Hermes | `commitlore hermes install` | same command |
| Other `AGENTS.md` hosts | yes | a written procedure the host may or may not follow |

The last row is the honest one and the README now says it in those words. A
host without a plugin gets guidance, not a mechanism.

Codex and Hermes both gained a real installation this release. Hermes needed
its own: its skills load from a configured directory, and an earlier attempt
that wrote a bundle into the source checkout was never found by a live session.

### Queries stop blocking on a cold index

A path-scoped query on a repository with no index used to rebuild the whole
index first — 186 seconds on a 21,446-commit repository, on the path that runs
before every edit. A caller with a shorter timeout killed it, and the next edit
started cold again, so the index could stay cold forever.

A consumer query now catches an index up but never rebuilds it, and the
fallback materialises the corpus once instead of once per path alias.

### Fewer warnings that could not be acted on

`context` warned about an unfetched notes mirror in repositories where no notes
ref existed anywhere, pointing at a fix that could not change anything, while
`doctor --fix` called the same checks `ok`. `doctor --fix` now asks each remote
what it advertises and records the answer; the query reads that. A repository
that has genuinely never been checked still warns — that case is why the
warning exists.

### Upgrading

Nothing to migrate. Re-run `commitlore init` in each repository to pick up the
MCP registration and the `AGENTS.md` section; it is idempotent and leaves an
existing policy file, `.mcp.json` entry or `AGENTS.md` alone.

If you use Codex or Hermes, run its installer once — `commitlore plugin
install-codex` or `commitlore hermes install` — and start a new session
afterwards, since both load their skill at session start.

### Still true, and worth repeating

Capture needs an agent host. An ordinary `git commit` typed by a person
initiates nothing and by design never will: there is no transcript, and a
record invented from a diff would be a claim about a decision nobody made.
`doctor` reports whether this repository has an initiator rather than assuming
the policy file implies one.

### Also in this release

The agent tooling whose local config shipped in 0.5.0 as `.serena/` is no
longer used, and the configuration that kept it out of future runs is retired
with it: the ignore entry, the manifest-test guard, and the task-level comments
that named it. The bench evidence still names the directory, because that is
what the recorded runs saw (#514).

## 0.7.1

### `[directive]` did not work in 0.7.0

0.7.0's headline change made the `[directive]` tier reachable. **It did not
reach anyone.** `commander` declares `--trusted-author` with a default of `[]`,
so the flag arrived as an empty array rather than `undefined` when it was
absent, the nullish fallback to the author `init` records never fired, and
every record on every install still graded `[claim]`.

That is the defect #415 was opened about, reintroduced one layer up by the fix
for it.

Reproduced against the released artefact: `commitlore inject --path <p>` — the
form the hook runs — rendered `[claim]`, while the same command with an
explicit `--trusted-author` rendered `[directive]`.

The tests that passed drove `buildInjection` with options assembled by hand and
never went through the command line, which is the only path the hook uses.
`test/trusted-authors.test.ts` now spawns the built CLI. Its own header had
already warned that a unit test one layer down would have passed throughout the
period the original bug existed; the same sentence applied one layer up and was
not heard.

### Fixed

- `package-lock.json` still declared `0.1.0` while the manifests read `0.7.0`.
  Stale since the first release.

### Corrections to 0.7.0's own record

The promotion PR said 132 commits; it was **137**. It said `RELEASE-GATE.md` §4
lists seven install checks; it lists **six**. Both were miscounts in the
evidence submitted for review, and both are corrected here rather than left in
the history unremarked.

## 0.7.0

### The behaviour claim is measured: 2.8% against 18.8%

M5 is complete — 1,160 registered runs. An agent handed the repository's active
records re-proposed a ruled-out approach in **16 of 580** runs; without them,
**109 of 579**.

```
commitlore-on    16/580 =  2.8%   Wilson 95%  1.7 – 4.4%
commitlore-off  109/579 = 18.8%   Wilson 95% 15.9 – 22.2%
```

The significance test, the interval on the difference and the registered
threshold are in `bench/VERDICT-M5.md`, not retyped here.

Three things about how it was produced matter more than the number:

- **The threshold was registered before the run**, not chosen after it.
- **The preregistration predicted a *smaller* effect** and gave three reasons.
  All three were conservative; the result is 2.4× the threshold. That
  prediction is in `bench/PREREGISTRATION-M5.md` Appendix A.2 with its stated
  probabilities, and it was wrong.
- **The control arm truncated more** (28.5% against 21.2%), and truncation
  suppresses re-proposal — so the artefact removes control-arm chances rather
  than manufacturing treatment ones. The measured difference is a floor with
  respect to it.

**Every record in this run rendered `[claim]`**, with the payload's own legend
telling the agent not to act on it as an order. The `[directive]` tier below
became reachable only in this release, *after* the run. This number describes
the weaker tier. One model, one harness, ten constructed fixtures, and an
oracle that reads the final tree rather than establishing anything was read:
`bench/VERDICT-M5.md`.

### `[directive]` became reachable

Records reach an agent graded `directive`, `claim` or `blocked`. `directive`
means "treat this as a constraint" and is where the trust model lives. Until
now **no installed surface could produce one**: nothing passed
`--trusted-author`, grading failed closed to `claim` for every record every user
had ever received, and the injected legend went on advertising a tier that had
never been delivered or measured (#415).

`init` now records the installing user's git identity in
`commitlore.trustedAuthor`. Records you authored reach your agent as
`[directive]`; every other author's stay `[claim]`, so the property that stops a
contributor's commit from instructing someone else's agent is untouched. A team
widens it to its reviewers, or empties it back to trust-nobody, with one git
command and no hand-edited hook.

**M1 and M5 measured `[claim]`-graded delivery.** Their numbers describe that
tier and do not transfer to this one.

### Capture runs unattended

ADR-0030. `mode` defaults to `auto`: the pipeline drafts and stages a record
without asking, and the record is stamped `Provenance: drafted`. A drafted
record is capped at `[claim]` — nobody read it, so it cannot direct an agent —
and is promoted by a person declaring `Supersedes:` on an authored record. A
repository declines the whole thing by setting `mode: "off"`.

### Fixed

- The pre-push hook re-entered itself through `sync`'s push and **hung every
  `git push`** — 1,240 invocations in 40 seconds (#422)
- A non-executable `COMMITLORE_BIN` **killed the git operation next to it**
  instead of falling through (#428)
- Notes-sourced records inherited the annotated commit's author trust, so
  **anyone who could write `refs/notes` could forge a `directive`** (#409)
- The injection guard matched a literal phrase, serving an attack paraphrase as
  `directive` and blocking a benign one (#408)
- Concurrent hooks fell back to a full scan for want of a SQLite busy timeout
  (#420)
- The notes refspec `doctor --fix` wrote was forced, so an ordinary `git fetch`
  **silently destroyed unpushed records** (#417)
- The notes mirror was written locally and never left the machine (#416)
- A commit carrying a record could never be amended (#430)
- `doctor` did not say when the agent's hook was running a different build than
  the CLI (#433)
- The MCP server left no record of whether it closed or was killed (#424 work)

### Evidence and protocol

- **`docs/SELF-AUDIT.md`** — what this repository caught in itself, leading with
  the claims this project published that turned out to be false
- The CDEB benchmark protocol at v1.2, its schemas, a recursive verifier wired
  into default CI, and a frozen-bundle materializer that proves two arms saw one
  repository
- **CDEB-P**, a pilot that measured what CDEB v1 assumed: the mechanism is
  observable, and the ON arm costs 45% more, which makes the registered token
  gate unreachable as written
- The M5 analysis reads the shards its preregistration names, after the previous
  version read 1,835 rows from four different experiments and would have passed
  its own stopping rule on the contamination (#441)
- ADR-0031 names Zed's DeltaDB and which three differences carry weight

### Documentation

- The README shows the concrete failure before the evidence tables. Nothing was
  softened; the order changed.
- The plugin does not update itself, and updating is two steps

`bench/TOKEN-LEDGER.md` prices what a record costs to write against what the
projection saves to read, and closes the gap `docs/evidence.md` carried under
*Break-even*. The two write-side terms obtainable with no model call are
measured — the generated harvest prompt's scaffold at 1,197 tokens, and each
commit's staged diff, which takes a median capture to 3,537 tokens — and
verification's zero is now a scan of the built verify module graph rather than
an assertion. The read side is the committed delivery run restated per read.

Both halves are floors, so the break-even they produce is a lower bound: against
an agent that runs `git log -- <path>` at the same 800-token budget, this
repository's records pay for themselves after at least 22,326 path-scoped reads.
Against an agent that reads no history there is no break-even at any read count,
and that row is published rather than omitted. At the same budget the saving is
154.6 tokens per read and the recall difference is 39.7 points, so on this
corpus the case rests on recall rather than on tokens — the token-reduction
percentage is the weaker half of the answer.

What remains unmeasured is named rather than estimated: the tokens a model
spends drafting a record. The driver reads one session-total `usage` object out
of `--output-format json`, so there is no per-turn ledger to attribute an answer
to that turn even if a call were made.

## 0.6.0 — 2026-08-01

Minor rather than patch: two changes move behaviour a caller can observe, and one
narrows what `validate` accepts.

### Upgrade reasons

- **A note on a commit the history no longer reaches was served as active, and
  its `Supersedes:` retired the record that is live.** A git note is keyed by
  object name and knows nothing about refs, so it outlives the commit it
  annotates — `reset --hard`, an abandoned branch and a rebase all leave the
  object addressable and the note readable. The abandoned record then silenced a
  reachable one. Notes are now filtered against the same `rev-list HEAD` walk the
  commit source has always used (#351).
- **Two commits in one second made `context` and `stale` answer differently about
  one record.** `committed_ts` is `%ct`, second resolution, and the tie broke on
  input array position — which on the index path was decided by `commit_sha ASC`,
  effectively at random. Both serving paths now fold oldest-first. Where two
  same-second declarations of one `Record-Id` genuinely disagree, the record is
  reported for review with its content withheld rather than resolved by a guess;
  agreeing declarations are untouched (#350).
- **`commitlore hooks uninstall` removed one of the three hooks `init` installs,
  and the two left behind blocked every commit.** `prepare-commit-msg` and
  `post-commit` inherited the validation gate's `exit 1` by string replacement,
  so once the CLI they were installed with had moved, a repository could not
  accept a commit at all. The gate still fails closed — that is its job — and the
  two capture hooks now say they did nothing and get out of the way. The gate's
  own stub is byte-for-byte unchanged (#354).
- **The commit-msg hook refused valid records in a shallow clone and on
  multi-block messages.** A `dangling-ref` in a truncated clone is a fact about
  the checkout, not the record; it is now reported as `not checked` with the
  boundary named, and every other reference rule still refuses. Separately, the
  identity used to group indexed records omitted `block`, so a `Follows:` naming
  a sibling block — the shape squash inheritance produces — read as dangling
  (#352).
- **A capture that was never staged leaked its pending file permanently.**
  `expires_at` is stamped at stage, so a `prepared` or `verified` transaction had
  none and garbage collection failed closed on it forever. Collection is now
  gated on age **and** on HEAD having moved past `base_head` — the condition
  staging already refuses on — so a collected transaction provably had no path to
  a record. `commitlore pending rm <nonce>` removes one now (#367).
- **`validate` reported every `duplicate-id` twice and counted it twice.** The
  shape check and the reference check found it independently and neither knew the
  other had. A message with two problems reported four, and the repair loop was
  handed two identical instructions for one edit (#365).

### Behaviour that changes

- `Ruled-out:` splits on the first `|`, and an alternative containing a pipe was
  silently truncated — so the record could not match the thing it ruled out,
  while `validate` said `shape ok`. Counted over this repository's history,
  splitting on the *last* pipe would break two correct records to fix one, and
  refusing every multi-pipe value would invalidate all three. So only the
  provable case is refused: an odd backtick count before the first `|`, where the
  code span crosses the separator. Every other multi-pipe value is warned about
  with the split quoted back, and already-written records are annotated on read.
  **This is a narrowing — no record that conformed to 0.5.1 stops conforming**
  (#372).
- `mode: "suggest"` is documented as what it is: a host-side convention the core
  cannot enforce. There is no approval phase in the capture transaction, so
  nothing can refuse to stage a record a human never saw. The commit skill now
  asks before staging, and says plainly that nothing enforces the step
  ([ADR-0028](docs/adr/ADR-0028-suggest-is-a-host-side-convention.md), #341).

### Measured

`bench/DECISION-DELIVERY.md` asks how much of a repository's active decision set
a route delivers before the first edit. On this repository, at the shipping
800-token budget: **81.7% of path-attached active records, with zero retired
records delivered.** Ordinary `git log` for the same path at the same budget
reaches 42.0%, delivers 7 retired records, and spends more tokens.

Unbounded, the scoped projection and a whole-repository dump recover the
identical 2,047 of 2,217 pairs — so **path scoping costs nothing**, for 741,429
tokens against 92,175,612 and 0 retired records against 7,322. The remaining 170
pairs are the ceiling the trust grader sets, not the scope: they are exactly the
records graded `blocked`.

This is **delivery, not recovery** — no agent ran, so it bounds what one could
recover. One corpus, one repository. The error term is half-exercised: 7
superseded records and no expired ones, so "zero retired delivered" says nothing
about expiry. It does not discharge ADR-0017's registered study, which is still
unrun.

### Also

- The Claude Code plugin ships the MCP server, the pre-edit hook and the skills,
  and puts no `commitlore` on `PATH`. The README said otherwise by omission and
  then told the reader to run `commitlore init` (#353).
- The commit skill taught the manual `harvest` path; it now teaches the verified
  capture pipeline, with hand-written trailers as the stated fallback (#340).
- `capture --help` said `--diff` defaults to empty. It defaults to the staged
  diff, and has since the empty default was fixed as a defect (#359).
- The README moved its reference material into `docs/` — protocol, capture,
  evidence, install and CLI — and links to it. Three blocks stay because CI pins
  them there: the complete record example, the vocabulary table and the
  benchmark block (#344).
- Two demo tests scanned the process-wide temp directory, so a concurrent worker
  turned them red. They now assert against a directory they own (#364).

### What this release does not change

The capture transaction's phases, its file format, and the identity-hash inputs
ADR-0021 fixed. Adding an approval phase was priced and deliberately not built.

`guard` remains an experimental advisory at precision 44.8% and recall 22.0%. An
empty guard result still does not mean a proposal avoids every ruled-out
alternative.

## 0.5.1 — 2026-08-01

### Upgrade reasons

- **On a repository with no records, the index invented them, and `context` fed
  them to the agent.** Any RFC-822-shaped `key: value` line was ingested as a
  trailer — conventional-commit prefixes (`ax:`, `fix:`, `docs:`), a Homebrew
  digest (`sha256:`), arbitrary body fields. One report had 106 rows on a
  repository with zero records. `context` is wired into the pre-edit hook, so
  what an agent received before editing was a commit subject presented as a
  recorded decision, and `doctor` called that state healthy while `stale` — which
  reads git — correctly reported nothing. A block carrying no key from the
  protocol's vocabulary is not a record now, and the two commands agree (#335).
- **`harvest-verify` says the draft is not a draft before asking for a
  transcript.** A draft that was prose rather than the contract's JSON object
  came back as `missing --transcript`, which sent the reader after a file they
  did not need for a draft that was never going to parse. The draft is checked
  first (#329).
- A tool's local config, `.serena/`, was committed into 0.5.0 by a `git add -A`
  and shipped carrying the name of the worktree it came from. Removed, ignored,
  and a test now notices a file that ships but was never declared (#334).

### What this release does not change

`Verified:` is protocol vocabulary. A release note that happens to use it as a
field is indistinguishable from a record that uses it for what it means, so a
block containing one is still a record. Guessing from surrounding context is how
a tool starts discarding records somebody wrote on purpose.

Nothing here changes the Windows repair path from 0.5.0: a repository whose hook
was installed before that release still needs `commitlore hooks install` re-run.

## 0.5.0 — 2026-08-01

Windows works, and this is the release that can say so from a run rather than
from an argument.

### Upgrade reasons

- **On Windows, `git commit` in a repository with the hook installed did not
  return.** It did not refuse and it did not succeed — it hung, and the shell it
  spawned kept running after the commit was killed. Two defects in one chain: the
  install root is recorded by Node as a win32 path and read by the hook under Git
  for Windows' shell, where `pwd -P` answers in POSIX form, so the containment
  comparison matched **nothing** — an attacker's path and the installer's own
  bundle alike — and control fell through to a directory walk that could not
  terminate at a drive root. Both are fixed; both sides of the comparison are now
  resolved before they are compared, and the walk stops when stripping a
  component stops making progress (#321).
- **If you installed the hook before this release, installing this release does
  not repair it.** The hook is written into `.git/hooks/commit-msg` when it is
  installed, so an existing repository keeps the old one. Run `commitlore hooks
  install` in each affected repository — it is not a commit, so it still works
  where commits are blocked. `commitlore doctor` reports such a repository as
  `outdated`.
- **Windows is supported.** Not because a PowerShell installer exists — that
  shipped in 0.4.1 and made Windows *reachable*, which is a different claim — but
  because #71's install-root containment is now established there by execution:
  in a required job on `windows-latest`, a real commit through the recorded
  install is accepted, an invalid record refused, and both containment attacks
  execute and refuse with the tampered program run zero times (#283).
- **`commitlore uninstall` removes what the installers wrote, and nothing else.**
  The wrapper, the pinned checkout, and one MCP entry per agent config. An entry
  is matched on its shape and on the wrapper it points at, never on the key it
  sits under — a server you named `commitlore` yourself, or the other install's
  entry on a machine carrying two, is left alone. Per-repository state and the
  Claude Code plugin are named rather than touched (#272).
- **`docs/COMPATIBILITY.md` states which hosts are supported and what each
  install path checks**, and a test compares every row to the file that provides
  what it claims (#271). It also separates *required* from *checked*: the plugin
  path enforces nothing, so a machine without Node gets a hook that fails open
  rather than a message naming what is missing.
- **Alpine and other musl Linux hosts are no longer described as unsupported.**
  The reason was that only glibc-linked binaries were published; there are no
  binaries. Executed in `alpine:3.21` on `aarch64` and `x86_64`: the install
  lands and the tool runs. Alpine 3.21 is supported; musl as a class is recorded
  as undecided, because one image is not a family (#323).

### What this release does not claim

Windows `supported` means the containment property was established there by
execution. It does not mean Windows has the same mileage behind it as macOS and
Linux, and it does not reach a repository whose hook predates this release.

`commitlore uninstall` does not remove the Claude Code plugin cache — thousands
of files it did not write, keyed by plugin version. It names the step instead.

## 0.4.1 — 2026-07-31

### Upgrade reasons

- **The documented install no longer reports a failure after succeeding.**
  Running the one-liner over an existing install exited 137 because the
  installer's own post-install `commitlore --version` was killed by a signal,
  after the binary had already been installed correctly. The verification now
  retries once and, if it still cannot run, says the binary is installed but
  unverified in this shell rather than failing the install (#256).
- The binary is written beside its destination and renamed into place instead of
  overwritten. Rename is atomic, so a reader sees either the old binary or the
  new one and never a partially written executable.

The root cause of the signal kill is not established, and #256 records what was
ruled out: overwriting an already-executed ad-hoc-signed copy of the same binary
in place and re-executing it exits 0, so cached-signature invalidation alone does
not explain it. This release makes the installer honest about a verification it
cannot complete; it does not claim to have fixed the kill.

## 0.4.0 — 2026-07-31

The release that makes recording a decision something the tool does, rather than
something you have to remember to ask for.

### Upgrade reasons

- **`commitlore capture` records a decision without you typing trailer syntax.**
  It runs prepare, verify and stage as one command: it snapshots the HEAD, the
  staged diff and the evidence sources, checks a draft's quotes against those
  sources mechanically, and stages at most one record for the commit being
  written. A verification failure produces no record and does not fail the
  command, because most commits should carry nothing (#198, #193–#197).
- **A record can no longer attach to the wrong commit.** The `prepare-commit-msg`
  hook applies a staged record only when the HEAD it was prepared against is
  unchanged, the staged diff still hashes the same, the record is staged,
  unexpired, unconsumed, and the policy identity is unchanged. If any of those
  fails it applies nothing and lets the commit through (#197). A `post-commit`
  finaliser then consumes the record exactly once, bound to the commit that
  actually resulted (#213).
- **`commitlore demo` shows the product in a temporary repository.** No network,
  no model, nothing written to your repository, and it removes what it created
  even when it fails (#202, #203).
- **`commitlore init` reports readiness instead of internal step names.** A clean
  run is short; a step it could not complete is still named rather than absorbed
  into a success message. The previous step-by-step output moved to
  `--verbose`, and `--json` is unchanged (#204, #205).
- **`harvest --prompt-only` prints the contract with no other input.** It
  previously refused unless a transcript and a diff were supplied, which
  inverted the order of use: the contract is what a session needs *before* it
  has produced a transcript (#229).

### Agents

- Three write-side MCP tools — `commitlore_prepare_capture`,
  `commitlore_verify_capture`, `commitlore_stage_capture` — give an agent the
  same capture contract the CLI uses. They write only inside
  `.git/commitlore/pending/`, never Git history; every binding a staged record
  commits to is computed server-side and never accepted from the caller; and a
  caller-supplied nonce is validated before it reaches any path resolution
  (#199, #200, #201).
- There is deliberately no `commitlore_write_record` tool. A draft cannot reach
  Git without passing verification and the pending transaction.
- `commitlore_before_change` answers with path-scoped context and, when given a
  proposal, an experimental guard result in the same response. The two are kept
  separate structurally: `guard_confidence` describes
  `possible_revival_matches` and nothing else (#219).

### Honesty about guard

- **Guard is classified as an experimental advisory.** Its measured position is
  precision 44.8% (95% Wilson 32.7%–57.5%) and recall 22.0% against a
  417-decision corpus, and that now appears wherever guard is exposed: the CLI
  help and output, the MCP tool description, and the README's known limitations
  (#208, #209, #210).
- The MCP description no longer tells a caller that an empty result "is a
  verdict, not an absence". At 22% recall an empty result is a miss in the
  common case, and saying otherwise was the most misleading sentence on the
  product surface.
- Guard output calls a hit a **possible match** and no longer prints a score in
  default text output. `--json` still carries the score and the signal
  breakdown for anything that parses it.

### Fixed

- `doctor` no longer asserts that a hook failed "when git's PATH carries no
  node" when the hook actually ran and threw. It reports what the probe can
  determine, including that it cannot determine the cause (#192).
- `init` no longer exits 1 in a repository where the configured PreToolUse
  executable is not resolvable from `PATH`. `doctor` still reports it; an
  incomplete environment is not a misconfiguration (#192, #221).
- The record lint now checks the full `origin/main..HEAD` range on pushes to
  `dev`, not only a pull request's own commits. A known duplicate identity had
  sat unresolved for a day because the two colliding commits never appeared in
  one narrow range (#186).
- `rationale_density` names its denominator. It now reports both populations,
  labelled: all commits, and authored non-merge commits. At the time of writing
  the gap is 26.3 points (71.8% against 98.1%), which is merge volume rather
  than a change in discipline (#183).
- `commitlore capture gc` is reachable. The parent command's required
  `--transcript` option was being enforced on the subcommand, so it could not
  run at all, and `--json` on it was silently ignored.

### Known limitations, unchanged by this release

- Windows and musl Linux hosts remain unsupported.
- Guard's measured precision and recall are what they are; nothing in this
  release improves them, and ADR-0019 records that the current signals cannot
  separate a genuine revival from a coincidental textual match.
- Nothing here measures whether an agent behaves differently for having received
  a decision. The fresh-agent recovery protocol is registered and unrun.
- Capture's write-side cost is still reported as `not instrumented` rather than
  as a number.

## 0.3.0 — 2026-07-29

### Upgrade reasons

- `doctor` now probes the PreToolUse command actually configured in
  `.claude/settings.json`. Binary-only installs no longer report a working hook
  as broken because `doctor` invented a missing shell-script path (#128), and a
  completed hook is no longer failed because its probe's stdin write raced an
  `EPIPE` (#149).
- `init` now exits 0 for a healthy new repository with no remote. It still
  reports the sharing warning; configured problems that need attention still
  exit 1 (#107).

### Correctness

- `context` no longer turns conventional attribution trailers such as
  `Co-authored-by` into decision records, and `validate` now rejects duplicate
  `Record-Id` values declared by two blocks in one message.
- Git and hook probes preserve a completed child process's exit status when an
  stdin `EPIPE` races after it exits. Local squash preservation and benchmark
  reporting now distinguish history loss from path-lookup loss.
- `guard` no longer lets one rare filename outweigh the unmatched subject words
  in a rejected alternative. Its former `identity:*` trace signal was
  IDF-weighted keyword coverage, not semantic or record identity; the corrected
  signal is named `keyword-strength:*`. Consumers that parse signal text should
  migrate to that name. The exported `STRONG_KEYWORD_MASS` constant remains as a
  deprecated compatibility alias for `STRONG_KEYWORD_STRENGTH`.

### Measurements and benchmarks

- Record capture is measured: the truthful one-record fixture used 1,524
  harvest tokens and 923 verification tokens (2,117 marginal / 2,447 including
  cache reads per accepted record).
- Addressable rationale density is measured: 203 of 263 commits (77.2%) carry
  records, with 2,243 structured trailers (37.5% of non-empty body lines). The
  denominator is every commit, merge commits included; merges are generated by
  `--no-ff` and carry no record, so the rate over authored commits is higher and
  the two are not interchangeable. Read the figure with its denominator named.
- Retrieval routes are compared at a two-record budget on a corpus with no
  superseded records: embedding top-k, embedding plus a path filter, and
  CommitLore path plus lifecycle each return 2/2 relevant records at every
  reported corpus size. **This is a tie, not an embedding-retrieval advantage**,
  and it withdrew the retrieval claim the README had been making.
- Retrieval routes are then compared on a corpus that contains superseded and
  expired records, which is the case the product exists for. At every size from
  0 to 10,000 distractors, BM25, embedding top-k, hybrid RRF and embedding with
  a path filter each returned one superseded record; CommitLore path plus
  lifecycle returned none, and both current records. The separation is in stale
  records returned, not in recall — recall at k=2 is 2/2 against 1/2 and is too
  narrow to carry a claim. One corpus, one query, one pinned embedding model.
- Irrelevant-context exposure is measured: with 10,000 distractors,
  inject-everything exposes 10,002 records / 1,004,554 tokens, top-k lexical
  returns 1/2 relevant records in 190 tokens, and path plus lifecycle exposes
  2 relevant records in 335 tokens.

The 17x indexed-versus-unindexed figure in the 0.2.0 notes is retired: it used
a parser that read only a message's final record block. The current 100k
measurement is 496.15 ms p50 indexed versus 86,672.97 ms p50 for
`--no-index`; it compares CommitLore modes, not alternative products. Modelled
break-even and token-saving claims are also removed: avoided rejected-path work
and provider token usage have not been measured.

### Compatibility

There is no end-user CLI or installation migration. The deterministic benchmark
now stops at 100k commits; this changes its internal measurement protocol, not
the product. Consumers of deterministic JSONL must accept the new
`capture_cost`, `noise_exposure`, and `rationale_density` rows, use
`outcome`/`measurement` instead of a survival row's former `method`, and accept
the added guard-threshold fields.

## 0.2.0 — 2026-07-28

Second release. 25 defects found and 22 closed by dogfooding this tool on its
own history (2026-07-26 to 2026-07-28) — several of them in CommitLore's own
install and check paths, listed below. 3 remain open, two of them
([#61](https://github.com/MongLong0214/commitlore/issues/61),
[#69](https://github.com/MongLong0214/commitlore/issues/69)) reopened on
2026-07-28 after dogfooding disproved the reasoning their original close
relied on — a reproducible guard false positive for #61, a `--help` string
that still promised a dropped property for #69. That is the loop working,
not a gap this release is hiding. Ships a single static binary (no Node
required), `commitlore init`, agent auto-detection, a `node:sqlite` index
(roughly 17x faster indexed vs. unindexed at 100k commits — see
`bench/results/deterministic-20260727T174801Z.md`), the multi-record grammar
for squashed history, reference-integrity checking, and unified exit codes
across every command.

Windows is not shipped, and won't be until [#95](https://github.com/MongLong0214/commitlore/issues/95)
is done: the SEA build crashes on Windows path handling, and shipping the
binary today would let the install hook bypass [#71](https://github.com/MongLong0214/commitlore/issues/71)'s
containment check, which has only been verified on the platforms this
release does ship.

Alpine/musl is not a supported target either — the published Linux binaries
are glibc (`*-unknown-linux-gnu`). [#99](https://github.com/MongLong0214/commitlore/issues/99)
does not add musl support; it makes the failure on Alpine attributed (a
named, exit-coded message) instead of a bare `not found`. The same work
verified `install.sh`'s dependency check directly: on a container with
neither `curl` nor `wget`, it prints `error: neither curl nor wget is
available to download the release` and exits, naming what is missing
instead of failing obscurely.

CommitLoreBench's fourth measurement (M4) is registered and running as of
this release. It may come back null — that question is open and this
release does not answer it.

### install.sh runs in CI now, on clean containers with nothing preinstalled — feat-issue-99

install.sh had never run on a machine that was not the author's: it was only
ever tested against a simulated release in a sandboxed `$HOME` on macOS. A
new CI job (`install-script` in `.github/workflows/ci.yml`) runs it inside
`debian:stable-slim` and `alpine:latest` containers with nothing
preinstalled — no curl/jq/tar/git added ahead of time to hide what the
script actually requires.

Debian ships neither curl nor wget by default; install.sh's own
`command -v` check already handles that cleanly (exit 2, a named message),
verified rather than assumed. A second step adds curl — the one missing
piece — and verifies the full path: binary installed, `--version` matches,
and all six coding-agent detections report absent with no config file
written for any of them.

Alpine surfaced a real bug: busybox ships wget/sha256sum/tar by default, so
the download and checksum-verify steps ran with nothing added, but the
published binaries are `-unknown-linux-gnu` (glibc) and Alpine is musl.
install.sh copied the unusable binary into place, printed "installed to
...", and then crashed on its own `"$dest" --version` sanity check with a
bare `not found` and exit 127 — not one of the four exit codes this script
documents for itself. Fixed by executing the freshly extracted binary
before installing it anywhere and `die`-ing with a named, attributed
message (exit 1, the existing "unsupported platform" bucket) if it cannot
run.

The checksum path is exercised deliberately: a corrupted copy of the staged
release asset (SHA256SUMS left pointing at the original, now-wrong hash) is
served to both images, and both must refuse it (exit 3, nothing written to
the install directory).

The real GitHub release (`v0.1.0`) currently has zero attached assets — the
job checks that first and runs every assertion above against a locally
staged, `release.yml`-shaped artifact via `COMMITLORE_INSTALL_BASE_URL`
(install.sh's own documented escape hatch for exactly this). The one step
that exercises the true `github.com` download path is conditional on a real
asset existing, so it starts running with no workflow edit the day a
release actually publishes one.

Not touched: `release.yml`'s build matrix (the SEA binary still has to
build on its real target OS, not a container standing in for one), and no
part of local development or the test suite was containerized — this is one
CI job for one script.

### `package.json` no longer describes a package this project can publish — bug-issue-93

`npm publish` would have succeeded: nothing in `package.json` enforced
ADR-0011's decision that there is no registry package. `"private": true`
makes that structural instead of a convention nobody checks.

`bin` pointed `dist/cli.js` at a package-manager install (`npm install -g` /
`npx`) that ADR-0011 already replaced with a git clone — and that entry
never worked: a fresh clone with no `node_modules` (exactly what a `bin`
install produces without a compatible registry flow) crashes
`ERR_MODULE_NOT_FOUND: commander`, because `dist/cli.js` is the unbundled
`tsc` output, not the esbuild bundle. Removed rather than repointed, per the
owner's instruction — it exists only to serve an install that will never
happen. `dist/cli.js` itself stays: CI and `scripts/commitlore-run.sh` both
still run it directly as the "`node_modules` is already sitting next to it"
fallback, which is unrelated to what `bin` does.

The five `dependencies` moved to `devDependencies`: rebuilt and ran the
bundle with `node_modules` deleted (`--version`, `validate`) to confirm
esbuild inlines all five — they are build-time inputs, and listing them as
runtime dependencies advertised a runtime that does not exist. `files`
(`dist`, `spec`) is untouched even though #39's single-executable binary has
since landed: it was not part of this audit's own "not clean" findings, and
folding it in here would be scope creep past what #93 asked for rather than
the "single cleanup" the issue anticipated.

Not touched: `npm run build`/`npm test`/`devDependencies`' existing entries
(the dev toolchain), and the npm text in ADR-0002 and ADR-0011 (the decision
history explaining why npm was rejected).

### Shape's verdict no longer depends on whether a repository is attached — bug-issue-90

SPEC §6.1 defines Shape as needing "the message alone" and running
"anywhere, including stdin." It did not: the same merge commit message got
`shape ok` through `--commit` and `shape failed` (an `unknown-key` on the
GitHub PR-title paragraph) through `--message-file`, reproduced against
gitseed's own history before changing anything.

The two paths had diverged, not the check class: bug-issue-76's merge-title
exclusion (`validate.ts`'s `nonTrailerParagraph`) gated on `source.merge`,
computed from `git log --format=%P` parent-counting — repository
information a `--message-file`/stdin caller never has. `--commit` and
`--range` populated it; `--message-file` and stdin silently left it
`undefined`, so the exact same excuse applied to one path and not the other
for the identical text.

Reconciled by making the signal message-only: `looksLikeMergeTitle` matches
the message's own first line against the subject `git merge` and GitHub's
PR-merge button write on their own (`Merge pull request #N from …`, `Merge
branch '…'`, `Merge remote-tracking branch '…'`, `Merge tag '…'`) — text
available identically in every input mode, so both paths now compute the
same excuse the same way. `readCommitSource` no longer fetches `%P` at all.

### `context` and `validate` now refuse two blocks in one message sharing a `Record-Id`, the same way `parse` already does — bug-issue-92

Continuing bug-issue-89's finding: `core/stale.ts`'s `findIdCollisions` only
fired when a *notes*-sourced record disagreed with a commit's own content —
a group with no `notes` record in it, which is what two same-message commit
blocks are, never reached it. `parse` already detected the same-message case
itself (bug-issue-89); `context` and `validate` disagreed with it about the
very same message.

`findIdCollisions` now also flags a `Record-Id` claimed by two *commit*-sourced
records that share a `sha` — declared by the same message, not a later
commit re-declaring the id over time (which stays a legitimate SPEC §5
lifecycle update, unflagged). A clean note mirroring its own commit is
unaffected: that always shares a `sha` too, and stays gated on payload drift
exactly as before.

`validate`'s reference check (`checkReferences`) built its collision-check
array by pairing `repositoryRecords` — which already carries the single
last-paragraph record `collectRecords` derives for the commit being
checked — with a per-block `candidate`, so checking the message's own last
block duplicated that same block instead of ever placing two *different*
blocks side by side. Rebuilt to pass the message's own blocks once each
(`ownRecords`, plus any notes record already found for that `sha`, so
bug-issue-74's divergent-note case stays covered) alongside `prior`.

Also fixed in the same investigation, without which the fix above could not
be observed through `commitlore context <path>` — the shape a user actually
runs: `core/query.ts`'s `collectRows` deduplicated rows fetched across
aliases by `sha`+`source`+`seq` alone. `seq` restarts at 0 within every
record block (SPEC §2.4), so a commit with two blocks has a `seq: 1` row in
*each* — `collectRows` was silently dropping the second block's rows as
"already seen," which is what made `context --json` show one clean record
instead of a blocked collision at a scoped path. Fixed by keying on `block`
too, matching the `trailers` table's own unique index.

### Compiled single-executable binary — feat-issue-39

`npm run build:binary` (`scripts/build-binary.mjs`) builds `dist/commitlore`,
a Node SEA binary that needs no Node runtime, no interpreter and no
`node_modules` at all — `doctor`, `validate`, `context`, `guard`, `inject` and
`index --rebuild` all run against `PATH=/usr/bin:/bin`. It uses Node's own
`--experimental-sea-config` and `postject` (a devDependency, not a runtime
one); `core/paths.ts` embeds `package.json`, `spec/SPEC.md` and
`spec/schema/record.schema.json` as SEA assets, since a compiled binary has no
directory tree of its own to read them from.

`dist/commitlore.mjs` (ADR-0011's committed, registry-free distribution) is
unchanged — the binary is a second, uncommitted, reproducible build artifact,
not a replacement channel. `commitlore hooks install` and the Claude Code
plugin's `PreToolUse` hook (`scripts/commitlore-run.sh`) both resolve and
prefer it automatically once built. `core/hook-target.ts#classifyBinTarget`
extends the commit-msg hook's `.js`/`.mjs` resolution with a `binary` branch
recognized by name (`commitlore`, not merely "no extension"); its containment
check is an exact match against the recorded install rather than a directory
prefix, since a binary has no subdirectory for a foreign file to hide in. Both
of #71's attacks — a `commitlore.bin` pointed outside the install root, and a
symlink planted inside it pointing back out — are refused for the binary
branch the same way they already were for scripts.

See `docs/adr/ADR-0015-single-executable-binary.md`.

### `parse` recognizes every record block, not only the message's own — bug-issue-89

`commitlore parse` still answered from `parseCommitMessage` alone after
bug-issue-60 taught `context`, `validate` and the index to recognize every
record block a message carries (SPEC §2.4): for a message with more than one
block, `parse` reported only the message's own last paragraph, while
`context` correctly reported all of them — the exact pre-#86 answer next to
the exact post-#86 one, for the same message. `parse --help` describes
itself as "the command" for asking this question, so it is the one place a
human or agent was still guaranteed a wrong answer.

`parse` now reports every block (`core/trailers.ts` `labelRecordBlocks`),
labeled `own` (the message's own last paragraph, SPEC §2.1 B1) or `earlier`
(a block the grammar recovered). A single-block message is unaffected —
verified byte-for-byte identical, text and `--json`, against the previously
shipped `dist/commitlore.mjs`, across every fixture in `spec/fixtures/`. The
multi-block form is additive: `--json`'s `trailers` key keeps meaning what it
always meant (the message's own block), with a new `blocks` array alongside
it only when there is more than one.

Also checked: two blocks in one message declaring the same `Record-Id`.
Neither `commitlore context --json` nor `commitlore validate` flags this
today — `core/stale.ts`'s `findIdCollisions` (the mechanism behind
`identityCollision`) only fires when a *notes*-sourced record disagrees with
a commit's own content; a group with no `notes` record in it, which is what
two same-message commit blocks are, never reaches it, and the two blocks are
silently merged instead. `parse` now detects this itself — a check local to
the one message being parsed, independent of `findIdCollisions` — and
reports it on stdout (`identityCollision: true` per block in `--json`, a
`Record-Id collision` marker in text) and stderr. Whether `context`/`validate`
should also catch the same-message case is open; SPEC and those commands are
unchanged here.

### Eliminates a `dist/`-race flake in `bench-ablation.test.ts`; scales `mcp.test.ts`'s per-test budget — bug-issue-88

`test/bench-ablation.test.ts`'s "accepts all six arms" test failed
intermittently under concurrent load (CI #79, #87). Diagnosed before
changing anything: `bench/runner.ts` hashes the whole `dist/` tree at startup
and re-checks it before every one of the six arms
(`bench/hooks-settings.ts` `writeArmSettings`), refusing an arm when the two
disagree — a real, useful check (it caught a genuine `dist/core/guard.js`
drift once before). `dist/` is one directory shared by every vitest worker,
though, and four other test files (`cli.test.ts`, `mcp.test.ts`,
`action-lint.test.ts`, `action-preserve.test.ts`) each rebuild it via their
own `tsc` in a `beforeAll` — so a concurrent rebuild from any of those can
legitimately trip the check on a digest that was never wrong, only
concurrently rewritten. Reproduced directly (`bench/runner.ts` invoked in a
loop against a competing `tsc` rebuild loop): ~1 run in 5 fails with exactly
the reported `Command failed:` / `dist/ changed after the benchmark matrix
started` error. `execFileSync` is fully synchronous, so vitest's own
per-test timeout cannot even pre-empt it — this was never a timeout problem,
raising one would not have helped.

Fixed the contention, not the symptom: `DIST_DIR` (`bench/hooks-settings.ts`)
is now overridable via `COMMITLORE_BENCH_DIST_DIR`, unset (and so unchanged)
everywhere except `bench-ablation.test.ts`, which now snapshots `dist/` into
a private, unshared copy once per file and points every run at it. 20/20
clean runs of the previously-flaky test under the same concurrent-rebuild
load that failed 4/20 before.

`mcp.test.ts` does not share that cause — it never calls `bench/runner.ts` or
the digest check — but its JSON-RPC round trips are `await`ed (unlike
`bench-ablation`'s synchronous `execFileSync`), so they genuinely are subject
to vitest's fixed 5000ms default under real concurrency. Scaled its budget to
`5_000 * Math.max(availableParallelism() - 1, 1)` — the same worker count
vitest's own default pool sizing already uses — rather than picking a bigger
constant.

### Multi-record grammar (SPEC §2.4) — bug-issue-60

A message MAY now carry more than one record block. `squash-preserve` used to
fold every inherited record from a squashed branch into one merged record —
correct only when the branch declared at most one `Record-Id`, and silently
wrong about `Provenance:` whenever it declared more than one. It now emits one
block per inherited record (`SquashPlan.blocks`), each keeping its own
identity and its own accurate `Provenance:`. `commitlore validate`,
`commitlore context`, and the index all recognize every block a message or
note carries, not only the last paragraph — which is also the fix for a
silent GitHub squash-button defect: when the squash button pastes full commit
messages into the merge body, `git interpret-trailers` (SPEC §2.1 B1) only
ever read the last one, and the rest silently became prose. A single-record
message parses byte-identically to before.

`commitlore doctor` gained a `squash-conservation` check: it warns when a
local branch that looks like an un-preserved squash source declared a
`Record-Id` that HEAD's history cannot find. Nothing invokes `squash-preserve`
automatically — for a local `git merge --squash` this check catches the
oversight; for GitHub's server-side squash button, nothing local can, and that
remains a documented gap (ADR-0014).

`X-Inherited-From:`, the previous format's only way to carry per-source
provenance when identity was ambiguous, is no longer written — each block's
own `Provenance:` says the same thing correctly. A note published before this
change still reads back exactly as it did (`X-<Name>:` is an ordinary
preserved extension, SPEC §3.2).

See `docs/adr/ADR-0014-multi-record-grammar.md`.

### Breaking

Exit codes are now one contract across every command (SPEC §10), not a
per-command habit: `0` ran, nothing to report; `1` ran, found what the caller
asked about (a violation, a match, a block); `2` could not run (usage error,
unresolvable ref, missing dependency, missing input file, no repository); `3`
ran and answered, but could not see everything (unfetched notes, shallow
history).

`guard` was the one command that disagreed with itself: `1` meant a broken
invocation and `2` meant a match, both opposite of `validate`'s `1`/`2`, and
`--help` documented neither. **`guard`'s `1` and `2` are now swapped** — a
match is `1`, a usage error is `2` — which is a breaking change for anything
scripted against the old numbers. Everything else was consistency work, not a
new behavior: `context`/`limits`/`ruled-out`/`warnings` now use `2` instead of
`1` for "no repository" or a bad flag (`3`, for an unfetched notes mirror, is
unchanged); `parse`, `harvest`, and `index --rebuild` now use `2` instead of
`1` for a missing input file or a missing dependency, matching what
`harvest-verify`, `inject`, `hooks`, and `squash-preserve` already did.

Every command now documents its exit codes in `--help`.

## 0.1.0 — 2026-07-26

First release. Protocol v2.0.0.

### The protocol

Sixteen trailer keys, every one of them with a consumer route — a key nothing
reads does not enter the spec. `spec/SPEC.md` is canonical; an implementation
that passes `spec/fixtures/` (25 conformance fixtures) and
`spec/contract-cases/` (14 cases) is a conforming implementation in any
language.

Parsing is delegated to `git interpret-trailers`, never to line matching. Eight
boundary behaviours (B1–B8) are pinned by fixture, including the two that make
grepping wrong: prose containing a colon line yields **zero** trailers (B3), and
a trailer block with no subject line yields zero as well (B8).

### The CLI

`validate` `parse` `context` `limits` `ruled-out` `warnings` `stale` `index`
`doctor` `guard` `inject` `harvest` `harvest-verify` `squash-preserve`
`backfill` `hooks` `mcp`.

Exit codes are a contract: `0` clean, `1` the check found something, `2` usage
error. (`guard` overloads `2` for "matched" — documented, not accidental.)

- SQLite incremental index with a `--no-index` fallback that returns identical
  rows from git alone. Measured p50 **1.86ms** for a path-scoped query over a
  100k-commit repository, against a 100ms criterion; the fallback answers the
  same query in 105ms.
- Records survive rebase, amend, squash merge (`squash-preserve`) and rename
  (`--follow` by default), mirrored in `refs/notes/commitlore`.
- Trust grading: `Warn:` renders as an instruction only when provenance is
  `authored` and the committer is trusted. Everything else is a claim. Trust
  defaults to nobody.
- Secret scanning refuses to inject a record whose value looks like a live
  credential, redacted to four characters.

### For agents

`commitlore mcp` (stdio MCP server), a path-scoped and budgeted injection hook,
transcript harvesting with an evidence-checking verifier, and `guard` for
pre-tool-use blocking.

### Measured, and what is not

Every figure in the README is regenerated from `bench/results/` by
`bench/report.ts` and CI fails if one byte differs.

The re-proposal benchmark ran 60 registered runs against frozen code and came
back **without a significant difference**: `commitlore-on` 5/30, `commitlore-off`
7/30, Fisher exact two-tailed **p = 0.7480**. It is published rather than
withheld. Two documents say why it is weaker evidence than it looks:

- `bench/VERDICT-M1.md` — power to detect the observed effect at n=30/arm was
  **5.1%**, and 4 of 10 tasks were silent in both arms.
- `bench/ROUTE-GAP.md` — the matrix delivered `Ruled-out:` as injected context,
  which SPEC §5 assigns to `Limit:` and `Warn:`. The route §5 assigns to
  `Ruled-out:` is `guard`, and it was never invoked. Replaying the same runs
  through `guard` stops 3 of the 5 re-proposals before execution, at a
  false-alarm cost that has to be designed against.

CPAA is not measured: `harvest` carries no model by design, so no bench row
prices it, and `metrics.ts` reports `not-instrumented` rather than a number.
The `no-scope` ablation arm is inert because the bench injector never scoped.

### Known limits

- One model and one CLI version behind every behavioural figure.
- `guard` matches lexically, not semantically: it finds a revival that reuses
  the words, not one that paraphrases them.
- Node >= 22 (ADR-0010; Node 20 reached end of life 2026-04-30).
