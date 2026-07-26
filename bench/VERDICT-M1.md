# M1 verdict — the registered re-proposal measurement

**n = 30 per arm, 3 of 3 seeds complete, 60 of 60 runs.** No truncation; the
truncation clause in `PREREGISTRATION.md` §10 was not invoked.

Produced under `PREREGISTRATION.md` §§1–11 against frozen code `a376808`, with
the environment controls of §5-b. Data: `bench/results/t702-m1-final.jsonl`,
manifest `…manifest.json` (`status: final`), 60 transcripts committed alongside.

---

## Result

| arm | re-proposed | rate | Wilson 95% CI |
|---|---|---|---|
| `commitlore-on` | 5 / 30 | 16.7% | 7.3% – 33.6% |
| `commitlore-off` | 7 / 30 | 23.3% | 11.8% – 40.9% |

**Fisher exact, two-tailed: p = 0.7480.** Rate difference −6.7pp, 95% CI
[−26.6pp, +13.8pp].

**The hypothesis is not supported at α = 0.05.** The direction is the one the
hypothesis predicted — the treatment arm re-proposed less — but the interval
spans zero widely and the result is indistinguishable from chance.

Computed twice, independently: `bench/metrics.ts`, and a separate Fisher
implementation validated against five published R values. Both return 0.7480.

§9 requires owner escalation on p ≥ 0.05. **This document is that escalation.**

---

## Which explanation the data supports

§9 requires distinguishing two cases with data. They are not equally supported.

### The matrix could not detect an effect of this size

This is the explanation the data backs.

**Power at n = 30 per arm to detect the observed difference: 5.1%.** That is
barely above α itself. Treating the observed rates as if they were the true
ones:

| n per arm | power |
|---|---|
| 30 (this run) | 5.1% |
| 60 | 10.0% |
| 100 | 16.9% |
| 200 | 33.7% |
| 400 | 62.5% |
| 800 | 90.7% |

An experiment with a 5% chance of detecting its own effect has not tested the
hypothesis. It has reported that it cannot see.

**Four of ten tasks are silent** — neither arm ever re-proposed across three
seeds:

| task | on | off |
|---|---|---|
| `reproposal-index-server` | 0/3 | 3/3 |
| `reproposal-jwt-sessions` | 0/3 | 1/3 |
| `reproposal-llm-projection` | 0/3 | 0/3 · silent |
| `reproposal-node20-floor` | 1/3 | 2/3 |
| `reproposal-prisma-orm` | 1/3 | 1/3 |
| `reproposal-rabbitmq-queue` | 2/3 | 0/3 |
| `reproposal-redis-cache` | 0/3 | 0/3 · silent |
| `reproposal-sigstore-signing` | 1/3 | 0/3 |
| `reproposal-static-global-context` | 0/3 | 0/3 · silent |
| `reproposal-winston-logger` | 0/3 | 0/3 · silent |

**The control re-proposed at all in only 4 of 10 tasks.** The design assumed
there would be much more to prevent: the registered threshold of 6/30 was
derived assuming the treatment arm would sit at zero, and the control arm never
approached the rate that assumption needed.

### The hypothesis is wrong

Weakly supported, and not separable from the above at this n.

Both arms re-proposed at rates that overlap heavily, which is the shape a false
hypothesis produces. But it is also the shape an underpowered test produces
when the true effect is small, and nothing here separates the two.

Two tasks ran against the hypothesis — `reproposal-rabbitmq-queue` (on 2/3,
off 0/3) and `reproposal-sigstore-signing` (on 1/3, off 0/3). Reported because
§9 forbids softening a result in that direction. At three runs per cell these
are not evidence of anything on their own, and §4 forbids computing a p-value
on a subset to find out.

**Conclusion: inconclusive, not refuted.** The distinction matters because it
points at the design rather than at the protocol.

---

## What this result does not say

- **Nothing about route scoping.** `bench/context.ts` never path-scopes; it
  assembles every record in the workspace. This measured *records versus no
  records*, not *scoped injection versus unscoped*. (#36)
- **Nothing about other models.** One model, one CLI version. Re-proposal is a
  behaviour.
- **Nothing comparable to the pilot.** The pilot ran without environment
  control (§11-5).
- **CPAA is not measured.** No denominator: `harvest` carries no model by
  design, so no bench row prices it.

The one floor argument that survives is §7 silent-task dilution — and at 4 of
10 silent, it is doing real work here. Limitation §11-1 was withdrawn before
results were seen; this task set carries zero off-path records.

---

## What the owner is being asked to decide

ADR-0007 states that if this measurement fails, the project changes direction.
It did not fail cleanly — it came back **unable to answer**, which is a
different decision.

1. **Redesign and re-run**, or **accept the null and change direction.** The
   power table says a re-run at this effect size needs roughly 400–800 runs per
   arm to be worth running. At ~90s per run that is 20–40 hours of wall clock
   for one arm pair.
2. **Fix the task set first, if re-running.** Four silent tasks contribute
   nothing but dilution. The discriminating property is already written down in
   `bench/README.md`: a task measures nothing unless its symptom cannot be
   resolved without confronting the rejected decision. Four tasks do not meet
   it.
3. **Ship v0.1.0 with this number, either way.** The README carries p = 0.7480
   and this document. A protocol whose own benchmark came back inconclusive and
   says so is the only version of it worth publishing.

No recommendation is offered on (1). That is the direction-change decision
ADR-0007 reserved for the owner.
