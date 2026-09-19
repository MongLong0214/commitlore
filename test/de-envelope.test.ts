/**
 * Checker envelope validation — #1038 §4, revision `native-efficacy-r6.1`.
 *
 * Transcribed from the issue body. This is the gate in front of `scoring.ts`:
 * everything here decides whether a candidate's output becomes evidence at all.
 *
 *   - "Do not trust a candidate-provided identity or PASS line."
 *   - "Missing/extra/duplicate rows, malformed JSON, wrong artifact/revision or
 *      contradictory exits invalidate that envelope."
 *   - "An invalid envelope contributes no trusted checks, but cannot erase a
 *      separate VALID envelope's failure."
 *   - "Feedback false rows require nonempty public explanations ... Audit
 *      public_feedback is null."
 *   - "Source syntax/build failure is a legitimate false with dependent checks
 *      null."
 */

import { describe, expect, it } from 'vitest';

import { unparsableEnvelope, validateEnvelope, type CheckDefinition } from '../bench/de/envelope.ts';
import { scoreArtifact } from '../bench/de/scoring.ts';

const ARTIFACT = 'sha256:artifact';
const REVISION = 'checker@r6.1';

const described: CheckDefinition[] = [
  { id: 'build', category: 'request', purpose: 'feedback', requirement_ids: ['r1'] },
  { id: 'keeps-public-name', category: 'decision', purpose: 'feedback', requirement_ids: ['r2'] },
];

const row = (over: Record<string, unknown> = {}) => ({
  id: 'build',
  category: 'request',
  pass: true,
  evidence: 'tsc exited 0',
  public_feedback: null,
  ...over,
});

const envelope = (over: Record<string, unknown> = {}) => ({
  purpose: 'feedback',
  artifact_id: ARTIFACT,
  checker_revision: REVISION,
  environment_error: null,
  exit_code: 0,
  checks: [row(), row({ id: 'keeps-public-name', category: 'decision' })],
  ...over,
});

const validate = (raw: unknown, purpose: 'feedback' | 'audit' = 'feedback') =>
  validateEnvelope({
    purpose,
    artifact_id: ARTIFACT,
    checker_revision: REVISION,
    described: described.map((entry) => ({ ...entry, purpose })),
    raw,
  });

describe('#1038 §4 a well-formed envelope becomes evidence', () => {
  it('accepts every described check with a consistent exit', () => {
    const verdict = validate(envelope());

    expect(verdict.valid).toBe(true);
    if (!verdict.valid) return;
    expect(verdict.envelope.presence).toBe('present');
    expect(verdict.envelope.checks).toHaveLength(2);
  });

  it('hands scoring.ts a shape it can score', () => {
    // One path from raw bytes to a score, rather than two readers whose first
    // disagreement is silent.
    const verdict = validate(envelope());
    if (!verdict.valid) throw new Error('expected a valid envelope');

    const scored = scoreArtifact(
      {
        artifact_id: ARTIFACT,
        checker_revision: REVISION,
        required_checks: { feedback: ['build', 'keeps-public-name'], audit: [] },
      },
      { feedback: verdict.envelope, audit: { presence: 'missing' } },
    );

    expect(scored.score).toBe(true);
    expect(scored.coverage).toBe('complete');
  });
});

describe('#1038 §4 the row set must be exactly what was described', () => {
  it('rejects a missing row', () => {
    const verdict = validate(envelope({ checks: [row()] }));

    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.reasons.join(' ')).toMatch(/keeps-public-name was described and is missing/);
  });

  it('rejects an extra row', () => {
    // An extra row is indistinguishable from renaming one the candidate failed.
    const verdict = validate(
      envelope({ checks: [...envelope().checks, row({ id: 'invented', category: 'request' })] }),
    );

    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.reasons.join(' ')).toMatch(/invented was not described/);
  });

  it('rejects a duplicated row', () => {
    const verdict = validate(envelope({ checks: [row(), row(), row({ id: 'keeps-public-name', category: 'decision' })] }));

    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.reasons.join(' ')).toMatch(/build appears more than once/);
  });

  it('rejects a row whose category disagrees with the definition', () => {
    const verdict = validate(envelope({ checks: [row({ category: 'regression' }), row({ id: 'keeps-public-name', category: 'decision' })] }));

    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.reasons.join(' ')).toMatch(/reports category "regression"/);
  });

  it('rejects a pass value that is not true, false or null', () => {
    const verdict = validate(envelope({ checks: [row({ pass: 'PASS' }), row({ id: 'keeps-public-name', category: 'decision' })] }));

    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.reasons.join(' ')).toMatch(/only true, false or null are results/);
  });
});

describe('#1038 §4 the exit code is a second statement about the same rows', () => {
  it('rejects exit 0 with a failing row', () => {
    // When the two disagree neither can be believed, so the envelope is invalid
    // rather than resolved in favour of one of them.
    const verdict = validate(
      envelope({ exit_code: 0, checks: [row({ pass: false, public_feedback: 'build failed' }), row({ id: 'keeps-public-name', category: 'decision' })] }),
    );

    expect(verdict.valid).toBe(false);
  });

  it('rejects exit 1 with no failing row', () => {
    const verdict = validate(envelope({ exit_code: 1 }));

    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.reasons.join(' ')).toMatch(/exit 1 claims a trustworthy false/);
  });

  it('rejects exit 2 when a row reports false', () => {
    const verdict = validate(
      envelope({ exit_code: 2, checks: [row({ pass: false, public_feedback: 'why' }), row({ id: 'keeps-public-name', category: 'decision', pass: null })] }),
    );

    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.reasons.join(' ')).toMatch(/exit 2 claims unknown with no false/);
  });

  it('rejects exit 0 alongside an environment error', () => {
    const verdict = validate(envelope({ environment_error: 'the registry was unreachable' }));

    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.reasons.join(' ')).toMatch(/environment error/);
  });

  it('rejects an exit code outside the contract', () => {
    const verdict = validate(envelope({ exit_code: 3 }));

    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.reasons.join(' ')).toMatch(/the contract defines 0, 1 and 2/);
  });
});

describe('#1038 §4 a build failure is a legitimate false with null dependents', () => {
  it('accepts exit 1 with a failing build and an unresolved dependent', () => {
    const verdict = validate(
      envelope({
        exit_code: 1,
        checks: [
          row({ pass: false, evidence: 'tsc exited 2: unexpected token', public_feedback: 'the build does not compile' }),
          row({ id: 'keeps-public-name', category: 'decision', pass: null, evidence: 'not reached: build failed' }),
        ],
      }),
    );

    expect(verdict.valid).toBe(true);
    if (!verdict.valid) return;
    expect(verdict.envelope.checks).toEqual([
      { id: 'build', passed: false, detail: 'tsc exited 2: unexpected token' },
      { id: 'keeps-public-name', passed: null, detail: 'not reached: build failed' },
    ]);
  });
});

describe('#1038 §4 the two purposes are not symmetric', () => {
  it('rejects a feedback failure with no public explanation', () => {
    // A failure nobody can read cannot be repaired from.
    const verdict = validate(
      envelope({ exit_code: 1, checks: [row({ pass: false, public_feedback: '' }), row({ id: 'keeps-public-name', category: 'decision' })] }),
    );

    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.reasons.join(' ')).toMatch(/failed with no public explanation/);
  });

  it('rejects an audit row carrying public feedback', () => {
    // The audit is hidden; a leaked explanation makes it a second feedback
    // round rather than an independent one.
    const verdict = validate(
      envelope({
        purpose: 'audit',
        exit_code: 1,
        checks: [row({ pass: false, public_feedback: 'here is why' }), row({ id: 'keeps-public-name', category: 'decision' })],
      }),
      'audit',
    );

    expect(verdict.valid).toBe(false);
    if (verdict.valid) return;
    expect(verdict.reasons.join(' ')).toMatch(/must be null/);
  });

  it('accepts an audit failure with null public feedback', () => {
    const verdict = validate(
      envelope({
        purpose: 'audit',
        exit_code: 1,
        checks: [row({ pass: false }), row({ id: 'keeps-public-name', category: 'decision' })],
      }),
      'audit',
    );

    expect(verdict.valid).toBe(true);
  });
});

describe('#1038 §4 an invalid envelope contributes nothing and erases nothing', () => {
  it('reports an unparsable payload rather than throwing', () => {
    expect(validate('not json at all').valid).toBe(false);
    expect(validate(null).valid).toBe(false);
    expect(validate([]).valid).toBe(false);
  });

  it('leaves a separate valid envelope free to establish failure', () => {
    // The invalid feedback contributes no trusted check; the audit's failure
    // still scores the artifact false, on partial coverage (#1033 §2).
    const audit = validate(
      envelope({
        purpose: 'audit',
        exit_code: 1,
        checks: [row({ pass: false }), row({ id: 'keeps-public-name', category: 'decision' })],
      }),
      'audit',
    );
    if (!audit.valid) throw new Error('expected a valid audit envelope');

    const scored = scoreArtifact(
      {
        artifact_id: ARTIFACT,
        checker_revision: REVISION,
        required_checks: { feedback: ['build'], audit: ['build', 'keeps-public-name'] },
      },
      { feedback: unparsableEnvelope(), audit: audit.envelope },
    );

    expect(scored.score).toBe(false);
    expect(scored.coverage).toBe('partial');
    expect(scored.untrusted).toEqual([{ purpose: 'feedback', reason: 'unparsable' }]);
  });
});
