/**
 * The common capture prompt and its leakage guard — #1040 and #1038 §3,
 * revision `native-efficacy-r6.1`.
 *
 * Leakage is the failure that invalidates everything quietly: an arm that saw
 * the next task, the target label, the checker or the reference solution did not
 * capture anything, and no results file would look wrong.
 *
 *   - "The capture prompt builder receives only common prior discussion, source
 *      locations and staged-change context. It does not receive arm name, target
 *      decision labels, next task, checks, reference solution or desired
 *      savings."
 *   - "Capture actors see only prior discussion and staged change, NEVER
 *      next_request, target-unit IDs, labels, checker, future PR solution or
 *      reference patch."
 *   - "Use the same natural instruction."
 */

import { describe, expect, it } from 'vitest';

import {
  assertNoLeak,
  buildCapturePrompt,
  capturePrompt,
  CAPTURE_INSTRUCTION,
  type LeakSecret,
} from '../bench/de/prompt.ts';

const input = {
  discussion: 'We keep the public name `fetchUser` for legacy clients; v2 may rename it.',
  sourceLocations: ['api.ts', 'DISCUSSION.md'],
  stagedContext: 'api.ts is staged with the new overload.',
};

const secrets: LeakSecret[] = [
  { kind: 'next_request', value: 'Add pagination to the user listing endpoint' },
  { kind: 'unit_label', value: 'unit-keeps-public-name' },
  { kind: 'check_id', value: 'keeps-public-name' },
  { kind: 'reference_patch', value: 'export const fetchUserPage = ' },
];

describe('#1040 both arms get the same natural instruction', () => {
  it('leads with the instruction verbatim', () => {
    // A constant rather than a template: an instruction that varied per arm
    // would be a second intervention nobody declared.
    expect(buildCapturePrompt(input).startsWith(CAPTURE_INSTRUCTION)).toBe(true);
  });

  it('is identical whichever arm is about to run it', () => {
    // There is no arm parameter to vary, which is the point.
    expect(buildCapturePrompt(input)).toBe(buildCapturePrompt({ ...input }));
  });

  it('carries the discussion, the source locations and the staged context', () => {
    const prompt = buildCapturePrompt(input);

    expect(prompt).toContain('fetchUser');
    expect(prompt).toContain('- api.ts');
    expect(prompt).toContain('staged with the new overload');
  });

  it('labels the discussion as replay rather than as a live session', () => {
    // "#1038 §3: label replay". A forged transcript would make the actor
    // believe it was there.
    expect(buildCapturePrompt(input)).toContain('(replay)');
    expect(CAPTURE_INSTRUCTION).toContain('replayed reference material');
  });

  it('grants no extra permission with the replay', () => {
    expect(CAPTURE_INSTRUCTION).toContain('not additional execution permission');
  });
});

describe('#1038 §3 the actor never sees what would tell it the answer', () => {
  it('passes a clean prompt', () => {
    expect(() => capturePrompt(input, secrets)).not.toThrow();
  });

  it('refuses a prompt carrying the next request', () => {
    const leaked = { ...input, discussion: `${input.discussion}\nNext: Add pagination to the user listing endpoint` };

    expect(() => capturePrompt(leaked, secrets)).toThrow(/next_request/);
  });

  it('refuses a prompt carrying a target unit label', () => {
    const leaked = { ...input, stagedContext: 'relates to unit-keeps-public-name' };

    expect(() => capturePrompt(leaked, secrets)).toThrow(/unit_label/);
  });

  it('refuses a prompt carrying a check id', () => {
    const leaked = { ...input, sourceLocations: [...input.sourceLocations, 'checks/keeps-public-name.ts'] };

    expect(() => capturePrompt(leaked, secrets)).toThrow(/check_id/);
  });

  it('refuses a prompt carrying the reference solution', () => {
    const leaked = { ...input, stagedContext: 'export const fetchUserPage = (page: number) => page;' };

    expect(() => capturePrompt(leaked, secrets)).toThrow(/reference_patch/);
  });

  it('names every leak it found rather than the first', () => {
    const leaked = {
      ...input,
      discussion: 'Next: Add pagination to the user listing endpoint',
      stagedContext: 'see unit-keeps-public-name',
    };

    // Three, not two: `unit-keeps-public-name` contains the check id
    // `keeps-public-name`, so both secrets are genuinely present in the bytes.
    // Overlapping secrets each report rather than the longest swallowing the
    // rest, because a reader repairing this needs every one of them named.
    expect(() => capturePrompt(leaked, secrets)).toThrow(/3 thing\(s\)/);
  });

  it('matches regardless of case', () => {
    // The question is whether the bytes are there for a model to read, not
    // whether they were written the same way.
    const leaked = { ...input, stagedContext: 'UNIT-KEEPS-PUBLIC-NAME applies here' };

    expect(() => capturePrompt(leaked, secrets)).toThrow(/unit_label/);
  });
});

describe('#1038 §3 the guard refuses to be useless', () => {
  it('rejects a secret too short to search for', () => {
    // `off` is an arm name and an ordinary English word. Matching it would
    // refuse every honest prompt that says "hand off", and a guard that cries
    // wolf is one somebody turns off; arm names are kept out by construction.
    expect(() => assertNoLeak('anything', [{ kind: 'arm_name', value: 'off' }])).toThrow(
      /too short to search for/,
    );
  });

  it('says nothing when there is nothing to find', () => {
    expect(() => assertNoLeak(buildCapturePrompt(input), [])).not.toThrow();
  });
});
