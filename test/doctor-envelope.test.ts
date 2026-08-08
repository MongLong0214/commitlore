/**
 * #469: the machine-readable doctor report has one final, versioned envelope.
 *
 * These use finished rows directly so they exercise the aggregation contract
 * independently of any particular repository fixture. The runner test in
 * doctor-snapshot.test.ts supplies the complementary crash-containment path.
 */

import { describe, expect, it } from 'vitest';

import { buildReport, deriveInstallSource, deriveStatus } from '../src/commands/doctor/report.js';
import { CHECK_REGISTRY, runDoctor, type CheckDefinition } from '../src/commands/doctor.js';
import type { DoctorCheck } from '../src/commands/doctor/model.js';

const row = (
  id: string,
  status: DoctorCheck['status'],
  overrides: Partial<DoctorCheck> = {},
): DoctorCheck => ({
  id,
  title: `${id} title`,
  status,
  needsAttention: status === 'warn' || status === 'fail',
  detail: `${id} detail`,
  fix: null,
  fixed: false,
  category: 'runtime',
  severity: status === 'fail' ? 'error' : status === 'warn' ? 'warning' : 'info',
  evidence: { observed: id },
  optional: false,
  durationMs: 0,
  ...(status === 'skipped' ? { skipReason: 'nothing_applicable' as const } : {}),
  ...overrides,
});

describe('#469 doctor JSON envelope', () => {
  it('derives status from non-optional final rows only', () => {
    expect(deriveStatus([row('ok', 'ok')])).toBe('ok');
    expect(deriveStatus([row('warn', 'warn')])).toBe('degraded');
    expect(deriveStatus([row('skipped', 'skipped')])).toBe('degraded');
    expect(deriveStatus([row('fail', 'fail')])).toBe('failed');
    expect(deriveStatus([row('optional-fail', 'fail', { optional: true })])).toBe('ok');
  });

  it('keeps an optional failure out of status and the exit code', () => {
    const report = buildReport([row('informational', 'fail', { optional: true, durationMs: 4 })]);

    expect(report.status).toBe('ok');
    expect(report.exitCode).toBe(0);
    expect(report.fixPlan).toEqual(['informational']);
  });

  it('keeps a registry-declared optional failure out of the runner envelope', () => {
    const original = CHECK_REGISTRY.map((definition) => ({
      definition,
      run: definition.run,
      optional: definition.optional,
    }));
    const optionalFailure = CHECK_REGISTRY[0];
    if (optionalFailure === undefined) throw new Error('doctor registry is empty');

    try {
      for (const definition of CHECK_REGISTRY) {
        (definition as { run: CheckDefinition['run'] }).run = () =>
          row(definition.id, definition === optionalFailure ? 'fail' : 'ok');
      }
      (optionalFailure as { optional: boolean }).optional = true;

      const report = runDoctor();
      expect(report.status).toBe('ok');
      expect(report.exitCode).toBe(0);
    } finally {
      for (const saved of original) {
        (saved.definition as { run: CheckDefinition['run'] }).run = saved.run;
        (saved.definition as { optional: boolean }).optional = saved.optional;
      }
    }
  });

  it('marks a non-optional skipped check degraded without failing the command', () => {
    const report = buildReport([row('unverified', 'skipped')]);

    expect(report.status).toBe('degraded');
    expect(report.exitCode).toBe(0);
  });

  it('counts every final row and sums their measured durations', () => {
    const report = buildReport([
      row('healthy', 'ok', { durationMs: 2 }),
      row('warning', 'warn', { durationMs: 3 }),
      row('failure', 'fail', { durationMs: 5 }),
      row('not-run', 'skipped', { durationMs: 7 }),
    ]);

    expect(report.summary).toEqual({
      total: 4,
      ok: 1,
      warn: 1,
      fail: 1,
      skipped: 1,
      durationMs: 17,
    });
    expect(report.summary.ok + report.summary.warn + report.summary.fail + report.summary.skipped).toBe(
      report.summary.total,
    );
    expect(report.summary.total).toBe(report.checks.length);
    expect(report.summary.durationMs).toBe(
      report.checks.reduce((total, check) => total + (check.durationMs ?? 0), 0),
    );
  });

  it('pins the v2 schema and leaves selection absent on a full run', () => {
    const report = buildReport([row('healthy', 'ok')]);

    expect(report.schema).toBe('commitlore_doctor.v2');
    expect(report.version).not.toBe('');
    expect(['plugin', 'npm', 'npx', 'source', 'unknown']).toContain(report.installSource);
    expect('selection' in report).toBe(false);
    expect(JSON.stringify(report)).not.toContain('"selection":null');
  });

  it('detects the documented installation channels without spawning a process', () => {
    expect(deriveInstallSource({ pluginRoot: '/plugin/root' })).toBe('plugin');
    expect(deriveInstallSource({ pluginRoot: '' })).toBe('source');
    expect(
      deriveInstallSource({
        entryPath: '/private/tmp/_npx/hash/node_modules/commitlore/dist/commitlore.mjs',
        packageRoot: '/missing',
        pluginRoot: '',
      }),
    ).toBe('npx');
    expect(
      deriveInstallSource({
        entryPath: '/usr/local/lib/node_modules/commitlore/dist/commitlore.mjs',
        packageRoot: '/missing',
        pluginRoot: '',
      }),
    ).toBe('npm');
    expect(
      deriveInstallSource({
        entryPath: '/missing/commitlore.mjs',
        packageRoot: '/missing',
        pluginRoot: '',
      }),
    ).toBe('unknown');
  });
});
