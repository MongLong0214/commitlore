---
document_id: cdeb-fresh-v6-result
study_id: cdeb-fresh-v6
status: TERMINAL_HOLD_FINAL
measured_product_effect_rows: 0
document_date: 2026-08-24
---

# CDEB-Fresh v6 — TERMINAL_HOLD_FINAL

The study stopped at its task-buildability gate. It never ran an episode, so it
says nothing about whether automatic decision delivery helps an agent. What it
does say is why it could not ask.

## The number

Thirty-four decisions entered. Each was given a fresh maintenance task written
by a session that had never seen the decision, and each task was verified to
fail on the untouched tree before anything else happened.

| disposition | candidates |
| --- | ---: |
| `TASK_BUILDABLE` | 17 |
| `no-functionally-passing-violation-for-frozen-task` | 8 |
| `no-two-compliant-controls` | 5 |
| `task-already-satisfied-by-base` | 3 |
| `candidate-decision-visible-to-task-author` | 1 |

| repository | task buildable | floor | |
| --- | ---: | ---: | --- |
| agent-operator-score | 8 | 10 | short |
| gitseed | 9 | 10 | short |
| **total** | **17** | **22** | **short** |

The floors were written into `PREREGISTRATION.md` while the study held zero
tasks and zero controls — the only moment they could have been set honestly.
They were not adjusted to fit seventeen.

## What the eight failures are

They are the result, not the obstacle to it. In six of the eight a builder wrote
the violating implementation, hit a test, and named it:

```text
tests/test_category.py:71
tests/test_cli.py:579
tests/test_collect.py:162, :279
tests/test_model_choice.py:188
packages/schema/test/issuance-contract.test.ts:524-527
scripts/validate-planning.mjs:783
```

Not a governance document among them. Each is a test asserting the behaviour the
decision chose. An agent doing the task in that repository cannot take the
ruled-out path and still pass its suite.

One further candidate passed both acceptances and was excluded anyway, because
two blind judges agreed its implementation does not violate the decision. A
passing implementation is not automatically a violation, and counting it as one
would have made agent-operator-score nine instead of eight — still short, and
short for the wrong reason.

## What v5 measured and what v6 added

v5 asked whether these wrong paths were functionally violable at all, and found
34 of 62. v6 asked a harder question of those 34: can the wrong path be taken
**while doing a neutral task** authored by someone who did not know the
decision. Seventeen survive.

v5 was not wrong. A violation reachable in isolation is not always reachable
while doing something else, and the difference between the two numbers is the
part of the corpus where the decision is enforced by the work rather than by
memory.

## What this bounds

For roughly half of this corpus, automatic decision delivery has nothing to
prevent: the repository's own tests already close the path. That is a real
boundary on where the product can help, and it was measured rather than assumed.

It is also the narrowest possible reading of the result. These two repositories
were selected in v5 for having deterministic test suites, which is correlated
with having thorough ones. A less thoroughly tested codebase would leave more
wrong paths open, and this study cannot say how many.

## Limitations

- **No product effect was measured.** Zero episodes, zero rows. Nothing here
  supports or refutes any claim about CommitLore's effect.
- **The Bad controls are directed violations.** The builder was told which
  approach to take, so this measures whether the ruled-out path can be taken
  deliberately while doing the task — not whether an agent would drift into it.
  The second is the question the experiment would have asked.
- **One frozen commit, two repositories, one snapshot.** The test-enforcement
  finding is a property of those trees on that day.
- **Three instrument defects were found and repaired during execution**, each
  recorded with what it cost: a regression baseline measured on a tree the
  controls never run in, which flipped four sound controls to failures; a
  governance clause that had to be written three times because it kept going to
  the prompt where the failure had just appeared; and a census computation that
  counted unverified stages as failures. The first two are in
  `buildability/regression-baseline-defect.json` and
  `buildability/governance-declined-controls.json`.

## What was not done

No successor is designed. The SSOT registered v6 as the final planned study of
this line, and a further study requires a separate owner decision.

## Artifacts

```text
PREREGISTRATION.md                              floors, endpoint, analysis, claim gate
source-pool.json                                the 34, with the reducer and digest that chose them
registered-acceptance.json                      both suites, baselines, sabotage controls
buildability/task-freeze-manifest.json          task and acceptance digests, frozen before any control
buildability/dispositions.jsonl                 34 rows, one disposition each
buildability/summary.json                       floors and verdict
buildability/validation-report.json             the obstacles, by file and line
buildability/firewall-leak-adjudication.json    blind adjudication of two trees that shared wording
buildability/regression-baseline-defect.json    the defect, the null control, and the four flips
buildability/governance-declined-controls.json  three occurrences of one correction
buildability/directed-violation-limitation.json why judge agreement is high and what it costs
transitions.jsonl                               every state change with input and output digests
deviations.jsonl                                two registered deviations
```
