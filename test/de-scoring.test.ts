/**
 * The scoring truth table of #1033 §2, revision `native-efficacy-r6.1`.
 *
 * Every expectation here is transcribed from the issue body, not from
 * `scoring.ts`. A table copied out of the implementation agrees with the
 * implementation's bugs, and the one this study cannot afford is the pair that
 * looks alike in a results file and means opposite things: a check that ran and
 * failed, and an envelope that knows nothing. Salvaging the second as the first
 * would let a missing audit erase a real failure, or a missing audit promote a
 * feedback pass to full success.
 *
 * The issue's table, verbatim:
 *
 *   | Feedback        | Audit           | Artifact score | Coverage                       |
 *   | trusted fail    | missing/invalid | false          | partial                        |
 *   | missing/invalid | trusted fail    | false          | partial                        |
 *   | trusted pass    | missing         | null           | partial                        |
 *   | trusted pass    | trusted fail    | false          | complete if every check observed|
 *   | trusted pass    | trusted pass    | true           | complete                       |
 *   | invalid         | missing         | null           | unavailable                    |
 */

import { describe, expect, it } from 'vitest';

import {
  andThreeValued,
  scoreArtifact,
  type Envelope,
  type Purpose,
  type RequirementContract,
} from '../bench/de/scoring.ts';

const ARTIFACT = 'sha256:artifact-under-test';
const CHECKER = 'checker@r6.1';

const contract = (
  required: Readonly<Record<Purpose, readonly string[]>> = { feedback: ['c1'], audit: ['c1'] },
): RequirementContract => ({
  artifact_id: ARTIFACT,
  checker_revision: CHECKER,
  required_checks: required,
});

/** A checker envelope that ran against the artifact under test. */
const ran = (checks: Array<{ id: string; passed: boolean | null }>): Envelope => ({
  presence: 'present',
  artifact_id: ARTIFACT,
  checker_revision: CHECKER,
  checks,
});

const missing: Envelope = { presence: 'missing' };

/**
 * Carries a `false` on purpose. Presence decides trust, not the payload — an
 * envelope that half-parsed still knows nothing, and a fixture with no checks
 * in it would pass against a module that salvages them.
 */
const unparsable: Envelope = {
  presence: 'unparsable',
  artifact_id: ARTIFACT,
  checker_revision: CHECKER,
  checks: [{ id: 'c1', passed: false }],
};

describe('#1033 §2 the scoring truth table', () => {
  it('trusted fail + missing audit is false on partial coverage', () => {
    const verdict = scoreArtifact(contract(), { feedback: ran([{ id: 'c1', passed: false }]), audit: missing });

    expect(verdict.score).toBe(false);
    expect(verdict.coverage).toBe('partial');
    expect(verdict.untrusted).toEqual([{ purpose: 'audit', reason: 'missing' }]);
  });

  it('missing feedback + trusted fail is false on partial coverage', () => {
    const verdict = scoreArtifact(contract(), { feedback: missing, audit: ran([{ id: 'c1', passed: false }]) });

    expect(verdict.score).toBe(false);
    expect(verdict.coverage).toBe('partial');
  });

  it('trusted pass + missing audit is null, never true', () => {
    // The row that a two-valued design gets wrong in the expensive direction:
    // a pass with half the evidence is not success.
    const verdict = scoreArtifact(contract(), { feedback: ran([{ id: 'c1', passed: true }]), audit: missing });

    expect(verdict.score).toBeNull();
    expect(verdict.coverage).toBe('partial');
  });

  it('trusted pass + trusted fail is false, and complete when every check was observed', () => {
    const verdict = scoreArtifact(contract(), {
      feedback: ran([{ id: 'c1', passed: true }]),
      audit: ran([{ id: 'c1', passed: false }]),
    });

    expect(verdict.score).toBe(false);
    expect(verdict.coverage).toBe('complete');
  });

  it('trusted pass + trusted pass is true on complete coverage', () => {
    const verdict = scoreArtifact(contract(), {
      feedback: ran([{ id: 'c1', passed: true }]),
      audit: ran([{ id: 'c1', passed: true }]),
    });

    expect(verdict.score).toBe(true);
    expect(verdict.coverage).toBe('complete');
    expect(verdict.unobserved).toEqual([]);
  });

  it('invalid feedback + missing audit is null on unavailable coverage', () => {
    const verdict = scoreArtifact(contract(), { feedback: unparsable, audit: missing });

    expect(verdict.score).toBeNull();
    expect(verdict.coverage).toBe('unavailable');
    expect(verdict.observed).toEqual([]);
  });
});

describe('#1033 §2 an untrusted envelope contributes no result', () => {
  // "A missing/invalid/wrong-snapshot envelope contributes NO trusted result;
  // never salvage its arbitrary `false`." Each of these carries a `false` that
  // must not reach the score -- if any did, the case above it would pass for
  // the wrong reason, so these are the controls for the whole module.

  it('does not salvage a false from an envelope describing another snapshot', () => {
    const verdict = scoreArtifact(contract(), {
      feedback: { ...ran([{ id: 'c1', passed: false }]), artifact_id: 'sha256:some-other-tree' },
      audit: ran([{ id: 'c1', passed: true }]),
    });

    expect(verdict.score).toBeNull();
    expect(verdict.coverage).toBe('partial');
    expect(verdict.untrusted).toEqual([
      { purpose: 'feedback', reason: 'wrong_artifact', saw: 'sha256:some-other-tree' },
    ]);
  });

  it('does not salvage a false from an envelope produced by another checker revision', () => {
    const verdict = scoreArtifact(contract(), {
      feedback: { ...ran([{ id: 'c1', passed: false }]), checker_revision: 'checker@r6' },
      audit: ran([{ id: 'c1', passed: true }]),
    });

    expect(verdict.score).toBeNull();
    expect(verdict.untrusted).toEqual([{ purpose: 'feedback', reason: 'wrong_checker', saw: 'checker@r6' }]);
  });

  it('does not salvage a false from an unparsable envelope', () => {
    const verdict = scoreArtifact(contract(), { feedback: unparsable, audit: ran([{ id: 'c1', passed: true }]) });

    expect(verdict.score).toBeNull();
    expect(verdict.observed.map((check) => check.purpose)).toEqual(['audit']);
  });
});

describe('#1033 §2-§3 a non-observation is not a failure', () => {
  it('scores false from the build failure itself while its dependents stay unobserved', () => {
    // "A source-build failure with dependent checks null is a trusted failure
    // when emitted by the valid checker." The failure is the build check; the
    // dependents are absent, so coverage is partial rather than complete.
    const verdict = scoreArtifact(contract({ feedback: ['build', 'unit', 'lint'], audit: [] }), {
      feedback: ran([
        { id: 'build', passed: false },
        { id: 'unit', passed: null },
        { id: 'lint', passed: null },
      ]),
      audit: ran([]),
    });

    expect(verdict.score).toBe(false);
    expect(verdict.coverage).toBe('partial');
    expect(verdict.unobserved).toEqual([
      { purpose: 'feedback', id: 'unit' },
      { purpose: 'feedback', id: 'lint' },
    ]);
  });

  it('keeps an environment fault out of the score instead of reading it as a failed assertion', () => {
    // "An environment fault cannot be encoded as a fake assertion failure."
    // Carried as null it leaves the artifact unjudged; were it carried as false
    // this case would read `false` and a broken runner would look like a broken
    // artifact.
    const verdict = scoreArtifact(contract({ feedback: ['c1'], audit: [] }), {
      feedback: ran([{ id: 'c1', passed: null }]),
      audit: ran([]),
    });

    expect(verdict.score).toBeNull();
    expect(verdict.coverage).toBe('unavailable');
  });

  it('counts a required check the checker never mentioned as unobserved', () => {
    const verdict = scoreArtifact(contract({ feedback: ['c1', 'c2'], audit: [] }), {
      feedback: ran([{ id: 'c1', passed: true }]),
      audit: ran([]),
    });

    expect(verdict.score).toBeNull();
    expect(verdict.coverage).toBe('partial');
    expect(verdict.unobserved).toEqual([{ purpose: 'feedback', id: 'c2' }]);
  });
});

describe('#1033 §2 each purpose is normalised against its own expected check IDs', () => {
  it('does not let a feedback answer discharge the audit obligation of the same id', () => {
    // The same identifier under both purposes is two obligations. A flat list
    // would report `complete` here, which is the shape that lets a skipped
    // audit disappear.
    const verdict = scoreArtifact(contract({ feedback: ['c1'], audit: ['c1'] }), {
      feedback: ran([{ id: 'c1', passed: true }]),
      audit: ran([]),
    });

    expect(verdict.score).toBeNull();
    expect(verdict.coverage).toBe('partial');
    expect(verdict.unobserved).toEqual([{ purpose: 'audit', id: 'c1' }]);
  });
});

describe('#1039 §3 a purpose with nothing required contributes nothing', () => {
  // Found the first time the modules were wired together, not by these cases:
  // scoring the feedback purpose alone still recorded a missing *audit*
  // envelope as untrusted, and `chooseRepair` refuses any verdict carrying an
  // audit observation. The caller could not build a feedback-only verdict at
  // all, which made that guard unsatisfiable rather than protective.

  it('does not report an unrequired purpose as untrusted', () => {
    const verdict = scoreArtifact(contract({ feedback: ['c1'], audit: [] }), {
      feedback: ran([{ id: 'c1', passed: true }]),
      audit: missing,
    });

    expect(verdict.untrusted).toEqual([]);
    expect(verdict.unobserved).toEqual([]);
    expect(verdict.score).toBe(true);
    expect(verdict.coverage).toBe('complete');
  });

  it('still reports a missing envelope as untrusted when that purpose was required', () => {
    // The row of the table above is untouched: an envelope nobody asked for is
    // irrelevant, one that was asked for and did not arrive is not.
    const verdict = scoreArtifact(contract({ feedback: ['c1'], audit: ['c1'] }), {
      feedback: ran([{ id: 'c1', passed: true }]),
      audit: missing,
    });

    expect(verdict.untrusted).toEqual([{ purpose: 'audit', reason: 'missing' }]);
    expect(verdict.score).toBeNull();
    expect(verdict.coverage).toBe('partial');
  });
});

describe('#1033 §2 the first workflow score', () => {
  it('is false for a definitively failed handoff even though solve never ran', () => {
    expect(andThreeValued(false, null)).toBe(false);
  });

  it('lets a valid handoff carrying no record proceed to the artifact score', () => {
    // "A successful commit WITHOUT a new record is valid and proceeds."
    // Recording nothing is a complete answer in this product; scoring it as an
    // invalid handoff would measure the study's own assumption.
    expect(andThreeValued(true, true)).toBe(true);
    expect(andThreeValued(true, false)).toBe(false);
  });

  it('is null when the handoff is unknown and nothing failed', () => {
    expect(andThreeValued(null, true)).toBeNull();
    expect(andThreeValued(null, null)).toBeNull();
  });

  it('is false when the artifact failed whatever the handoff is known to be', () => {
    expect(andThreeValued(null, false)).toBe(false);
    expect(andThreeValued(true, false)).toBe(false);
  });
});
