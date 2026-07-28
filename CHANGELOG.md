# Changelog

## Unreleased

`guard` no longer lets one rare filename outweigh the unmatched subject words
in a rejected alternative. Its former `identity:*` trace signal was
IDF-weighted keyword coverage, not semantic or record identity; the corrected
signal is named `keyword-strength:*`. Consumers that parse signal text should
migrate to that name. The exported `STRONG_KEYWORD_MASS` constant remains as a
deprecated compatibility alias for `STRONG_KEYWORD_STRENGTH`.

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
