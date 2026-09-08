/**
 * #885: the row named versions and stopped there.
 *
 * `doctor` reported three distinct live runtimes answering MCP. It was right,
 * and every registration on the machine was correct — the old runtimes were
 * live processes that outlived the upgrade, because a host resolves the
 * launcher once at session start and holds that runtime for as long as the
 * session lives. Agent sessions there ran for days.
 *
 * What made it costly is that these runtimes *write*. Records captured by a
 * session started two days earlier are produced by the build that session
 * started on, while the operator believes the repository is on the release they
 * installed, and nothing on the commit says which runtime produced it. The row
 * named three versions, offered no action, and gave an operator no way to tell
 * whether that was cosmetic or whether half their records came from old code.
 *
 * The scan already knew the pids and dropped them on the way to a deduplicated
 * identity string, so the reporter had to run `ps` themselves to find the five
 * processes behind the three names.
 *
 * What this must NOT do: name one runtime as the stale one. r-liveruntime660
 * ruled that out — a copied or stale install can report the same version as a
 * current one, so a version comparison here proves nothing about identity.
 */

import { describe, expect, it } from 'vitest';

import { checkMcpRuntimeIdentity } from '../src/commands/doctor/checks/delivery-mcp-runtime-identity.js';
import type { DoctorContext } from '../src/commands/doctor/model.js';
import type { LiveMcpRuntime, LiveMcpScan } from '../src/core/mcp-probe.js';

const runtime = (root: string, pid: number): LiveMcpRuntime => ({
  pid,
  entrypointRealpath: `${root}/dist/commitlore.mjs`,
  packageRoot: root,
  bundlePresent: true,
  specPresent: true,
});

const contextWith = (scan: LiveMcpScan): DoctorContext =>
  ({ liveMcpRuntimes: () => scan }) as unknown as DoctorContext;

/** The reporter's machine: five processes, three distinct runtimes. */
const reported = (): LiveMcpScan => ({
  available: true,
  detail: 'process list',
  runtimes: [
    runtime('/data/v1.2.5', 13359),
    runtime('/data/v1.2.3', 19075),
    runtime('/data/v1.2.3', 23251),
    runtime('/data/v1.2.0', 47396),
    runtime('/data/v1.2.0', 4869),
  ],
});

describe('#885 the runtime-mismatch row carries the pids and an action', () => {
  it('names every pid, including two processes sharing one identity', () => {
    const row = checkMcpRuntimeIdentity(contextWith(reported()));

    expect(row.status).toBe('warn');
    for (const pid of [13359, 19075, 23251, 47396, 4869]) {
      expect(row.detail, `pid ${pid} is not in the row`).toContain(String(pid));
    }
    // Three identities behind five processes -- the count must still describe
    // distinct runtimes, not the process total, or "3 distinct" becomes a lie.
    expect(row.detail).toMatch(/^3 distinct live CommitLore runtimes/);
  });

  it('says plainly that the older runtimes are still writing records', () => {
    const row = checkMcpRuntimeIdentity(contextWith(reported()));

    // The operator's actual question was whether this is cosmetic.
    expect(row.detail).toMatch(/writing records/);
  });

  it('offers an action naming the pids to restart', () => {
    const row = checkMcpRuntimeIdentity(contextWith(reported()));

    expect(row.fix, 'the row offered no action at all').not.toBeNull();
    expect(row.fix).toContain('13359');
    // Why restarting is the action and reinstalling is not: the upgrade already
    // happened, and it cannot reach a process that is already running.
    expect(row.fix).toMatch(/session/);
  });

  it('puts the pids in evidence, where a machine reader can use them', () => {
    const row = checkMcpRuntimeIdentity(contextWith(reported()));

    expect(row.evidence['pids']).toBe('13359, 19075, 23251, 47396, 4869');
    expect(row.evidence['distinct_identities']).toBe('3');
    expect(row.evidence['runtime_count']).toBe('5');
  });

  it('does not declare which runtime is the stale one', () => {
    const row = checkMcpRuntimeIdentity(contextWith(reported()));

    // r-liveruntime660: a copied or stale install can report the same version
    // as a current one. The row reports what is running; it does not rank them.
    expect(`${row.detail} ${row.fix ?? ''}`).not.toMatch(/\b(stale|outdated|obsolete)\b/i);
  });

  it('still does not claim attention — this is the machine, not the checkout', () => {
    const row = checkMcpRuntimeIdentity(contextWith(reported()));

    // #750: `init` treats a check needing attention as a step that did not
    // complete, and a leftover server on a developer's machine is not that.
    expect(row.needsAttention).toBe(false);
  });

  it('says nothing about pids or restarting when one runtime answers', () => {
    const row = checkMcpRuntimeIdentity(
      contextWith({ available: true, detail: 'process list', runtimes: [runtime('/data/v1.2.5', 13359)] }),
    );

    expect(row.status).toBe('ok');
    expect(row.fix).toBeNull();
  });
});
