/**
 * Doctor's model and construction seam.
 *
 * Check modules share the frozen report shapes, factory, and observation
 * helpers here so that each can own one diagnosis without reaching into a
 * sibling check. Construction stays central because status-derived fields and
 * non-empty evidence are report-wide invariants, not per-check conventions.
 */
/** Probe message for the git capability check — one trailer of each shape. */
export const PROBE_MESSAGE = 'commitlore doctor probe\n\nLimit: probe\nBlast: local\n';
export const gitOptions = (opts) => (opts.cwd === undefined ? {} : { cwd: opts.cwd });
/** The bound keeps a broken child process from making a JSON report unbounded. */
export const boundedExcerpt = (output) => {
    const [firstLine = ''] = (output ?? '').split(/\r?\n/, 1);
    return {
        firstLine: firstLine.slice(0, 200),
        truncated: firstLine.length > 200 ? 'true' : 'false',
    };
};
export const streamEvidence = (stream, output) => {
    const excerpt = boundedExcerpt(output);
    return {
        [`${stream}_first_line`]: excerpt.firstLine,
        [`${stream}_truncated`]: excerpt.truncated,
    };
};
/** Reports keep paths useful in bug reports without carrying a user's home directory. */
const homeRelativePath = (value) => {
    const home = process.env['HOME'];
    if (home === undefined || home === '')
        return value;
    const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return value.replace(new RegExp(`${escapedHome}(?=$|/)`, 'g'), '~');
};
const normaliseEvidence = (evidence) => Object.fromEntries(Object.entries(evidence).map(([key, value]) => [key, homeRelativePath(value)]));
export const evidenceKey = (value) => value
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'remote';
/**
 * `severity` as a total function of `status` — the only place it is decided.
 *
 * `skipped` maps to `info`, not `warning`: a check that could not run has
 * reported nothing, and giving it a warning's weight is how a report starts
 * ranking its own blind spots above its findings.
 */
const severityOf = (status) => status === 'fail' ? 'error' : status === 'warn' ? 'warning' : 'info';
export function check(id, category, title, status, detail, fix = null, fixed = false, needsAttention = status === 'warn' || status === 'fail', extra = {}) {
    const evidence = extra.evidence ?? {};
    if (Object.keys(evidence).length === 0) {
        throw new Error(`doctor check ${id} has no evidence`);
    }
    return {
        id,
        title,
        status,
        needsAttention,
        detail,
        fix,
        fixed,
        category,
        severity: severityOf(status),
        evidence: normaliseEvidence(evidence),
        optional: extra.optional ?? false,
        ...(extra.skipReason === undefined ? {} : { skipReason: extra.skipReason }),
    };
}
export const blocked = (dependency, row) => {
    if (dependency.status === 'ok') {
        throw new Error(`doctor check ${row.id} cannot repeat an ok finding`);
    }
    return { ...row, blockedBy: dependency.id };
};
//# sourceMappingURL=model.js.map