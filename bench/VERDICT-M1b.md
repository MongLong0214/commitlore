# M1-b verdict — corrected detector, and it misses by one run

**n = 30 per arm, 3 of 3 seeds complete, 60 of 60 runs.** Frozen at `1d82a5b`,
environment controls of §5-b, zero isolation warnings, zero errors, zero
timeouts, zero simulated rows, 60 distinct cells with no duplicate.

Registered as `PREREGISTRATION.md` §12 **before** the run. §12 does not revise
M1; that measurement's result is still p = 0.7480. This is a second measurement
with a different instrument and its numbers stand alone.

---

## Result

| arm | re-proposed | rate | Wilson 95% CI |
|---|---|---|---|
| `commitlore-on` | **0 / 30** | 0.0% | 0.0% – 11.4% |
| `commitlore-off` | **5 / 30** | 16.7% | 7.3% – 33.6% |

**Fisher exact, two-tailed: p = 0.0522.** Rate difference −16.7pp, 95% Newcombe
interval [−33.6pp, −2.0pp]. Odds ratio not estimable (cell a is zero).

**The hypothesis is not supported at α = 0.05.** The registered test is Fisher
exact (§2) and it does not reject. That is the verdict.

It misses by **one run**. §10, written before any data existed, put the control
threshold at 6/30 when the treatment arm sits at zero — 6/30 gives p = 0.0237,
5/30 gives p = 0.0522. The control arm produced five.

Computed twice: `bench/metrics.ts` and an independent Fisher implementation
checked against five published R values. Both return 0.0522.

### The interval and the test disagree, and the test governs

The Newcombe interval excludes zero; the Fisher p does not clear α. That is an
ordinary consequence of two different procedures on a table with a zero cell —
Fisher exact is the conservative one. §2 names Fisher as **the** test and names
the interval as effect size. Reading the interval as though it were the verdict
would be choosing the favourable procedure after seeing the numbers, which is
what §4 exists to forbid. **Not significant.**

## What changed from M1, and what it means

| | M1 | M1-b |
|---|---|---|
| detector surface | `artifacts` (diff + commits) | `code` (added lines, no docs, no comments) |
| `commitlore-on` | 5 / 30 | **0 / 30** |
| `commitlore-off` | 7 / 30 | 5 / 30 |
| p | 0.7480 | **0.0522** |

M1's treatment arm was scored on three prose lines in which the agent explained
that it had *avoided* the ruled-out alternative (`DETECTOR-DEFECT.md`). With the
surface corrected, the treatment arm has **no flags at all** — not flags that
turn out to be prose on inspection, but zero.

**§12 requires the per-arm false-positive check, and here it is.** Every one of
the five control-arm flags is an implementation, verified by reading the matched
line:

| run | matched line |
|---|---|
| `index-server` s1 | `this.server = http.createServer((req, res) => {` |
| `index-server` s2 | `"express": "^4.18.0"` and `const app = createServer(config)` |
| `index-server` s3 | `const server = http.createServer((req, res) => {` |
| `node20-floor` s1 | `"engines": { "node": ">=20" }` |
| `node20-floor` s2 | `"engines": { "node": ">=20" }` |

Five for five are code that builds the thing that was ruled out. Zero prose.
The treatment arm contributes nothing to this table because it has nothing in
it.

## What this does and does not license

**It does not license claiming the effect is real.** p = 0.0522 is not 0.049,
and a result that misses by one run is exactly the case where a project talks
itself into the answer it wanted. The number goes in the README as it is.

**It does not license quoting M1-b beside M1.** Different instruments.

**It does license one specific thing**: the M1 result should no longer be cited
as evidence about the hypothesis. It measured an instrument that counted
compliance as failure, in the arm that could uniquely produce that failure. M1-b
is the measurement; M1 is the reason M1-b exists.

## What would settle it

The design is now the binding constraint rather than the detector. With the
treatment arm at a true zero, the control arm needs 6 of 30 to clear α, and it
produced 5. The power table in §10 says a third seed pair — n = 40 per arm —
moves the required control count to a proportion the observed rate already
clears. That is a pre-registered extension of the same matrix, not a new design,
and it is the smallest honest next step.

Four of ten tasks were silent in both arms in M1. That is unchanged here and is
still the largest source of dilution.

## Limits carried forward

- One model (`claude-haiku-4-5-20251001`), one CLI version.
- `code` inherits the honest limit of any lexical surface: an alternative
  implemented under another name is invisible; one named in a string literal is
  counted.
- This matrix measures records against no records, not scoped injection against
  unscoped — `bench/context.ts` never path-scopes (#36).
- §11 as amended, including the withdrawal of §11-1.
