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

## Unattended capture — an opt-in

Capture normally runs with the agent in the loop: it prepares, drafts and
verifies, and the policy's `mode` decides whether anyone is asked before
staging. A repository can go one step further and consent once, for every
commit, to capture with nobody in the loop at all:

```
commitlore auto on
```

writes the setting to `.commitlore-policy.json` (`commitlore init` asks about
it once where no policy file exists yet, and `commitlore auto status` reports
what is set). Where that is set — `mode "auto"` beside `unattended: true` —
`commitlore capture --unattended` (or the MCP prepare tool's `unattended`
argument) prepares, verifies and stages without any prompt, and the record
reaches the commit through the hooks that already exist. Anywhere else the
declaration is refused at prepare: consent is a repository setting, not a
caller's say-so (ADR-0030, #511). The setting is honoured in `auto` mode only
— `suggest` exists to ask, and `off` captures nothing; `commitlore auto on`
sets both coherently rather than producing a file the resolver rejects.

The file is committed with the repository: turning it on applies to everyone
who clones it.

Because the setting lives with the capture policy, the policy identity covers
it: a file edited between stage and commit is detected like any other policy
change (ADR-0021 §7). It is off unless a repository sets it; shipping the
switch is not flipping it.

What it does not change: every record staged without a person reading it is
stamped `Provenance: drafted` and served as `[claim]`, never `[directive]`,
and the commit-msg hook's credential scan still runs before the commit exists.

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

## Standing behind a record nobody read

A record marked `Provenance: drafted` was produced by the capture pipeline and
staged without a person reading it. Its quotes are checked against the
transcript and the diff it came from, so it is real — but nobody vouched for the
wording, and that is what `[directive]` claims. It is delivered as `[claim]`
however trusted its author is (ADR-0030).

**Endorsing one is a new record, never an edit.** A commit message cannot be
changed without rewriting history, so the way to stand behind a drafted record
is to write one that supersedes it:

```
feat: stand behind the cache decision

Warn: session entries must stay under 4KB
Ruled-out: shared Redis cache | ops refuses another stateful dependency
Supersedes: r-promo01
Record-Id: r-promo02
Provenance: authored
```

The lifecycle fold retires the drafted record, and the endorsement is graded on
its own author:

```
before   [claim]      r-promo01   session entries must stay under 4KB
after    [directive]  r-promo02   session entries must stay under 4KB
```

Nothing was added for this — `Supersedes:` and the fold already did it.

**Never endorsing anything is the supported path.** A repository where nobody
promotes serves every record as a `claim`, which is what an installed CommitLore
serves today unless `--trusted-author` is configured.
