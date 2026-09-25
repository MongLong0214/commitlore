# Changelog

Release notes for 1.0.0, 1.0.1 and 1.0.2 are on the
[GitHub releases page](https://github.com/MongLong0214/commitlore/releases); they
were not written here.

## 1.7.0

Five fixes found while upgrading a machine to 1.6.0. In each case something
reported success, or reported nothing, while part of the install was not
working.

**After upgrading, run `commitlore hooks install` once in each repository.** It
used to rewrite only `commit-msg`. The `prepare-commit-msg`, `post-commit` and
`pre-push` hooks that `init` installs beside it kept the stub their build
wrote, and a stub from before 1.1.3 cannot follow an upgrade. Under the `PATH`
a GUI client or IDE gives a hook, such a stub skips: the commit succeeds with
no staged record attached, and a push publishes no notes. Both exit 0.
`hooks install` now also refreshes each of the three that is already a
commitlore stub from another build. It still installs none that is missing and
leaves a hook without the marker alone. `hooks status` and doctor's
`commit-msg-hook` row name an out-of-date one (#1135). If a refresh fails,
`hooks install` exits 2 after writing `commit-msg`.

- **doctor's transport checks are bounded (#1136).** `notes-refspec` and
  `notes-push` reached each remote with no time limit and with the ordinary
  interactive environment, so a remote that stopped answering held the whole
  report. They now wait 15 seconds, with terminal prompts turned off and
  batch-mode SSH, and report a remote that does not answer as `could not verify
  (origin: no answer within 15s)`. `COMMITLORE_DOCTOR_REMOTE_TIMEOUT_MS` sets
  another limit, in milliseconds.
- **The `pre-push` hook keeps your SSH command (#1138).** The notes push set
  `GIT_SSH_COMMAND` unless you had, and git reads that variable before `GIT_SSH`
  and `core.sshCommand`. An SSH command chosen either of those ways carried the
  branch, and the notes push that followed used plain `ssh` and could fail. The
  hook and doctor now set it only when none of the three is set.
- **The installer judges the plugins by the version they end at (#1134).** The
  Claude Code and Codex plugin rows took "installed" as success, so a plugin left
  at an older version was reported as installed. Both rows now read the version
  after updating and fail, naming the command that moves it, when the plugin is
  still behind the CLI. `plugin install-codex` upgrades a Codex plugin that is
  behind instead of stopping at "already installed".
- **The installer's host rows run one at a time (#1137).** They all started at
  once, and the synchronous steps held the event loop past an MCP probe's
  timeout. On a first run, healthy registrations were reported as `initialize
  timed out`, and as healthy on the next run.

Minor rather than patch: `COMMITLORE_DOCTOR_REMOTE_TIMEOUT_MS` is a new setting,
and `hooks install` has a new way to exit 2.

## 1.6.0

`commitlore sync` no longer publishes the notes mirror to every remote.

With no `--remote`, sync used to write `refs/notes/commitlore` to every
configured remote, including forks added only to fetch a pull request. The
refusals from forks this account could not write to were reported as `failed`.
A fork that allows edits by maintainers would have accepted the push, and the
mirror carries every record in the repository (#1128).

**Sync now writes only where the branch's code goes.** It uses the remotes
listed in `commitlore.syncRemote` (`git config --add commitlore.syncRemote
<remote>`), else the branch's push remote in the order `git push` reads it,
else `origin`, else the only remote. Every other remote is named as `not
synced` and is never contacted. With several remotes and nothing to choose
between them, sync writes nowhere, exits 2 and asks for `--remote`. The
`pre-push` hook already synced only the remote being pushed to, and still does.

**A dry run says what it would do.** Its planned writes were reported as
`pushed`, `fetched` and `merged`; they are now `would-push`, `would-fetch` and
`would-merge`, in the table and in `--json`, which also gains `skipped` and
`source`. A script that matched a dry run's `pushed` needs `would-push`.

Minor rather than patch: `commitlore.syncRemote` is a new configuration key,
and a dry run's `--json` outcomes changed names.

Two `commitlore commit` fixes ship with it:

- **A draft of several records is all or nothing (#1127).** A draft whose
  records all verified and then exceeded `max_records_per_commit` was committed
  with none of them, and reported as a complete answer. A draft with one bad
  record staged the survivor before the refusal was reported, so the next plain
  `git commit` carried it. Now any rejection or failed capture stops the commit
  with nothing bound, and the max-records refusal says how to proceed.
  `commitlore capture` still stages the survivors and names the rest.
- **`--amend` checks evidence against the commit it produces (#1129).** A quote
  of the amended commit's own content was refused, because evidence was checked
  against the change since HEAD only. A message-only amend had nothing to cite.
  A record carried over from the replaced commit was refused with
  `duplicate-record-id`. Evidence is now checked against HEAD's parent to the
  index (the empty tree for a root commit), and the replaced commit's own
  records are left out of the duplicate checks.

## 1.5.1

Records the two channels agreed on were being withheld.

On a squash-merged repository, a merge commit carrying more than one record had
them served as nothing. `commitlore context` reported *"N trailer key(s) are
withheld because a record's commit message and its note on
refs/notes/commitlore declare different values for them"* — and the two
declarations agreed.

**The two channels are written by different hands.** A forge composes the squash
message; `writeRecordBlocks` writes the note. Only one of them separates record
blocks with a blank line, so git read the message's two records as a single
folded block while the note arrived as two. Grouped by the first `Record-Id`,
the folded block and the note block declaring that same id compared unequal —
thirteen trailers against eight on the reported commit — and every key that
differed was withheld. Nothing contradicted anything: both note blocks were
exact subsets of the folded one.

**On the reporting repository this moved one file from four `Limit:`, two
`Ruled-out:` and six `Warn:` to eight, four and twelve.** Those are the lines a
reader is meant to see before editing, and they were the ones going missing.

A note block that is one record of a folded message is now read as a component
of it rather than a rival account of it. **A real disagreement still withholds**
— a note that changes a value declares a pair the message does not carry, and
that key is withheld exactly as before.

What this gives up is recorded with the code: a folded block carries both
records' pairs, so a note that attributes the second record's content to the
first record's identity is now served rather than withheld. Reaching that takes
a hand-edited or corrupted note rather than an ordinary workflow, and the
alternative was leaving every squash-merged repository withholding records that
agree.

## 1.5.0

Something now starts the capture.

`commitlore auto status` has said the gap plainly for a long time: *"an agent
host must initiate capture; init installs no initiator"*. On this repository's
own history, 204 of 249 substantive commits carry a record. The missing 18% was
never a capability gap — it was a product that required five things to be
remembered in order.

**`commitlore commit` is one call in place of five.** Give it a message; add
`--transcript` and `--records` when there is something to record, and nothing
when there is not. It composes no commit message of its own — the records reach
the commit through the `prepare-commit-msg` hook, the same path a person uses
after staging a capture by hand. A draft with any refused record commits nothing
and binds nothing, and says both legal next moves: correct the quotes, or record
nothing.

**Recording nothing is a complete answer, and nothing anywhere checks that a
record exists.** That is the whole design rather than a gap in it. An agent that
must produce a record will produce one, and a false record is permanent — so
what can be enforced honestly is that the flow *ran*, never what came out of it.

**The Claude Code plugin now refuses a `git commit` on a tree that was never put
through the flow.** A `PreToolUse` hook on `Bash` answers one question — was
this tree considered — and names the command that clears it, in the directory it
graded, carrying `--amend` and `-a` through from the command it refused. It
steps aside for a merge, for a rebase, for `--dry-run`, for anything it cannot
parse, for a repository whose policy is not `auto`, and for a mechanically
trivial change: one file and five lines, documentation only, `fixup!`, or a
`release:` commit touching only release paths.

Everything it cannot answer is an allow. A gate that blocks on its own confusion
is one people disable.

### If you already use the five-step flow, nothing changes for you

`prepare_capture` → `verify_capture` → `stage_capture` → `git commit` satisfies
the gate. It writes the same consideration `commitlore commit` does, from the
shared code both routes pass through.

### What this does not promise

Not 100% recorded — 100% *considered*, and only where a Bash `PreToolUse` hook
exists. A person at a terminal, CI, a script, and any host without that hook are
unchanged: they get a simpler command and no enforcement. The ceiling on records
is still the agent's judgement.

## 1.4.2

Where the MCP server gets registered stopped being a decision this tool made for
you, and the one place it made that decision wrongly for itself is fixed.

**`commitlore init` asks which scope, and every scope the host has is
available.** `--mcp-scope user|project|local|none`, or the question itself when
there is a terminal to ask at. `user` is one registration covering every
repository you open, `local` is this repository for you alone, `project` is the
committed `.mcp.json` this command used to write unconditionally, and `none`
writes nothing — the right answer when the Claude Code or Codex plugin already
carries the server. The default is `user`, and it is the default in both
directions: what a bare Enter takes, and what a run with no terminal uses, so a
script and a person who pressed Enter end up in the same place.

The two host-owned scopes are written by `claude`, not by this tool. That file
belongs to the host and has already changed shape once; a second writer for it
is a guess that goes stale without announcing itself. `project` is still written
here, because this writer merges without disturbing servers somebody else put in
the file, refuses to overwrite an entry a person chose, and works for a host
that ships no CLI at all.

One measurement shaped the result: `claude mcp add` exits 1 both when the name
already exists and when it genuinely refuses, and the only difference between
them is prose. Re-running `init` has to be a success, so the question is asked
again in a form whose answer is an exit code — `claude mcp get` — and a real
refusal still reaches you in the host's own words. That answer does not say
*which* scope holds the name, so the report does not claim one.

A `user` or `local` scope asked of a machine with no `claude` on `PATH` is not a
failed install and no longer reports as one: the plugin paths carry the server
themselves, so it reports clean and names the command for later.

**The plugin's own MCP declaration moved off `.mcp.json`.** That name is read by
two loaders — the plugin loader, which defines `${CLAUDE_PLUGIN_ROOT}`, and
Claude Code's project configuration for any session opened in a checkout of this
repository, which never does. One file cannot be correct for both, and for three
iterations whichever form suited the plugin left every session in a commitlore
checkout with a server that failed to connect: `./dist/...` with `"cwd": "."`
(#870), then `${CLAUDE_PLUGIN_ROOT:-.}`, whose default reinstated #870 exactly,
then a bare `${CLAUDE_PLUGIN_ROOT}` on the reasoning that a host refuses an
unexpanded placeholder by naming the variable. It does name it — in a
diagnostics footnote — and it also spawns the registration and reports
`CONNECTION_CLOSED` in the session's server list.

So the declaration is `plugin-mcp.json`, named by both plugin manifests and
reached no other way, and the root name is left free. Nothing about the launch
changed. Two checks that were reading a name rather than a requirement, and
would have gone quietly green on the rename, now assert what they meant.

## 1.4.1

One report, and it arrived from a session doing something entirely ordinary:
working on a branch in a linked worktree.

**`prepare_capture` binds to the server's checkout, and now says so or refuses.**
The MCP server is registered against one working tree and answers from it. A
caller in a linked worktree of the same repository received a transaction bound
to the *other* tree — `base_head` was the main checkout's HEAD, the staged diff
was empty, and three files were staged in the caller's tree at that moment.
Nothing in the response was wrong, and nothing in it looked wrong either:
`staged_diff_empty: true` is also exactly what you see when you have staged
nothing. The harvest prompt then said `(no diff — nothing is staged)` and its
rule 8 told the agent to proceed on the transcript alone, so the flow continued
and a record would have been bound to a tree its author never touched.

The server cannot discover a caller's working directory — MCP carries no such
field, and a guess from the process tree is wrong in precisely the multi-worktree
case this exists for. So `prepare_capture` takes an optional `repository`: the
caller states the tree it means and the server verifies the statement, the shape
`--diff` already has on `capture`. It cannot change the binding, only assert it,
and a mismatch is a refusal that names both trees, says whether they are
worktrees of one repository, and leaves no pending transaction behind. Omitting
it keeps the old behaviour.

Where nothing is staged, the response now explains what that means instead of
only flagging it: `staged_diff_empty_means` names the tree that was inspected and
points at the assertion that would have refused. `repository` was already in the
answer, which is how the reporter caught this — but it was one field among
sixteen with nothing drawing attention to it.

**Three README claims corrected.** The symbol-anchor paragraph described a
command by a name this build does not ship; `commitlore coverage` is what it is
called. A link pointed at a `docs/README.md` that does not exist. And the
payload sample omitted the short-sha column every real answer carries, so the
first thing a reader compared against their own output did not match.

## 1.4.0

Six reports, and the first is the one to read: a credential in a trailer reached
every agent context that asked about the file.

**A credential is masked on the way out of every reader.** `validate` detected a
secret in a trailer value and reported it as `AKIA…`; every reader on the other
side printed the same value whole. `inject` worst of all — that is the projection
handed to a model before it edits a path, so one secret in one record was
replayed into every agent context that asked about that file, for as long as the
record stayed active.

The commit-msg hook is the intended gate and not the only door: a missing hook is
a `warn`, `--no-verify` skips it, `backfill` reads commits that predate it, and
the notes mirror carries records that only ever passed somebody else's gate. The
masking runs in the one place `inject`, `context`, `limits`, `ruled-out`,
`warnings` and the MCP tools all read through.

**A substituted source no longer settles a transaction as verified.** The
mismatch was reported only by rejecting individual draft records, so a draft of
`{"records": []}` — a correct and common answer — produced an empty `rejected`,
`incomplete: false` and a receipt: the shape of a clean final verification, for a
call whose transcript and diff were both wrong. It then locked the nonce holding
a verification built from sources it never matched. The condition is
transaction-shaped and the signal was record-shaped, so it now returns without
binding and reports `source_mismatch`.

**A capture that accepted nothing stays `prepared`.** It reached `verified` and
sat in `pending ls` forever, and `pending ls` is the only way a host can ask "is a
capture staged for the commit about to happen". A host that built that check had
every commit after its first empty capture read as covered.

**A divergent mirror withholds the axes that diverged, not the record.** A
`Record-Id` in both a commit message and its note, differing at all, made every
axis `[blocked]` — the reporter lost every `Limit:`, `Ruled-out:` and `Warn:` on
the only record covering the file they were about to edit, over two metadata
lines. Where every declaration agrees on a key, the approved commit message says
exactly that, so it is served; only the keys that actually differ are withheld.

**The prompt bounds the diff, and verify no longer needs it echoed.** The
transcript was windowed and reported while the diff went in whole: 190,300 of a
200,071-character prompt on one feature branch, which overran the client's limit
so capture could not proceed. The diff is windowed to its own budget and reported
as `diff_window`, and `verify_capture` reads the staged diff itself rather than
asking a model to reproduce 190,000 characters without drift.

**`before_change` describes itself, and `stale` speaks the coverage
vocabulary.** The two tools shipped identical descriptions while their schemas
differ in the way that decides which to call. And `stale` reported truncation
under a key the server instructions never teach, so an agent taught to check
`coverage` read `totalRecords: 0` from a partial scan as "nothing is stale".

## 1.3.17

Fifteen records that existed correctly in the notes mirror were being thrown
away, and 1.3.16's own report of the loss was nearly twice the real number. Both
were found by checking that number against the repository it was built for.

**A note block is kept when the commit does not actually yield that record.**
`collectRecords` drops a note block that duplicates what the commit declares,
decided by asking whether every trailer in it also appears somewhere in the
commit's trailers, unioned across blocks. That is right while the commit's blocks
are well formed — the commit yields one record per block and the note adds
nothing.

A commit whose blocks were flattened into one carries every identity in that
union and still yields a **single** record. So every well-formed block of the
note was a subset of it, all sixteen were dropped as duplicates, and the records
that existed only in the mirror disappeared. On the repository measured,
`totalRecords` read **32 where it should read 47**.

The test is now whether the commit side yields a record for *that identity*,
together with the text comparison. Identity alone was tried and broke three
existing tests, which were right to break: a note that claims an identity the
commit declares while saying something else is the divergent-note collision both
`validate` and `stale` exist to report. Both conditions are required, and each
rules out a different failure.

**The count of unfolded declarations only counts what nothing folds.** It had
counted an id as lost whenever it was not the first in its block, without asking
whether it reached a state from somewhere else. On the same repository that was
32 against a true 17 — a report about missing records that sent the reader to
repair records that were already intact.

The seventeen that remain are real, and nothing here recovers them: their records
exist only inside a malformed commit block.

## 1.3.16

`stale` names the declarations it could not fold, instead of leaving them out of
the count without a word.

**A block that declares several `Record-Id`s leaves all but one with no
lifecycle.** They cannot be reported superseded, expired or for review. On the
repository this was found in, that is **32 declarations across seven blocks**,
and the header said `of 32 record(s)` with nothing about them.

The fold is not wrong to keep one. `Record-Id` is single-valued, so a block
declaring several is malformed and `validate` reports it as `cardinality` — there
is no defined answer for the fold to give. What was missing was any report that
the others existed, which is the same silence `unresolved refs` exists to break
for a window the scan could not cover.

```
declarations not folded
  055ac9e4  15 of 16 unread: r-34ed9bf9ff05, r-33015efa341a, ...

note: 32 declaration(s) have no lifecycle because their block declares more than
one Record-Id, which is a cardinality violation — run commitlore validate on the
commits above.
```

`--json` carries it as `unfoldedDeclarations`, so a CI job can fail on it. A
repository whose blocks declare one id each gains no row.

**Where those blocks come from is not a writer bug here.** The affected commits
carry `committer: GitHub <noreply@github.com>`: the squash button on github.com
composes the message itself and drops the blank lines that separated the blocks.
`squash-preserve --message-file` writes correctly separated blocks, including for
a range whose commits already carry several.

Splitting a block at each `Record-Id` was rejected: it invents a record boundary
SPEC does not define, and would make `stale` report records `validate` calls
invalid.

## 1.3.15

`stale` no longer reports a reference as dangling when the record it points at is
declared in the same block.

**Every `Record-Id` in a block counts as a declaration.** The check built its set
of declared ids one per record, and a record here is a *block* — which can carry
several declarations, because squash inheritance writes each preserved record's
trailers with no blank line between them and git folds the lot into one trailer
block. One commit carried sixteen of them, fifteen invisible, and a `Follows:`
pointing at one of those — in the same commit, in the same block — was reported
as `dangling-ref`, whose `want` is "an existing Record-Id in history".

The asymmetry is what identified it: a second commit carried three ids and two
`Follows:` lines, and the one pointing at the **first** id resolved while the one
pointing at the second did not. Same message, same block, same scan.

The fallback used when the scan window is truncated already collected every
trailer correctly. The complete-scan path was the wrong one, which is why this
survived — the repair written for a partial scan was right, and nobody asked the
same question of the whole scan.

This is the reference half of a one-id-per-record assumption. The lifecycle fold
still has the other half and is untouched here: on the reporting repository, 52
distinct declared ids fold to 32 states, so about twenty records have no
lifecycle at all. That is a design decision rather than a repair and is tracked
separately.

## 1.3.14

`stage_capture` now requires the receipt for any transaction that has one, which
closes the hole #989 left open — without breaking anything, and without the
format migration it was scheduled behind.

**A caller that cannot prove it bound the transaction cannot stage it.** Staging
took a nonce and staged whatever was stored under it, so a connection that never
verified could attach the first caller's record and the commit would carry it.
The per-connection guard added in 1.3.11 could not close that: there is no caller
identity in the protocol, so "the caller that verified" was knowable only when it
was the same connection.

The rule is keyed on the transaction rather than on the release:

| stored receipt | presented | outcome |
|---|---|---|
| absent | absent | staged — a transaction older than receipts |
| present | absent | **refused** |
| present | wrong | refused |
| present | right | staged |

Every transaction this build binds carries a receipt, so every one of them is
protected. Nothing is migrated and no pending file is discarded. What is left is
a transaction prepared by an older build and staged after the upgrade, and a
pending transaction lives minutes — `expires_at` is `staged_at` plus five — so
that window closes itself.

Planning it as "always required" is what made it look breaking, and that plan
would have spent a release and a format version bump to close a five-minute
window.

**Authorization is checked before the binding conditions.** A caller with no
receipt is told about the receipt and never about HEAD, the staged diff or the
policy identity. Four existing tests saw a different message because of it, and
each now presents a receipt rather than being relaxed: a test asserting `HEAD
moved` from a call that cannot get past authorization was asserting the wrong
refusal.

## 1.3.13

`verify_capture` issues a receipt, and `stage_capture` refuses one it did not
issue. Two of the three steps that close #1005; neither changes what a host that
ignores them can do.

**A verification that binds a transaction is issued a receipt.** `stage_capture`
takes a nonce and stages whatever is stored under it, and nothing in the protocol
proves the caller staging is the caller whose verification bound those records.
1.3.11 closed the common case and made the mismatch visible; neither is the
closure, and a third connection — one that never verified the nonce — can still
stage it, which a test runs through to the commit rather than arguing.

The per-connection guard cannot close that: there is no caller identity in the
protocol, so "the caller that verified" is knowable only when it is the same
connection. A receipt is that identity. `verify_capture` returns it; the caller
that found the transaction already bound gets none.

It says **you bound this transaction**, never "your records were accepted" — a
verification whose evidence is not in the transcript still binds, to an empty
result, and is correctly issued one.

**`stage_capture` accepts an optional `receipt` and refuses a mismatch.** Sending
none still works, which is the whole difference between this release and the one
that closes the hole: a transaction written before this carries no receipt, and a
host that has not upgraded sends none. Requiring it is step three, it is
breaking, and it needs the pending format version bumped.

A refusal never names the stored receipt, and leaves the transaction stageable by
the caller that does hold it.

## 1.3.12

A query asks git for each fact once instead of three times, and the canonical
release workflow stops failing on a read it already knew to retry.

**One request, one reading of each repository fact.** Answering a query resolved
HEAD three times — the index refresh, the history-availability check and the
vantage read — and two of those ran byte-identical argv. The notes ref was
resolved twice the same way. On this repository at 1,621 commits with a complete
index, a query spent **18** git processes and now spends **14**; a second path
went 19 to 15. The saving lands on the first request, not only on a repeat, so it
does not depend on how often a session happens to ask the same thing twice.

The memo is threaded to each call site rather than wrapped around the spawn,
because a command whose answer the same invocation changed must not be reused and
nothing keyed on argv alone could tell the difference. One site is left reading
git directly on purpose and says why: the check that re-reads the notes ref to
confirm a pass matched it would, through the memo, compare the pass against
itself.

It lives for exactly one invocation. Nothing survives between requests, which is
the half of the original proposal that was withdrawn — the histogram behind it
established repeated work, not the net saving after validating every dependency,
and three of those dependencies cost more to check than the issue assumed.

**`canonical-merge` retries the ref read-back it pushed.** The workflow read the
ref it had just pushed and failed with a 404 three times in one day, one line
above a retry loop that existed for the read below it. Same loop, both reads.

## 1.3.11

Two reports now say what they know, and three issues closed by a `Closes` line
that did not do what they asked are met.

**`stage_capture` names the records it staged.** It returns the Record-Ids now
waiting, which a scripted caller previously had no way to read back — the nonce
was the only handle, and the tool that owns the transaction would not name its
contents. Worded as what *was staged* and never as what will be committed,
because the hook still selects the newest eligible transaction by `created_at`
and another nonce can win.

**`doctor` reports the schema version the index is stamped with.** The
`index-health` row described a database's trailer count, commit count and HEAD
position while omitting the one field deciding whether this build may believe any
of it: a mismatched version is discarded unread on first use, so every other
number in the row describes something about to be thrown away. The mismatch is
reported ahead of the HEAD comparison, so the reader is not sent after the wrong
repair. It reports the hole rather than closing it — `openIndex` and
`queryTrailers` still carry no version gate.

**Three issues were closed without meeting their acceptance, and now meet it.**
A query whose notes refresh could not run is no longer answerable as a current
index: with the absorbed-contention build restored, that query reports
`coverage: "complete"` with **zero of twelve** note records and no diagnostic.
The HEAD-moves-mid-pass property is asserted inside a pass rather than between
passes, and it has no negative control for a reason worth writing down — the
listing is the first thing a pass does, so there is no moment at which the scope
could be re-derived. And the collision-work profile was retaken by allocation
rather than CPU: holding commits at 200 and moving record density from 22 to 181,
those functions allocate 0 KB at both densities.

**`trusted-authors.ts` is searchable again.** Its field separator was a literal
NUL byte, so `rg` reported `binary file matches` and searched nothing — every
grep-based sweep of this repository skipped the file silently, and looking for a
function defined in it was answered with "it does not exist". The separator is an
escape now. The bytes hashed are identical, so no index is re-keyed.

## 1.3.10

A capture that verified nothing can no longer stage someone else's record, and
two storage figures this project had quoted are replaced with ones that measure
what they claim to.

**`stage_capture` refuses a nonce this connection verified without binding
anything.** The tool reads the transaction stored under the nonce, never what
the calling verification computed — deliberately, so a caller cannot smuggle a
diff hash past the server-side bindings. But there is no caller identity in the
protocol, so a caller whose verification was refused could stage anyway and the
next commit would carry the *first* caller's record: one the second caller was
told it did not get. The server now remembers, per connection, which nonces its
own verifications failed to bind.

That is a mitigation rather than the closure, and the limits are stated rather
than glossed: a reconnection bypasses it, and a nonce this connection never
verified keeps the old behaviour. Closing it fully needs a receipt required at
stage, which is a pending-format version bump and therefore a release sequence.

**Storage is measured per table, and writes are counted as writes.** The old
figures came from dividing the whole database by a row count, and from
subtracting `page_count` — which measures growth, so an index rewriting tens of
kilobytes per commit reported zero. Per-table sizes come from `dbstat` now, and
writes from WAL frames, counted with the handle still open because the exit
checkpoint erases them. A record-bearing commit rewrites 18 to 24 pages while
the file does not grow at all; both columns now sit in the same table.

**`npm test` builds first**, as `test:local` already did. Many tests spawn the
built bundle rather than importing the source, and a stale one reports the last
build as this one.

## 1.3.9

A note's own trailer block is read in a batch now, the way a commit message's
already was.

It cost one `git interpret-trailers` process each, because there is no atom for
it — `%(trailers)` parses the annotated *commit's* message, and a note body is
not that. The earlier paragraphs of every note in a batch were already answered
in one pass; the block that matters was not.

This had been recorded as unfixable, and half of that was right: probing a
note's *last* paragraph in isolation is a different question from the one the
whole message answers, and it is the shape that fabricated a record once. What
does not follow is that each note needs its own process. Whole messages batch
safely, because that asks git exactly what asking one at a time asks.

Equivalence is checked against this repository's whole history — 1,603 distinct
messages and its notes, disagreeing nowhere — and against fifteen shapes built
to break it, including both that broke earlier designs. A corpus that happens
not to contain the hazard is how a previous "zero disagreements" was read as
soundness.

`doctor` goes from 29 `interpret-trailers` to 19 and from 488 git processes to
478, with the index identical row for row.

## 1.3.8

Two places where concurrent work could be mixed into one answer, or lost.

**A query now reads one version of the index.** `runQuery` reads twice — once to
fold lifecycle states, once to gather the rows it displays — and its own
contract requires the two to agree, because a stream where they disagreed would
report records whose supersessions had not been read. They were separate reads
on a live database, so a rebuild landing between them produced an answer neither
version supports. One pinned read snapshot now covers every read a query makes,
the coverage counts included: a coverage number taken from a different version
than the rows is the same defect wearing a smaller hat.

**Advancing a capture's phase now holds the nonce.** Verification took the lock
for its read-check-write; staging and marking-applied did the same shape of
update to the same file and took nothing. Two callers could both read a verified
transaction and both write it staged — and a delayed one could write `staged`
over a record another process had already advanced to `applied`, losing the
marker that says the trailer reached a commit. The atomic rename these use keeps
a file from being half-written; it does nothing about two whole files written
from the same stale read.

## 1.3.7

Two ways a query could answer wrongly and say it was complete. Both were found
by review rather than by a test, and both now have one.

**A fast-forward could lose a note, permanently.** A note row is not a property
of the notes mirror: the pass filters the mirror by what HEAD reaches, so one
mirror yields different rows at different HEADs — and the check that decided
whether to re-read compared the mirror and nothing else. Index at an ancestor
whose mirror already carries a note on a descendant, then `git pull --ff-only`:
the commit scan advances, the notes scan returns at once, and the note is
missing with nothing queued. Every later call repeats it. On the reproduction
the indexed answer was `coverage: "complete"` with no records while
`--no-index` returned the note — the two paths disagreeing, which is the one
thing they may never do. A missing `Supersedes:` arriving the same way would
leave a withdrawn constraint active.

A pass now records the HEAD it was scoped to alongside the mirror it read. The
correctness alone would cost a whole notes pass per commit — 40
`interpret-trailers` on a repository with 40 notes, paid by the post-commit
hook every time — so a fast-forward is answered narrowly: it can only add
reachable commits, so only the commits it added can be carrying a missing note.
56 git processes to 14, and 40 parses to 0.

**A query that fell back to the scan kept describing the index.** When a read
fails, the answer is produced by a full scan for the rest of that query — that
part always worked. What did not was everything the query then said about
itself: `fromIndex`, the scan-pass count, and the unread count were all fixed at
the index's values. The last one decides `coverage`, so a fallback scan that ran
out of budget while the index's queue happened to be empty reported a complete
answer that was missing records. The explanation was lost too, appended to a
diagnostics array that had already been copied.

## 1.3.6

Concurrency, measured instead of argued — and three defects that only showed up
when four real processes met on one index.

**A second verification of a capture no longer destroys the first.** A caller
that verified a prepared nonce and finished could have its result deleted by the
next caller to arrive: the store refuses every phase but `prepared`, and the
refusal was answered by discarding the transaction. Once the first caller has
released its lock and exited, a deliberate replay and a concurrent caller that
arrived late are byte-identical from inside — so a verification whose caller had
been told it passed was thrown away. It is now refused before anything is
recomputed, and the refusal is reported: every drafted record comes back
rejected, naming the phase and what to do about it. The guarantee that mattered
is unchanged — a result nobody stored is still never reported as accepted.

**Opening the index while another process opens it no longer throws.**
`PRAGMA journal_mode = WAL` raised `SQLITE_IOERR` — "disk I/O error" — out of
`openIndex` when several writers arrived together, which is a crash on the path
the edit hook takes per edit. And the write transaction opened with a deferred
`BEGIN`, which SQLite will not apply `busy_timeout` to: the timeout was set and
had no effect on the case it was set for. Both fixed, and the journal-mode guard
tests SQLite's own result code rather than the wording of a message — it
re-raises the two codes that mean the file needs rebuilding and absorbs the rest.

Contention itself still reaches the caller, and deliberately so. A version of
this release absorbed it and reported a pass that had done nothing; review found
that a notes refresh which lost its write lock then returned normally with the
old rows in place, and a query served that stale index as complete where it had
previously fallen back to a full scan. A derived cache must not answer "I am
authoritative" when it means "I am behind".

**`doctor` and `validate --range` stopped re-reading the same messages.**
`doctor` parsed each candidate branch separately, and `validate --range` parsed
every message twice because its shape pass and its reference pass held separate
caches. Both now read a range once. On this repository: `doctor` goes from 70
`interpret-trailers` to 30 and from 592 git processes to 531, with all 22 rows
identical; a 79-commit `validate --range` goes from 179 to 14 and from 445
processes to 281, with the report identical.

**The test suite can be believed locally again.** `npm run test:local` bounds
the workers, and the two files that scan real history carry timeouts sized from
a measurement rather than from a default. Under full parallelism this suite was
reporting failures that were not failures — eleven of fifteen were the 20-second
default expiring on work that takes six.

## 1.3.5

One pass over the notes mirror now reads one mirror.

**The note reader touched a mutable ref three times.** `revParseRef` recorded
it, `git notes list` enumerated it, `git log --notes=<ref>` read the bodies —
and the result was stamped with the first of those readings. A mirror that moved
between them produced rows from one version under a stamp naming another. It
self-corrected on the next call, because the stamp no longer matched the live
ref, except where the ref returned to the stamped value first; in between, a
query answered from a mirror state that never existed as a whole.

The listing is `git ls-tree` against a resolved tree, and the bodies come from
the blob ids that listing named. The snapshot is chosen once by the caller and
everything downstream reads it — including a resumed drain, which recovers its
queued notes from the mirror the queue was listed from rather than from the ref.

**It costs nothing.** One listing process for one listing process, and the
commit fields a note row carries — `%ct`, `%cI`, `%G?` — now come from the path
pass that already visits exactly those commits. A cold rebuild of this
repository stays at 31 git processes and 14 `interpret-trailers`, with the index
identical row for row on trailers and on paths.

**A note body is framed by byte length.** `cat-file --batch` says how many bytes
each object is, and indexing a decoded string by that count is wrong the moment
a note holds a multi-byte character — wrong silently, because every object after
it is then framed from the wrong offset. The bodies are walked as bytes and
decoded per object.

**Two tests that could not fail were fixed on the way.** The first version of the
mirror-moving test moved the mirror before the pass began, where the listing and
the bodies see the same thing and a defective reader passes; it now moves it
inside the pass and asserts the rows match the tree the stamp names. And the
`index-db` mock wrapped only the string git helpers, so four tests that inject a
failed note read were never reaching the failure they injected.

## 1.3.4

Two consumer routes were reading every message through git one paragraph at a
time, and four numbers this project acted on were taken without saying what they
were taken against.

**`validate` read the same message three times per source.** Once for its own
trailers, once more inside `parseRecordBlocks` because no block was handed over,
and a third time in the reference pass — each a `git interpret-trailers`
process. The blocks are read once per invocation now and shared.

**The paragraph probes of `collectRecords` go in one process.** The atom already
removed the process for each message's own block; every earlier paragraph was
still one apiece. Attributed by stack rather than guessed: of 245 processes in a
39-commit `validate --range`, 156 were those probes and 111 arrived through this
one reader.

**And the notes beside them.** A note is read once and parsed from what was
read, where pairing the batch with `readRecordBlocks` would have read every note
twice.

Measured through `scripts/measure.mjs`, against a rebuilt index, on this
repository:

| | before | after |
|---|---|---|
| `validate --range` over 39 commits | 430 processes, 284 `interpret-trailers` | **247, 101** |
| `stale` | 331, 279 | **78, 26** |

`validate --json` is byte-identical before and after; `stale` and `doctor`
differ only in their timestamps and `durationMs`.

**`doctor` is unchanged, and the number that said otherwise was wrong.** It was
quoted at 228 `interpret-trailers`, taken against whatever index state the
previous run had left. Against a rebuilt index it is 71, before this change and
after it. The "improvement" that number implied was the index state moving, not
the code.

**So numbers now carry their provenance.** `scripts/measure.mjs` pins the index
state, counts processes rather than timing anything, and prints the repository,
HEAD, commit and note counts and the machine load beside the result. Four
numbers were wrong the same way — a batch read as 3.7s while three other jobs
ran and 206ms quiet; "zero disagreements" from a corpus holding neither shape
that broke the design; 29% duplicate branches measured over refs the code does
not read. A bare number is now visibly unsourced.

## 1.3.3

A complete index could be replaced by a shorter one, and the only thing that had
ever said so was a design review.

**A rebuild no longer publishes less than what is installed.** `rebuildIndex`
scans outside its transaction and replaces every table inside it, with no
comparison against what is already there — so a scan that started earlier and
read less lands on top of one that read more. Run rather than reasoned about, by
holding a budgeted rebuild inside its scan while another committed a whole one:
a complete index of 10,290 trailer rows became **591 rows with 1,491 commits
owed**. Recoverable, because `scan_pending` names exactly what is left, and a
6%-complete index answering every query until a later call drains it.

`scan_pending` also measures coverage, so noticing needs no new bookkeeping:
against the same HEAD, the index that owes less has read more. A budgeted
rebuild that would install more outstanding work than is already installed keeps
what is there instead.

Scoped to budgeted rebuilds. Without a budget the caller is `index` or `init` —
somebody asked — and that must replace whatever is installed, because the reason
may be corruption or a schema this build cannot read.

**Two unbudgeted rebuilds racing still overwrite each other.** Closing that needs
the writer lock held across the scan, which serialises cold rebuilds on the path
the budget exists to protect. Stated as the boundary rather than left to look
like the narrow fix is general.

## 1.3.2

The probes that decide whether a paragraph is an earlier record block now share
a process. Two attempts at that were wrong in ways this repository's own history
could not show.

**One process for many probes, not one each.** `parseRecordBlocks` asks git
whether a paragraph is a record block (SPEC §2.4) by parsing it on its own, and
1.3.1 left 155 of those per cold rebuild. git accepts several files per
invocation, so they can share one — but it emits nothing between them, and the
marker that attributes the output is the whole difficulty.

**Putting the marker in the paragraph fabricated a record.** git does not
require every line of a block to be a trailer, which is what the first design
assumed: a group holding a recognised trailer is accepted once a quarter of its
lines are trailers. `Record-Id:` and `Signed-off-by:` above seven prose lines
parse to nothing; appending one marker line — 2/9 to 3/10 — made git emit a
record block that does not exist. **A second shape moved records between
commits**: a scissors line makes git discard everything after it, an appended
marker included, while still emitting the trailers above it, so that paragraph's
records landed in the next paragraph's answer.

Neither shape occurs in this repository's history, so the corpus that had 131
paragraphs and zero disagreements said nothing about either. Both came from
review, and both are now fixtures.

**The marker goes in a file of its own.** Each paragraph file is byte-equal to
what the single-process path pipes, so git's verdict on it is the verdict it
would give alone, and each marker file is one trailer line that git accepts
unconditionally. Every paragraph must return its own marker, in order, or the
batch is discarded and the caller falls back to one process per paragraph.

**The notes path was the last of it.** It spent 46 of the remaining 48 processes
for eleven notes, because it had both gaps the commit path had: no atom and no
batch. The batch it can have; the atom it cannot, since `%N` carries the note
text while `%(trailers)` parses the annotated commit.

A cold rebuild of this repository:

| | git processes | `interpret-trailers` |
|---|---|---|
| 1.3.0 | 261 | 244 |
| 1.3.1 | 172 | 155 |
| 1.3.2 | **31** | **14** |

The index is identical throughout, row for row on trailers and on paths.

**And the boundary the resumable scan rests on is now a test.** A queue entry is
retired only in the transaction that inserts the records read from it; that was
argued and never asserted. A trigger that refuses every retirement now proves
the inserts roll back with it — and moving the retirement outside that
transaction fails it.

## 1.3.1

The index paid a process to work out something it had already been told.

**The recovery pass re-derived the block the walk had handed it.**
`readCommitRecords` reads `TRAILERS_ATOM` in the same `git log` that fetches
each commit, so a message's own trailer block arrives with it. The pass that
recovers *earlier* blocks (SPEC §2.4) then called the grammar with no block in
hand, and the grammar spawned `git interpret-trailers --parse` to work out the
one already in hand. `stale` and `squash-preserve` were both moved onto
`parseRecordBlocksWithAtom` for exactly this reason; the index was left behind.

A cold rebuild of this repository went from **261 git processes to 172**, of
which `interpret-trailers` went from 244 to 155 — and the index it produces is
identical, row for row, on both trailers and paths. Nothing about which
paragraphs are tested changed: the atom decides only where the last block's
bytes come from, and the process still answers whenever the message's framing
makes the atom ambiguous.

This is the first half of #951's ranked item 1, and it is the half that needed
no new measurement. The measurement the issue asked for said the rest: commit
count is not the cold-path driver — 20,000 generated commits index cold in three
seconds while 1,544 real ones do not, because the generated history carries no
multi-block messages. What is left is the 155, which are one process per
candidate paragraph, of which 88 of 114 on this history are paragraphs that
could never have become a block.

## 1.3.0

A scan that ran out of budget stopped, and then never started again. Everything
below follows from that one thing, and from two rounds of external review that
reproduced, between them, eight ways the fix for it would still have lost work.

**A budgeted scan now carries on from where it stopped.** A truncated scan used
to persist one number — how many commits it had left unread — and a number
cannot be resumed from. Measured on a 1544-commit repository against an injected
clock: the first budgeted call read 448 commits, and seven further budgeted
calls read none. The index stayed 29% built until somebody ran `commitlore
init`, which is the one command the situation exists to avoid needing. The
unread work is now recorded as the work itself, in a `scan_pending` table, and a
later budgeted call drains it. Four calls take that repository to a complete
index whose rows are identical, one for one, to a single unbudgeted rebuild.

**A slice per call, not the whole budget.** Finishing the index is not what the
caller asked for; answering is. Spending the rest of the budget on the backlog
converged in four calls and made every one of them cost three seconds — an edit
hook that used to return in milliseconds paying full price on every fire. The
drain takes a quarter of the ceiling, so the backlog still empties and each call
stays close to what it cost before.

**The unread count added commits to notes.** One `meta.unread_commits` held
both, so draining either source could report the other complete. They are
counted separately now, and `doctor` reports each.

**A truncated notes pass claimed the mirror was indexed.** The rebuild stamped
`notes_ref_sha` whether or not the notes were all read, and `indexNotes` returns
immediately when that stamp matches — so the notes left over were never read
again. Eleven of this repository's own notes were being dropped permanently
while the stamp said otherwise. The stamp is now written only for a pass that
finished, and outstanding notes carry the mirror they were listed from: draining
a queue listed from an older mirror can no longer certify a newer one.

**The walk enumerated a name it had already resolved.** `rebuildIndex` read
`HEAD` with one git process and then walked `HEAD` with another, so a checkout
landing between them attached the walk — and `last_indexed_sha` — to a history
it never read. It walks the resolved object now.

**A budgeted incremental had the same defect the scan had.** New commits beyond
the ceiling were read, discarded, and left out of both the index and the unread
count: reproduced at 130 new commits against a budget reaching 64, where three
successive calls made no progress, all 130 were missing, and the index reported
nothing owed. What the ceiling cuts off now joins the queue.

**A queued entry is retired by identity, not by position.** A drainer selects
its rows and then reads git holding no transaction, and a rebuild can replace
the queue inside that window. Deleting on position alone retired whatever had
moved into that slot — work nobody had done — and the index then called itself
complete with a record permanently absent.

**A note's identity is its commit, and its commit does not change when it
does.** Retiring queued notes by sha therefore could not tell one version of a
mirror's work from another: a drainer reading 64 notes from one version while
another process re-listed the queue against the next retired the new queue's
entries with the old version's content, leaving 64 old notes, 66 new ones and
nothing outstanding. The mirror is checked again inside the write, and a queue
that moved underneath is refused rather than retired.

**A mirror that disappears takes its rows with it.** A truncated notes pass
leaves both rows and a queue, belonging to one mirror. Dropping only the queue
left an indexed prefix nothing pointed at, with `notes_ref_sha` and the live ref
both unset — so `indexNotes` returned at its first line and those notes were
served for good.

**The one-batch floor is spent once per call, not once per source.** Giving it
to both readers let a call with an already-spent budget read a full commit batch
and then a full notes batch, twice what the floor is supposed to cost.

**An unborn HEAD kept what it could no longer reach.** Switching to an orphan
branch returns from `updateIndex` before either pending path, so the previous
branch's rows and its whole backlog survived — the orphan served records from a
history it does not contain, and three calls later still owed 130 commits
against it. Everything derived is cleared with the history it came from.

**`doctor` called an index current that was missing history.** `index-health`
compared `last_indexed_sha` against HEAD, and a budgeted scan stamps that equal
the moment it starts, outstanding work or not. It reads what is outstanding now,
and warns.

**The index schema is v5.** A v4 index left partial by an earlier release has no
position to carry forward, so it is rebuilt once on first use — which is the
existing mechanism for exactly this, and costs one rebuild.

## 1.2.19

Four findings, and three of them came from running the monitor against the
released build rather than from reading the code. The fourth came from an audit
that contradicted a conclusion this project had already written down.

**A mode-only change is not already in HEAD.** An executable bit is a change HEAD
can decline, and the blob does not move when it does — so comparing object ids
alone called an abandoned `chmod +x` "already squashed", and prescribed
`squash-preserve --target`, which writes the branch's records onto a commit that
never took the change. That is the manufactured provenance the check's own header
names as the failure it exists to prevent. It predates the tree-diff rewrite in
1.2.17 rather than arriving with it: the `rev-parse <rev>:<path>` form compared
ids alone too, and both 1.2.16 and 1.2.18 answer the same way on the
reproduction. The raw diff already carried both modes; only one was being read.

**A prose mention upstream is not a declaration.** `upstreamRecordIds` matched
`^Record-Id:` in the upstream's message text, so an upstream commit whose body
read "a record line looks like this in prose: Record-Id: r-x" made an unmerged
branch that really declares `r-x` report `ok` — the loss excused by a sentence
about losses. Git's own parser reads no trailer in that message, and neither does
this project's. It is #914's finding at a second site: `stale` was moved off a
text scan for exactly this reason, and this one was left. Reading the upstream
through the parser costs 176 more git processes on this repository, which is what
the answer being about trailers rather than about text costs.

**`pending ls` asked where the pending directory is, once per pending file.** A
repository with 24 of them paid 25 `git rev-parse --git-path`, of which 24 were
the same question with the same answer. 26 spawns to 2.

**`collectRange`'s cache covered the messages and not the note bodies.** Candidate
ranges overlap, so a note on a shared commit was read once per candidate —
twelve reads of one note in a single `doctor` run. That is the same half-fix
`CollectCache` shipped with two releases ago, and measuring caught it the same
way both times: a cache added to the loop that was profiled, while the sibling
read in the same loop keeps its own cost.

**`doctor` resolved every branch twice.** `for-each-ref` had already resolved
each ref to answer at all, and the check then ran a `git rev-parse` per name.
Taking `%(objectname)` from the enumeration removes exactly one process per
branch: 945 spawns to 745 here, 731 to 531 elsewhere, 200 each, which is the
branch cap rather than a fraction of it.

That last one contradicts what was written in 1.2.18: that doctor's remaining
cost could not be reduced without changing how the check decides a branch's fate.
Enumeration and decision are separate, and this was enumeration. The per-candidate
range walks are untouched and are what the remaining cost is.

## 1.2.18

One question, asked for the first time: **did this release weaken the scanner?**

1.2.17 narrowed three injection patterns and, in doing so, served three phrasings
that 1.2.16 blocked — `you would paste this into your terminal` among them. Every
required context was green at its merge commit. It was caught by hand, before
tagging, by running the previous release's binary against the same phrasings, and
the fix shipped in that same release. Nothing in the pipeline would have found it.

**Why nothing found it.** Three answers were tried and each failed the same way:
the corpus came from a person, so it held only what a person had thought of.
Fixtures pin phrasings someone wrote, and a narrowing releases the ones nobody
wrote — otherwise its author would have seen it. This repository's history is
entirely benign, so a narrowing that releases an attack shows up there as no
change at all. A cross product generated from the scanner's own vocabularies
shrinks with the list it reads: reinstating 1.2.17's two-word agent list produced
505 cases instead of 733, and every one passed.

**The corpus does not have to come from a person.** A pattern is a specification
of what it catches, and its alternations enumerate that specification — so the
table generates its own adversarial set. Each alternative of each group appears
at least once rather than every combination, because the full cross product
reaches 21,600 strings for a single pattern and covers nothing the smaller set
misses. Each phrase is then framed in every shape a disarm rule reads: an agent
subject before a counterfactual, a negation, a reporting verb.

Coverage of every pattern comes from an invariant that already existed — a
pattern with no fixture is reported as an orphan — so the fixtures seed the seven
patterns whose nested groups the expander cannot flatten.

**The artifact is one direction.** `test/injection-blocked.json` records the 1,380
phrasings that block today. A phrasing in it that no longer blocks fails the run
and is named. Releasing a false positive is the point of a narrowing, so that
direction is not a fault; releasing something *without noticing* is. Regenerating
the file is deliberate, and its diff is exactly the list of phrasings a change let
go — the review 1.2.17 did not get.

Measured against the defect it was built for: reinstating 1.2.17's rule fails with
368 named phrasings. Three had been found by hand.

## 1.2.17

Two reports about the injection scanner, and a finding neither of them asked for:
on this repository's own history the scanner's precision is zero. Not one of the
thirteen records it withholds here is an attack. That is not an argument for
deleting it — this corpus contains no attack, so there is nothing for it to catch
— but it is the shape of a trade that was never stated, and it is now written
into the table's own header.

**A noun compound is not a shell invocation (#931).** `tool.shell-invocation`
matched a verb, up to 24 characters, and a shell noun, which reads every noun
compound as an instruction. In the reporting repository a *run* is one execution
of a suite and its *terminal* is the record that execution writes, so records
about the central object of that codebase were withheld for using its own
vocabulary. The shell noun now has to sit where the verb's destination sits: its
object (`run the terminal`), behind a preposition (`paste this into your
terminal`), or as an interpreter the verb names (`execute bash`).

The reporter suggested a determiner between the two words as evidence the first
is a noun. Measured, that heuristic disarms `run the terminal` — which they
themselves classify as an instruction — and `run this in bash`, while still
blocking the benign row it was proposed to fix. Every narrowing here is measured
against both fixture sets for that reason.

**The author hears it now (#931).** Nothing on the capture or validate path had
ever run the scanner over the draft being written: a record was verified, staged
and committed under `shape ok · references ok`, and only appeared withheld later,
to someone else. `capture` now refuses with a reason naming the trailer and the
pattern, and the commit-msg hook warns on stderr — a warning rather than a
refusal, because refusing there would make `--no-verify` the way past the
scanner.

**The mandated separator was read as a pipe (#935).** SPEC requires `|` between a
`Ruled-out:` alternative and its reason, so every value of that key carries one
by construction, and `tool.pipe-to-shell` hunts a pipe followed by an interpreter
name. A reason that began "node on Windows reads…" was withheld for the grammar's
own punctuation. The first pipe of a `Ruled-out:` value is now neutralised for
that pattern alone; a second pipe is still a pipe.

**`would` marks a counterfactual (#935).** A reason explaining why an alternative
was refused describes what it *would* have done. `would` immediately before the
verb now disarms an occurrence, under the same gate the existing negation and
mention lists use. Only `would`: `could`, `might` and `should` all carry real
instructions, and `would you hide this` is a request rather than a report.

**A counterfactual stands an occurrence down only when nothing in it could act.**
The first form of this rule keyed on `would` sitting immediately before the verb,
and adjacency was never why it was safe. The reason is that a counterfactual
cannot tell anyone to do anything while its subject is not someone who could do
it — so `you would paste this into your terminal` is an instruction in a
counterfactual's clothes, and so is every third-person or generic agent. The rule
now reads the subject.

The inverse was measured first and is worse. Allowing only non-agent subjects is
the safer shape, but the benign population's subjects are noun phrases naming
mechanisms — `the retry would log the error and hide it`, `an unpinned hook would
run the following` — so an allow-list of pronouns broke ten real records. The
line is agent against mechanism, and no word list decides it. The list is
therefore a deny-list, incomplete by construction, and the code says so rather
than implying otherwise.

Four smaller rules land with it, each measured on both fixture sets: a negation
or reporting verb stops at a clause boundary, so `never mind, hide this` no
longer passes on a comma; the shell pointer needs something pointed at; `with …
rights` needs a doing verb; and modal scope crosses a coordinator.

**Two records about the scanner were withheld by the scanner.** The record
explaining why the suggested heuristic is unsafe had to quote the phrasings the
refutation turned on; the record narrowing the patterns had to quote what they
must still block. Neither fix could release them — one trips on a `Limit:` line
that lists the remaining false positives by quoting them, so it is blocked by a
phrasing it documents. Both are restated under new identities, with each quote
behind a reporting verb, which is what the existing mention list reads. That is
the loop the new capture-time warning exists to close, run by its author on the
first records to need it.

## 1.2.16

A release about what a tool says when it cannot see something, and about how
much work it does to find out. Most of it came from one report — an MCP server
answering "no records" from a checkout that was behind — and from following that
question into the places where the same bytes were being read over and over.

**An answer now says where it was read from (#930).** `coverage: "complete"`
means the scan was not truncated. It reads as "this answer is whole", and every
other field described a source or the scan too, so all of them stayed healthy
while the walk started from the wrong commit. A checkout five commits behind its
own already-fetched upstream returned zero records with `coverage: "complete"`,
`history: "ready"` and `notes: "present"` — byte-identical to the answer from a
repository where nobody ever wrote one, with the record one `git merge --ff-only`
away. Every answer now carries `vantage`: the commit walked from, the branch or
null for a detached head, the upstream, and how far behind it is. Behind fires;
the tip, an unmerged branch and a review worktree stay quiet, because a signal
that fires on healthy repositories is the one people learn to skip. `doctor`'s
`history-depth` row reports the same fact beside the shallow-history one it
already owned.

**A branch touching a non-ASCII filename was never classified.**
`squash-conservation` compared blobs path by path, and the paths came from `git
diff --name-only`, which prints anything outside ASCII C-quoted. No tree resolves
that spelling, so the lookup failed and the whole branch returned `unknown` — a
squashed branch reported as undetermined, an abandoned one never told there was
nothing to preserve. Silent, because `unknown` is the safe verdict and looks like
caution. One `git diff-tree -r -z` now answers for every path at once.

**`stale` read only the last block of a note.** Every other reader of the same
bytes recovers all of them, so `stale` alone answered differently about the same
repository: a two-block note yielded one record, and a `Follows:` whose target
sat in an earlier block of the same note was reported dangling. The shape is what
`squash-preserve --target` writes, so this was the path a preserved squash's own
records travel.

**Reading the same message once instead of once per walk.** `validate --range`
collects the whole reachable history once per commit in the range and re-read
everything each time. On this project's own CI that step took 47 and 60 minutes
per matrix leg, on every release. The walks stay — each one's reachable set is
the question being asked — but a message is parsed once, the notes mirror is read
once, and the last trailer block now comes from git's own trailer atom in the
`git log` the walk already runs, rather than from a separate `interpret-trailers`
process per message. Measured on this repository, counting every git invocation:
a 164-commit range went from more than 147,000 spawns, still running when it was
stopped at 42 minutes, to 1,193. The answers are byte-identical.

That last change replaces one parser with another, so it is carried by a
differential test rather than by a benchmark: every commit in this repository's
history plus 23 constructed hazards, both readers compared. It found one real
failure — a value containing the atom's own separator bytes cannot be framed —
and those messages are routed to the process reader.

## 1.2.15

Six reports about `doctor`, and what they have in common is worse than any one of
them: a diagnostic that reads a name rather than the requirement behind it reports
`ok` and takes the warning away with it. Most of the release is that shape, found
in rows shipped days and in one case hours earlier.

**The published squash-merge recipe could not run, and the row it satisfied said
nothing (#926).** The `## Squash-merge repositories` section added to every README
in 1.2.13 ended at `uses: MongLong0214/commitlore/action/preserve@vX` with no
`with:` block. The action declares `cli-path` as required and exits immediately on
an empty value, so every job the recipe produced failed. Meanwhile
`squash-inheritance` looked for a workflow *referencing* the action, so following
those instructions flipped the row to satisfied while records went on being
dropped at every squash merge — the exact loss the row exists to warn about, with
the warning removed. The recipe now carries the checkout step and the input, taken
from this repository's own working workflow, and the row reads the requirement: a
workflow that references the action without supplying `cli-path` warns and says
that the old recipe is how a reader got there.

**The plugin's MCP server looked in the session's working directory (#870,
reopened).** `.mcp.json` named `${CLAUDE_PLUGIN_ROOT:-.}/dist/commitlore.mjs`.
A host that does not set that variable resolves the `:-.` default against the
session, so node was asked for `<your repository>/dist/commitlore.mjs` and the
server died in 75 ms with `MODULE_NOT_FOUND`, surfacing only as the host's own
`CONNECTION_CLOSED`. That is #870 exactly, preserved by the default added while
fixing it. There is no default now: an unset variable is refused by the host and
the refusal names the variable, instead of resolving to a plausible path whose
failure names a file nobody wrote. A source guard refuses the form in the files
this repository ships, because the defect has now arrived twice — once as itself,
once inside its own fix.

**The registration row asked whether the command resolves, not whether the launch
works (#924, follow-up).** The field failure had `command: "node"`, which always
resolves, and a broken path in `args` — so a command-only check called it healthy.
The row now resolves the entry point out of `args` and reports a missing one, and
its placeholder branch reads the environment instead of matching `${VAR}` with a
regex, which had been warning at sessions that *had* set the variable and could do
nothing to clear it.

**`doctor` could not report `ok` (ADR-0032 §2).** Status degraded on any skipped
check, and `squash-conservation` skips as not-applicable wherever no branch looks
like a squash source — most repositories. So a repository with nothing wrong
reported `degraded` for life, under a headline saying some checks could not be
verified when every one of them had been. Skip reasons now carry the class ADR-0032
specified, the type system refuses a reason without one, and only the reasons that
mean *unverified* degrade the report. A skip that declines to say why still
degrades.

**`notes-push` told a clone that is behind to push (#890, related).** The row
compared the local mirror's sha to the remote's and called any difference local
records nobody pushes — including a clone whose mirror is an ancestor of the
remote's, which has nothing to send. Running the printed fix there is how a
duplicate note gets written. Direction now comes from ancestry, and behind reports
`ok`, saying a fetch settles it. The same detail also claimed no command pushes
records for you, which stopped being true when the pre-push hook shipped; it now
says whether that hook is installed.

**`inject-runtime` prescribed a fix that would break the thing it checked.** On the
branch where the plugin is already delivering context, the row skipped with
`fix: commitlore inject install-claude-hook` — and the renderer prints `fix:` for a
skipped row like any other, so the instruction reached the reader. Following it
installs a second delivery of the same context, the double injection removed in
#781. The row names no fix there and says why.

**`doctor` was writing itself into the log it reads.** Every run that reached the
MCP probe appended a session start and exit to `.git/commitlore/mcp-lifecycle.log`,
whose only reader counts host sessions — and on the escalation path, where the
probe's child is killed with a signal it cannot handle, it left a start with no
exit for the row to warn about. A probe child records nothing now.

## 1.2.14

**`backfill` collects pull request bodies by default (#902).** `--with-prs` was
opt-in, and three rounds of real reconstruction in one repository showed the cost:
every trailer that survived rounds two and three rested on pull request body text
rather than a commit message. With the flag off, the command whose whole job is
recovering context that was never recorded mostly recovers nothing.

The stronger reason is an asymmetry that lost work quietly. The same function
builds the text for the prompt and for verification, so the flag had to be passed
to the `--draft` call as well — and a run that collected bodies for the prompt but
not for the draft discarded exactly the quotes the session had taken from them.
That refusal was correct about a document nobody had assembled the same way twice.
Defaulting both sides on removes the way to get it wrong.

The degraded path is unchanged. An absent or unauthenticated `gh` is a normal
state of the world: the probe runs once, the run continues from commit messages
and diffs, and the summary says which. `--no-with-prs` turns collection off for a
repository whose pull requests are irrelevant, or to avoid one `gh` call per
target commit.

## 1.2.13

Three reports about the same habit from three directions: answering more
confidently than the evidence allows, and staying quiet where the evidence is
missing.

**`stale` reported a truncated window's absence as a definite dangling reference
(#914).** The default scan reads the most recent 1000 commits and says
`truncated: true`. Inside that same report it emitted a `dangling-ref` wanting
"an existing Record-Id in history" — an assertion about history made from a
window the report itself declares incomplete. In the reporting repository three
`Follows:` references sat inside the window while the `Record-Id` defining them
sat at commit 1397 of 1554, so the finding was produced entirely by the
truncation and cleared under `--all-history`.

It is the inference this project refuses everywhere else and tells its own
callers not to make: a partial scan means absence of a record is not evidence the
record does not exist. A candidate is now resolved against the whole history
before it is asserted, through the same reader that produced the window, so a
default run still answers definitely and a CI job reading `danglingRefs` keeps
working. Only a caller holding no repository gets `unresolvedRefs`, which is the
honest answer where none can be computed.

**`prepare_capture` succeeded over an empty staged diff and said so nowhere a
caller reads (#911).** It returned a nonce, a prompt and `policy_error: null` for
a repository with nothing staged; the prompt said `(no diff)` in prose and
`staged_diff_hash` held the SHA-256 of the empty string. The contract's first
rule is cite or omit, and with no diff half the citable surface is gone while
every rule after it still reads as though it were there.

It is not refused, and the reason is measured: the transaction binds to the
staged diff, so a record prepared this way cannot reach a commit that has one —
the commit is refused with "the staged diff differs from the verified capture".
Refusing would also remove recording a decision that has no code change, and
contradict the earlier decision not to withhold the contract when nothing is
staged, which is exactly when someone is learning the format. So the absence is
stated where it is read: `staged_diff_empty` as a field, and a contract rule
naming what it costs. `repository` now travels with the response too — the report
came from an MCP server owned by another process, answering about a tree that was
not the caller's, with every other field internally consistent.

**A squash-merge repository lost every record by default, and nothing said so
(#915).** Two paths cover a squash. A local `git merge --squash` is carried by
the installed `prepare-commit-msg` hook. The merge GitHub performs on its own
servers runs no local hook at all and is carried by the `action/preserve` GitHub
Action, which was built, which this repository has run on its own merges since,
and which **no README mentioned**. The reporter made one record in twelve
commits, the squash dropped it, and they found out only by going looking.

Every README now documents the workflow, with the two rules that keep
`pull_request_target` safe beside it. And `doctor` gains a `squash inheritance`
row that reports whether the protection is switched on — before a record is lost,
where `squash conservation` reports records already gone. It warns rather than
fails: a repository merging with merge commits or rebase keeps its records
either way, and nothing local can read the remote's merge setting.

No hook was added. A `post-merge` hook is told by git that the merge was not a
squash and given no way to name which branch was collapsed, so it could only
re-run the conservation scan — measured here at 11.2s, with nine undetermined
prescriptions and zero confirmed squashes, on every pull.

**`doctor` prescribed fabricating provenance for a branch whose fate it could not
determine (#915).** 1.2.7 stopped prescribing `squash-preserve` for a branch
proven unmerged and deliberately left the undetermined case prescribing it, on
the argument that an unnecessary preservation costs only a discarded plan. That
weighed the wrong cost — `--target` mirrors records onto whatever commit it is
handed without checking the commit contains the work, so on an abandoned branch
it writes provenance for changes HEAD never took.

And undetermined is not the rare case that grouping assumed. The fate is decided
by comparing blobs, so an abandoned branch that edited a file HEAD still has
satisfies neither arm and lands there — the ordinary shape of an abandoned
branch. The command is still named, because it is still the right one once the
squash commit is known, but the condition now comes first and the hazard is
stated.

## 1.2.12

**`doctor` called a deliberately fail-closed hook broken, and offered to break it
(#910).** The preserved `commit-msg` hook is probed under a PATH carrying no
interpreter, and any non-zero exit was a `fail` prescribing `fix or remove`. A
hook written to refuse when it cannot run its own check therefore failed that
row permanently — and the remedy on offer was to make it fail open, which
reopens the class of defect the hook exists to close. The reporting repository
had closed exactly that defect days earlier: a missing interpreter used to make
their hook blame the message, announcing that the message wrote a record git
would not store, about a check that had never run.

The probe itself was measuring the right thing. `PATH=/usr/bin:/bin` is close to
what a commit started from a GUI or a daemon actually gets, so a fail-closed hook
does block those commits and that is worth a row. What the check could not do was
tell a deliberate refusal from a broken script, because it read only the exit
code.

It now asks the same question twice. A hook that accepts the probe when an
interpreter is on PATH and refuses when none is, is PATH-sensitive rather than
broken: that is the repository's own decision, and it reports as a `warn` naming
the consequence — commits started where git's PATH has no interpreter are blocked
by it — with nothing prescribed and no effect on `doctor`'s exit code. A hook
that fails under either PATH is broken whatever it intended, and still reports
`fail`.

CommitLore's own hook keeps the stricter contract: it must work with no node on
PATH, because it records its interpreter.

The `commit-msg hook` row inherits the runtime's outcome, and a finding that
names nothing to repair used to acquire `commitlore hooks install` on the way
out. That was the same misdirection removed in #876, in a milder form; a fix of
nothing now passes through as nothing.

## 1.2.11

A third backfill round in the same repository, and the two failures it found are
both the tool answering a question nobody asked.

**A wholly valid draft could attach zero records and call it convergence
(#907).** `--draft` applies in batches over the target list and stops after two
that produce nothing. An entry whose `records` is an empty array produces
nothing — and that is the honest answer for a commit the session found no
context in, so a well-formed draft is mostly made of them. A 40-commit draft
whose records all sat at target #21 or beyond therefore converged on the twenty
honest empties above them and attached nothing, reporting `stopped: converged`
at exit 0. A reader who did not diff the note mirror would conclude the draft
was rejected on content.

Worse, the workaround it rewarded was padding: the reporter had to insert a
real record among the early targets to keep the walk alive long enough to reach
the later ones.

Only entries that claim at least one record are worked now, so an empty batch
means what convergence assumes it means — records that failed verification, not
commits nobody drafted for. A malformed `records` is still worked, because it
has to reach the parser and be reported rather than be dropped for looking
empty.

**Running outside a repository reported a zero-length history as a normal walk
(#907).** Every sha came back `unknown-commit` under `history: 0 commits
walked`, at exit 0 — visually identical to the stale-window failure fixed in
1.2.10, so the natural response was to raise `--limit`, which cannot help when
there is no repository to walk. The reporter hit it three times chaining `cd
<scratchpad> && commitlore backfill`. It now refuses the way git does, at exit
2.

**The `Ruled-out` rejection described the wrong fix (#902, reopened by
measurement).** The message said to quote where the alternative "was actually
turned down", which reads as *quote more context*. Three drafting rounds
answered it by selecting quotes that argued the alternative would be bad — a
counterfactual consequence — and all seven of the third round's records failed.
The checker scans for the act of evaluating and dropping: considered, rejected,
ruled out, decided against, abandoned, superseded, `instead`, `rather than`. An
argument against the alternative is not one of those.

Both the rejection message and the recording contract now say that, and say
which half is not enough. The contract matters more: it is read before a draft
is written, and the rejection is read after the record is already discarded.

The bar itself did not move. Widening the marker list was ruled out previously
and stays ruled out — a rule that accepts reasoning about an alternative would
accept most prose that merely mentions one.

## 1.2.10

Two reports about `backfill`, and one habit under both: the command reasons in
commits, while its input, its verification and its failures are all about
records. A third is about the test suite, which had been quietly filling the
temp directory with executables.

**`--draft` skipped commits it had been told to work (#901).** Target selection
is bounded by `--limit`, which defaults to 50, and a draft's shas were checked
for membership in that window — a sha outside it was refused as `not-a-target`
even though the draft named it explicitly. Raising `--limit` looked like the fix
and was not, because a second stop sat behind the first: apply mode walked the
whole window in batches and converged after two that produced nothing, and every
commit without a draft entry produces nothing. A drafted commit far enough down
the walk was never reached at any limit; raising the limit only moved where the
empty batches fell, which is why the same command succeeded and failed on the
same repository.

A draft now names its own targets. A sha outside the window is worked because
the draft named it, and apply mode works only the commits the draft covers — so
convergence counts batches of drafted work rather than batches of empty walking,
and still stops on drafted commits that yield nothing.

**One rejected trailer took the rest of its record with it, silently (#901,
#902).** Verification is per record, so a `Ruled-out:` whose quote shows the
alternative being mentioned rather than turned down fails the whole record. The
trailers beside it disappeared without a word — and because the grounding check
runs only after the quote check has passed, those siblings had provably survived
the re-read. The rejection line now names them and distinguishes the two cases:
trailers that passed the re-read and were not stored, from trailers dropped
along with a record that failed earlier.

**A rejection said what was wrong and not what would pass (#902).** `harvest`
prints repair guidance in its repair round; `backfill` has no repair round, so
its authors got the diagnosis without the remedy and had to guess at the shape.
The same guidance catalogue is now printed on backfill's rejections.

**The summary counted commits and labelled them records (#902).** `attached`
incremented once per commit while a commit's records are assembled together, so
a commit carrying two records reported one attached and the arithmetic in the
summary did not add up. It counts records now.

**The test suite left a new pair of executables in the temp directory on every
run, and removed none of them (#903).** Two test files shadow `git` and `sh` on
`PATH` to record what a run starts. Both wrote a fresh shim pair per test case
and neither cleaned up, so a full suite left about sixty directories behind;
this machine had accumulated 1,433. macOS evaluates an executable's provenance
on its first exec and caches the verdict against file identity, so a new file
every time is an evaluation every time — a cache that cannot hit, and against a
saturated `syspolicyd` the exec does not return at all. Both files now write the
shim pair once and delete every scratch directory they make; the log they read
back moves to its own path and reaches the shims through the environment.

This is a defect in the test suite and not in the installed tool, which the
report's framing ("on every invocation") suggests. The shipped hook writer
touches only `.git/hooks/`, once per install, through a temporary file it
renames into place. The two stuck processes in the report are still real, both
were ours, and both came from a killed test run.

Not changed: `--with-prs` remains opt-in. #902 suggests making it the default,
which would spawn `gh` on every run of a command that otherwise touches only the
local repository; that is a product decision rather than a defect, and it is
open.

## 1.2.9

Three reports from one repository in one morning, and they share a cause: a
squash that preserves every record produces shapes the rest of the tool had not
been taught to read.

**`stale` called a `Follows:` dangling when its target was in the same commit
(#898).** It reported `want an existing Record-Id in history` about a record
present in that very commit. The rule was never wrong — `findDanglingRefs`
builds its set from the whole stream with no ordering requirement. The stream
was. The scan extracted a commit's trailers with git's view of a message, which
is the last paragraph only, so a message carrying several record blocks arrived
as a single record holding the final block and every id declared above it was
invisible.

`validate` and the index have always read every block, which is why
`validate -c HEAD` said `references ok` about the commit `stale` called dangling
— the same disagreement, on one commit, from two parsers. The scan now reads
every block too. A commit still counts as one commit, so a multi-block history
is not overstated and does not trip the truncation flag early.

**`squash-conservation` reported records as lost when they were on the tracked
upstream (#897).** The check reads local `HEAD`. The reporter's squash had
landed on `origin/main` and their checkout had not caught up, so thirteen
records were named as absent while `git log origin/main` found every one of
them. They verified against the remote, the check reads HEAD, and both were
right about different refs — which is also why an index rebuild changed nothing.

A record the tracked upstream carries is no longer a loss; the row says it is on
`origin/main` and that this checkout is behind. Scoped to the tracked upstream
rather than every remote-tracking ref, because a feature branch pushed to
`origin` and never merged carries its ids too, and counting those would excuse
the loss this check exists to find.

It also stops asserting more than it measured. `undetermined` findings rendered
under the sentence *"do not appear in HEAD's history"*, a positive claim the
check had not established; the row now says they could not be found there. This
matters because the remedy it recommends writes a duplicate note, which is the
withheld-record condition of #890 — the wrong warning could manufacture the
corruption.

**A staged capture expired silently (#896).** Five minutes after prepare, and
when it lapsed the record was dropped with nothing said: the commit succeeded
without it. Four records were lost this way in one working day, surfaced only
afterwards by `doctor` as a count — by which time the transcript needed to
re-capture may be gone. One of them carried a `Warn:` about what a green check
does not prove and an `Unverified:` denying a coverage claim. Both had passed
verification; neither reached history.

Skipping an expired record is right: it binds to the tree it was prepared for.
Saying nothing was not. The hook now names it on the commit that misses the
window, and only for a record that was otherwise attachable — a record that
fails another gate stays quiet, as before. It reports and does not block.

Not changed, and left for its own decision: the five-minute window itself, and
whether a record whose tree moved could be re-bound rather than expired. Both
were suggested in #896; the second touches the binding every capture rests on.

## 1.2.8

`upgrade` could not reach the release it was pointed at, and this one is 1.2.6's
fault.

**It reported 1.2.6 as newest while 1.2.7 was the newest release, and `--force`
installed 1.2.6 (#893).** Nothing was wrong with the lookup — `git ls-remote`
sees every tag. The answer is cached for a day, and 1.2.6 taught the command to
re-ask only when the cached tag was *strictly older* than the running version,
on the reasoning that the equal case is every up-to-date machine and re-asking
it would spawn `git ls-remote` on every invocation.

The equal case is exactly the one that goes stale. A machine on 1.2.6 with
`v1.2.6` cached keeps being told it is current for the rest of the day after
1.2.7 ships, and there was no way through: `--force` acted on the same stale
value and reported `upgraded to v1.2.6` on a machine already running 1.2.6.
The previous direction of this bug was harmless — the newer version was already
in place. This one is not, because the operator cannot get the new release
through the tool's own path.

**The cost was measured wrong rather than weighed wrong.** `buildReport` has one
caller, the `upgrade` command itself. The day-long cache exists for the ambient
callers — the update notice, and `doctor` and `init` through
`latestReleaseSync` — and none of them come through it. So the command whose
whole purpose is to ask now asks, every time, and the extra lookup falls only on
someone who typed it. The cache is refreshed rather than bypassed, so the
ambient callers get the fresh answer too.

**`--force` no longer confirms an upgrade it did not perform.** It names the
target before installing, and when the newest release is the version already
installed it says so and changes nothing, rather than reinstalling the same
bytes under a success message.

**The answer says where it came from.** "This is the newest release" and "this
is the newest release I was told about yesterday" were the same sentence; the
output now carries the source it resolved against.

```
installed  1.2.8
latest     v1.2.8
source     https://github.com/MongLong0214/commitlore.git
```

## 1.2.7

Three diagnostics that named a cause they had not established. One prescribed a
remedy that would have done harm; another hid a record for being stored
correctly.

**`squash-conservation` could not tell an abandoned branch from a squashed one
(#888).** It reported records "declared on a branch not reachable from HEAD" and
concluded a squash had dropped them. A squash is one cause. The other is a
branch closed without merging — an ordinary and correct outcome, where the
records are absent because the work is absent.

The two are identical in the commit graph, which is all the check looked at, so
it prescribed the same remedy for both:

```
fix: commitlore squash-preserve <base>..<branch> --target <the commit that squashed it>
```

On an abandoned branch that is not merely unnecessary. `--target` mirrors the
branch's records onto whatever commit it is handed, with no check that the
commit contains the work, so following the advice writes decision records
describing work that was deliberately discarded onto a commit that does not
contain it. Reported against a pull request closed as superseded, where there
was no "commit that squashed it" for `--target` to name at all.

**The content separates them**, and the check now uses it: a squash carries the
branch's tree into HEAD even though its commits are gone, while an abandoned
branch's tree is nowhere. Each branch is classified by comparing the blob of
every path it touched against HEAD's, and the row says which case it is and
prescribes accordingly — `squash-preserve` for a branch whose changes reached
HEAD, and nothing to do for one whose changes did not.

**The finding set is unchanged.** Every record reported before is still
reported; only the claim and the remedy vary. The classification is deliberately
asymmetric for that reason — "never merged" requires that *no* touched path
exist in HEAD, and a squash whose files `main` has since edited falls to
"could not be determined", which still prescribes preserving. A vaguer message
is a cheap mistake; a dropped finding is not.

This is not identification by content, which this project has repeatedly found
unsafe: records are still matched by `Record-Id` exactly as before. What the
content decides is what happened to the *branch*.

**A record stored in both supported places was withheld as declared twice
(#890).** `context` hid a record whose declarations were a trailer block in a
commit's message and the same records on the notes ref for that same commit —
both CommitLore's own storage, and the second one produced by following the
tool's own advice. The merge helper's output tells the operator to pass
`--target` so the records are mirrored where git will not parse them as
trailers; doing so is what created the second declaration.

The rule was already right and the comparison was not. Exact commit and note
mirrors are meant to be one logical record, with only divergent note payloads
colliding — but the comparison weighed every trailer except `Record-Id`, while
the mirroring stamps each block it writes with its own `Provenance: inherited
<sha>`, by design. The two disagreed about what "same content" means, so a
mirror written by the tool was never identical to the block it mirrored and the
exact-mirror path could not fire for the case it exists for.

A note is now recognised as its own commit's mirror when it sits on that
commit's sha and matches the message block once the provenance stamp is set
aside. **Only the stamp is forgiven, and only within one commit.** A note whose
`Limit:` changed, one carrying a trailer the message does not, and one missing a
trailer the message has all still collide and are still withheld — notes are
remote-reachable, and divergent note content must not inherit an identity a
human approved. Two different commits declaring one id and differing only in
provenance still collide too, because there "which is current" is a real
question.

**The withholding message also stops making the operator guess.** It reported
that a record was declared more than once without saying where either
declaration was, and the reporter deleted a branch and rebuilt the index before
finding the note. Each collision now names its own locations:

```
... r-branch890aa in 10a0f5d2's commit message and in its note on
refs/notes/commitlore, which differ
```

**`before_change` reported a timeout that never happened (#889).** With
unreadable Git history and a proposal supplied, the guard is skipped and never
starts — and the response called that `guard_confidence: "timed-out"`. A
completed Git failure presented as an expiry, with no guard execution and no
elapsed time behind it. Measured against a directory that is not a repository:
the whole call returned in about 37 ms claiming it had timed out.

There is now a fourth value, `unavailable`, meaning a proposal was supplied and
the guard could not run. `not-run` keeps its documented meaning — no proposal was
supplied — so the two cases stay distinct, and `verification_gaps` still carries
`history-unavailable` as the reason. The fail-closed behaviour is untouched:
unreadable history is still reported as a gap and never as a verified empty
answer.

`timed-out` stays in the enum and is now emitted by nothing. F11 specifies a
bounded guard leg that returns it on expiry; that bound was never implemented,
and this branch was its only emitter. It is the specified name for a real
expiry, and it stays unreachable until something actually bounds the guard and
can say so from a measured elapsed time.

## 1.2.6

A long session killed the process outright, and an upgrade nobody could see had
already happened.

**`capture` died with a fatal V8 error on a large transcript (#884).** On a
74,173,844-byte session it exited 133 having written no JSON at all:

```
# Fatal error in , line 0
# Fatal JavaScript invalid size error 134217728
```

Not a graceful refusal — an engine abort. `capture` reports outcomes
structurally so a caller can branch on `staged` / `empty` / `rejected` rather
than on the exit code, and this escaped that contract entirely: a wrapper that
had been careful to read the outcome had nothing to read. Reproduced on 1.2.3 as
well, so it was a standing limit rather than a regression the last release
introduced.

1.2.3 bounded the *prompt* (#873). It did not bound the guard beside it.
`prepareCaptureContext` handed the whole transcript to the guard advisory on one
line and took a 256 KiB window of it on the next. The guard normalises its
proposal through the anti-injection normaliser, whose `\p{Script=Latin}\p{M}*`
global replace collects one match per letter into a single array; past roughly
69 MB that array crosses V8's 2^27 `FixedArray` ceiling and the process dies
inside `Runtime_RegExpExecMultiple`.

**The guard now reads the same window the prompt carries.** That is a narrowing,
and it is also the more honest alignment: the advisory is shown beside the
prompt, so an advisory computed over a whole session could warn about a decision
the prompt does not contain. Measured on a 74,450,108-byte transcript: exit 0,
`outcome: staged`, 0.7 s end to end, where before the process aborted.

**It says when it did so.** A truncated scan must never read as a complete one,
so the advisory carries a `proposal-windowed` gap whenever the window dropped
part of the session — an empty `matches` array is then silence about the window,
not a clean scan of the transcript.

A note on what is *not* fixed: verification still reads the whole transcript on
purpose, so a quote from outside the window still verifies, and its scan builds
per-character structures over the whole file. That survives 74 MB and would fail
somewhere past ~134 M characters. Bounding it would break the guarantee that a
locator names a line of the file it is checked against.

**`doctor`'s runtime-mismatch row named versions and stopped (#885).** It
reported three distinct live CommitLore runtimes answering MCP while every
registration on the machine was correct — the old runtimes were live processes
that outlived an upgrade, because a host resolves the launcher once at session
start and holds that runtime for the life of the session. Agent sessions there
ran for days.

Those runtimes write. Records captured by a session started two days earlier
come from the build that session started on, and nothing on the commit says
which. The row gave an operator no way to tell whether that was cosmetic, and
the scan already knew the process ids and discarded them, so the reporter had to
run `ps` themselves to find the five processes behind the three names.

The row now names every pid, says plainly that each runtime keeps writing
records with the build it started on, and offers an action: restart the host
sessions that own those pids, because an upgrade cannot reach a process that is
already running. It deliberately does not label any runtime the stale one — a
copied or stale install can report the same version as a current one.

**`upgrade` reported a release older than the binary printing it (#885, not
separately filed).** On a machine running 1.2.5 it said `latest v1.2.3` and
"this is the newest release". The lookup was fine; the answer is cached for a
day in `~/.cache/commitlore/latest-release.json` and only `upgrade` acting
clears it, so a release installed any other way — `install.sh`, the plugin
marketplace, a manual checkout — leaves yesterday's answer standing. A `latest`
older than the version already running cannot be the latest, and that case now
re-asks. Equality still serves from the cache, or the cache would never serve
the case it exists for.

Not addressed, and left for its own decision: #885 also asks that the producing
runtime be recorded on the record itself. `CommitLore-Version:` is not that
field — SPEC §8 defines it as the protocol version a record targets — so this
needs a new trailer and a wider decision than a patch release should make.

## 1.2.5

Two flags on `capture` did nothing and said nothing; a third refusal knew the
fix and did not say it.

**`capture --out` exited 0 and never wrote the file (#878).** The flag is
documented as "write the pending nonce to a file", and prompt-only mode — get the
nonce, hand the prompt to a model, come back with `--draft` — is the step it
exists for. That was the one run where the pipeline reported `nonce: null` while
prepare had already persisted a real transaction under a real nonce, so the write
was guarded out. Measured by the reporter as 3 runs, 3 exit 0, 3 missing files,
with and without `--diff`. The nonce is now reported, so `--out` writes it and
`--json` carries it.

**`capture --diff` was accepted, ignored by prepare, and honoured by verify
(#877).** Passing the *same* `--diff` file to both steps failed whenever that
file was not byte-identical to the staged diff:
`discarded record 0 (source-mismatch): diff hash does not match the prepared
transaction`. That message is about the draft's sources, and the fault was
entirely the flag's — the reporter spent several attempts re-checking quotes and
locators that were never wrong.

The refusal itself was right and stays. A capture transaction binds to the staged
diff, which prepare, verify and stage each recompute independently, because every
binding is computed server-side and never from the caller. `--diff` cannot select
a different diff; it can only assert what is staged. So it is now refused where
that is decidable — up front, exit 2, naming the flag and naming the way out
(`git reset --soft`, which is what the reporter had to find on their own) — rather
than several steps later against the record. A run refused this way also leaves no
pending transaction behind; the old path wrote two per attempt.

`--diff` byte-identical to the staged diff keeps working, and the help text now
says what the flag does rather than implying an override it never had.

**`unknown-key` now names the `X-` form the author could have written (#881).**
Claude Code instructs every session to end its commit message with
`Claude-Session:`, so the key arrives by default, the hook refuses it, the commit
is lost, and an agent that cannot see the repository's earlier commits writes it
again. Reported twice in one day in two repositories by the same author, the
second time after already knowing about the first, because `X-` is not the kind of
thing that stays in mind between repositories.

```
31: unknown-key Claude-Session — got "Claude-Session",
    want "a key from SPEC §3, or X-Claude-Session if this is your own metadata"
```

Nothing is accepted that was not accepted before, and nothing is rewritten: SPEC
§6 says the message is not modified, and silently renaming someone's trailer would
be worse than refusing it. This only says the name. Two keys are deliberately not
offered the prefix — one whose value reads as a sentence, which keeps the #647
answer, because that author's problem is that their prose became metadata; and one
that differs from a SPEC §3 key only by case, because `X-limit` would be a valid
record carrying the wrong key.

`spec/fixtures/invalid/03-unknown-key.expected.json` moves with it. The violation
it pins is unchanged and `Constraint:` is still refused; only the advisory `want`
text differs.

## 1.2.4

`doctor` blamed the hook that worked, and prescribed reinstalling it.

**`hook-runtime` attributed a preserved hook's failure to commitlore's hook
(#876).** The installed stub runs the hook it preserved at install time first and
exits with that hook's code, verbatim, before commitlore is resolved. Probed as
one process, a preserved hook that called `node` by name died with 127 under
git's PATH and the row read "the hook cannot find a node interpreter", with
`commitlore hooks install` as the fix. That command rewrites only commitlore's
own file; it reported the file unchanged, and the next `doctor` failed
identically. The reporter spent several minutes repairing the wrong component,
because the diagnostic named it.

**The preserved hook now runs on its own first**, under the same PATH-less
environment and through `sh` the way the stub invokes it. If it exits non-zero,
the row says commitlore's hook is not what failed, names the preserved hook by
path, classifies its first stderr line the same way the stub's was (node
missing, node threw, unclear), and prescribes a fix aimed at that file. Only once
it has passed does the stub run, so every remaining failure is commitlore's own
resolution and `hooks install` is once again a remedy that can move it.

**`commit-msg-hook` inherits the fix along with the outcome.** It was the row the
reporter read: it already carried the runtime row's outcome when blocked on it,
and kept saying `hooks install` under an outcome that had just explained why
that could not help.

Not changed: a broken preserved hook still blocks every commit. That is the
chaining contract — a hook that was rejecting commits before commitlore arrived
must keep rejecting them — and whether a hook that is broken rather than
rejecting deserves different treatment is a separate decision from a diagnostic
one.

## 1.2.3

The capture prompt was the session, so on a long session there was no prompt.

**`capture` embedded the whole transcript in its prompt (#873).** Measured by the
reporter: a 67,981,436-byte transcript produced a 67,468,122-byte prompt — 99.3%
of the file, and larger than any model can consume, so the pipeline could not be
completed and no record was ever written. The pipeline itself was fine, which is
how they proved it: `tail -n 400` on the same transcript gave 537,250 bytes and
the same command in the same repository worked.

**The failure was silent, which is why it reads as the reason capture is not
used.** Prompt-only mode reports `outcome: "empty"`, `staged: false`, exit 0. An
operator who tried capture once on a real session got a prompt they could not
use and no statement that anything was wrong, and did not try again. In the
repository where this was measured, `stale` reported 1 record in 1000 commits
while roughly twenty commits in one recent session carried real decision context
and produced none — with `{"mode":"auto","unattended":true}` already set, so
permission was never the obstacle.

**The prompt now carries the end of the transcript within a byte budget**, 256
KiB by default and `COMMITLORE_TRANSCRIPT_BUDGET_BYTES` to change it. The end
rather than the beginning: a decision is taken near the end of the session that
implements it, and the diff being captured is that end.

**Three things the bound deliberately does not do.** It does not renumber — the
window keeps the line numbers it has in the whole transcript, because
verification reads the whole transcript and a window renumbered from 1 would
have every `L<start>-L<end>` locator name a different line of the file it is
checked against. It does not reach the hash — `source_hashes` and every quote
check are still over the whole transcript, so a quote from outside the window
still verifies and a caller passing the session it actually had is never told
the transcript was substituted. And it does not stay quiet — the prompt says
which lines it shows and how many were left out, and `transcript_window` says
the same to `capture --json` and to `commitlore_prepare_capture`. A bounded
prompt that did not say so would be the old silence in a smaller package.

**One line can outrun the budget by itself.** A JSONL transcript line can hold an
entire tool result. That line is shown from its end rather than dropped, and the
window marks it partial, because a window of no lines is worse than a window of
one partial line. The byte slice never leaves a split codepoint at the front: a
replacement character inside a quotable line is a character nobody can copy back.

**Not claimed.** Where the useful boundary is. 256 KiB is comfortably readable by
current models and carries far more than the ~537 KB slice measured to work; the
reporter said they had not measured where a good record stops needing context,
and neither has this. Also unchanged, and worth stating because automation is
built on it: `outcome` is `staged`, `empty` or `rejected`, and all three exit 0
— anything driving capture must read `--json`, because an exit-code check reads
a rejected record as a success.

**Not reviewed.** No cross-provider review was run on this change.

## 1.2.2

One line of configuration, and the plugin's MCP server had never started for
anybody.

**The plugin's MCP server died at launch everywhere but a commitlore checkout
(#870).** `.mcp.json` named the entry point as `./dist/commitlore.mjs` and set
`"cwd": "."`, and both of those resolve against the *session's* working
directory rather than the plugin's install directory. So node was asked for
`<session-cwd>/dist/commitlore.mjs`, which does not exist, and the server exited
in under 60ms with `MODULE_NOT_FOUND`. Capture is MCP-only, so a session with
the plugin installed made commits carrying no records at all, and the only
visible symptom was one line saying a connection failure had been cached. It was
identical in the `0.8.0` and `1.2.0` plugin caches, so no release ever shipped a
working one. The entry point is now
`${CLAUDE_PLUGIN_ROOT:-.}/dist/commitlore.mjs` with no `cwd` — the form
[ADR-0026](docs/adr/ADR-0026-node-only-distribution.md) and the F14 ticket had
both documented while the file said otherwise.

**The defect was invisible to every check because they all ran in the one place
it cannot appear.** A checkout is the one cwd where a session-relative path is
also the plugin's path, and that is where the suite, the release gate and the
maintainers all work. The manifest checks now launch from a directory that is
not a checkout, and one of them drives the server to an MCP `initialize` rather
than stopping at "something resolved" — the same distinction #483 forced on the
plugin entry point two releases ago.

**A registration is read the way a host reads it.** `.mcp.json` is a launch
instruction for a host, and hosts expand `${VAR}` and `${VAR:-default}` before
they spawn anything; the readers here returned the raw text. Doctor's
unattended-initiator probe therefore launched a literal `${...}` as a path and
would have called this repository's own registration unhealthy — sending an
operator to repair the one thing that is not broken. An unset placeholder with
no default is left as written on purpose: a host refuses that registration
outright, and expanding it to nothing would turn the refusal into a
plausible-looking path whose failure names a file nobody wrote.

**The default is what keeps this repository working on itself.** `:-.` is not
decoration. This repository's `.mcp.json` is also an ordinary project file here,
loaded by a host that sets no plugin root, and without the fallback the
dogfooding install would break in exchange for fixing the plugin.

**Not verified.** Codex reads the same `.mcp.json`, declared by
`.codex-plugin/plugin.json`, and whether Codex performs the same placeholder
expansion was not measured — no Codex install was available to this change. What
is measured is that the Claude Code plugin path now launches from a foreign cwd
and answers `initialize`. If Codex does not expand, its launch is no worse than
the relative path it had before, and that is a claim about the shape of the
change, not a test result.

## 1.2.1

A security release, and one line that had been asserting something nobody checked.

**Seven advisories left the tree, and two of them shipped.** `npm audit --omit=dev`
was failing on `main`, not only on the dependency pull requests that were being
blamed for it: `fast-uri` (high, four GHSAs, reached through `ajv`) and `qs`
(moderate, two, reached through the MCP SDK's `express`) were both in the runtime
tree — the tree that gets bundled into `dist/commitlore.mjs` and installed. They
are fixed at `fast-uri` 3.1.7 and `qs` 6.16.0. Five more, including one rated
critical, were `esbuild <=0.24.2` reachable only through vitest 2's own
dependencies; the vitest 4 upgrade below is what removes them. `npm audit` is now
silent on both surfaces.

**The push hook no longer reports records that do not exist as unsent.** On a
failed notes mirror the line said "the records for these commits are still only
local" whether or not any record existed — #632 asked "is there a local note
waiting?" and the answer was hard-coded to yes. A repository with no notes ref at
all was told to run `commitlore sync`, and found nothing to send. The hook now
checks, locally, before it claims; when there is nothing waiting it says so. The
check is ref-scoped rather than commit-scoped on purpose: the mirror publishes
`refs/notes/commitlore` whole, so a record written against an already-pushed
commit is still unsent, and a commit-scoped check would call that "nothing
waiting" — wrong in the dangerous direction.

**`commitlore sync` keeps one row per remote.** An unreachable remote answers with
two lines of git diagnostic, and both went into a column that promises one. The
row broke in half and the trailing `fatal:` read as a bare error standing above
the table rather than as that remote's result.

**Upgrades.** vitest 2.1.9 → 4.1.11, `@modelcontextprotocol/sdk` 1.29.0 → 1.30.0,
js-yaml 5.2.3 → 5.4.1, `upload-artifact` v4.6.2 → v7.0.1 and `download-artifact`
v4.3.0 → v8.0.1. vitest 4 needed three things with it: `--reporter=basic` no
longer exists, changing `ci.yml` moves the reviewed-workflow lock deliberately,
and the 5s default test timeout no longer fits a runner whose per-file startup
costs more — every failure measured during that upgrade was a timeout, none was
an assertion.

**Reviewed, with one exception recorded.** 1.2.0 shipped without a cross-provider
review and said so here. This one had them: `gpt-5.6-sol`, read-only and asked to
*disprove* rather than approve, went through the dependency batch (it recomputed
the source digest and all 310 `dist` entries from the commit's git blobs
independently) and the artifact-action upgrade (it read the pinned action sources
and mapped every uploaded path to where the next job reads it). The exception is
the security fix itself, which was merged first and without one, because leaving
two advisories in the runtime tree to wait for a reviewer is the worse trade. Both
reviews recorded their own limits — neither could rerun the Docker build, and
neither dispatched the canonical-merge workflow — and those limits stand.

**Not changed, deliberately.** The guard's short-alternative false positive
(#858) was measured rather than fixed. At one distinctive token the corroboration
strength is structurally 1.00 whatever the token is, because the corpus weight
that separates a rare `redis` from an ordinary `read` is divided out by its own
denominator. Every rule that removes the false positive also removes
`add a Redis client` → `shared Redis cache`, a documented true positive. Trading
that for an advisory false positive is the wrong direction for a tool that
declares itself advisory; the issue carries the measurements.

## 1.2.0

> **Recorded as held for want of a reviewer, not as reviewed.** Every change in
> this release passed the gate — 3,359 tests, the canonical artifact check, and
> CI at the released commit — and none of it had a cross-provider review. The
> reviewers this project uses were out of quota on the day it shipped, and
> Claude reviewing Claude is not a second opinion: the same model family shares
> its blind spots. Two of today's conclusions were reversed by an outside
> reviewer earlier in the day, so this is a real gap and not a formality.

The release that makes releases discoverable, and three places where the tool
was doing work nobody read.

**`commitlore upgrade`.** There was no way to find out that a newer CommitLore
existed. `--version` reported what was running and nothing compared it to
anything, so a repository initialised on a stale install kept validating every
commit with a stale protocol and nothing said so. `upgrade --check` reports the
installed and newest release; the bare form performs the upgrade by invoking the
installer and then reading the link back to confirm it points at the tag that
was asked for -- not merely that it moved, which an installer that moved it
somewhere wrong would satisfy. `--json` is the scriptable form and answers
inside CI on purpose. A passive notice appears at most once a day and is silent
for hooks, `--json`, non-terminals, and any command that failed; `doctor`
carries staleness as a finding, because the notice is silent for `--json` and
that is the one output built for programs to read. `init` names the version it
pinned and does not move `current`; `init --upgrade` does.

**Both installers register the same hook, and only one of them.** The CLI wrote
`Read|Edit|Write` and the plugin shipped `Edit|Write|MultiEdit|NotebookEdit`, so
a CLI install delivered nothing when the agent edited with MultiEdit and a
plugin install delivered nothing when it read a file before deciding. A matcher
of only letters and `|` is a list of exact strings rather than a regular
expression, so `Edit` never covered `MultiEdit`. Both now register all five.
And `init` no longer writes its hook when the Claude Code plugin already covers
the repository -- before this, following the README to the plugin and then
running `init` answered every matched tool call twice.

**A hook fire costs a third less, and a rebuild an order of magnitude.** Every
fire ran `PRAGMA quick_check` over the whole index -- 62 ms on a 15 MB one,
before an answer that usually has nothing to deliver. Nothing promises it,
SQLite documents that it does not catch the desynchronised-index case that
would actually hurt, and across 85 corruption trials it never prevented a wrong
answer. It runs on rebuild and in `doctor` now, and a read that meets corruption
falls back to a scan rather than failing open to silence. Separately, a rebuild
started 4,345 git subprocesses, 4,329 of them parsing trailer paragraphs whose
results were then discarded: 45 s to 2.3 s on this repository, and a
10,000-commit repository from over two minutes to 2.2 s.

**Fixed:** a partial index answered with silence, which reads as "no records
here" (#778); a rebuild could not rebuild past a schema change (#779) and could
not open a structurally damaged index at all (#785).

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
