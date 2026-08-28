# Panel composition under two available families

Written before the second candidate's score is known, so the reasoning cannot be
assembled around whichever composition the numbers happen to favour.

## What is available

```
codex     available, first candidate scored 91.5% / 88.2% / 93.3%, all thresholds passed
claude    available, calibrating now, several models within the family
grok      unavailable — 402 Payment Required, usage balance exhausted
```

§7.2 asks for three fixed judges and at least two distinct families where
available. Two are available, so the study proceeds without the evidence-tier
downgrade that a single family would force.

## The consequence nobody registered

Three seats, two families. One family necessarily holds two of them.

§9.1 aggregates by majority: two matching labels decide the episode. So the
doubled family can carry an episode on its own, and the single-family judge can
never do more than force `PANEL_INDETERMINATE` by splitting three ways. That is
not a majority of independent readings — it is a majority of two readings from one
family plus one from another.

This matters most exactly where the study is most interesting. The trial packet
`977c370988b476c0` drew `COMPLIANT` from codex and `VIOLATION` from claude, both
at high confidence, on a decision v7 had already reported as having no boundary a
program could apply. Where families disagree, the doubled family decides.

## What follows, and what does not

It does not change the selection rule. §8.3 is ordered: pass thresholds, maximise
panel accuracy, maximise family diversity, lexical tie-break. Two families is the
maximum diversity reachable with what exists, so the rule is satisfied by any
2+1 split and the earlier criteria pick which.

It does mean two things must be reported rather than assumed:

- **which family holds two seats, and what that does to the label distribution.**
  Per-family agreement is already required by §10; the split should be readable
  from it.
- **the rate at which the two families disagree on the same packet.** If they
  disagree often, a 2+1 panel is closer to "the doubled family's answer, checked"
  than to three independent readings, and the reliability numbers should be read
  that way.

Both are measurable from the calibration corpus before any episode runs, because
both candidates see the same 47 packets.

## Not a reason to stop

The PRD anticipated a thinner pool than five and registered the downgrade only
for a single family. Two families with one doubled is inside what it authorised.
Recording the limitation is the obligation here, not escalating it.

Escalate only if calibration shows the two families disagreeing so often that the
panel label is effectively one family's, which is a question this note cannot
answer and the 47 packets can.
