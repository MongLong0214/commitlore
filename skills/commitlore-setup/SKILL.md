---
name: commitlore-setup
description: Use when a git repository needs CommitLore wired up for the first time, or when its hook/notes configuration looks broken. Runs the diagnostic, installs the commit-msg validation hook, fixes the notes fetch refspec so records survive a clone or fetch, and builds the local record index. Trigger phrases include "set up commitlore in this repo", "install the commitlore hook", "commitlore doctor is warning", "why isn't commitlore capturing commits here", "wire up commit trailers", "commitlore 저장소에 붙여줘", "commitlore 훅 설치해줘".
---

# CommitLore setup

**Shortcut for a repository that just needs wiring up, nothing broken to diagnose:**
`commitlore init` runs steps 2-4 below (`hooks install`, `index --rebuild`, then
`doctor --fix` as a final check) in one command, reports what it did and what it
could not, and is safe to re-run. Use the four steps below one at a time when
something specific looks broken and you want to isolate which piece.

Four checks, in order. Each one is independent and re-runnable — running any of
them twice on an already-configured repo is a no-op, not an error.

## 1. Diagnose

```
commitlore doctor
```

Reports `ok`, `warn`, or `skipped` for: whether the `origin` remote fetches
`refs/notes/commitlore` (records that live only in the notes mirror never
reach a teammate whose fetch config omits that ref), whether there is a local
notes mirror to push, whether the commit-msg hook is installed, and whether
the local `git` build parses trailers the way the spec expects. `warn` lines
carry their own fix directly underneath — read that before doing anything
else. Example, run against a repo that has a remote but nothing else set up:

```
warn    notes fetch refspec — origin does not fetch refs/notes/commitlore, so records pushed by others stay invisible here
        fix: git config --add remote.origin.fetch '+refs/notes/commitlore:refs/notes/commitlore'
ok      notes push — no local mirror yet — nothing to push (git push origin refs/notes/commitlore, once there is)
warn    commit-msg hook — no commit-msg hook at .git/hooks/commit-msg
        fix: commitlore hooks install
ok      git interpret-trailers — git version 2.50.1 (Apple Git-155) parses trailers as the spec expects
```

`doctor` exits 0 even with warnings present — it reports, it never blocks a
command on its own. Add `--json` for a machine-readable report, or skip
straight to `commitlore doctor --fix`, which applies the reversible local
config fixes directly (currently: the notes fetch refspec) instead of making
you copy the command out of the warning.

## 2. Install the commit-msg hook

```
commitlore hooks install
```
```
installed commit-msg hook: /path/to/repo/.git/hooks/commit-msg
```

This hook pipes every commit message through `commitlore validate` before the
commit is created and rejects it if a trailer breaks the protocol (unknown
key, bad enum value, malformed `Ruled-out:`, and the rest of SPEC §6) — see
the `commitlore-commits` skill for what that check actually catches. If a
commit-msg hook already exists at that path, install **preserves and chains
it**: commitlore's check runs first, then the original hook runs after it, so
this is safe to run in a repo that already has hooks (Husky, lint-staged,
whatever). Running it again once installed is a no-op:

```
commit-msg hook already installed: /path/to/repo/.git/hooks/commit-msg (unchanged)
```

`commitlore hooks status` reports what's currently installed without changing
anything (`commit-msg: installed (commitlore)` or `commit-msg: not
installed`). `commitlore hooks uninstall` removes commitlore's hook and
restores whatever it replaced.

## 3. Fix the notes fetch refspec

If step 1 reported the `notes fetch refspec` warning:

```
commitlore doctor --fix
```
```
ok      notes fetch refspec — origin fetches refs/notes/commitlore
        fixed by --fix
```

This adds one line to local git config —
`git config --add remote.origin.fetch '+refs/notes/commitlore:refs/notes/commitlore'`
— it is not a server-side setting, so it does not propagate on its own.
Everyone who clones the repo needs to run `commitlore doctor --fix` (or
`doctor` and copy the fix line) once for their own clone; a fresh `commitlore
doctor` on a new clone will catch it if it's missing.

## 4. Build the index

```
commitlore index
```
```
rebuilt: scanned 1 commit, indexed 0 trailers in 59ms
```

Builds `.git/commitlore/index.db`, the local cache that `commitlore context`,
`limits`, `ruled-out`, `warnings`, and `stale` read from so they don't rescan
the entire commit history on every call (see the `commitlore-query` skill).
It is derived and disposable, not a second source of truth — every one of
those commands falls back to answering directly from git with `--no-index` if
the index is missing or stale. Re-run `commitlore index` after a history
rewrite (rebase, squash-merge); `--rebuild` discards it and rebuilds from
scratch. `--stats` reports what it currently holds without touching it:

```
index      /path/to/repo/.git/commitlore/index.db
schema     v1
fts5       yes (trigram)
head       9153679...
notes ref  (none)
holds      0 trailers, 0 commits, 0 paths
```

## Verifying it worked

`commitlore hooks status` should read `commit-msg: installed (commitlore)`,
and a fresh `commitlore doctor` run should show no `warn` line except ones
with nothing local to fix (e.g. "no remote is configured" on a repo that
genuinely has none yet).
