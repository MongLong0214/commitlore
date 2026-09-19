/**
 * The report's arithmetic — #1033 §1 and #1037, revision `native-efficacy-r6.1`.
 *
 * Transcribed from the issue bodies. Both rules here are about the denominator,
 * and both fail in the direction that flatters the result:
 *
 *   - "Start from the complete planned schedule ... Preserve unstarted, failed
 *      and unknown rows, not only surviving successful files."
 *   - "M averages repetitions within case, cases within source_group, then
 *      source_groups equally. ... More records or repeats are not more
 *      independent repositories."
 *   - "A known false with partial coverage is included as an observed false in
 *      the paired outcome, not dropped as unknown."
 *   - "Relative reduction is `1 - M_NATIVE/M_OFF` only when both means are
 *      complete and the control is positive."
 */

import { describe, expect, it } from 'vitest';

import {
  joinPlan,
  meanFor,
  pairedEffect,
  plannedRows,
  type JoinedRow,
  type ObservedOutcome,
  type PlannedRow,
} from '../bench/de/aggregate.ts';
import type { Arm, ScheduledPair } from '../bench/de/schedule.ts';

const pair = (case_id: string, repetition = 1, order: readonly [Arm, Arm] = ['off', 'native']): ScheduledPair => ({
  case_id,
  cluster_id: `cluster-${case_id}`,
  repetition,
  order,
});

const row = (over: Partial<JoinedRow> & { arm: Arm; score: boolean | null }): JoinedRow => ({
  case_id: 'case-1',
  cluster_id: 'cluster-1',
  source_group: 'group-1',
  repetition: 1,
  status: 'observed',
  ...over,
});

const observed = (case_id: string, repetition: number, arm: Arm, score: boolean | null): ObservedOutcome => ({
  case_id,
  repetition,
  arm,
  score,
});

describe('#1037 the report starts from the plan', () => {
  it('expands each scheduled pair into one row per arm', () => {
    const planned = plannedRows([pair('a'), pair('b')], () => 'group-1');

    expect(planned).toHaveLength(4);
    expect(planned.map((entry) => entry.arm)).toEqual(['off', 'native', 'off', 'native']);
  });

  it('keeps a planned row that was never observed', () => {
    // The rows that go missing are not missing at random: they are the episodes
    // that crashed, timed out or were never reached. Iterating the observations
    // instead would make the arm that fails more often look better.
    const planned = plannedRows([pair('a'), pair('b')], () => 'group-1');
    const joined = joinPlan(planned, [observed('a', 1, 'off', true), observed('a', 1, 'native', true)]);

    expect(joined).toHaveLength(4);
    expect(joined.filter((entry) => entry.status === 'unobserved')).toHaveLength(2);
    expect(joined.filter((entry) => entry.case_id === 'b').every((entry) => entry.score === null)).toBe(true);
  });

  it('refuses an observation with no planned row', () => {
    // It means the runner ran something the plan did not schedule, and
    // averaging it in would use a denominator nobody declared.
    const planned = plannedRows([pair('a')], () => 'group-1');

    expect(() => joinPlan(planned, [observed('ghost', 1, 'off', true)])).toThrow(/no planned row/);
  });

  it('preserves a failed row rather than treating it as absent', () => {
    const planned = plannedRows([pair('a')], () => 'group-1');
    const joined = joinPlan(planned, [observed('a', 1, 'off', false), observed('a', 1, 'native', true)]);

    expect(joined.find((entry) => entry.arm === 'off')).toMatchObject({ status: 'observed', score: false });
  });
});

describe('#1033 §1 the mean has three levels and weights source groups equally', () => {
  it('averages repetitions within a case', () => {
    const rows: JoinedRow[] = [
      row({ arm: 'off', score: true, repetition: 1 }),
      row({ arm: 'off', score: false, repetition: 2 }),
    ];

    expect(meanFor(rows, 'off').value).toBe(0.5);
  });

  it('averages cases within a source group', () => {
    const rows: JoinedRow[] = [
      row({ arm: 'off', score: true, case_id: 'a' }),
      row({ arm: 'off', score: false, case_id: 'b' }),
      row({ arm: 'off', score: false, case_id: 'c' }),
    ];

    expect(meanFor(rows, 'off').value).toBeCloseTo(1 / 3);
  });

  it('gives a source group with forty cases no more weight than one with a single case', () => {
    // The rule that stops one repository's quirks carrying the headline. A flat
    // mean over rows here would be 40/41; the three-level mean is 0.5.
    const many: JoinedRow[] = Array.from({ length: 40 }, (_, index) =>
      row({ arm: 'off', score: true, source_group: 'big', case_id: `big-${index}` }),
    );
    const one: JoinedRow[] = [row({ arm: 'off', score: false, source_group: 'small', case_id: 'small-1' })];

    expect(meanFor([...many, ...one], 'off').value).toBe(0.5);
  });

  it('is null when no source group contributed a value', () => {
    const rows: JoinedRow[] = [row({ arm: 'off', score: null, status: 'unobserved' })];
    const mean = meanFor(rows, 'off');

    expect(mean.value).toBeNull();
    expect(mean.groups).toBe(0);
  });
});

describe('#1033 §2 an unresolved row is not a failure', () => {
  it('leaves a null score out of the mean rather than counting it as false', () => {
    // Counting it would turn an unmeasured episode into evidence against the
    // arm, which is the substitution that most flatters whichever arm reported
    // more cleanly.
    const rows: JoinedRow[] = [
      row({ arm: 'off', score: true, case_id: 'a' }),
      row({ arm: 'off', score: null, case_id: 'b', status: 'observed' }),
    ];

    expect(meanFor(rows, 'off').value).toBe(1);
  });

  it('reports the unresolved and unobserved counts beside the mean', () => {
    // So the number is never read without them.
    const rows: JoinedRow[] = [
      row({ arm: 'off', score: true, case_id: 'a' }),
      row({ arm: 'off', score: null, case_id: 'b', status: 'observed' }),
      row({ arm: 'off', score: null, case_id: 'c', status: 'unobserved' }),
    ];
    const mean = meanFor(rows, 'off');

    expect(mean).toMatchObject({ planned: 3, observed: 2, unresolved: 2 });
  });

  it('counts a known false with partial coverage as a false', () => {
    // "A known false with partial coverage is included as an observed false in
    // the paired outcome, not dropped as unknown." The score carries that; the
    // coverage lives beside it in the scorer.
    const rows: JoinedRow[] = [row({ arm: 'native', score: false })];

    expect(meanFor(rows, 'native').value).toBe(0);
  });
});

describe('#1033 §1 the paired effect keeps both means beside it', () => {
  it('reports the difference in percentage points', () => {
    const rows: JoinedRow[] = [
      row({ arm: 'off', score: false, case_id: 'a' }),
      row({ arm: 'native', score: true, case_id: 'a' }),
    ];

    expect(pairedEffect(rows).differencePoints).toBe(100);
  });

  it('withholds the difference when either arm has no mean', () => {
    const rows: JoinedRow[] = [
      row({ arm: 'off', score: true, case_id: 'a' }),
      row({ arm: 'native', score: null, case_id: 'a', status: 'unobserved' }),
    ];
    const effect = pairedEffect(rows);

    expect(effect.differencePoints).toBeNull();
    expect(effect.native.value).toBeNull();
    // The control's own mean is still reported: it was measured.
    expect(effect.off.value).toBe(1);
  });

  it('withholds the relative reduction when the control is zero', () => {
    // A relative reduction against a zero control is a number with no
    // denominator behind it.
    const rows: JoinedRow[] = [
      row({ arm: 'off', score: false, case_id: 'a' }),
      row({ arm: 'native', score: false, case_id: 'a' }),
    ];
    const effect = pairedEffect(rows);

    expect(effect.off.value).toBe(0);
    expect(effect.relativeReduction).toBeNull();
    expect(effect.differencePoints).toBe(0);
  });

  it('computes the relative reduction when both means exist and the control is positive', () => {
    const rows: JoinedRow[] = [
      row({ arm: 'off', score: true, case_id: 'a' }),
      row({ arm: 'off', score: false, case_id: 'b' }),
      row({ arm: 'native', score: true, case_id: 'a' }),
      row({ arm: 'native', score: true, case_id: 'b' }),
    ];
    const effect = pairedEffect(rows);

    expect(effect.off.value).toBe(0.5);
    expect(effect.native.value).toBe(1);
    expect(effect.relativeReduction).toBe(-1);
  });
});
