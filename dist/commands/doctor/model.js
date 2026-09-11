import { spawnSync } from 'node:child_process';
import { execGit } from '../../core/git.js';
import { discoverLiveMcpRuntimes } from '../../core/mcp-probe.js';
import { openIndex } from '../../core/index-db.js';
/**
 * Whether a skip degrades the report (ADR-0032 §2).
 *
 * `not_applicable` is the check looking and observing a true empty: the world
 * contains nothing for it to inspect. `unverified` is something existing that the
 * check could not read, which is precisely what `degraded` exists to say.
 *
 * The ADR wrote 'a reason cannot be declared without a class -- the type system
 * enforces both' and the map was never built, so `deriveStatus` degraded on every
 * skip. `squash-conservation` skips `nothing_applicable` on any repository with no
 * squash-shaped branch, which is most of them, so a healthy repository could never
 * report `ok` and the headline said some checks could not be verified when all of
 * them had been.
 *
 * `Record<SkipReason, ...>` is the enforcement: a new reason does not compile
 * until it is classified here.
 */
export const SKIP_CLASS = {
    command_unrecognized: 'unverified',
    hook_not_installed: 'not_applicable',
    probe_path_unavailable: 'not_applicable',
    version_unreadable: 'unverified',
    unborn_head: 'not_applicable',
    nothing_applicable: 'not_applicable',
};
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
/**
 * The shipping process effects. Tests pass a complete synthetic context to
 * exercise effect-dependent branches without starting the process they probe.
 */
export const defaultDoctorContext = (opts = {}) => ({
    opts,
    now: process.hrtime.bigint,
    memo: new Map(),
    git: execGit,
    spawn: spawnSync,
    liveMcpRuntimes: discoverLiveMcpRuntimes,
    env: process.env,
    openIndex,
});
//# sourceMappingURL=model.js.map