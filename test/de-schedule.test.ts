/**
 * The seeded schedule and the pair budget — #1036, revision
 * `native-efficacy-r6.1`.
 *
 * Transcribed from the issue body. Both rules here fail *quietly*: a schedule
 * that favours one arm and a budget that funds half a pair each produce a
 * complete-looking results file rather than an error, so each gets a case that
 * fails when the rule is removed.
 *
 *   - "shuffle cluster IDs; draw a fair initial control/treatment order per
 *      cluster and alternate for later case/repeat pairs. Reuse the fixed pair
 *      order for capture, solve and repair."
 *   - "reserve the declared worst-case pair budget before starting it. Do not
 *      spend leftover budget on a favorable single arm."
 *   - "Unknown consumption stops later spending when remaining authorization
 *      cannot be established; it does not erase already known quality."
 */

import { describe, expect, it } from 'vitest';

import {
  assertUsableLimits,
  planSchedule,
  reservePair,
  worstCasePairCost,
  type PhaseLimits,
  type ScheduleCase,
} from '../bench/de/schedule.ts';

const cases = (count: number, cluster = 'c1'): ScheduleCase[] =>
  Array.from({ length: count }, (_, index) => ({ id: `case-${cluster}-${index + 1}`, cluster_id: cluster }));

const limits: PhaseLimits = { capture: 1_000, solve: 10_000, repair: 5_000 };

describe('#1036 the schedule is reproducible from the seed alone', () => {
  it('gives the same plan for the same seed', () => {
    const input = { cases: [...cases(3, 'a'), ...cases(3, 'b')], repeat: 2, seed: 'run-7' };

    expect(planSchedule(input)).toEqual(planSchedule(input));
  });

  it('gives a different plan for a different seed', () => {
    // Not a strong claim about the generator, just that the seed reaches it:
    // a plan that ignored the seed would make these equal.
    const base = { cases: [...cases(4, 'a'), ...cases(4, 'b'), ...cases(4, 'c')], repeat: 1 };

    expect(planSchedule({ ...base, seed: 'one' })).not.toEqual(planSchedule({ ...base, seed: 'two' }));
  });

  it('plans one pair per case and repetition', () => {
    const plan = planSchedule({ cases: cases(3), repeat: 4, seed: 's' });

    expect(plan).toHaveLength(12);
    expect(plan.filter((pair) => pair.repetition === 1)).toHaveLength(3);
    expect([...new Set(plan.map((pair) => pair.repetition))].sort()).toEqual([1, 2, 3, 4]);
  });

  it('refuses a repeat that is not a positive safe integer', () => {
    for (const repeat of [0, -1, 1.5, Number.NaN]) {
      expect(() => planSchedule({ cases: cases(1), repeat, seed: 's' })).toThrow(/positive safe integer/);
    }
  });
});

describe('#1036 the initial arm order is fair and then alternates', () => {
  it('alternates the leading arm within a cluster', () => {
    // Which arm goes first matters -- the first warms what the second shares --
    // so a cluster whose pairs all led with one arm would bias every one of
    // them in the same direction.
    const plan = planSchedule({ cases: cases(6), repeat: 1, seed: 'alternate' });
    const leaders = plan.map((pair) => pair.order[0]);

    for (let index = 1; index < leaders.length; index += 1) {
      expect(leaders[index]).not.toBe(leaders[index - 1]);
    }
  });

  it('splits the lead evenly over an even number of pairs', () => {
    const plan = planSchedule({ cases: cases(8), repeat: 2, seed: 'even' });
    const off = plan.filter((pair) => pair.order[0] === 'off').length;

    expect(off).toBe(plan.length / 2);
  });

  it('draws the first arm from the seed rather than always starting with one', () => {
    // A constant first arm would make every seed agree here.
    const leaders = new Set(
      ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map(
        (seed) => planSchedule({ cases: cases(1), repeat: 1, seed })[0]!.order[0],
      ),
    );

    expect(leaders).toEqual(new Set(['off', 'native']));
  });

  it('always plans both arms, in one frozen order per pair', () => {
    const plan = planSchedule({ cases: [...cases(3, 'a'), ...cases(3, 'b')], repeat: 2, seed: 'both' });

    for (const pair of plan) {
      expect([...pair.order].sort()).toEqual(['native', 'off']);
    }
  });
});

describe('#1036 clusters are shuffled, not taken in manifest order', () => {
  it('does not always walk the clusters as they were given', () => {
    // A run cut short by an interruption should not be systematically the first
    // half of the manifest.
    const given = ['a', 'b', 'c', 'd', 'e', 'f'];
    const input = { cases: given.flatMap((cluster) => cases(1, cluster)), repeat: 1 };
    const orders = new Set(
      ['s1', 's2', 's3', 's4', 's5', 's6'].map((seed) =>
        planSchedule({ ...input, seed }).map((pair) => pair.cluster_id).join(','),
      ),
    );

    expect(orders.size).toBeGreaterThan(1);
    expect([...orders]).not.toEqual([given.join(',')]);
  });

  it('keeps every case exactly once per repetition', () => {
    const given = [...cases(2, 'a'), ...cases(2, 'b'), ...cases(1, 'c')];
    const plan = planSchedule({ cases: given, repeat: 3, seed: 'complete' });

    for (const entry of given) {
      expect(plan.filter((pair) => pair.case_id === entry.id)).toHaveLength(3);
    }
  });
});

describe('#1036 a pair starts whole or not at all', () => {
  it('reserves the worst case: two captures, two solves, two repairs', () => {
    // "at most six actor sessions"
    expect(worstCasePairCost(limits)).toBe(2 * (1_000 + 10_000 + 5_000));
  });

  it('declines rather than funding the arm that fits', () => {
    // "Do not spend leftover budget on a favorable single arm." A pair that ran
    // the control and stopped has produced an unpaired row, not a cheap half.
    const required = worstCasePairCost(limits);
    const reservation = reservePair({ remaining: required - 1, limits });

    expect(reservation.outcome).toBe('insufficient');
    expect(reservation.remainingAfter).toBeNull();
    expect(reservation.reason).toMatch(/unpaired row/);
  });

  it('reserves exactly the worst case when it fits', () => {
    const required = worstCasePairCost(limits);
    const reservation = reservePair({ remaining: required, limits });

    expect(reservation.outcome).toBe('reserved');
    expect(reservation.remainingAfter).toBe(0);
  });

  it('stops later spending when remaining authorisation is unknown', () => {
    // "it does not erase already known quality" -- so this refuses the next
    // pair and says nothing about the rows already measured.
    const reservation = reservePair({ remaining: null, limits });

    expect(reservation.outcome).toBe('unknown-consumption');
    expect(reservation.reason).toMatch(/measured rows stand/);
  });

  it('refuses limits that are not positive safe integers', () => {
    // A zero would make a pair look free and every reservation succeed, which
    // spends the whole authorisation before anyone reads a number.
    for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertUsableLimits({ ...limits, solve: bad })).toThrow(/positive safe integer/);
      expect(() => reservePair({ remaining: 1_000_000, limits: { ...limits, capture: bad } })).toThrow(
        /positive safe integer/,
      );
    }
  });
});
