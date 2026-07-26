# M2 verdict — the shipped delivery path, and it did worse

**n = 40 per arm registered, 79 rows in the analysis set, 4 of 4 seeds, 80 of 80
runs.** Frozen at `5640748`, §5-b environment controls, zero isolation warnings.

Registered as `PREREGISTRATION.md` §13 **before** the run. M1 (p = 0.7480) and
M1-b (p = 0.0522) are not revised; this is a third measurement with a different
delivery path.

---

## Result

| arm | re-proposed | rate | Wilson 95% CI |
|---|---|---|---|
| `commitlore-on` | 4 / 40 | 10.0% | 4.0% – 23.1% |
| `commitlore-off` | 8 / 39 | 20.5% | 10.8% – 35.5% |

**Fisher exact, two-tailed: p = 0.2247.** Rate difference −10.5pp, 95% Newcombe
interval [−26.7pp, +5.8pp]. Odds ratio 0.4306.

**The hypothesis is not supported at α = 0.05.**

### Analysis set (§3)

One row excluded: `reproposal-index-server` seed 1, `commitlore-off`,
`stopped_by: error`. The unfiltered table is `on 4/40, off 9/40`, and it gives
the same p to four places.

Worth stating plainly: **the excluded row was a control-arm re-proposal.** The
exclusion rule removed a point that favoured the hypothesis, so it cannot be
accused of having been applied to help.

## The delivery path that ships did worse than the one that does not

| | M1 | M1-b | M2 |
|---|---|---|---|
| delivery | session-start block | session-start block | **PreToolUse hook, per edit** |
| detector | `artifacts` | `code` | `code` |
| n per arm | 30 | 30 | 40 |
| `commitlore-on` | 5/30 | 0/30 | 4/40 |
| `commitlore-off` | 7/30 | 5/30 | 8/39 |
| p | 0.7480 | **0.0522** | **0.2247** |

M1-b and M2 share a detector and differ only in how records reach the agent.
M1-b handed the agent everything up front and the treatment arm re-proposed
**zero** times. M2 delivered the way the product actually does — per edit,
scoped to the path — and the treatment arm re-proposed **four** times.

This is the opposite of what the project assumed. ADR-0006 chose push-injection
over a session-start dump on the argument that unscoped context is noise. On
this evidence the session-start dump suppressed re-proposal more, not less.

**Do not over-read it.** n is small, the arms are not significantly different in
either run, and M1-b and M2 differ in sample size as well as delivery. What can
be said is narrow and worth saying: **there is no evidence here that the shipped
delivery path is better than the one the benchmark used before, and some
evidence it is worse.**

## An asymmetry the design introduced

| arm | completed | over-turns | timeout | error |
|---|---|---|---|---|
| `commitlore-on` | 30 | 7 | **3** | 0 |
| `commitlore-off` | 25 | 14 | **0** | 1 |

Every timeout is in the treatment arm. The hook runs on every Edit, so the
treatment arm pays a subprocess spawn per tool call that the control never pays.
Three runs in forty hit the 300s wall.

A timeout truncates a run. A truncated run has had fewer chances to re-propose,
which **flatters** the treatment arm on the registered outcome — so this
asymmetry works in the hypothesis's favour and the result is still null. It also
means the treatment arm's real cost is understated: latency is a cost this
benchmark does not price at all.

## What this does and does not license

- **It does not license dropping the hook.** One 80-run matrix at α = 0.05 is
  not grounds to re-architect delivery. It is grounds to stop assuming.
- **It does not license quoting M2 beside M1-b as a series.** Different
  delivery, different n.
- **It does license retiring one claim**: that per-edit scoped injection is
  self-evidently better than handing the agent everything. It was assumed in
  ADR-0006 and has now been measured once, and the measurement did not agree.

## Limits

- One model, one CLI version.
- Four of ten tasks were silent in both arms in M1 and that has not been
  re-examined here.
- The hook's latency is unpriced; only its effect on timeouts is visible.
- `guard` is still unmeasured (#37). SPEC §5 assigns `Ruled-out:` to it, and
  every measurement so far has been of injection.
