---
document_id: cdeb-fresh-v5-stage1-r1-host-isolation
study_id: cdeb-fresh-v5
stage: stage1-r1
status: method-registered-before-use
measured_run_allowed: false
---

# There is no isolated host, so isolation has to be a measured precondition

The acceptance-determinism protocol asks for a hundred runs on a host where
nothing else is happening. This study does not have such a host, and saying so
plainly is the first half of the method.

## What the host actually is

Twelve logical cores, eight performance and four efficiency. It runs the
orchestrating session, whatever else its owner is doing, and a set of containers
that belong to other work — six of them Buzz infrastructure that this study is
not permitted to stop, since it is the only channel the study reports through.

Load average over one working session moved between **4.3 and 161**. The high
end was not ambient: five containers at roughly one core each, plus this study's
own six concurrent adjudication agents. That last part matters more than it
looks, and it is the first lever.

## The three levers, in the order they were worth pulling

### 1. Stop being the load

The single largest contributor to the interference was the study itself. Six
adjudication workers, each driving an agent and then a full test suite, on a
twelve-core machine. Reducing concurrency to one during a measurement took the
load from 141 to 6 without anyone else changing what they were doing.

An acceptance measurement now runs alone: no adjudication agent, no second
repository, no other acceptance run. This costs wall-clock and buys the only
part of the environment the study controls outright.

### 2. Gate on measured ambient load rather than assuming it

A sampler records the one-minute load average every ten seconds to
`iso/load.tsv`. It does one `sysctl` and one append per sample, deliberately
small enough not to become part of what it measures.

Before a measurement starts, the gate requires every sample in the preceding two
minutes to sit below a registered ceiling, with at least eight samples present.
Three properties are load-bearing:

- **It is a precondition, not a monitor.** Once acceptance starts, the load it
  generates is its own and says nothing about interference.
- **It uses the peak, not the mean.** A two-minute window whose mean is quiet and
  whose peak is 23 contains a spike, and a spike is what starves a test that
  measures its own CPU time.
- **Insufficient samples is BUSY, not quiet.** Absence of evidence is not the
  evidence of absence, and a fresh log would otherwise read as an idle machine.

The ceiling is registered in `acceptance-load-sensitivity-design.json` before any
run, and the load at each run is recorded beside its result. A reader can see
what "quiet" meant on the day instead of trusting the word.

### 3. Make load an independent variable

Gating alone cannot answer the question that matters. agent-control-plane's suite
produced 9, 9, **11**, 9 failures on the unmodified tree, and until load is
controlled there is no way to tell whether that is the machine or the suite. More
uncontrolled runs produce more uninterpretable runs.

So a load generator applies a known synthetic load — one busy process per logical
core — and the same command runs in both conditions. That turns the thing that
was contaminating the measurement into the thing being measured.

The arms alternate rather than running in blocks, because the QUIET arm waits by
construction and would otherwise all land later in the day than the LOADED arm.

## What each outcome means

| result | reading |
| --- | --- |
| identical failure sets in both arms | the suite is stable; the earlier disagreement needs another explanation |
| differs only under load | load-induced; gate and proceed, and the two negative verdicts taken under uncontrolled load are void |
| differs under quiet too | intrinsic; section 8 applies and the repository's stratum empties |

## What this is not

It is not the determinism protocol. Ten runs per arm is a diagnostic that decides
whether the protocol can be run here at all; the protocol asks for a hundred and
has not been run for any repository.

It is also not isolation in the sense the protocol means. A gated quiet window on
a shared machine is weaker than a dedicated host, and the honest name for what
this achieves is *a measured and recorded precondition* rather than *an isolated
environment*.

## The asymmetry that makes the residual risk one-directional

Across the four uncontrolled runs the anomaly only ever **added** failures — no
run produced fewer than the baseline nine. Interference of that shape can turn a
passing revival into a failing one and cannot do the reverse.

So whatever this method fails to exclude, it cannot have manufactured a passing
revival. The direction of any error left behind is toward understating how
violable the corpus is, which is the same direction every other correction in
this census has run.
