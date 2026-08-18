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

const runtime = (root: string): LiveMcpRuntime => ({
  pid: 1,
  entrypointRealpath: `${root}/dist/commitlore.mjs`,
  packageRoot: root,
  bundlePresent: true,
  specPresent: true,
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
