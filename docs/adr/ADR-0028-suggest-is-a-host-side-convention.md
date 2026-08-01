# ADR-0028 — `mode: suggest` is a host-side convention, and the core does not pretend otherwise

Status: accepted · Closes [#341](https://github.com/MongLong0214/commitlore/issues/341)

- Related: [ADR-0021](ADR-0021-capture-pending-transaction.md) (the pending format and
  phase vocabulary this decision declines to change)

## Context

A review of v0.5.0 read `src/core/capture-policy.ts`:

```ts
export type CaptureMode = 'suggest';
```

and then read the phases the pending transaction can hold
([ADR-0021 §2](ADR-0021-capture-pending-transaction.md)):

```
prepared → verified → staged → applied → consumed
```

There is no `approved`, no rejection state, and no approval token anywhere in
`src/`. `stageCaptureRecord` gates on the phase, the record count, HEAD, the
staged diff, the staged tree and the policy identity hash. None of those is a
person.

So `suggest` reads as a policy — *produce a candidate rather than committing one
automatically* — and one half of that is true. Nothing writes a record without a
host driving prepare → verify → stage. The other half is not: a candidate the
user never saw and a candidate the user approved are the same bytes in the same
phase, and `stage` accepts both. Two hosts can behave oppositely and neither is
out of contract.

That is not a bug in the check. There is no check. The word names something the
transaction has no way to represent.

## What the two fixes actually buy

| | where approval lives | what `stage` can refuse | cost |
|---|---|---|---|
| host-side prompt | the skill, between verify and stage | nothing | none to the format |
| `approved` phase | the pending file | a record nobody kept | ADR-0021 §2 and §7 |

They are often spoken of as the same fix. They are not. The first changes what
this project's own agent does; the second changes what any agent *can* do. A
second host — someone else's skill, a CI job, a wrapper calling
`commitlore_stage_capture` directly — is unaffected by the first and bound by
the second.

The second is also the expensive one, and the expense is specific. `approved`
would be a sixth phase in a field ADR-0021 declares normative, in a file whose
`version` consumers must reject when they do not understand it. It needs a
place to record who approved and when, which is a field addition, which is a
`version` bump by ADR-0021's own rule. And the policy identity hash is
`sha256(JSON.stringify(defaults))` over a key order ADR-0021 §7 fixed and
`test/capture-policy.test.ts` pins — an approval-carrying mode is a different
`mode` value, so every pending record in flight was written under a hash the
hook would then report as changed. That is a coordinated change across the CLI,
the MCP tools, both hooks and every agent integration built on them.

## Decision

**`suggest` is a host-side convention. It is not enforceable by this codebase,
and every place that describes it says so.**

1. **The prompt ships in the skill, not the core.**
   `skills/commitlore-commits/SKILL.md` gains a step between verify and stage:
   the agent shows the accepted records and stages only what the user keeps. One
   prompt per commit, and the default policy allows one record in it.

2. **Skipping is ordinary, and the skill says that in those words.** Most
   commits carry nothing worth recording. A skipped candidate is the pipeline
   working. Silence on a trivial commit is the correct output, not a failure to
   capture, and an agent that re-asks or argues a record back has misread this.

3. **No claim is made that this closes the hole.** The skill states plainly that
   nothing enforces the step, that `stage` cannot ask whether a human saw the
   record, and that the prompt is the only thing between a draft and a commit.
   `src/core/capture-policy.ts` and ADR-0021 §7 carry the same statement. A host
   that stages without asking violates no check here and is within contract.

4. **The pending format, the phase vocabulary and the identity-hash inputs are
   untouched by this change.** No `approved` phase, no approval field, no new
   `mode` value, no `version` bump.

5. **An `approved` phase is not rejected — it is unbuilt.** It is the thing that
   would make `suggest` mean something, and it needs its own ADR and its own
   approval, because it is a protocol change and not an implementation detail.

## Consequences

- The gap is now documented in three places rather than implied by none. That is
  the entire honest gain: a reader of `CaptureMode` learns what it does not do,
  and a second host implementer learns they are unconstrained rather than
  discovering it.

- **A skipped candidate leaves an inert file behind.** A transaction that reaches
  `verified` and is never staged has `expires_at: null`, and `capture gc` keeps
  files it cannot date (`pending-gc.ts` fails closed). The hook only ever applies
  `staged` or `applied`, so the file can never reach a commit — but it sits in
  `.git/commitlore/pending/` and shows in `commitlore pending ls`. This is
  already true of every capture that stops before stage; step 4 makes it the
  common case rather than the failure case. `commitlore pending` has no `rm`.

- **The CLI's one-command form still stages without asking.** `commitlore capture
  --transcript … --draft …` composes prepare, verify and stage in one process,
  and there is no point inside it where a user can answer. The skill now says so
  and directs the asking path to the MCP tools. Adding a flag to stop after
  verify is a reasonable follow-up and is not done here.

- **The name collides with an unrelated route.** SPEC §5 routes `Blast: system`
  and `Undo: permanent` to an "approval gate" — that is a consumer reading a
  record that already exists, and it decides whether a *change* needs review. It
  has nothing to do with approving a *record* before it is written. The two must
  not be conflated when the second one is built.

## Alternatives ruled out

**Add the `approved` phase in this change.** It alters the pending format,
ADR-0021's normative field set, and the identity-hash inputs — the three things
that ADR-0021 fixed precisely because a break in them forces a coordinated
update across every agent integration. A protocol change decided as a side
effect of closing a documentation defect is the shape of change this repository
is least able to review.

**Leave the prompt out and only document the gap.** Documentation of a gap that
nothing fills is a smaller product. The prompt is cheap, it is where the UX has
to live in either design, and building it now means the phase — if it is ever
added — is enforcing a flow that already exists rather than inventing one.

**Ship the prompt and call the policy enforced.** This is the failure the issue
is actually reporting, committed a second time. A host-side prompt makes *this*
host ask; it makes no statement about any other, and describing it as enforcement
would leave the next reader of `CaptureMode` believing a check exists.

**Remove `mode` from the policy until it can be enforced.** It is an input to the
identity hash that ADR-0021 §7 fixed and `test/capture-policy.test.ts` pins.
Deleting it changes the digest for every pending record in flight — the full cost
of the real fix, for none of its benefit.

**Rename it to something weaker, like `advisory`.** Same hash cost as any other
`mode` change, and it buys a word rather than a behaviour. The honest fix for a
word that overclaims is a sentence next to it saying what it does not do, which
is what this ADR requires.

## Falsification

This ADR is wrong if any of the following is true:

- a document, a tool description or a skill describes `suggest` as enforced, or
  implies that `stage` refuses an unapproved record
- the skill's approval step is described as closing the gap rather than
  conventionally filling it
- an `approved` phase, an approval field, or a new `CaptureMode` member is added
  without an ADR that accepts the `version` bump and the identity-hash change
- `skills/commitlore-commits/SKILL.md` treats a skip as a failure, prompts more
  than once per commit, or prompts on a commit with nothing to record

It is superseded, not falsified, by an ADR that moves approval into the
transaction. What would motivate one: evidence that a second host stages without
asking in practice, or a user report that a record they never saw reached
history.
