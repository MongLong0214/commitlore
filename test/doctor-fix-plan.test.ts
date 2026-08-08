/**
 * #468: remediation planning is pure report logic. Rendering and envelope
 * wiring land separately, so these assertions use only synthetic check rows.
 */

import { describe, expect, it } from 'vitest';

import { computeFixPlan, deriveHeadline } from '../src/commands/doctor/report.js';
import type { DoctorCheck } from '../src/commands/doctor/model.js';

type CheckOverrides = Partial<Omit<DoctorCheck, 'id' | 'status'>>;

const check = (
  id: string,
  status: DoctorCheck['status'],
  overrides: CheckOverrides = {},
): DoctorCheck => ({
  id,
  title: `${id} title`,
  status,
  needsAttention: status === 'fail' || status === 'warn',
  detail: `${id} detail`,
  fix: `${id} fix`,
  fixed: false,
  category: 'runtime',
  severity: status === 'fail' ? 'error' : status === 'warn' ? 'warning' : 'info',
  evidence: { source: 'fixture' },
  optional: false,
  ...overrides,
});

describe('#468 doctor fix plan and headline', () => {
  it('includes a dead hook runtime but not its blocked commit-msg-hook dependent', () => {
    const checks = [
      check('commit-msg-hook', 'fail', { blockedBy: 'hook-runtime' }),
      check('hook-runtime', 'fail'),
    ];

    expect(computeFixPlan(checks)).toEqual(['hook-runtime']);
  });

  it('keeps an independent defect when another finding is blocked', () => {
    const checks = [
      check('hook-runtime', 'fail'),
      check('commit-msg-hook', 'fail', { blockedBy: 'hook-runtime' }),
      check('pending-backlog', 'warn'),
    ];

    expect(computeFixPlan(checks)).toEqual(['hook-runtime', 'pending-backlog']);
  });

  it('puts failures before warnings while retaining registry order within each tier', () => {
    const checks = [
      check('warn-first', 'warn'),
      check('fail-first', 'fail'),
      check('warn-second', 'warn'),
      check('fail-second', 'fail'),
    ];

    expect(computeFixPlan(checks)).toEqual([
      'fail-first',
      'fail-second',
      'warn-first',
      'warn-second',
    ]);
  });

  it('is stable across identical runs', () => {
    const checks = [
      check('warn-first', 'warn'),
      check('fail-first', 'fail'),
      check('fail-second', 'fail'),
      check('warn-second', 'warn'),
    ];
    const expected = computeFixPlan(checks);

    for (let run = 0; run < 10; run += 1) expect(computeFixPlan(checks)).toEqual(expected);
  });

  it('keeps a failed optional check in the plan', () => {
    expect(computeFixPlan([check('informational-check', 'fail', { optional: true })])).toEqual([
      'informational-check',
    ]);
  });

  it('does not cap twenty synthetic findings', () => {
    const checks = Array.from({ length: 20 }, (_, index) =>
      check(`finding-${String(index + 1)}`, index < 10 ? 'fail' : 'warn'),
    );

    expect(computeFixPlan(checks)).toHaveLength(20);
    expect(computeFixPlan(checks)).toEqual(checks.map((entry) => entry.id));
  });

  it('uses the first planned check as the next action', () => {
    const checks = [check('hook-runtime', 'fail'), check('pending-backlog', 'warn')];

    expect(deriveHeadline({ checks, fixPlan: computeFixPlan(checks), status: 'failed' })).toBe(
      'Next action [hook-runtime]: hook-runtime detail — hook-runtime fix',
    );
  });

  it('omits the separator when the first action has no fix', () => {
    const checks = [check('crash-row', 'fail', { detail: 'contained throw', fix: null })];

    expect(deriveHeadline({ checks, fixPlan: ['crash-row'], status: 'failed' })).toBe(
      'Next action [crash-row]: contained throw',
    );
  });

  it('distinguishes a healthy empty plan from an unverified one', () => {
    const healthy = deriveHeadline({ checks: [], fixPlan: [], status: 'ok' });
    const degraded = deriveHeadline({ checks: [], fixPlan: [], status: 'degraded' });
    const failed = deriveHeadline({ checks: [], fixPlan: [], status: 'failed' });

    expect(healthy).toBe('Doctor is healthy.');
    expect(degraded).toBe('Doctor is usable; some checks could not be verified.');
    expect(degraded).not.toContain('healthy');
    expect(failed).not.toContain('healthy');
  });
});
