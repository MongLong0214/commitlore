/**
 * The gate that keeps `engines.node` honest, and the bug that broke it.
 *
 * `check-engines.mjs` read the declared range by scanning it for digits and
 * taking the smallest, so `>=22.5` became **Node 5**. Every dependency was then
 * measured against a floor nobody had declared, the required `check (22)` and
 * `check (24)` jobs failed at that step, and typecheck, build, the whole suite,
 * dogfooding and the performance gate never ran behind it.
 *
 * It survived because the parser was inline in a script with no test of its
 * own. This file is that test.
 */

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs helper, deliberately not part of the build.
import { admits, compare, parseVersion, rangeMinimum } from '../scripts/engine-floor.mjs';

describe('reading the lowest version a range admits', () => {
  it.each([
    ['>=22', [22, 0, 0]],
    ['>=22.5', [22, 5, 0]],
    ['>=22.12.0', [22, 12, 0]],
    ['22.x || 24.x', [22, 0, 0]],
    ['^22.12.0', [22, 12, 0]],
    ['~22.12.3', [22, 12, 3]],
    ['>=20 || >=24', [20, 0, 0]],
    ['v22.12.0', [22, 12, 0]],
  ] satisfies [string, number[]][])('reads %s as %s', (range, expected) => {
    expect(rangeMinimum(range)).toEqual(expected);
  });

  it('is unreadable rather than wrong when there is no version in it', () => {
    expect(rangeMinimum('*')).toBeNull();
    expect(rangeMinimum('')).toBeNull();
    expect(rangeMinimum('not a range')).toBeNull();
  });

  it('does not read a minor as a major', () => {
    // The exact defect: `[22, 5]` scanned as digits, `Math.min` taken, floor 5.
    expect(rangeMinimum('>=22.5')).not.toEqual([5, 0, 0]);
    expect(rangeMinimum('>=22.5')![0]).toBe(22);
  });
});

describe('whether a range admits the declared floor', () => {
  it('compares versions, not majors', () => {
    // The second half of the same defect: reading only the major said
    // `>=22.12.0` admitted 22.5.0, so a real mismatch read as agreement.
    expect(admits('>=22.12.0', parseVersion('22.5.0'))).toBe(false);
    expect(admits('>=22.12.0', parseVersion('22.12.0'))).toBe(true);
    expect(admits('>=22.12.0', parseVersion('24.0.0'))).toBe(true);
  });

  /**
   * The caret, tilde and bare-version branch had the defect the `>=` branch was
   * fixed for: it returned true whenever the majors matched, so `^22.13.0`
   * admitted 22.12.0. The table below could not have caught it — every entry
   * was a `>=` form, a `*`, or `^18.0.0 || >=20.0.0`, whose second clause
   * returns first. Nothing exercised the branch at all.
   *
   * These are the windows each operator actually denotes. `^` allows the rest
   * of the major, `~` the rest of the minor, and a bare version is bounded by
   * whatever it leaves unstated: `22` is all of 22, `22.13` is all of 22.13,
   * and `22.13.0` is only itself.
   */
  it.each([
    ['^22.13.0', '22.12.0', false],
    ['^22.12.0', '22.12.0', true],
    ['^22.12.0', '22.13.0', true],
    ['^22.12.0', '23.0.0', false],
    ['~22.12.5', '22.12.0', false],
    ['~22.12.0', '22.12.9', true],
    ['~22.12.0', '22.13.0', false],
    ['22.13.0', '22.12.0', false],
    ['22.13.0', '22.13.0', true],
    ['22.13.0', '22.13.1', false],
    ['22', '22.12.0', true],
    ['22.x', '22.12.0', true],
    ['22', '23.0.0', false],
    ['22.13', '22.13.9', true],
    ['22.13', '22.12.0', false],
  ] satisfies [string, string, boolean][])(
    'the %s window admits %s: %s',
    (range, version, expected) => {
      expect(admits(range, parseVersion(version))).toBe(expected);
    },
  );

  it.each([
    ['>=18', '22.12.0', true],
    ['^18.0.0 || >=20.0.0', '22.12.0', true],
    ['>=14.17', '22.12.0', true],
    ['*', '22.12.0', true],
    ['>=24', '22.12.0', false],
  ] satisfies [string, string, boolean][])('%s admits %s: %s', (range, version, expected) => {
    expect(admits(range, parseVersion(version))).toBe(expected);
  });
});

describe('ordering', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compare([22, 5, 0], [22, 12, 0])).toBeLessThan(0);
    expect(compare([22, 12, 0], [22, 12, 0])).toBe(0);
    expect(compare([24, 0, 0], [22, 99, 99])).toBeGreaterThan(0);
  });
});
