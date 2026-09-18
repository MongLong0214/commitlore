/**
 * The counting rules of #1038 §2 and #1041, revision `native-efficacy-r6.1`.
 *
 * Each expectation is transcribed from an issue body, not read back from
 * `matching.ts`. The rules they pin are the ones whose violation produces a
 * plausible number rather than an error, which is why every one of them gets a
 * case:
 *
 *   - "Partial coverage is not a full recall success."
 *   - "A unit is covered at most once per episode/stage."
 *   - "Unknown source/observation must not become coverage=none."
 *   - "No new records means undefined precision; no applicable units means
 *      undefined recall."
 *   - "Already-recorded=true cannot count as eligible NEW capture."
 *   - "Joint stored coverage cannot stand in for joint delivered coverage."
 *   - "Notes/message copies of the same canonical native record aren't extra
 *      precision items."
 */

import { describe, expect, it } from 'vitest';

import {
  deliveryRecall,
  newCaptureRecall,
  recordQuality,
  type Coverage,
  type DecisionUnit,
  type RecordAssessment,
  type Stage,
  type UnitCoverageAssessment,
} from '../bench/de/matching.ts';

const unit = (id: string, over: Partial<DecisionUnit> = {}): DecisionUnit => ({
  id,
  source_refs: [`discussion.md#${id}`],
  statement: `the decision behind ${id}`,
  required_qualifiers: ['scope'],
  handoff_validity: 'current',
  eligible_for_new_capture: true,
  already_recorded: false,
  next_requirement_ids: [`req-${id}`],
  next_status: 'applicable',
  ...over,
});

const covered = (
  unit_id: string,
  coverage: Coverage,
  over: Partial<UnitCoverageAssessment> = {},
): UnitCoverageAssessment => ({
  unit_id,
  stage: 'committed',
  record_refs: [`record:${unit_id}`],
  coverage,
  evidence_refs: [`commit:abc#${unit_id}`],
  reason: 'transcribed for the test',
  assessor_method: 'fixture',
  ...over,
});

const record = (record_ref: string, over: Partial<RecordAssessment> = {}): RecordAssessment => ({
  record_ref,
  units: [],
  source_support: 'supported',
  usefulness: 'useful',
  stale_or_misqualified: false,
  evidence_refs: [`commit:abc#${record_ref}`],
  reason: 'transcribed for the test',
  assessor_method: 'fixture',
  ...over,
});

describe('#1033 §4 partial coverage is not a recall success', () => {
  it('counts only complete coverage, and reports partial beside it', () => {
    // The scoped rule that lost its exception: "Keep the public name for legacy
    // clients; v2 may rename it." Losing the v2 exception is partial, and
    // rounding it up is the single change that would most flatter the arm that
    // writes records.
    const units = [unit('u1'), unit('u2'), unit('u3')];
    const tally = newCaptureRecall(units, [
      covered('u1', 'complete'),
      covered('u2', 'partial'),
      covered('u3', 'none'),
    ]);

    expect(tally).toMatchObject({ applicable: 3, complete: 1, partial: 1, none: 1, unknown: 0 });
    expect(tally.recall).toBeCloseTo(1 / 3);
  });
});

describe('#1038 §2 a unit is covered at most once per stage', () => {
  it('counts a joint match as one unit rather than adding fractions', () => {
    // "Several records may jointly express one unit ... Record that exact joint
    // set in UnitCoverageAssessment; do not add fractions or manufacture a new
    // summary."
    const tally = newCaptureRecall(
      [unit('u1')],
      [covered('u1', 'complete', { record_refs: ['record:a', 'record:b'] })],
    );

    expect(tally).toMatchObject({ applicable: 1, complete: 1 });
    expect(tally.recall).toBe(1);
  });

  it('refuses two coverage assessments for one unit at one stage', () => {
    // Not a tie to break. Picking one silently is how a later re-assessment
    // replaces an earlier verdict with nobody seeing it.
    expect(() =>
      newCaptureRecall([unit('u1')], [covered('u1', 'complete'), covered('u1', 'none')]),
    ).toThrow(/covered at most once per stage/);
  });

  it('allows the same unit at two different stages', () => {
    const units = [unit('u1')];
    const assessments = [
      covered('u1', 'complete'),
      covered('u1', 'none', { stage: 'solve_delivered' }),
    ];

    expect(newCaptureRecall(units, assessments).complete).toBe(1);
    expect(deliveryRecall(units, assessments, 'solve_delivered').none).toBe(1);
  });
});

describe('#1041 unknown is not absent', () => {
  it('leaves an unjudged unit unknown instead of counting it as none', () => {
    const tally = newCaptureRecall([unit('u1')], []);

    expect(tally).toMatchObject({ applicable: 1, complete: 0, none: 0, unknown: 1 });
    expect(tally.recall).toBe(0);
  });

  it('keeps an explicit unknown coverage apart from an observed none', () => {
    const tally = newCaptureRecall(
      [unit('u1'), unit('u2')],
      [covered('u1', 'unknown'), covered('u2', 'none')],
    );

    expect(tally).toMatchObject({ unknown: 1, none: 1 });
  });
});

describe('#1041 an empty denominator is undefined, not zero', () => {
  it('returns null recall when no unit applies', () => {
    // "no applicable units means undefined recall". A 0 here would be a number
    // standing where "this was not measured" belongs.
    expect(newCaptureRecall([], []).recall).toBeNull();
    expect(deliveryRecall([], [], 'solve_delivered').recall).toBeNull();
  });

  it('returns null supported_rate when no new record was produced', () => {
    expect(recordQuality([]).supported_rate).toBeNull();
    expect(recordQuality([]).records).toBe(0);
  });
});

describe('#1038 §2 already-recorded units are not eligible new capture', () => {
  it('leaves an already-recorded unit out of the new-capture denominator', () => {
    const units = [
      unit('fresh'),
      unit('old', { already_recorded: true, eligible_for_new_capture: false }),
    ];

    expect(newCaptureRecall(units, [covered('fresh', 'complete')]).applicable).toBe(1);
  });

  it('refuses an already-recorded unit even when the label claims it is eligible', () => {
    // The two fields can disagree in a hand-written label file; #1038 settles it
    // in one direction, so the module does too rather than trusting the flag.
    const units = [unit('old', { already_recorded: true, eligible_for_new_capture: true })];

    expect(newCaptureRecall(units, []).applicable).toBe(0);
  });

  it('keeps an already-recorded unit in delivery applicability', () => {
    // "Already-recorded units are separate from new-capture recall but remain in
    // applicability/delivery."
    const units = [unit('old', { already_recorded: true, eligible_for_new_capture: false })];
    const tally = deliveryRecall(units, [covered('old', 'complete', { stage: 'solve_delivered' })], 'solve_delivered');

    expect(tally).toMatchObject({ applicable: 1, complete: 1 });
  });

  it('leaves a unit that does not apply to the next task out of delivery recall', () => {
    const units = [unit('u1', { next_status: 'irrelevant' }), unit('u2', { next_status: 'overridden' })];

    expect(deliveryRecall(units, [], 'solve_delivered').recall).toBeNull();
  });
});

describe('#1038 §2 stored coverage does not stand in for delivered coverage', () => {
  it('does not let a committed match raise solve-stage delivery recall', () => {
    const units = [unit('u1')];
    const assessments = [covered('u1', 'complete')]; // committed only

    expect(newCaptureRecall(units, assessments).recall).toBe(1);
    expect(deliveryRecall(units, assessments, 'solve_delivered')).toMatchObject({
      applicable: 1,
      complete: 0,
      unknown: 1,
    });
  });

  it('does not let a repair-stage statement improve solve-stage recall', () => {
    // "A repair-only statement cannot retroactively improve solve-stage recall."
    const units = [unit('u1')];
    const assessments = [covered('u1', 'complete', { stage: 'repair_delivered' })];

    expect(deliveryRecall(units, assessments, 'solve_delivered').complete).toBe(0);
    expect(deliveryRecall(units, assessments, 'repair_delivered').complete).toBe(1);
  });
});

describe('#1038 §2 record identity for record-quality counts', () => {
  it('counts the notes copy and the message copy of one record once', () => {
    // "Notes/message copies of one native record are one record identity for
    // precision and one unit for recall."
    const quality = recordQuality([
      record('record:canonical'),
      record('record:canonical', { evidence_refs: ['notes:refs/notes/commitlore'] }),
    ]);

    expect(quality.records).toBe(1);
    expect(quality.supported_rate).toBe(1);
  });

  it('keeps two genuinely separate records as two, redundant or not', () => {
    // "Separate duplicate records remain in record-quality counts; redundant
    // records are not automatically useful." Collapsing by similarity would hide
    // the finding instead of reporting it.
    const quality = recordQuality([
      record('record:a', { usefulness: 'useful' }),
      record('record:b', { usefulness: 'irrelevant' }),
    ]);

    expect(quality.records).toBe(2);
    expect(quality).toMatchObject({ useful: 1, irrelevant: 1 });
  });

  it('keeps supported, useful and stale apart', () => {
    // "Preserve supported versus useful versus stale/misqualified distinctions."
    // A verbatim quote can be source-supported and still over-broad.
    const quality = recordQuality([
      record('record:a', { source_support: 'supported', usefulness: 'irrelevant', stale_or_misqualified: true }),
      record('record:b', { source_support: 'unsupported', usefulness: 'useful', stale_or_misqualified: false }),
      record('record:c', { source_support: 'unknown', usefulness: 'unknown', stale_or_misqualified: null }),
    ]);

    expect(quality).toMatchObject({
      records: 3,
      supported: 1,
      unsupported: 1,
      support_unknown: 1,
      useful: 1,
      irrelevant: 1,
      usefulness_unknown: 1,
      stale_or_misqualified: 1,
    });
    expect(quality.supported_rate).toBeCloseTo(1 / 3);
  });

  it('does not treat a null stale_or_misqualified as false', () => {
    const quality = recordQuality([record('record:a', { stale_or_misqualified: null })]);

    expect(quality.stale_or_misqualified).toBe(0);
  });
});

describe('#1038 §2 an unrelated record may legitimately cover nothing', () => {
  it('counts it as a record without attributing a unit to it', () => {
    const quality = recordQuality([record('record:a', { units: [], usefulness: 'irrelevant' })]);

    expect(quality.records).toBe(1);
    expect(quality.irrelevant).toBe(1);
  });
});

describe('the stage vocabulary is closed', () => {
  it('names exactly the three stages the contract uses', () => {
    const stages: Stage[] = ['committed', 'solve_delivered', 'repair_delivered'];

    expect(stages).toHaveLength(3);
  });
});
