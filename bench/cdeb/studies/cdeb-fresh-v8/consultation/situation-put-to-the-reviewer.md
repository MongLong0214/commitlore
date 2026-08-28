# A preregistered trial cannot build two of its arms. Attack the conclusion.

Two files sit beside this one:

    preflight-result.json      what the manipulation preflight measured, all 17
    the-three-decisions.json   the raw records behind the two failures

## The design

A trial measures whether automatically delivering a repository's own recorded
decision to a coding agent, before it makes its first relevant change, makes the
agent more likely to finish the task without doing the thing the decision ruled
out.

Seventeen tasks, fixed and preregistered. Each has one target decision. Every
task runs twice per repetition:

    ON           the agent receives the payload the shipping build emits
    SUPPRESSED   the same payload with the target decision's blocks removed

Suppression is specified as removal **by structured record identity** — you take
out the record, not text that looks like it. That is deliberate: a text filter
deletes whatever happens to be phrased like the ruling and keeps whatever happens
to be phrased differently, so the manipulation would differ per candidate.

The preregistration also fixes the population at all seventeen and forbids
reducing it, and says a missing required input is a terminal hold.

## What the preflight found

Fifteen of seventeen build both arms correctly. Two do not, and both reproduce by
hand with the frozen build.

**`v4-34aef026d81c2f6b`** has no `record_id` in the source pool. There is no
identity to remove. Its path scope returns 66 records.

**`v4-f901052615fa3aee`** targets `r-f8adapter`, whose ruling is "JSON files on
disk". Removing that record does not remove the ruling from the payload, because
**three** decisions in that repository rule out the same approach for different
reasons:

    r-f8adapter   JSON files on disk | sqlite keeps each artifact atomically constrained
                                       with its correction lineage
    r-f8replay    JSON files on disk | sqlite keeps a single durable, constrained run history
    r-f8schema    JSON files on disk | sqlite provides atomic constraints, version gating,
                                       and immutable correction lineage

So a SUPPRESSED agent on that task is still told the approach was ruled out.

And `r-f8replay` is the target record of `v4-ed878960135ff45a`, which is also one
of the seventeen. Suppressing all three to clean one arm changes that other
candidate's ON payload.

## The conclusion I reached, which you should try to break

I recommended ending the study: `TERMINAL_HOLD_FINAL`, zero episodes, publishing
the finding that a naturally recorded repository decision is not always a unit
that can be independently suppressed.

I ruled out three alternatives:

- **suppress by matching the ruling text** — the manipulation stops being one
  registered transform and becomes a different one per candidate
- **treat the three co-ruling records as one target cluster** — it changes another
  candidate's ON payload, so the two stop being independent units
- **drop the two and run fifteen** — the preregistration forbids reducing the
  population, and it would report a study of the decisions that happen to be
  suppressible as though it were a study of the seventeen

## What I want from you

Not agreement. Try to find the thing I have wrong.

Concretely:

1. Is there a suppression that is neither text matching nor cluster removal, that
   I have not considered? Something using the record's audit anchor, its commit,
   its path scope, its lifecycle?
2. Is the second failure actually a failure? An argument exists that a
   SUPPRESSED agent still hearing "JSON files on disk was ruled out" from two
   other records is the *correct* comparator — the treatment under test is
   delivery of *this* decision, and the others are part of the world either way.
   Is that argument right? What does it cost?
3. Is the first failure recoverable? A decision with no `record_id` — can it be
   identified another way that is still structural rather than lexical?
4. If the study does end here, is `TERMINAL_HOLD_FINAL` the honest label, or is
   this really a result about decision records rather than an integrity failure?

Read both JSON files before answering. Say which you read. If you think the
conclusion is right, say why in a way that would survive someone arguing the
other side — not by restating it.
