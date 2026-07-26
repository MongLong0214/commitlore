# Can `guard` block? Measured: no

`bench/ROUTE-GAP.md` ends by saying the guard route is the one the product's
claim rests on and that it stops three of five re-proposals before execution.
The obvious next step is to wire it into the plugin as a blocking PreToolUse
hook. This is the measurement that says not to.

No model calls. Every number below comes from the 30 recorded `commitlore-on`
runs already in `bench/results/transcripts-final/` — 5 genuine re-proposals and
25 compliant runs, scored by replaying each agent's own diff through `guard`.

---

## 1. The default matcher flags compliance at maximum confidence

Sweeping the threshold produced no usable operating point, and the reason was
not a near miss:

| threshold | caught / 5 | false alarms / 25 | highest false-alarm score |
|---|---|---|---|
| 0.35 | 3 | 5 | **1.0000** |
| 0.50 | 3 | 4 | **1.0000** |
| 0.55–0.80 | 0 | 2 | **1.0000** |

A compliant run scoring a perfect 1.0000 is not a tuning problem. Opening the
two payloads showed the same cause in both — the agent **cited the record it was
obeying**:

- `reproposal-index-server` seed 3 wrote `**Constraints (from r-2d55a9):**` and
  then followed them.
- seed 1 used the id as a documentation example: `org-query --record-id r-2d55a9`.

Both scored 1.00 on the `Record-Id:` signal with a token overlap of **0.01**.

`RECORD_ID_WEIGHT` is documented as deliberate, and for the CLI it is right:
*"a proposal that names `r-7c1a45` is discussing that record, and printing what
it ruled out and why is the correct response whether the proposal is reviving
the alternative or merely citing it."* For a blocking hook it inverts — **citing
a record is what compliance looks like**, so the better the agent behaves, the
more certainly it gets blocked.

## 2. `--require-content` fixes that, and is not enough

A new option refuses to flag on a record-id reference alone, and drops the id
from the score. The perfect-score false alarms disappear: the worst false alarm
falls from **1.0000 to 0.5213**.

The separation still does not exist:

```
true re-proposals   0.5288  0.5022  0.5016  0.2518  0.0000
compliant runs      0.5213  0.5043  0.5036  0.5033  0.3842  0.2609
```

The highest false alarm sits **between** the best true positive and the second
best. Any threshold that keeps three catches admits four false alarms; the only
threshold with zero false alarms catches **one of five**.

Two of the five re-proposals are invisible to lexical matching at any setting:
`reproposal-node20-floor` scores **0.0000** — it lowered a version floor, which
shares no vocabulary with the alternative that was ruled out.

## 3. What follows

**`guard` stays advisory.** It is not wired into the plugin as a blocking hook,
and the plugin continues to inject records rather than refuse edits.

That is the conclusion `src/core/guard.ts` had already reached in its own header
— *"the honest limit of lexical matching, and the reason `guard` warns rather
than blocks"* — before this was measured. The measurement exists because the
opposite was proposed on the strength of ROUTE-GAP's "3 of 5 caught", by reading
the recall column and not the precision one.

**`--require-content` ships anyway.** Removing a class of false alarm that fires
specifically on well-behaved agents is worth having whether or not anything
blocks, and any future blocking mode starts from it rather than from the
informational default.

**This narrows #37.** The question is not "does the guard route beat injection".
Blocking is off the table for a lexical matcher, so what is left to measure is
whether an *advisory* guard — surfaced at the moment of the edit rather than at
session start — changes behaviour more than injected context does. That is a
smaller and more answerable question.

**What would change the answer** is a matcher that separates the two
populations. Semantic matching is the obvious candidate and the obvious risk:
`ADR-0002` keeps the core LLM-free and zero-cost on purpose, and #31 registers
an embedding layer as opt-in only. Nothing here justifies moving that into the
core.
