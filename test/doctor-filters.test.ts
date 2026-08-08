/**
 * #471: filters choose registry entries before a diagnostic starts. A filtered
 * report is useful only when it names both what it ran and what it did not.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { CHECK_REGISTRY, runDoctor, type CheckDefinition } from '../src/commands/doctor.js';
import { check, type DoctorCheck, type DoctorContext } from '../src/commands/doctor/model.js';
import type { GitResult } from '../src/core/git.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const noRepository = join(tmpdir(), `commitlore-doctor-filters-no-repository-${process.pid}`);

const gitResult = (overrides: Partial<GitResult> = {}): GitResult => ({
  code: 1,
  stdout: '',
  stderr: 'synthetic git failure',
  ...overrides,
});

const childResult = (overrides: Record<string, unknown> = {}) => ({
  pid: 0,
  output: [null, '', ''],
  stdout: 'v0.0.0\n',
  stderr: '',
  status: 0,
  signal: null,
  ...overrides,
});

const context = (overrides: Partial<DoctorContext> = {}): DoctorContext => ({
  opts: { cwd: noRepository },
  now: () => 0n,
  memo: new Map(),
  git: vi.fn(() => gitResult()) as DoctorContext['git'],
  spawn: vi.fn(() => childResult()) as DoctorContext['spawn'],
  env: {},
  openIndex: vi.fn(() => {
    throw new Error('synthetic missing index');
  }) as DoctorContext['openIndex'],
  ...overrides,
});

const row = (id: string, status: DoctorCheck['status']): DoctorCheck =>
  check(
    id,
    'runtime',
    id,
    status === 'skipped' ? 'skipped' : status,
    `${id} result`,
    null,
    false,
    status === 'warn' || status === 'fail',
    status === 'skipped'
      ? { evidence: { selected: id }, skipReason: 'nothing_applicable' }
      : { evidence: { selected: id } },
  );

const invokeCli = (args: string[]) =>
  spawnSync(process.execPath, [join(PACKAGE_ROOT, 'dist/commitlore.mjs'), ...args], {
    encoding: 'utf8',
  });

describe('#471 doctor filters', () => {
  it('filters before execution: an unselected check produces no Git call or spawn', () => {
    expect(existsSync(noRepository)).toBe(false);
    const git = vi.fn(() => gitResult());
    const spawn = vi.fn(() => childResult());
    const openIndex = vi.fn(() => {
      throw new Error('unselected index check ran');
    });

    const report = runDoctor(
      { cwd: noRepository, only: ['cli-runtime'] },
      context({
        git: git as DoctorContext['git'],
        spawn: spawn as DoctorContext['spawn'],
        openIndex: openIndex as DoctorContext['openIndex'],
      }),
    );

    expect(report.checks.map((entry) => entry.id)).toEqual(['cli-runtime']);
    expect(spawn).toHaveBeenCalledOnce(); // cli-runtime's own `--version` probe
    expect(git).not.toHaveBeenCalled();
    expect(openIndex).not.toHaveBeenCalled();
  });

  it('puts selection, status, and the partial-run headline on the selected rows only', () => {
    const registry = CHECK_REGISTRY as CheckDefinition[];
    const original = [...registry];
    const selectedRun = vi.fn(() => row('selected', 'ok'));
    const unselectedRun = vi.fn(() => row('unselected', 'fail'));

    registry.splice(
      0,
      registry.length,
      {
        id: 'selected',
        title: 'selected',
        category: 'runtime',
        dependencies: [],
        optional: false,
        run: selectedRun,
      },
      {
        id: 'unselected',
        title: 'unselected',
        category: 'capture',
        dependencies: [],
        optional: false,
        run: unselectedRun,
      },
    );

    try {
      const full = runDoctor({}, context());
      const filtered = runDoctor({ only: ['selected'] }, context());

      expect('selection' in full).toBe(false);
      expect(filtered.selection).toEqual(['selected']);
      expect(JSON.stringify(filtered)).not.toContain('"selection":null');
      expect(filtered.checks.map((entry) => entry.id)).toEqual(['selected']);
      expect(filtered.status).toBe('ok');
      expect(filtered.exitCode).toBe(0);
      expect(filtered.headline).toBe('1 of 2 checks run — Doctor is healthy.');
      expect(selectedRun).toHaveBeenCalledTimes(2);
      expect(unselectedRun).toHaveBeenCalledOnce(); // the full run only
    } finally {
      registry.splice(0, registry.length, ...original);
    }
  });

  it('selects an entire category in registry order and records that category', () => {
    const report = runDoctor({ cwd: noRepository, category: 'capture' }, context());

    expect(report.selection).toEqual(['capture']);
    expect(report.checks).not.toHaveLength(0);
    expect(report.checks.every((entry) => entry.category === 'capture')).toBe(true);
    expect(report.headline).toMatch(new RegExp(`^${report.checks.length} of ${CHECK_REGISTRY.length} checks run — `));
  });

  it('accepts comma-separated ids and still emits rows in registry order', () => {
    const result = invokeCli(['doctor', '--only', 'git-trailers,cli-runtime', '--json']);
    const report = JSON.parse(result.stdout) as { selection: string[]; checks: Array<{ id: string }> };

    expect(result.status).toBe(0);
    expect(report.selection).toEqual(['git-trailers', 'cli-runtime']);
    expect(report.checks.map((entry) => entry.id)).toEqual(['cli-runtime', 'git-trailers']);
  });

  it('rejects unknown ids and categories before any injected effect runs', () => {
    const git = vi.fn(() => gitResult());
    const spawn = vi.fn(() => childResult());
    const openIndex = vi.fn(() => {
      throw new Error('unexpected index open');
    });
    const effects = context({
      git: git as DoctorContext['git'],
      spawn: spawn as DoctorContext['spawn'],
      openIndex: openIndex as DoctorContext['openIndex'],
    });

    expect(() => runDoctor({ only: ['no-such-check'] }, effects)).toThrow('unknown doctor check id');
    expect(() => runDoctor({ category: 'no-such-category' }, effects)).toThrow('unknown doctor check category');
    expect(git).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(openIndex).not.toHaveBeenCalled();
  });

  it('reports unknown selections as exit 2 with no JSON or other stdout', () => {
    for (const args of [
      ['doctor', '--only', 'no-such-check', '--json'],
      ['doctor', '--category', 'no-such-category', '--json'],
    ]) {
      const result = invokeCli(args);

      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('unknown doctor check');
    }
  });

  it('documents all doctor exit codes in help', () => {
    const result = invokeCli(['doctor', '--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Exit codes:.*\b0\b.*\b1\b.*\b2\b/s);
  });
});
