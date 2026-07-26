/**
 * Fisher's exact test for a 2×2 table, two-tailed.
 *
 * ADR-0007 picked this over chi-squared because n is small — 60 runs across two
 * arms, with cell counts that can reach 0. Chi-squared's asymptotics do not hold
 * there, and a test that is wrong in the direction of significance would be the
 * worst possible failure for a benchmark whose whole job is to be able to
 * report "no effect".
 *
 * No dependency is added: the implementation is here, and `test/bench-stats.test.ts`
 * checks it against textbook values and against an independent exact-rational
 * implementation in BigInt.
 */

export interface FisherResult {
  table: [[number, number], [number, number]];
  pValue: number;
  /** Sample odds ratio (a·d)/(b·c). `null` when b·c is 0 — the ratio is not finite. */
  oddsRatio: number | null;
}

/**
 * Lanczos approximation, g=7, n=9. Factorials are taken in log space on purpose:
 * `C(60, 30)` is ~1.18e17 and the intermediate factorials are ~8e81. Those still
 * fit a double, but the benchmark is meant to survive a bigger run than the one
 * it was written for, and a factorial that silently reaches Infinity turns every
 * downstream probability into NaN — which reads as "no result" rather than as a
 * bug.
 */
const LANCZOS: readonly number[] = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export const logGamma = (z: number): number => {
  if (!Number.isFinite(z)) throw new Error(`logGamma expects a finite number, got ${z}`);
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);

  const x = z - 1;
  const t = x + 7.5;
  let series = LANCZOS[0] as number;
  for (let i = 1; i < LANCZOS.length; i += 1) series += (LANCZOS[i] as number) / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(series);
};

/** log(n!) */
export const logFactorial = (n: number): number => logGamma(n + 1);

/** log C(n, k). -Infinity outside the support, so an impossible table gets probability 0. */
export const logChoose = (n: number, k: number): number => {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
};

export interface Margins {
  readonly row1: number;
  readonly row2: number;
  readonly col1: number;
  readonly col2: number;
  readonly total: number;
}

export const marginsOf = (a: number, b: number, c: number, d: number): Margins => ({
  row1: a + b,
  row2: c + d,
  col1: a + c,
  col2: b + d,
  total: a + b + c + d,
});

/**
 * Probability of the table whose top-left cell is `k`, given the margins —
 * the central hypergeometric term. Returned as a plain probability; the caller
 * sums a handful of them, so precision is not at risk.
 */
export const hypergeometricPmf = (k: number, margins: Margins): number => {
  const { row1, row2, col1, total } = margins;
  if (total === 0) return k === 0 ? 1 : 0;
  const logP = logChoose(row1, k) + logChoose(row2, col1 - k) - logChoose(total, col1);
  return Number.isFinite(logP) ? Math.exp(logP) : 0;
};

const assertCount = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`fisherExactTwoTailed: ${name} must be a non-negative integer, got ${value}`);
  }
};

/**
 * Relative slack when deciding which tables are "at least as extreme" as the
 * observed one. Two tables that are mathematically equally likely can differ in
 * the last bits after exp(), and dropping one of them shifts the p-value by a
 * whole term — visibly wrong on symmetric tables like [[3,1],[1,3]].
 */
const EXTREMITY_TOLERANCE = 1 + 1e-9;

/**
 * Two-tailed Fisher exact test on
 *
 *     [ a  b ]
 *     [ c  d ]
 *
 * The two-tailed p-value is the total probability of every table with the same
 * margins that is no more likely than the observed one (the standard "sum of
 * small p-values" definition, as used by R's `fisher.test`).
 */
export const fisherExactTwoTailed = (a: number, b: number, c: number, d: number): FisherResult => {
  assertCount("a", a);
  assertCount("b", b);
  assertCount("c", c);
  assertCount("d", d);

  const table: [[number, number], [number, number]] = [
    [a, b],
    [c, d],
  ];
  const margins = marginsOf(a, b, c, d);
  const oddsRatio = b * c === 0 ? null : (a * d) / (b * c);

  // A table with an empty row or column has exactly one arrangement, so nothing
  // is more extreme than what was seen and p is 1 by definition. Reporting a
  // small p here would be the classic way to manufacture significance out of an
  // arm that produced no data.
  if (margins.total === 0 || margins.row1 === 0 || margins.row2 === 0 || margins.col1 === 0 || margins.col2 === 0) {
    return { table, pValue: 1, oddsRatio };
  }

  const lo = Math.max(0, margins.col1 - margins.row2);
  const hi = Math.min(margins.row1, margins.col1);
  const observed = hypergeometricPmf(a, margins);

  let pValue = 0;
  for (let k = lo; k <= hi; k += 1) {
    const p = hypergeometricPmf(k, margins);
    if (p <= observed * EXTREMITY_TOLERANCE) pValue += p;
  }

  // Floating-point summation can overshoot 1 in the last bits; a p-value above 1
  // is not a thing.
  return { table, pValue: Math.min(1, pValue), oddsRatio };
};
