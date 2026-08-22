---
document_id: cdeb-fresh-v5-stage1-r1-firewall-leak-screen
study_id: cdeb-fresh-v5
stage: stage1-r1
status: measured-before-any-episode
measured_run_allowed: false
---

# The ruling is already in the tree, for a large part of the corpus

The first thing the record-blind task-author chain needed was a sandbox, and
building it surfaced something about the corpus that no earlier stage could have
seen.

## Why the sandbox has no `.git`

SSOT §6.2 forbids NEED-SCOUT and FUNCTIONAL-AUTHOR from seeing the record. A
materialized bundle does not achieve that: it carries the entire commit history
**and** `refs/notes/commitlore`, so an author with `git` in that directory is one
`git log` away from every record the study is about. The firewall would rest on
the author choosing not to look.

So the sandbox is the frozen tree with the git metadata removed. There is
nothing to read rather than a rule against reading.

## What removing the history could not hide

Two working files quote a record directly, and both name a decision that is one
of the 62:

```text
gitseed/docs/adr/ADR-0008-python-floor-widened-to-3.9.md   Record-Id: r-gsf501
agent-control-plane/HANDOFF-REPORT.md                      Record-Id: r-p014live20260814
```

A third hit, `gitseed/AGENTS.md`, carries `Record-Id: r-<6+` and
`Ruled-out: <alternative> | <why it lost>` — format documentation, not a
decision. It is noise and is recorded here so the next reader does not re-derive
that.

## The larger measurement

Record-Id matching finds only the candidates whose identifier survived into a
document. The wording is the more common carrier, so every qualified candidate's
`Ruled-out` and `Reason` text was compared against every text file in its own
repository, by shared 5-word runs.

**The null control first.** The same rulings were compared against a *different*
repository's files:

```text
                                      median   p90   max
against its own repository                 1     7    24
against another repository                 0     0     0
```

Zero, at every threshold, including one shared run. So a single shared 5-gram
against a candidate's own repository is signal and not the background rate of
English.

Against that null:

```text
threshold   candidates hit   null hits
  >= 1            34             0
  >= 2            30             0
  >= 3            22             0
  >= 5            16             0
  >= 8             6             0
  >= 20            1             0
```

Of 62 qualified candidates, **34 share at least one run of their ruling's own
wording with a file in the tree**, 22 share three or more, and one shares 24.

## Why this matters more than the firewall

The firewall consequence is the obvious one: an author reading those files sees
the ruling, so the task would be built around the answer.

The consequence that reaches further is Stage 0's **gate G3 — "the reason is not
obvious from the code"**. G3 was decided by paired blind reviewers, and Stage 0
recorded plainly that *no reviewer read the current code or ran a test*. This is
the first time the code was checked. For a substantial part of the corpus the
reason's wording is sitting in the tree, which is the condition G3 existed to
exclude and had no way to detect.

If the reason is legible in the tree, the SUPPRESSED arm can reach it without
delivery, and the contrast for that candidate shrinks toward zero on its own.

## What this does not establish

Restraint is warranted in three directions:

- **A shared run is not a restatement.** A reason that names a function or a
  file will share wording with code that defines it, without telling anyone what
  was ruled out.
- **Location matters and is not yet weighed.** A hit in `docs/adr/` is read by a
  different reader than a hit in the file the task must change.
- **The direction of the leak is not established.** The record and the code were
  often written together; wording in common does not say which explains which.

Deciding each case is per-candidate reading, and that is exactly what the
buildability census is for. This screen is an input to it, under the registered
reasons `firewall-provenance-not-demonstrable` and
`record-semantic-boundary-ambiguous`, not a global verdict.

## Registered before any episode

Recorded now so that it cannot later be discovered in whichever direction suits
a result. If the confirmatory contrast comes out small, this table is part of
the explanation and was in the tree before the first episode ran.
