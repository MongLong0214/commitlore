---
name: commitlore-commits
description: Use when about to make a git commit and there is decision context worth recording — a constraint that shaped the change, an alternative that was tried and dropped, a warning for whoever touches this next. Builds a CommitLore trailer block for the commit message, or drives the harvest pipeline to draft and machine-verify one from the session transcript and diff. Trigger phrases include "commit this with commitlore", "write a commitlore record for this change", "what should I record about why I ruled out X", "harvest a commit message", "commitlore 기록 남겨서 커밋해줘", "이 변경 결정 맥락 커밋에 남겨줘".
---

# CommitLore commits

A CommitLore record is the trailer block at the end of a commit message —
ordinary git trailers, parsed by `git interpret-trailers`. It captures what
the diff itself cannot show: the conditions that shaped the decision, the
alternatives that were dropped and why, and warnings for the next person (or
agent) who touches this code.

## When to record, and when not to

Trivial commits — typo fixes, formatting, a rename with no behavior change —
get no trailers. A record costs a future reader attention; spending that on
noise is worse than recording nothing. Only write one when there's a real
constraint, a real alternative that was seriously considered and rejected, or
a real warning to leave behind.

## The vocabulary

Sixteen keys, all optional, no others accepted. Anything outside this list
(other than an `X-<Name>:` extension) is rejected by `commitlore validate`.

### Decision context

| Key | Value grammar | Repeatable | Meaning |
|---|---|---|---|
| `Limit:` | free text | yes | An external condition that constrained the decision and may still be active |
| `Ruled-out:` | `alternative \| reason` — the `\|` separator is required | yes | An alternative that was evaluated and dropped, with why |
| `Warn:` | free text (folding allowed) | yes | An instruction for whoever modifies this next |
| `Blast:` | `local` \| `module` \| `system` | no | How far the change reaches |
| `Undo:` | `easy` \| `costly` \| `permanent` | no | What reverting this costs |
| `Certainty:` | `firm` \| `tentative` \| `guess` | no | How sure the author is |
| `Verified:` | free text | yes | What was checked, and how |
| `Unverified:` | free text | yes | A known gap in verification |

### Identity, lifecycle, provenance

| Key | Value grammar | Repeatable | Meaning |
|---|---|---|---|
| `Record-Id:` | `r-[a-z0-9]{6,}` | no | Stable identity for this record |
| `Follows:` | `Record-Id` | yes | The prior record in a decision chain |
| `Supersedes:` | `Record-Id` | yes | Retires an earlier record |
| `Expires:` | `YYYY-MM-DD` \| free-text condition | no | When this record stops being active |
| `Evidence:` | `path` \| `path#anchor` \| URL | yes | Link from a claim to its proof |
| `Provenance:` | `authored` \| `inherited <sha>` \| `reconstructed` \| `unknown` | no | How this record came to exist |
| `CommitLore-Version:` | semver | no | Protocol version this record targets |
| `X-<Name>:` | free text | yes | Organization extension, never interpreted by the core |

Enum values must match exactly — `Blast: wide`, `Undo: clean`, and
`Certainty: high` are all violations, not accepted synonyms. `Record-Id` is a
random-looking identifier, not a hash of the commit, so it survives a rebase
or squash; `Follows:`/`Supersedes:` reference a `Record-Id`, never a sha.

The trailer block must be the message's **last** paragraph, and every line in
it must be a `Key: value` line or an indented continuation of one. Mix in a
line of ordinary prose and the whole paragraph is read as prose — zero
trailers parsed, not a partial record. Keep the trailer block separated from
the body by a blank line and don't add commentary inside it.

Check a message before committing it:

```
printf 'Widen the retry window\n\nBlast: wide\n' | commitlore validate
```
```
3: enum Blast — got "wide", want "local|module|system"
commitlore: 1 violation (SPEC §6) — the message was not modified
```
(exit 1). A message with valid trailers exits 0 and prints nothing. If
`commitlore-setup`'s commit-msg hook is installed, this check runs
automatically on every `git commit`; running `validate` by hand first is just
a faster feedback loop while drafting the message.

## The harvest pipeline

Writing trailers by hand from memory is optional — the alternative is to hand
the drafting to the current agent session and let a separate, deterministic
checker throw out anything it made up.

**1. Get the prompt contract.** Point `commitlore harvest` at a transcript of
the session and the diff being committed:

```
commitlore harvest --transcript session.txt --diff staged.diff --prompt-only
```

With no `--diff`, it uses the staged diff. This prints a self-contained
prompt: the same vocabulary tables above, the rule "cite or omit — a missing
record is better than a false one", the exact JSON shape to answer in, and
the transcript and diff themselves, line-numbered. Nothing here calls a
model — this command only builds the prompt text. The session reading it (the
one already in context, with no separate API key or cost) answers by
producing a JSON draft: one object per record, each `trailers` entry paired
with `evidence` entries that quote the transcript or diff verbatim and give a
locator (`L<start>-L<end>` for a transcript line range, or the diff's `@@`
hunk header). Save that answer to a file, e.g. `draft.json`.

**2. Verify it.** Nothing above is trusted yet — a session can misquote or
invent a rejection that never happened. `commitlore harvest-verify` checks
the draft against the same transcript and diff, deterministically, with no
model in the loop:

```
commitlore harvest-verify --draft draft.json --transcript session.txt --diff staged.diff
```

A record that clears every check prints in `{"records": [...]}` form, ready
to fold into the commit message. Verified example — transcript said *"...A
queue-based retry would fix it too, but the free-tier infra has no queue
worker, so that option is ruled out for now..."*:

```
{
  "records": [
    {
      "trailers": [
        { "key": "Limit", "value": "the endpoint is flaky and fast retries trip the upstream rate limiter" },
        { "key": "Ruled-out", "value": "queue-based retry | the free-tier infra has no queue worker" }
      ],
      "evidence": [
        { "key": "Limit", "source": "transcript", "quote": "tripping the upstream rate limiter", "locator": "L1-L2" },
        { "key": "Ruled-out", "source": "transcript", "quote": "the free-tier infra has no queue worker", "locator": "L4-L4" }
      ]
    }
  ]
}
```

A record that quotes something nobody actually said is discarded and logged,
never silently dropped or "corrected":

```
{
  "records": []
}
```
```
commitlore: discarded record (evidence-not-found): Limit: the transcript does not contain "the endpoint fails every third request"
```

`Ruled-out:` gets an extra check beyond the quote existing: the text around
the quote has to show the alternative actually being turned down (a phrase
like "ruled out", "instead", "not viable"), not just mentioned. Quoting the
sentence where an alternative was first *proposed* is rejected as
`ruled-out-no-rejection`, with the same "discard, don't fabricate" policy.

**3. Repair, bounded.** `--repair-prompt` on a run with rejections prints
feedback text naming exactly what failed and why, meant to be handed back to
the session for one more attempt. This is capped at two rounds — after that,
the commit proceeds with whatever passed, or with nothing. Both
`harvest --prompt-only` (nothing to harvest) and `harvest-verify`
(everything rejected) always exit 0: an optional enrichment step is not
allowed to block the commit it sits next to.

**4. Commit.** Fold the trailers from the surviving `records` into the commit
message's trailer block (last paragraph, one `Key: value` line per trailer)
and commit as usual. If the setup skill's hook is installed, `commitlore
validate` runs on the final message automatically.
