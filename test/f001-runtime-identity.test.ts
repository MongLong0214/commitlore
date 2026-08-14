/**
 * F-001: a registered command and its reported version do not identify the
 * process currently answering an MCP session.  The process entrypoint and its
 * package root do.
 */

import { describe, expect, it } from 'vitest';

import { defaultDoctorContext, type DoctorContext } from '../src/commands/doctor/model.js';
import { runDoctor } from '../src/commands/doctor.js';
import type { LiveMcpRuntime } from '../src/core/mcp-probe.js';

type LiveRuntimeFixture = LiveMcpRuntime & { reportedVersion: string };

const runtime = (
  root: string,
  reportedVersion: string,
  assets: Pick<LiveRuntimeFixture, 'bundlePresent' | 'specPresent'> = {
    bundlePresent: true,
    specPresent: true,
  },
): LiveRuntimeFixture => ({
  pid: 3,
  entrypointRealpath: `${root}/dist/commitlore.mjs`,
  packageRoot: root,
  reportedVersion,
  ...assets,
});

/**
 * The production seam calls `ps`; these fixtures make the regression portable
 * and prove doctor judges the process table rather than a registration file.
 */
const doctorFor = (liveMcpRuntimes: readonly LiveRuntimeFixture[]) => {
  const context: DoctorContext = { ...defaultDoctorContext(), liveMcpRuntimes: () => ({
    available: true,
    runtimes: liveMcpRuntimes,
    detail: 'fixture process table',
  }) };
  return runDoctor({ only: ['mcp-runtime-identity'] }, context);
};

const runtimeCheck = (liveMcpRuntimes: readonly LiveRuntimeFixture[]) =>
  doctorFor(liveMcpRuntimes).checks.find((check) => check.id === 'mcp-runtime-identity');

describe('F-001 live MCP runtime identity', () => {
  it('does not report all-green while two distinct live runtimes answer MCP', () => {
    const first = runtime('/fixtures/commitlore/v0.8.1', '0.8.1');
    const second = runtime('/fixtures/commitlore/v0.8.2', '0.8.2');

    const check = runtimeCheck([first, second]);

    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('2 distinct live CommitLore runtimes');
    expect(check?.detail).toContain(first.entrypointRealpath);
    expect(check?.detail).toContain(second.packageRoot);
  });

  it('reports a live runtime without its bundle and spec as unusable, naming its root', () => {
    const deleted = runtime('/fixtures/commitlore/deleted-0.6.0', '0.6.0', {
      bundlePresent: false,
      specPresent: false,
    });

    const check = runtimeCheck([deleted]);

    expect(check?.status).toBe('fail');
    expect(check?.detail).toContain('unusable');
    expect(check?.detail).toContain(deleted.packageRoot);
    expect(check?.detail).toContain('dist/commitlore.mjs');
    expect(check?.detail).toContain('spec/SPEC.md');
  });

  it('treats matching reported versions at different roots as a runtime mismatch', () => {
    const cli = runtime('/fixtures/commitlore/v0.8.2', '0.8.2');
    const stale = runtime('/fixtures/commitlore/dev-3b70a1bebfb3', '0.8.2');

    const check = runtimeCheck([cli, stale]);

    expect(cli.reportedVersion).toBe(stale.reportedVersion);
    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('runtime mismatch');
    expect(check?.detail).toContain(cli.packageRoot);
    expect(check?.detail).toContain(stale.packageRoot);
  });
});
