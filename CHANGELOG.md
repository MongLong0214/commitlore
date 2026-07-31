# Changelog

## Unreleased

Nothing yet.

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
