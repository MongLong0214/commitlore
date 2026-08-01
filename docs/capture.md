# How records get created

You do not hand-write a trailer for every commit. Most commits should carry no
record at all. Add one only for a decision the diff cannot recover: an external
constraint, a rejected alternative, a warning, or a verification gap.

CommitLore never invents a record. The commit-msg hook validates a record that
is already present; it does not create one, and it does not silently add one.

## Through a coding agent

Ask the agent to commit normally and preserve only the decision context the diff
cannot explain:

> Commit this change. Add a CommitLore record only if the diff cannot recover an
> important constraint, rejected alternative, warning, or verification gap.

Most commits should still carry no record. The agent instructions live in
[`skills/commitlore-commits/`](../skills/commitlore-commits/), and the commit
hook validates any record the agent adds.

## Advanced: harvest

`commitlore harvest` builds a prompt contract from a session transcript and a
staged diff, and `commitlore harvest-verify` checks a draft against them. They
support drafting, not automatic commits. Interactive record building is not
implemented.

```bash
# 1. Build the prompt contract for the session and hand it to the agent.
commitlore harvest --transcript session.jsonl --prompt-only

# 2. The agent answers with a draft. Check what survives the transcript and diff.
commitlore harvest --transcript session.jsonl --draft draft.json
commitlore harvest-verify --transcript session.jsonl --draft draft.json
```

`commitlore harvest --diff <file>` reads a diff other than the staged one, and
`--out <file>` writes the output somewhere other than stdout.

`commitlore capture` runs the same idea as one transaction — prepare, verify,
then stage a record from a transcript and draft, with no trailer syntax to
write. `commitlore pending` inspects capture transactions that have not reached
a commit yet, and `commitlore capture gc` removes expired ones.

Whatever route produces the draft, the record only becomes real when the
commit-msg hook validates it on the commit.

## By hand

As an escape hatch, a human can write ordinary Git trailers by hand. The trailer
grammar is in [protocol.md](protocol.md); the normative rules are in
[`spec/SPEC.md`](../spec/SPEC.md).

## What happens to a record afterwards

- It lives in Git, with an identity (`Record-Id:`) that survives a rewritten
  commit hash, and a lifecycle (`Supersedes:`, `Expires:`).
- Before a path is edited, the next agent receives only the decisions still in
  force — through MCP, or through the `PreToolUse` hook.
- A decision that was later superseded or expired does not reach the agent as if
  it still stood. `commitlore stale` lists the ones that no longer apply.
