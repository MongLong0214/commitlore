/**
 * Doctor's registry runner.
 *
 * It owns exception containment and timing around the ordered registry, so
 * check modules only decide their own verdicts and rendering cannot alter run order.
 */
import { check } from './model.js';
import { CHECK_REGISTRY } from './registry.js';
import { buildReport } from './report.js';
/**
 * A check that threw becomes a row rather than a stack trace.
 *
 * The user who most needs a diagnosis is the one whose repository is in a
 * state some check did not anticipate. Losing the other twelve answers to that
 * is the worst possible trade, so the throw is contained and reported as what
 * it is: this check could not complete.
 */
const containedRun = (definition, ctx, dependencies) => {
    try {
        return definition.run(ctx, dependencies);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return check(definition.id, definition.category, definition.title, 'fail', 'this check could not complete, so its subsystem is unreported', null, false, true, {
            evidence: { error: message.split('\n')[0] ?? 'unknown error' },
            optional: definition.optional,
        });
    }
};
const statusRank = (status) => status === 'fail' ? 3 : status === 'warn' ? 2 : status === 'skipped' ? 1 : 0;
const collapseBlockedBy = (checks) => {
    const byId = new Map(checks.map((row) => [row.id, row]));
    return checks.map((row) => {
        if (row.blockedBy === undefined)
            return row;
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
export const runDoctor = (opts = {}) => {
    const ctx = { opts, now: process.hrtime.bigint, memo: new Map() };
    const completed = new Map();
    const checks = CHECK_REGISTRY.map((definition) => {
        const dependencies = new Map();
        for (const dependency of definition.dependencies) {
            const row = completed.get(dependency);
            if (row === undefined) {
                throw new Error(`doctor check ${definition.id} depends on ${dependency}, which has not run`);
            }
            dependencies.set(dependency, row);
        }
        const started = ctx.now();
        const contained = containedRun(definition, ctx, dependencies);
        // The registry is the declaration point for optionality. Containment must
        // preserve it, and a check implementation cannot accidentally disagree.
        const row = contained.optional === definition.optional
            ? contained
            : { ...contained, optional: definition.optional };
        const elapsed = Number((ctx.now() - started) / 1000000n);
        const timed = { ...row, durationMs: elapsed < 0 ? 0 : elapsed };
        completed.set(definition.id, timed);
        return timed;
    });
    const collapsed = collapseBlockedBy(checks);
    return buildReport(collapsed);
};
//# sourceMappingURL=runner.js.map