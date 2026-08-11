---
name: commitlore-commits
description: Use when about to make a git commit and there is decision context worth recording — a constraint that shaped the change, an alternative that was tried and dropped, a warning for whoever touches this next. Drives the CommitLore capture pipeline, which drafts a record from the session transcript and the staged diff, machine-checks every quote against them, and binds what survives to the commit it was prepared for. Applies to an ordinary commit request, not only to one that names CommitLore: most commits carry nothing worth recording and this skill is silent on them, so the cost of considering it is a judgement the agent makes and drops. Trigger phrases include "commit this", "commit these changes", "finish up and commit", "commit this with commitlore", "write a commitlore record for this change", "capture the decision context for this commit", "what should I record about why I ruled out X", "커밋해줘", "수정 완료하고 커밋해", "commitlore 기록 남겨서 커밋해줘", "이 변경 결정 맥락 커밋에 남겨줘".
---

# CommitLore commits

A CommitLore record is the trailer block at the end of a commit message —
ordinary git trailers, parsed by `git interpret-trailers`. It captures what the
diff itself cannot show: the conditions that shaped the decision, the
alternatives that were dropped and why, and warnings for the next agent or
person who touches this code.

Record through **capture**. It binds the record to a nonce, hashes the
transcript and staged diff it was drafted from, and refuses any quote absent
from those bytes — so a record citing something nobody said never reaches
history. Hand-writing trailers skips all of that; it is the fallback at the end
of this file, not the default.

## When to record, and when not to

Trivial commits — typo fixes, formatting, a rename with no behavior change —
get no trailers. A record costs a future reader attention, and spending that on
noise is worse than recording nothing. Record only a real constraint, a real
alternative that was seriously considered and rejected, or a real warning worth
leaving. Answering `{"records": []}` is correct, and common.

## Capture

This skill is the host-side initiator when the host selects it for a commit
request. The `prepare-commit-msg` hook that `commitlore init` installs only
attaches an already staged transaction; an ordinary `git commit` never starts
capture because it has no session transcript. Without the hook, nothing staged
reaches a commit message. Stage the change first — capture hashes `git diff
--cached`.

**1. Prepare.** Write the relevant part of the session to a transcript, in the
words actually exchanged rather than a summary: it is the source every quote is
checked against, so paraphrasing is how a record ends up citing a sentence that
was never said.

- MCP: `commitlore_prepare_capture { transcript }` → `{ nonce, prompt,
  guard_advisory, policy_error, ... }`
- CLI: `commitlore capture --transcript session.txt` prints the same prompt.

**2. Draft.** That `prompt` is a self-contained contract — the full vocabulary,
the rule *cite or omit*, and the JSON to answer in: a `records` array, each with
`trailers` (`key`, `value`) and `evidence` (`key`, `source` of `transcript` or
`diff`, `quote`, `locator`). A quote is copied character for character; a
locator is `L<start>-L<end>` for transcript lines or the `@@ ... @@` hunk header
for the diff. Follow the printed contract — it is the authority, and it carries
rules this file does not repeat.

**3. Verify.** `commitlore_verify_capture { nonce, draft, transcript, diff }`,
where `draft` is that JSON as a string and `diff` is the same `git diff
--cached` bytes prepare hashed. Returns `validation_result` (`pass` | `partial`
| `empty`), `accepted`, and `rejected` with a reason each: `evidence-not-found`
(the quote is not in the source), `ruled-out-no-rejection` (the quoted passage
proposes the alternative rather than turning it down), `canonical-duplicate`. A
refused record is discarded and logged, never silently corrected.

**4. Ask — only in `suggest` mode.** The capture policy's `mode` decides
(ADR-0030). The default is `auto`: stage what came back `accepted` without
asking. Those records are stamped `Provenance: drafted`, which caps them at
`[claim]` — they are delivered as information, never as an instruction, because
nobody read them. Say nothing about it; a record landing quietly is the pipeline
working.

Where the policy goes further — `"unattended": true` beside `"mode": "auto"`
in `.commitlore-policy.json` — this step does not exist at all (#511). The
repository consented once, for every commit: declare the capture unattended
(CLI `--unattended`, or the MCP prepare tool's `unattended` argument), stage
what came back `accepted`, and show nothing to anyone. Declare it only where
the file opts in — `prepare` refuses the declaration anywhere else — and know
that a host which stages without declaring still stages a record nobody read:
the `drafted` stamp and its `claim` cap follow either way (ADR-0028).

In `suggest`, show what came back and stage only what the user keeps:

```
One decision worth keeping from this work:

  Ruled-out: pgbouncer in transaction mode | one more process to operate
    for a service that opens four connections

  keep, or skip?
```

One prompt per commit, and the default policy allows one record in it. **Skip is
completely ordinary** — most commits carry nothing, and a skipped candidate is
this pipeline working rather than failing; drop it without comment and do not
re-ask or re-word it back. On a trivial commit there is nothing to show and no
prompt to make: silence there is correct. To change wording, prepare again —
`verify` runs once per nonce, so an edited draft needs a new one.

In `off`, `prepare` refuses and there is nothing to do.

Nothing enforces the prompt. `stage` takes a verified nonce and has no way to
ask whether a human ever saw the record (ADR-0028). What `auto` adds is not
enforcement but honesty: a record staged without a prompt says so in its own
`Provenance:`, and grading acts on that whatever the host does.

**5. Stage.** `commitlore_stage_capture { nonce }` → `{ "staged": true,
"nonce": "..." }`, or `{ "staged": false, "reason": "..." }` when verification
came back empty. Staging is what stamps `expires_at`. On a skip, call nothing:
an unstaged transaction is inert and never reaches a commit.

**6. Commit.** `git commit` as usual, message body only — the hook appends the
trailer block itself, so do not write trailers by hand or paste the draft in. It
applies the record only while all five hold: HEAD unchanged, staged diff
unchanged, under five minutes since staging, record unconsumed, capture policy
unchanged. Break one and the commit proceeds carrying no record.

The CLI runs steps 1, 3 and 5 in one process. There is no point inside it where
a user can answer, so it stages without asking — reach for it only when the user
has already agreed to record this one, or when the repository opted into
unattended capture, in which case pass `--unattended`: prepare refuses the
declaration where the policy does not consent. Otherwise keep the MCP tools,
where step 4 fits between verify and stage:

```
commitlore capture --transcript session.txt --draft draft.json
```
```
staged: f13afcf766455ae46f6b1b4e96914f26
```

A refusal prints its reason, stages nothing, and still exits 0 — capture is
never allowed to block the commit it sits next to:

```
no record staged
commitlore: discarded record 0 (evidence-not-found): Limit: the transcript does not contain "the endpoint fails every third request"
```

`commitlore pending ls` lists transactions that have not reached a commit yet;
`commitlore capture gc` removes expired ones, and a skipped capture among them —
24 hours after the commit it was prepared for lands without it. `commitlore
pending rm <nonce>` removes one now instead. Neither will touch a `staged` or
`applied` transaction: those can still become a record.

## The vocabulary

Sixteen keys, all optional, no others accepted — anything else (bar an
`X-<Name>:` extension) is rejected by `commitlore validate`. The capture prompt
reprints this, so the table is mostly for reading records and for the fallback.

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
| `Record-Id:` | `r-[a-z0-9]{6,}` | no | Stable identity for this record |
| `Follows:` | `Record-Id` | yes | The prior record in a decision chain |
| `Supersedes:` | `Record-Id` | yes | Retires an earlier record |
| `Expires:` | `YYYY-MM-DD` \| free-text condition | no | When this record stops being active |
| `Evidence:` | `path` \| `path#anchor` \| URL | yes | Link from a claim to its proof |
| `Provenance:` | `authored` \| `drafted` \| `inherited <sha>` \| `reconstructed` \| `unknown` | no | How this record came to exist |
| `CommitLore-Version:` | semver | no | Protocol version this record targets |
| `X-<Name>:` | free text | yes | Organization extension, never interpreted by the core |

Enums must match exactly — `Blast: wide`, `Undo: clean` and `Certainty: high`
are violations, not synonyms. `Record-Id` is random rather than a hash of the
commit, so it survives a rebase or squash, and `Follows:`/`Supersedes:`
reference one, never a sha. `Verified:` is the one key capture never drafts —
reading a transcript cannot prove a check ran.

The block must be the message's **last** paragraph, every line a `Key: value`
line or an indented continuation. Mix in one line of ordinary prose and the
whole paragraph parses as prose — zero trailers, not a partial record.

## Fallback: writing the block by hand

Capture binds a record to a HEAD and a staged diff, so it cannot record a
decision for a commit that already exists, and it does nothing where the hooks
were never installed. Those are the cases for writing trailers yourself. For
past commits that never carried a record, prefer `commitlore backfill
--prompt-only` / `--draft`: it reconstructs through the same verified loop and
marks every result `Provenance: reconstructed`.

Check a hand-written message before committing it:

```
printf 'Widen the retry window\n\nBlast: wide\n' | commitlore validate
```
```
3: enum Blast — got "wide", want "local|module|system"
commitlore: 1 violation (SPEC §6) — the message was not modified
```

(exit 1; a valid message exits 0 and prints nothing). The commit-msg hook runs
this on every commit once `commitlore-setup` has installed it.

`commitlore harvest --transcript session.txt --prompt-only` and `commitlore
harvest-verify --draft draft.json --transcript session.txt --diff staged.diff`
give the same contract and evidence checking without the transaction: quotes are
verified, but nothing binds the result to a HEAD, a diff or an expiry, and the
survivors must be folded into the message by hand (`--repair-prompt` emits
feedback for one more attempt). Reach for these only when capture cannot bind.
