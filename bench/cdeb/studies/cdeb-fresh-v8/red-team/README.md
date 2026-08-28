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
| A | v7 terminality, population drift, control labels, runtime drift, count mismatch | 2 P0 fixed, 1 P1 to the owner, 4 could-not-refute |
| B | boundary leak, calibration overfit, family diversity, arm exposure, judge memory, early reveal, reliability | 2 P0 fixed, 1 P0 ruled on by the owner, 3 P1, 1 P2 |
| C | arm asymmetry, retry loophole, panel aggregation, indeterminate scoring, bootstrap unit, headline | 2 P1 fixed as code defects, 1 P1 partly, 1 P1 to the owner, 2 P2 already recorded |

Nineteen surfaces, all covered, 16 findings. Seven were defects in work this
session produced and are fixed; the rest were already-recorded limitations the
reviewers found by reading what the study says about itself, or questions that
belong to the owner.

Three findings were worth the exercise on their own:

- **A judge read the other two before answering.** Not a risk — it happened, and
  the event stream names the command. `preflight/judge-independence-audit.json`
  measures it: 48 of 96 calibration judgements had the opportunity, one took it,
  and no selection outcome changes.
- **Packet ids reversed to an arm in under a millisecond.** Seventeen candidates
  times two arms is thirty-four hashes, and the salt was committed beside the code.
  I had written that the salt "is not a secret, it is a separator", which is the
  flaw stated as a reassurance.
- **The panel truth table agreed with the bug.** It had been written from the
  implementation rather than from section 9.1, so it asserted that two
  INDETERMINATE votes produce `INDETERMINATE`. A table copied from the code under
  test cannot disagree with it.

Two findings were the owner's to settle rather than defects to fix, and both are
ruled:

- **The calibration label/origin confound stays** (v8-d010). The frozen corpus is
  kept and the confound bounds the evidence tier under section 26. It bounds what
  passing calibration establishes about the three seats; it does not bound the
  measured agreement statistics, which are computed on 340 episodes whose trees
  carry no v6/v7 origin split for a judge to detect.
- **The headline names its benchmark** (v8-d009). Section 27 now reads *R% fewer
  repeated bad decisions on a fixed 17-task benchmark*, because a headline is the
  part that travels without its footnote.

No P0 and no P1 remain open.
