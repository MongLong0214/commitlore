/**
 * Doctor's registry runner.
 *
 * It owns exception containment and timing around the ordered registry, so
 * check modules only decide their own verdicts and rendering cannot alter run order.
 */

import { check, type DoctorCheck, type DoctorContext, type DoctorOptions, type DoctorReport } from './model.js';
import { CHECK_REGISTRY, type CheckDefinition } from './registry.js';

/**
 * A check that threw becomes a row rather than a stack trace.
 *
 * The user who most needs a diagnosis is the one whose repository is in a
 * state some check did not anticipate. Losing the other twelve answers to that
 * is the worst possible trade, so the throw is contained and reported as what
 * it is: this check could not complete.
 */
const containedRun = (
  definition: CheckDefinition,
  ctx: DoctorContext,
  dependencies: ReadonlyMap<string, DoctorCheck>,
): DoctorCheck => {
  try {
    return definition.run(ctx, dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return check(
      definition.id,
      definition.category,
      definition.title,
      'fail',
      'this check could not complete, so its subsystem is unreported',
      null,
      false,
      true,
      { evidence: { error: message.split('\n')[0] ?? 'unknown error' } },
    );
  }
};

const statusRank = (status: DoctorCheck['status']): number =>
  status === 'fail' ? 3 : status === 'warn' ? 2 : status === 'skipped' ? 1 : 0;

const collapseBlockedBy = (checks: readonly DoctorCheck[]): DoctorCheck[] => {
  const byId = new Map(checks.map((row) => [row.id, row]));

  return checks.map((row) => {
    if (row.blockedBy === undefined) return row;

    const visited = new Set([row.id]);
    let root = byId.get(row.blockedBy);
    while (root !== undefined && root.blockedBy !== undefined) {
      if (visited.has(root.id)) {
        throw new Error(`doctor check ${row.id} has a cyclic blockedBy chain`);
      }
      visited.add(root.id);
      root = byId.get(root.blockedBy);
    }
    if (root === undefined) {
      throw new Error(`doctor check ${row.id} names an unknown blocker`);
    }
    if (root.status === 'ok') {
      throw new Error(`doctor check ${row.id} names an ok blocker`);
    }
    if (statusRank(row.status) > statusRank(root.status)) {
      throw new Error(`doctor check ${row.id} is more severe than its blocker`);
    }
    return root.id === row.blockedBy ? row : { ...row, blockedBy: root.id };
  });
};

export const runDoctor = (opts: DoctorOptions = {}): DoctorReport => {
  const ctx: DoctorContext = { opts, now: process.hrtime.bigint, memo: new Map() };
  const completed = new Map<string, DoctorCheck>();
  const checks = CHECK_REGISTRY.map((definition) => {
    const dependencies = new Map<string, DoctorCheck>();
    for (const dependency of definition.dependencies) {
      const row = completed.get(dependency);
      if (row === undefined) {
        throw new Error(`doctor check ${definition.id} depends on ${dependency}, which has not run`);
      }
      dependencies.set(dependency, row);
    }
    const started = ctx.now();
    const row = containedRun(definition, ctx, dependencies);
    const elapsed = Number((ctx.now() - started) / 1_000_000n);
    const timed = { ...row, durationMs: elapsed < 0 ? 0 : elapsed };
    completed.set(definition.id, timed);
    return timed;
  });
  const collapsed = collapseBlockedBy(checks);
  return {
    checks: collapsed,
    exitCode: collapsed.some((entry) => entry.status === 'fail') ? 1 : 0,
  };
};
