---
name: commitlore-commits
description: Capture a decision record from verified session and diff evidence before a commit.
metadata:
  hermes:
    category: commitlore
    tags: [git, decisions, commits]
---

# CommitLore commits

Use the CommitLore MCP tools for a non-trivial commit only when there is a real
constraint, evaluated alternative, warning, or verification gap worth leaving
for a future reader. Trivial changes commonly produce no record.

Stage the intended diff first. Call `commitlore_prepare_capture`, build the
draft only from the returned prompt and the actual session/diff evidence, then
call `commitlore_verify_capture`. If no record survives verification, commit
without one. For a surviving record, call `commitlore_stage_capture` immediately
before the ordinary Git commit. Do not invent quotes, hand-repair rejected
evidence, or reuse a nonce after the staged diff changes.

The repository's policy decides whether unattended capture is allowed. Never
enable that policy or initialize a repository merely because this skill loaded.
