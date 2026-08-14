/**
 * A check that reads the process table must not read itself.
 *
 * `doctor` spawns an MCP probe of its own while it runs, and that child matches
 * the same pattern `discoverLiveMcpRuntimes` looks for. Two consecutive `doctor`
 * runs then see each other's probes, so a report that is supposed to be
 * byte-identical across runs is not — which is how this surfaced, as
 * `matches NO_COLOR output byte-for-byte` failing on a change that touched
 * neither.
 *
 * The measurement here is narrower and does not depend on timing: a runtime this
 * process started is this process's business, and enumerating it as though it
 * were somebody else's session is the defect.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { discoverLiveMcpRuntimes } from '../src/core/mcp-probe.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(PACKAGE_ROOT, 'dist', 'commitlore.mjs');

let child: ChildProcess | undefined;

const settle = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

beforeAll(async () => {
  // The shape doctor produces: a server this process owns, alive while the
  // enumeration runs.
  child = spawn(process.execPath, [BUNDLE, 'mcp'], {
    cwd: PACKAGE_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await settle(1_500);
});

afterAll(() => {
  child?.kill('SIGKILL');
});

describe('#661 the live-runtime scan does not enumerate its own descendants', () => {
  it('omits a server this process started', () => {
    const scan = discoverLiveMcpRuntimes();

    // Guard the guard: on a platform without `ps` the scan reports unavailable
    // and the assertion below would pass while measuring nothing.
    expect(scan.available, 'process enumeration must be available for this to mean anything').toBe(true);
    expect(child?.pid, 'the fixture server must have started').toBeTypeOf('number');

    expect(
      scan.runtimes.map((runtime) => runtime.pid),
      'a runtime this process owns is not another session answering',
    ).not.toContain(child?.pid);
  });

  it('answers identically across repeated calls while it owns a server', () => {
    const first = JSON.stringify(discoverLiveMcpRuntimes().runtimes.map((runtime) => runtime.pid).sort());
    const second = JSON.stringify(discoverLiveMcpRuntimes().runtimes.map((runtime) => runtime.pid).sort());

    expect(second, 'the same question asked twice must give the same answer').toBe(first);
  });
});
