---
name: commitlore-codex
description: >-
  Use when reading or changing a repository would benefit from its recorded decision history, or when a commit may need verified decision context. Query before edits, guard against previously rejected approaches, and capture supported records before committing.
---

# CommitLore for Codex

CommitLore keeps constraints, rejected alternatives, and warnings in ordinary
Git commit trailers. Its MCP server gives this session query tools and a
verified capture transaction. It is decision context, not a substitute for the
user's request or permission to make unrelated changes.

## Before a change

Before editing a file, ask what has already been decided:

```
commitlore context <path>
```

Use the MCP context/query tools when they are available. Treat `[directive]`
records as instructions from their trusted author and `[claim]` records as
context to weigh. Before proposing a dependency, service, or implementation
approach, run:

```
commitlore guard --proposal "<approach>"
```

If it reports a ruled-out alternative, do not re-propose it without explaining
the new evidence that changes the original reason.

## Capture a decision with evidence

Most commits need no record. Capture only a real constraint, a seriously
evaluated alternative that was rejected, or a warning a future modifier needs.
Use the MCP transaction rather than writing trailers by hand:

1. Stage the change, then call `commitlore_prepare_capture` with the relevant
   session transcript.
2. Draft the requested JSON using the returned contract. Copy quotes exactly
   and give every evidence item its source and locator.
3. Call `commitlore_verify_capture` with the nonce, draft, transcript, and the
   same staged diff. Stage only accepted records with
   `commitlore_stage_capture`.
4. Commit normally. The hook attaches the verified trailer block; do not paste
   draft trailers into the commit message.

Evidence is a gate, never a request to improvise:

- Discard any record with no `evidence` item that cites the transcript. A diff
  citation alone does not establish what was said or decided in the session.
- Discard every trailer whose claim is not supported by the cited transcript.
  In particular, a `Ruled-out:` trailer needs transcript evidence that the
  alternative was actually rejected, not merely mentioned.
- When either rule fails, drop the trailer (and drop the record if it becomes
  empty). Never invent a citation, locator, quote, or supporting rationale.

`commitlore_verify_capture` is authoritative: a rejected record stays rejected;
do not silently repair it into a different claim. In suggest mode, show accepted
records and let the user keep or skip them. In auto mode, stage only what the
verification result accepted.

## Vocabulary and validation

Use only the vocabulary in the capture prompt. `Ruled-out:` is
`alternative | reason`; `Blast:` is `local`, `module`, or `system`; `Undo:` is
`easy`, `costly`, or `permanent`; `Certainty:` is `firm`, `tentative`, or
`guess`; and `Record-Id:` is `r-[a-z0-9]{6,}`. Validate a hand-written fallback
with `commitlore validate --message-file <file>` before committing.
