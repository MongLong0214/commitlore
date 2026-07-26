/**
 * T-702: the significance test the re-proposal measurement rests on.
 *
 * The benchmark's whole value is its ability to report "no effect" honestly, so
 * a test that is wrong in the direction of significance is the worst failure
 * available here. Three checks, in increasing strength:
 *
 *   1. published textbook values, typed in by hand;
 *   2. an independent exact-rational implementation in BigInt, run over every
 *      small table and over the shapes this benchmark actually produces — the
 *      float implementation has no way to agree with it by accident;
 *   3. the invariants (symmetry, boundaries) that a plausible-looking but wrong
 *      implementation tends to break.
 */

import { describe, expect, it } from 'vitest';

import {
  fisherExactTwoTailed,
  hypergeometricPmf,
  logChoose,
  logFactorial,
  logGamma,
  marginsOf,
  rateDifference,
  wilsonInterval,
} from '../bench/stats.ts';

/** Exact two-tailed Fisher p-value as a rational number. The reference oracle. */
const exactP = (a: number, b: number, c: number, d: number): { num: bigint; den: bigint } => {
  const factorial = (n: number): bigint => {
    let result = 1n;
    for (let i = 2n; i <= BigInt(n); i += 1n) result *= i;
    return result;
  };
  const choose = (n: number, k: number): bigint =>
    k < 0 || k > n ? 0n : factorial(n) / (factorial(k) * factorial(n - k));

  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const total = a + b + c + d;
  if (total === 0) return { num: 1n, den: 1n };

  const den = choose(total, col1);
  if (den === 0n) return { num: 1n, den: 1n };

  // Every term shares the denominator C(total, col1), so "no more likely than
  // the observed table" is an exact integer comparison of the numerators.
  const observed = choose(row1, a) * choose(row2, col1 - a);
  let num = 0n;
  for (let k = Math.max(0, col1 - row2); k <= Math.min(row1, col1); k += 1) {
    const term = choose(row1, k) * choose(row2, col1 - k);
    if (term <= observed) num += term;
  }
  return { num, den };
};

const exactValue = (a: number, b: number, c: number, d: number): number => {
  const { num, den } = exactP(a, b, c, d);
  return Number(num) / Number(den);
};

describe('fisherExactTwoTailed — published values', () => {
  // Fisher's own tea-tasting table. p = 34/70 = 17/35.
  it("matches Fisher's tea-tasting experiment", () => {
    const result = fisherExactTwoTailed(3, 1, 1, 3);
    expect(result.pValue).toBeCloseTo(0.4857142857142857, 12);
    expect(result.pValue).toBeCloseTo(17 / 35, 12);
    expect(result.oddsRatio).toBeCloseTo(9, 12);
  });

  // The standard worked example (1 of 10 men studying vs 11 of 14 women).
  // p = 7462/2704156 ~ 0.00276.
  it('matches the standard 2x2 worked example', () => {
    const result = fisherExactTwoTailed(1, 9, 11, 3);
    expect(result.pValue).toBeCloseTo(0.0027594561852200836, 12);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.oddsRatio).toBeCloseTo((1 * 3) / (9 * 11), 12);
  });

  // Perfect separation, 10 per arm: only two tables are that extreme.
  it('matches a perfectly separated table', () => {
    const result = fisherExactTwoTailed(10, 0, 0, 10);
    expect(result.pValue).toBeCloseTo(2 / 184756, 15);
    expect(result.oddsRatio).toBeNull();
  });

  it('matches a moderately significant table', () => {
    const result = fisherExactTwoTailed(2, 7, 8, 2);
    expect(result.pValue).toBeCloseTo(0.023014137565221155, 12);
  });

  // The shape this benchmark produces: 30 runs per arm.
  it('matches a 30-per-arm table', () => {
    const result = fisherExactTwoTailed(3, 27, 12, 18);
    expect(result.pValue).toBeCloseTo(0.015331621697389908, 12);
    expect(result.oddsRatio).toBeCloseTo((3 * 18) / (27 * 12), 12);
  });
});

describe('fisherExactTwoTailed — agrees with an exact rational implementation', () => {
  it('agrees on every table with cells 0..6', () => {
    for (let a = 0; a <= 6; a += 1) {
      for (let b = 0; b <= 6; b += 1) {
        for (let c = 0; c <= 6; c += 1) {
          for (let d = 0; d <= 6; d += 1) {
            const mine = fisherExactTwoTailed(a, b, c, d).pValue;
            const reference = exactValue(a, b, c, d);
            expect(
              Math.abs(mine - reference),
              `[[${a},${b}],[${c},${d}]] float=${mine} exact=${reference}`,
            ).toBeLessThan(1e-9);
          }
        }
      }
    }
  });

  it('agrees on every 30-per-arm table this benchmark can produce', () => {
    const N = 30;
    for (let onHits = 0; onHits <= N; onHits += 1) {
      for (let offHits = 0; offHits <= N; offHits += 1) {
        const mine = fisherExactTwoTailed(onHits, N - onHits, offHits, N - offHits).pValue;
        const reference = exactValue(onHits, N - onHits, offHits, N - offHits);
        expect(
          Math.abs(mine - reference),
          `on=${onHits}/${N} off=${offHits}/${N} float=${mine} exact=${reference}`,
        ).toBeLessThan(1e-9);
      }
    }
  });

  it('stays accurate where a naive factorial would have overflowed', () => {
    // 170! is the largest factorial a double can hold; these tables need larger
    // ones, so a non-log implementation returns NaN here.
    const result = fisherExactTwoTailed(150, 150, 120, 180);
    expect(Number.isFinite(result.pValue)).toBe(true);
    expect(result.pValue).toBeGreaterThan(0);
    expect(result.pValue).toBeCloseTo(exactValue(150, 150, 120, 180), 9);
  });
});

describe('fisherExactTwoTailed — invariants', () => {
  const TABLES: readonly (readonly [number, number, number, number])[] = [
    [3, 1, 1, 3],
    [1, 9, 11, 3],
    [3, 27, 12, 18],
    [0, 30, 7, 23],
    [5, 25, 5, 25],
    [2, 0, 0, 4],
  ];

  it('is invariant under swapping the rows', () => {
    for (const [a, b, c, d] of TABLES) {
      expect(fisherExactTwoTailed(c, d, a, b).pValue).toBeCloseTo(fisherExactTwoTailed(a, b, c, d).pValue, 12);
    }
  });

  it('is invariant under swapping the columns', () => {
    for (const [a, b, c, d] of TABLES) {
      expect(fisherExactTwoTailed(b, a, d, c).pValue).toBeCloseTo(fisherExactTwoTailed(a, b, c, d).pValue, 12);
    }
  });

  it('is invariant under transposition', () => {
    for (const [a, b, c, d] of TABLES) {
      expect(fisherExactTwoTailed(a, c, b, d).pValue).toBeCloseTo(fisherExactTwoTailed(a, b, c, d).pValue, 12);
    }
  });

  it('never returns a p-value outside [0, 1]', () => {
    for (let a = 0; a <= 8; a += 1) {
      for (let b = 0; b <= 8; b += 1) {
        for (let c = 0; c <= 8; c += 1) {
          for (let d = 0; d <= 8; d += 1) {
            const { pValue } = fisherExactTwoTailed(a, b, c, d);
            expect(pValue).toBeGreaterThanOrEqual(0);
            expect(pValue).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('echoes the table it was given', () => {
    expect(fisherExactTwoTailed(3, 27, 12, 18).table).toEqual([
      [3, 27],
      [12, 18],
    ]);
  });
});

describe('fisherExactTwoTailed — boundaries', () => {
  it('reports p=1 when an arm produced no runs at all', () => {
    // An empty row: nothing was measured, so nothing can be significant.
    expect(fisherExactTwoTailed(0, 0, 5, 25).pValue).toBe(1);
    expect(fisherExactTwoTailed(5, 25, 0, 0).pValue).toBe(1);
  });

  it('reports p=1 when no run in either arm re-proposed', () => {
    // An empty column: both arms scored 0, which is not evidence of a difference.
    const result = fisherExactTwoTailed(0, 30, 0, 30);
    expect(result.pValue).toBe(1);
    expect(result.oddsRatio).toBeNull();
  });

  it('reports p=1 when every run in both arms re-proposed', () => {
    expect(fisherExactTwoTailed(30, 0, 30, 0).pValue).toBe(1);
  });

  it('handles an empty table without producing NaN', () => {
    const result = fisherExactTwoTailed(0, 0, 0, 0);
    expect(result.pValue).toBe(1);
    expect(result.oddsRatio).toBeNull();
  });

  it('returns null rather than Infinity when the odds ratio is undefined', () => {
    expect(fisherExactTwoTailed(5, 0, 0, 5).oddsRatio).toBeNull();
    expect(fisherExactTwoTailed(5, 5, 0, 0).oddsRatio).toBeNull();
  });

  it('rejects counts that are not non-negative integers', () => {
    expect(() => fisherExactTwoTailed(-1, 2, 3, 4)).toThrow(/non-negative integer/);
    expect(() => fisherExactTwoTailed(1.5, 2, 3, 4)).toThrow(/non-negative integer/);
    expect(() => fisherExactTwoTailed(1, 2, 3, Number.NaN)).toThrow(/non-negative integer/);
    expect(() => fisherExactTwoTailed(1, 2, 3, Number.POSITIVE_INFINITY)).toThrow(/non-negative integer/);
  });
});

describe('odds ratio on a zero cell — the shape this experiment produces', () => {
  // The regression that matters: 30 runs per arm, treatment records no events.
  // `oddsRatio` must not come back 0, because "the odds of re-proposing are zero"
  // is a claim 30 runs cannot support — all that was seen is 0 events in 30.
  it('refuses to report an odds ratio when the treatment arm recorded no events', () => {
    const result = fisherExactTwoTailed(0, 30, 6, 24);
    expect(result.pValue).toBeCloseTo(0.0237207039, 9);
    expect(result.oddsRatio).toBeNull();
    expect(result.oddsRatioReason).toMatch(/cell a .*is 0/);
  });

  it('refuses on every empty cell, not just the ones that divide by zero', () => {
    for (const [a, b, c, d] of [
      [0, 30, 6, 24],
      [30, 0, 6, 24],
      [6, 24, 0, 30],
      [6, 24, 30, 0],
    ] as const) {
      const result = fisherExactTwoTailed(a, b, c, d);
      expect(result.oddsRatio, `[[${a},${b}],[${c},${d}]]`).toBeNull();
      expect(result.oddsRatioReason).not.toBeNull();
    }
  });

  it('still reports an odds ratio when every cell is populated', () => {
    const result = fisherExactTwoTailed(3, 27, 12, 18);
    expect(result.oddsRatio).toBeCloseTo((3 * 18) / (27 * 12), 12);
    expect(result.oddsRatioReason).toBeNull();
  });

  it('pins the p-values around this experiment’s decision boundary', () => {
    // 5/30 in the control arm does not clear alpha; 6/30 does. Fixing both stops
    // a future change from moving the verdict without moving a test.
    expect(fisherExactTwoTailed(0, 30, 5, 25).pValue).toBeCloseTo(0.0521855486, 9);
    expect(fisherExactTwoTailed(0, 30, 5, 25).pValue).toBeGreaterThan(0.05);
    expect(fisherExactTwoTailed(0, 30, 6, 24).pValue).toBeLessThan(0.05);
    expect(fisherExactTwoTailed(0, 20, 2, 18).pValue).toBeCloseTo(0.4871794872, 9);
    expect(fisherExactTwoTailed(2, 28, 8, 22).pValue).toBeCloseTo(0.0797220148, 9);
  });
});

describe('rateDifference — the effect size that survives a zero cell', () => {
  it('reports a difference and an interval where the odds ratio cannot', () => {
    const result = rateDifference(0, 30, 6, 24);
    expect(result.treatmentRate).toBe(0);
    expect(result.baselineRate).toBeCloseTo(0.2, 12);
    expect(result.difference).toBeCloseTo(-0.2, 12);
    // Agrees with p < 0.05: the interval excludes zero.
    expect(result.ci95?.hi).toBeLessThan(0);
  });

  it('produces an interval that contains zero when the test does not reject', () => {
    const result = rateDifference(0, 20, 2, 18);
    expect(fisherExactTwoTailed(0, 20, 2, 18).pValue).toBeGreaterThan(0.05);
    expect(result.ci95?.lo).toBeLessThan(0);
    expect(result.ci95?.hi).toBeGreaterThan(0);
  });

  it('is antisymmetric under swapping the arms', () => {
    const forward = rateDifference(3, 27, 12, 18);
    const reversed = rateDifference(12, 18, 3, 27);
    expect(forward.difference).toBeCloseTo(-(reversed.difference as number), 12);
  });

  it('returns nulls instead of NaN when an arm has no runs', () => {
    const result = rateDifference(0, 0, 6, 24);
    expect(result.treatmentRate).toBeNull();
    expect(result.difference).toBeNull();
    expect(result.ci95).toBeNull();
  });

  it('rejects counts that are not non-negative integers', () => {
    expect(() => rateDifference(-1, 2, 3, 4)).toThrow(/non-negative integer/);
    expect(() => rateDifference(1, 2, 3, 1.5)).toThrow(/non-negative integer/);
  });
});

describe('wilsonInterval', () => {
  // The number that makes "odds ratio 0" indefensible: zero events in 30 trials
  // is consistent with a true rate as high as ~11%.
  it('gives 0/30 a non-degenerate upper bound', () => {
    const interval = wilsonInterval(0, 30) as { lo: number; hi: number };
    expect(interval.lo).toBeCloseTo(0, 10);
    expect(interval.hi).toBeCloseTo(0.1135133932, 9);
  });

  // Cross-checked against the algebraic form written a different way:
  //   (p + z²/2n ± z·sqrt(p(1-p)/n + z²/4n²)) / (1 + z²/n)
  // The implementation groups the terms differently, so agreeing to 12 digits is
  // not the same expression being compared with itself.
  it('agrees with the interval written in its other standard algebraic form', () => {
    const z = 1.959963984540054;
    const algebraic = (x: number, n: number) => {
      const p = x / n;
      const centre = p + (z * z) / (2 * n);
      const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
      const scale = 1 + (z * z) / n;
      return { lo: (centre - spread) / scale, hi: (centre + spread) / scale };
    };

    for (const [x, n] of [[10, 100], [0, 30], [6, 30], [3, 27], [1, 2]] as const) {
      const mine = wilsonInterval(x, n) as { lo: number; hi: number };
      const reference = algebraic(x, n);
      expect(mine.lo, `lo for ${x}/${n}`).toBeCloseTo(Math.max(0, reference.lo), 12);
      expect(mine.hi, `hi for ${x}/${n}`).toBeCloseTo(Math.min(1, reference.hi), 12);
    }
  });

  it('matches the published Wilson score interval for 10/100', () => {
    // [0.05523, 0.17437] — the score interval without continuity correction.
    // The continuity-corrected variant is [0.0554, 0.1755]; this is not that one.
    const interval = wilsonInterval(10, 100) as { lo: number; hi: number };
    expect(interval.lo).toBeCloseTo(0.0552291371, 9);
    expect(interval.hi).toBeCloseTo(0.1743656615, 9);
  });

  it('stays inside [0, 1] at both extremes and handles no trials', () => {
    for (const [x, n] of [[0, 5], [5, 5], [0, 1], [1, 1]] as const) {
      const interval = wilsonInterval(x, n) as { lo: number; hi: number };
      expect(interval.lo).toBeGreaterThanOrEqual(0);
      expect(interval.hi).toBeLessThanOrEqual(1);
    }
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe('log-space helpers', () => {
  it('computes log-factorials that match exact small factorials', () => {
    const expected = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
    expected.forEach((value, n) => {
      expect(Math.exp(logFactorial(n))).toBeCloseTo(value, 6);
    });
  });

  it('computes logGamma against known values', () => {
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    expect(logGamma(1)).toBeCloseTo(0, 12);
    expect(logGamma(2)).toBeCloseTo(0, 12);
    expect(logGamma(6)).toBeCloseTo(Math.log(120), 12);
  });

  it('computes binomial coefficients that survive past the double factorial ceiling', () => {
    expect(Math.exp(logChoose(10, 5))).toBeCloseTo(252, 6);
    expect(Math.exp(logChoose(20, 10))).toBeCloseTo(184756, 3);
    expect(Number.isFinite(logChoose(2000, 1000))).toBe(true);
  });

  it('gives an impossible cell zero probability instead of NaN', () => {
    expect(logChoose(5, 6)).toBe(Number.NEGATIVE_INFINITY);
    expect(logChoose(5, -1)).toBe(Number.NEGATIVE_INFINITY);
    expect(hypergeometricPmf(99, marginsOf(3, 27, 12, 18))).toBe(0);
  });

  it('has hypergeometric terms that sum to 1 across the support', () => {
    const margins = marginsOf(3, 27, 12, 18);
    let total = 0;
    for (let k = Math.max(0, margins.col1 - margins.row2); k <= Math.min(margins.row1, margins.col1); k += 1) {
      total += hypergeometricPmf(k, margins);
    }
    expect(total).toBeCloseTo(1, 12);
  });
});
