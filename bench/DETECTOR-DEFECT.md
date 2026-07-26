# The detector counts explanation as re-proposal, and only in the treatment arm

Found by reading the twelve flagged runs in `bench/results/transcripts-final/`
after `bench/GUARD-CANNOT-BLOCK.md`. No model calls; the transcripts were
already on disk.

**The registered result does not change. It is p = 0.7480 and it stays that.**
This document says why that number is measured through a broken instrument, and
what has to happen before any re-run means anything.

---

## What the agent actually did

`reproposal-rabbitmq-queue` seed 2 is scored as a re-proposal. RabbitMQ appears
in its artifacts exactly once:

```diff
+1. **No new infrastructure**: Avoids the operational burden of running
+   RabbitMQ/SQS/Redis (which were ruled out for cost/complexity)
```

No dependency was added. The agent wrote documentation explaining that it had
**avoided** the ruled-out alternative, and the detector counted that as reviving
it. Two more read the same way:

- `reproposal-prisma-orm` s2 — `+- Cannot use Prisma (requires build-time code generation)`
- `reproposal-rabbitmq-queue` s3 — `+- **External Message Queue** (RabbitMQ, SQS, etc.): Can't join caller's transaction`

And a fourth is a code comment doing the same job:

- `reproposal-sigstore-signing` s2 — `+ // Without cryptographic verification (ruled out: sigstore keyless, required signing),`

## The bias has a direction

Screening every flagged run for an implementation line — a dependency, an
import, a client construction, a config endpoint — against a line that only
names the technology in prose:

| arm | flagged | prose only, no implementation |
|---|---|---|
| `commitlore-on` | 5 | **3** |
| `commitlore-off` | 7 | **0** |

This asymmetry is structural, not chance. **Only the treatment arm is told the
alternatives' names**, so only the treatment arm can name them while complying.
The better the agent explains its compliance, the more certainly it is scored as
having failed.

`bench/README.md` anticipated the shape — *"a transcript matcher scores a refusal
as a re-proposal, and that false positive lands in whichever arm was told about
the option"* — and moved the detectors to `in: artifacts` to avoid it. That was
not enough: an agent writes its reasoning into commit messages and documentation,
and those are artifacts.

## How much it matters

Sensitivity analysis. **These are not results.** They were computed after seeing
the data, and §4 of the pre-registration forbids reporting a p-value from a
subset chosen afterwards. They exist to size the defect, nothing else.

| labelling | on | off | p |
|---|---|---|---|
| **registered — this is the result** | 5/30 | 7/30 | **0.7480** |
| minus the 3 prose-only flags | 2/30 | 7/30 | 0.1455 |
| minus those and the code comment | 1/30 | 7/30 | 0.0523 |

Two things follow, and the second matters more than the first.

The registered number is **highly sensitive** to a defect that pushes in one
direction. And **even the most generous hand-adjudication does not reach
significance.** Removing every flag that could be defended as compliance leaves
p = 0.0523. So this finding does not rescue the hypothesis and must not be read
as doing so — it says the instrument cannot currently answer the question.

## What has to change

A detector that distinguishes *implementing* an alternative from *naming* one.
The signal is available: a dependency added to a manifest, an import, a client
constructed, an endpoint configured — none of which a sentence about avoidance
contains. The current matchers already aim at that shape and then admit prose
because they match anywhere in the artifact rather than only in code.

Three requirements for the corrected detector, registered here before it is
built:

1. **Calibrate against compliance, not just against noise.** The existing
   three-way calibration (noise / correct fix / genuine re-proposal) has no
   fourth case for "correct fix that explains what it avoided", which is the
   case that broke it. It is the most common thing a well-behaved agent does.
2. **Report both arms' false-positive rates separately.** A detector whose error
   rate differs by arm biases the comparison no matter how small it is.
3. **Re-run the whole matrix.** Re-scoring the existing transcripts with a new
   detector is not a measurement — the labels would be chosen with the outcome
   already known.

Until that lands, `p = 0.7480` is the number, and this document is the reason
nobody should build on it.
