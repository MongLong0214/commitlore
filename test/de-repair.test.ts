/**
 * The repair selector's seven rules and their order — #1042, revision
 * `native-efficacy-r6.1`.
 *
 * Transcribed from the issue body, not read back from `repair.ts`.
 *
 * The order is the contract, so most of these cases are precedence cases: each
 * one sets up a later rule's trigger and checks that an earlier rule still wins.
 * A selector written as independent conditions passes a rule-by-rule test and
 * still launches repairs the policy forbids, which is the defect this file is
 * shaped to catch.
 */

import { describe, expect, it } from 'vitest';

import {
  chooseRepair,
  type CheckpointStatus,
  type HandoffStatus,
  type NormalizedFeedback,
  type SolveExecution,
} from '../bench/de/repair.ts';
import type { ArtifactVerdict } from '../bench/de/scoring.ts';

/** A feedback-only verdict. `score` is what the rules read. */
const verdict = (score: boolean | null, over: Partial<ArtifactVerdict> = {}): ArtifactVerdict => ({
  score,
  coverage: score === null ? 'partial' : 'complete',
  observed: [{ purpose: 'feedback', id: 'c1', passed: score !== false }],
  unobserved: score === null ? [{ purpose: 'feedback', id: 'c2' }] : [],
  untrusted: [],
  ...over,
});

const feedback = (over: Partial<NormalizedFeedback> = {}): NormalizedFeedback => ({
  trusted: true,
  verdict: verdict(false),
  public_explanation: true,
  environment_fault: false,
  ...over,
});

/** The state in which rule 6 fires, so a precedence case only changes one thing. */
const repairable = {
  handoff: 'valid' as HandoffStatus,
  solve: 'completed' as SolveExecution,
  feedback: feedback(),
  checkpoint: 'complete' as CheckpointStatus,
};

const choose = (over: Partial<typeof repairable> = {}) => {
  const state = { ...repairable, ...over };
  return chooseRepair(state.handoff, state.solve, state.feedback, state.checkpoint);
};

describe('#1042 the baseline: rule 6 fires on a repairable failure', () => {
  it('performs one repair for a trusted required failure with an explanation', () => {
    expect(choose()).toMatchObject({ decision: 'repair', rule: 6 });
  });

  it('repairs a source-build failure whose dependent checks are null', () => {
    // "including source-build failure with dependent null checks". The build
    // check is itself a trusted failure, so the score is false while coverage
    // stays partial -- the row that a coverage-driven selector would skip.
    const buildFailure = feedback({
      verdict: {
        score: false,
        coverage: 'partial',
        observed: [{ purpose: 'feedback', id: 'build', passed: false }],
        unobserved: [{ purpose: 'feedback', id: 'unit' }],
        untrusted: [],
      },
    });

    expect(choose({ feedback: buildFailure })).toMatchObject({ decision: 'repair', rule: 6 });
  });
});

describe('#1042 rule 1 outranks everything', () => {
  it('returns terminal_handoff even when the feedback would trigger a repair', () => {
    expect(choose({ handoff: 'terminal_failure' })).toMatchObject({ decision: 'terminal_handoff', rule: 1 });
  });

  it('returns terminal_handoff even when every check passed', () => {
    expect(choose({ handoff: 'terminal_failure', feedback: feedback({ verdict: verdict(true) }) })).toMatchObject({
      decision: 'terminal_handoff',
      rule: 1,
    });
  });
});

describe('#1042 rule 2: nothing was established to repair', () => {
  it('is not eligible when the handoff is unknown', () => {
    expect(choose({ handoff: 'unknown' })).toMatchObject({ decision: 'not_eligible', rule: 2 });
  });

  it('is not eligible when the first solve never started', () => {
    expect(choose({ solve: 'unstarted' })).toMatchObject({ decision: 'not_eligible', rule: 2 });
  });

  it('is not eligible when the solve was interrupted independently', () => {
    expect(choose({ solve: 'interrupted' })).toMatchObject({ decision: 'not_eligible', rule: 2 });
  });

  it('does not treat a product-owned failure as rule 2', () => {
    // "A product-owned refusal/error or a declared resource stop is not
    // automatically category2. If handoff is valid, first code/checkpoint is
    // stable and valid public feedback establishes a repairable failure, use the
    // same bounded repair policy." A product refusal shows up as a failed check,
    // not as an interrupted execution, so the selector reaches rule 6.
    const productRefusal = feedback({
      verdict: {
        score: false,
        coverage: 'complete',
        observed: [{ purpose: 'feedback', id: 'c1', passed: false, detail: 'product refused the operation' }],
        unobserved: [],
        untrusted: [],
      },
    });

    expect(choose({ solve: 'completed', feedback: productRefusal })).toMatchObject({ decision: 'repair', rule: 6 });
  });
});

describe('#1042 rule 3: a checkpoint is Git and notes, not code alone', () => {
  it('is unavailable when no checkpoint exists', () => {
    expect(choose({ checkpoint: 'unavailable' })).toMatchObject({ decision: 'unavailable', rule: 3 });
  });

  it('is unavailable when the checkpoint lost the first solve commits or notes', () => {
    // #1034: a source diff against the original handoff "is NOT sufficient for
    // repair if it loses the first solve's legitimate commits/notes", and an
    // unavailable checkpoint is never silently replaced with handoff state.
    const chosen = choose({ checkpoint: 'incomplete' });

    expect(chosen).toMatchObject({ decision: 'unavailable', rule: 3 });
    expect(chosen.reason).toMatch(/another stage's memory/);
  });

  it('outranks the feedback rules', () => {
    expect(choose({ checkpoint: 'unavailable', feedback: feedback({ verdict: verdict(true) }) })).toMatchObject({
      rule: 3,
    });
  });
});

describe('#1042 rule 4: untrusted inputs', () => {
  it('is unavailable for a missing, invalid or wrong-snapshot envelope', () => {
    // "do not invent feedback from private logs"
    expect(choose({ feedback: feedback({ trusted: false }) })).toMatchObject({ decision: 'unavailable', rule: 4 });
  });

  it('is unavailable when the evaluation environment is unsafe', () => {
    expect(choose({ feedback: feedback({ environment_fault: true }) })).toMatchObject({
      decision: 'unavailable',
      rule: 4,
    });
  });

  it('is unavailable when a required failure has no public explanation', () => {
    expect(choose({ feedback: feedback({ public_explanation: false }) })).toMatchObject({
      decision: 'unavailable',
      rule: 4,
    });
  });

  it('does not block a passing result for want of an explanation', () => {
    // Rule 4's explanation clause is about a required failure. A pass with no
    // explanation is rule 5, not unavailable.
    expect(choose({ feedback: feedback({ verdict: verdict(true), public_explanation: false }) })).toMatchObject({
      decision: 'not_triggered',
      rule: 5,
    });
  });
});

describe('#1042 rules 5 and 7: pass and unresolved are different answers', () => {
  it('is not_triggered when every required check passed on trusted feedback', () => {
    expect(choose({ feedback: feedback({ verdict: verdict(true) }) })).toMatchObject({
      decision: 'not_triggered',
      rule: 5,
    });
  });

  it('is unavailable, not not_triggered, when nothing failed but something is unresolved', () => {
    // "No known false and unresolved null -> unavailable." Reading this as a
    // pass would count an unmeasured episode as a success.
    expect(choose({ feedback: feedback({ verdict: verdict(null) }) })).toMatchObject({
      decision: 'unavailable',
      rule: 7,
    });
  });
});

describe('#1042 the hidden audit is never an input', () => {
  it('refuses a verdict carrying an audit observation', () => {
    const combined = feedback({
      verdict: {
        score: false,
        coverage: 'complete',
        observed: [
          { purpose: 'feedback', id: 'c1', passed: false },
          { purpose: 'audit', id: 'c1', passed: true },
        ],
        unobserved: [],
        untrusted: [],
      },
    });

    expect(() => choose({ feedback: combined })).toThrow(/hidden audit is never an input/);
  });

  it('refuses an audit purpose hiding in unobserved or untrusted', () => {
    // The combined verdict can carry the audit without a single observation --
    // a skipped audit appears only as an unobserved check or an untrusted
    // envelope, which is exactly the shape that would slip past an
    // observed-only guard.
    const viaUnobserved = feedback({
      verdict: { ...verdict(false), unobserved: [{ purpose: 'audit', id: 'c1' }] },
    });
    const viaUntrusted = feedback({
      verdict: { ...verdict(false), untrusted: [{ purpose: 'audit', reason: 'missing' }] },
    });

    expect(() => choose({ feedback: viaUnobserved })).toThrow(/hidden audit is never an input/);
    expect(() => choose({ feedback: viaUntrusted })).toThrow(/hidden audit is never an input/);
  });
});

describe('#1042 every answer names the rule that produced it', () => {
  it('reports a rule between 1 and 7 for each reachable decision', () => {
    const answers = [
      choose({ handoff: 'terminal_failure' }),
      choose({ handoff: 'unknown' }),
      choose({ checkpoint: 'unavailable' }),
      choose({ feedback: feedback({ trusted: false }) }),
      choose({ feedback: feedback({ verdict: verdict(true) }) }),
      choose(),
      choose({ feedback: feedback({ verdict: verdict(null) }) }),
    ];

    expect(answers.map((answer) => answer.rule)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const answer of answers) expect(answer.reason).not.toBe('');
  });
});
