# Readiness red-team

Section 31 asks for a fresh hostile reviewer before PR-A merges, across nineteen
attack surfaces. This directory holds what each round found and how the round was
checked before its findings were believed.

## How a round is run

```
fresh session, no context from the authoring session
read-only sandbox
detached git worktree at the exact branch head
prompt says: assume it is broken, prove it, quote what you read
```

The worktree matters twice. It keeps the shared working tree out of the way, and
it means the reviewer reads the tree that would merge rather than whatever is
checked out — a review of uncommitted work is a true statement about the wrong
thing.

## How a round is checked before it is believed

A schema-complete answer is not evidence that anything was read. A reviewer that
opened no files produces the same JSON shape as one that opened a hundred, so
every round is validated before its findings are read:

| check | what it catches |
|---|---|
| tool events ≤ 1 | nothing was read; the schema was filled in |
| `filesRead` empty | the same conclusion from the response side |
| a claimed path does not exist | fabrication |
| target − read − declared-unread ≠ ∅ | omission; silence is not coverage |

Two details are load-bearing. Fabrication is measured as **does not exist**, not
as *outside the target list* — a reviewer reading more than it was pointed at is
doing its job, and round A read 152 files against a 68-file list. And the target
list is generated from the tree at run time, never from memory: a stale list makes
a correct answer look fabricated.

The fourth check is the one that separates a lazy review from a thorough one.
Without it, a reviewer can claim one file, leave `notRead` empty, and pass
everything else.

## What a round cannot catch

A reviewer that names real files and returns a hollow judgement passes every
check here, because that is a property of how the answer was produced and not of
the answer. So findings are carried forward with the evidence quote attached, and
each one is reproduced here before it is acted on. Round A's first P0 was checked
against the working tree, appeared to be wrong, and turned out to be right once
`git ls-files` was consulted instead — the file existed locally and not in the
repository, which is exactly what the finding said.

## Rounds

| round | surfaces | result |
|---|---|---|
| A | v7 terminality, population drift, control labels, runtime drift, count mismatch | 2 P0 (both fixed), 1 P1 (open), 4 could-not-refute |

Round A's P0s are resolved in commit 622e2ca. Its P1 — calibration label and
origin are nearly confounded — was preregistered as a known limitation before the
panel was frozen, and whether it gates PR-A is an owner decision rather than one
made here.
