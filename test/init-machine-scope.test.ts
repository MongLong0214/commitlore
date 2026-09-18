/**
 * #750: `init` reported failure because of a process on the developer's machine.
 *
 * `init`'s final step runs `doctor` and is stricter than `doctor` is: any check
 * needing attention makes the step incomplete, on the reasoning that `init` is
 * the command that was supposed to take care of everything. That reasoning does
 * not reach a finding about the machine. A CommitLore MCP server another
 * session left running -- from an install that may since have been deleted --
 * is not something a checkout can act on, and `<data-root>` keeps old versions
 * by design, so this is the ordinary state of a developer machine rather than a
 * misconfiguration.
 *
 * The cost was a suite that told the truth on CI and lied everywhere else: six
 * cases in `test/init.test.ts` failed for anybody with an editor session open.
 * A red file that is usually red stops carrying information, and twice in one
 * session I attributed it to a change of my own before checking `origin/main`,
 * where it failed identically.
 *
 * This pins the property rather than the symptom. The symptom needs a stale
 * server running to reproduce, which is exactly the dependency being removed.
 */

import { describe, expect, it } from 'vitest';

import { checkMcpRuntimeIdentity } from '../src/commands/doctor/checks/delivery-mcp-runtime-identity.js';
import type { DoctorContext } from '../src/commands/doctor/model.js';
import type { LiveMcpRuntime, LiveMcpScan } from '../src/core/mcp-probe.js';
import { runtimeIdentity } from '../src/core/runtime-identity.js';

const runtime = (root: string, reportedVersion?: string): LiveMcpRuntime => ({
  pid: 1,
  entrypointRealpath: `${root}/dist/commitlore.mjs`,
  packageRoot: root,
  bundlePresent: true,
  specPresent: true,
  // Absent unless a case is about the version: `test/` is outside `tsconfig`'s
  // `include`, so an omitted field is `undefined` at runtime, and it stands in
  // for the runtime whose package.json could not be read.
  ...(reportedVersion === undefined ? {} : { reportedVersion }),
});

const contextWith = (scan: LiveMcpScan): DoctorContext =>
  ({ liveMcpRuntimes: () => scan }) as unknown as DoctorContext;

describe('#750 a finding about the machine does not fail a repository command', () => {
  it('warns about two live runtimes without claiming attention', () => {
    const row = checkMcpRuntimeIdentity(
      contextWith({
        available: true,
        detail: 'process list',
        runtimes: [runtime('/data/v1.0.1'), runtime('/data/v1.1.1')],
      }),
    );

    // Still visible -- the report is where this belongs.
    expect(row.status).toBe('warn');
    expect(row.detail).toMatch(/distinct live CommitLore runtimes/);
    // But `init` must not read it as a step that did not complete.
    expect(row.needsAttention, 'a leftover server on the machine failed a repository command').toBe(
      false,
    );
  });

  it('does not claim attention when the scan itself could not run', () => {
    const row = checkMcpRuntimeIdentity(
      contextWith({ available: false, detail: 'ps unavailable', runtimes: [] }),
    );
    expect(row.status).toBe('warn');
    expect(row.needsAttention).toBe(false);
  });

  it('does not claim attention for a runtime whose install was deleted', () => {
    const row = checkMcpRuntimeIdentity(
      contextWith({
        available: true,
        detail: 'process list',
        runtimes: [{ ...runtime('/data/v0.8.0'), bundlePresent: false }],
      }),
    );
    expect(row.status).toBe('warn');
    expect(row.detail).toMatch(/unusable/);
    expect(row.needsAttention).toBe(false);
  });

  it('is still ok, and still not claiming attention, when one runtime answers', () => {
    const row = checkMcpRuntimeIdentity(
      contextWith({ available: true, detail: 'process list', runtimes: [runtime('/data/v1.1.2')] }),
    );
    expect(row.status).toBe('ok');
    expect(row.needsAttention).toBe(false);
  });
});

/**
 * One live runtime was `ok` whatever build it was serving.
 *
 * The row groups by path, so a single runtime had nothing to disagree with. That
 * made the ordinary upgrade invisible: the session you left open keeps answering
 * from the build it started on, every record it writes is written by that build's
 * rules, and doctor reported no finding. The machine this was written on tripped
 * the multi-runtime warning only because it happened to have five.
 *
 * `runtime-identity` does compare versions, but against the last server to log a
 * start here, which need not be alive -- that day it reported "all observed
 * runtimes match CLI: v1.5.0" about a process that had already exited.
 */
describe('a live runtime that is not the installed build', () => {
  const installed = runtimeIdentity().version;

  it('warns, names both versions, and tells the reader how to reconnect', () => {
    const row = checkMcpRuntimeIdentity(
      contextWith({
        available: true,
        detail: 'process list',
        runtimes: [runtime('/data/v1.3.14', '1.3.14')],
      }),
    );

    expect(row.status).toBe('warn');
    expect(row.detail).toContain('1.3.14');
    expect(row.detail).toContain(installed);
    expect(row.fix).toMatch(/\/mcp/);
    expect(row.evidence['live_version']).toBe('1.3.14');
    expect(row.evidence['installed_version']).toBe(installed);
    // #750 again: a process on the developer's machine must not fail `init`.
    expect(row.needsAttention).toBe(false);
  });

  it('stays ok when the live runtime reports the installed version', () => {
    // The control. Without it this file would pass just as well against a check
    // that warned on every single runtime, which is the row #924 ruled out --
    // one that fires on every healthy repository.
    const row = checkMcpRuntimeIdentity(
      contextWith({
        available: true,
        detail: 'process list',
        runtimes: [runtime('/data/current', installed)],
      }),
    );

    expect(row.status).toBe('ok');
    expect(row.detail).toContain(installed);
    expect(row.evidence['live_version']).toBe(installed);
  });

  it('stays ok when the runtime did not report a version at all', () => {
    // An unread package.json is not evidence of staleness. The `ok` says so
    // rather than implying the build was checked.
    const row = checkMcpRuntimeIdentity(
      contextWith({ available: true, detail: 'process list', runtimes: [runtime('/data/silent')] }),
    );

    expect(row.status).toBe('ok');
    expect(row.detail).toMatch(/did not report a version/);
    expect(row.evidence['live_version']).toBe('unreported');
  });

  it('names which of several runtimes are behind, without calling any of them current', () => {
    const row = checkMcpRuntimeIdentity(
      contextWith({
        available: true,
        detail: 'process list',
        runtimes: [
          { ...runtime('/data/v1.3.14', '1.3.14'), pid: 11 },
          { ...runtime('/data/v1.3.17', '1.3.17'), pid: 22 },
          { ...runtime('/data/matching', installed), pid: 33 },
        ],
      }),
    );

    expect(row.status).toBe('warn');
    expect(row.evidence['differing_versions']).toBe('1.3.14 pid 11, 1.3.17 pid 22');
    // #660: equal versions do not make two runtimes the same install, so pid 33
    // is never described as the current one -- only the other two as not this
    // build. The first draft of this assertion matched the fixture's own path
    // (`/data/current`) rather than any claim the row made.
    expect(row.detail).not.toMatch(/is (the )?(current|up to date)/i);
    expect(row.needsAttention).toBe(false);
  });
});
