/**
 * Doctor command registration and output selection.
 *
 * This boundary owns Commander integration and choosing JSON versus the text
 * renderer, leaving diagnosis and formatting independently testable.
 *
 * `commitlore doctor` — is this repository able to carry and share records?
 *
 * The mirror in `refs/notes/commitlore` (ADR-0004) only reaches a teammate if
 * their clone is configured to fetch it, which git does not do by default. A
 * clone that skips that step reads an empty mirror and reports "no record" for
 * commits that have one — a silent wrong answer, the most expensive kind here.
 * doctor exists to turn that into a visible, fixable finding.
 *
 * Two boundaries are deliberate:
 *
 * - `--fix` only writes reversible local config (`remote.<name>.fetch`).
 *   Pushing notes is a network write to a shared ref, so doctor prints the
 *   command and lets a human run it.
 * - The commit-msg hook is *reported*, never installed. `commitlore hooks
 *   install` (T-202) owns that file; doctor only reads it.
 *
 * `checkSquashConservation` (ADR-0014, bug-issue-60 finding 1) is the same
 * shape of problem one route over: nothing runs `squash-preserve`
 * automatically, and a squash that happened without it silently drops
 * records the same way an unfetched mirror silently drops them. It is a
 * `doctor` check rather than a CI step because it runs at the moment the
 * mistake is still local and cheap to fix — see the check's own doc comment
 * for the full "Ruled-out" reasoning.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { PACKAGE_ROOT, installedPath, packageVersion } from '../../core/paths.js';
import { formatReport } from './render.js';
import { runDoctor } from './runner.js';
/**
 * The actionable root causes, in the order a user should address them.
 *
 * Filtering happens here; remediation-text deduplication belongs to the text
 * renderer, where it can retain one line for every independently failing row.
 */
export const computeFixPlan = (checks) => [
    ...checks.filter((check) => check.status === 'fail' && check.blockedBy === undefined),
    ...checks.filter((check) => check.status === 'warn' && check.blockedBy === undefined),
].map((check) => check.id);
const headlineWithoutAction = (status) => {
    if (status === 'ok')
        return 'Doctor is healthy.';
    if (status === 'degraded')
        return 'Doctor is usable; some checks could not be verified.';
    return 'Doctor failed; no actionable checks are available.';
};
export const deriveHeadline = (args) => {
    const nextId = args.fixPlan[0];
    if (nextId === undefined)
        return headlineWithoutAction(args.status);
    const next = args.checks.find((check) => check.id === nextId);
    if (next === undefined)
        return headlineWithoutAction(args.status);
    return `Next action [${next.id}]: ${next.detail}${next.fix === null ? '' : ` — ${next.fix}`}`;
};
/**
 * The report's only status derivation.
 *
 * This must receive the runner's final row set, after containment has turned a
 * thrown check into a failed row. Otherwise a crash could leave the envelope
 * looking healthy even though its checks say it was not fully examined.
 */
export const deriveStatus = (checks) => {
    const required = checks.filter((check) => !check.optional);
    if (required.some((check) => check.status === 'fail'))
        return 'failed';
    if (required.some((check) => check.status === 'warn' || check.status === 'skipped')) {
        return 'degraded';
    }
    return 'ok';
};
/**
 * Classify the installation from paths and the plugin environment only. This
 * deliberately spawns nothing: doctor reports the channel, it does not ask it
 * whether an update exists.
 */
export const deriveInstallSource = ({ entryPath = installedPath('dist', 'commitlore.mjs'), packageRoot = PACKAGE_ROOT, pluginRoot = process.env['CLAUDE_PLUGIN_ROOT'], } = {}) => {
    if (pluginRoot !== undefined && pluginRoot !== '')
        return 'plugin';
    const segments = resolve(entryPath).split(sep);
    if (segments.includes('_npx'))
        return 'npx';
    if (segments.includes('node_modules'))
        return 'npm';
    try {
        const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
        if (manifest.name === 'commitlore' && existsSync(join(packageRoot, '.git')))
            return 'source';
    }
    catch {
        // A malformed package manifest cannot license a source classification.
    }
    return 'unknown';
};
const summarize = (checks) => {
    const summary = {
        total: checks.length,
        ok: 0,
        warn: 0,
        fail: 0,
        skipped: 0,
        durationMs: 0,
    };
    for (const check of checks) {
        summary[check.status] += 1;
        summary.durationMs += check.durationMs ?? 0;
    }
    return summary;
};
export const buildReport = (checks, options = {}) => {
    if (options.selection !== undefined && options.selection.length === 0) {
        throw new Error('doctor selection must not be empty');
    }
    if (options.selection !== undefined && options.totalChecks === undefined) {
        throw new Error('doctor selection requires the full registry size');
    }
    const status = deriveStatus(checks);
    const fixPlan = computeFixPlan(checks);
    const headline = deriveHeadline({ checks, fixPlan, status });
    return {
        schema: 'commitlore_doctor.v2',
        version: packageVersion(),
        status,
        installSource: deriveInstallSource(),
        headline: options.selection === undefined
            ? headline
            : `${checks.length} of ${options.totalChecks} checks run — ${headline}`,
        summary: summarize(checks),
        fixPlan,
        ...(options.selection === undefined ? {} : { selection: [...options.selection] }),
        checks,
        exitCode: checks.some((check) => !check.optional && check.status === 'fail') ? 1 : 0,
    };
};
export const register = (program) => {
    program
        .command('doctor')
        .description('check that this repository can carry and share CommitLore records')
        .option('--fix', 'apply the reversible local config fixes (notes fetch refspec)')
        .option('--json', 'emit the report as JSON')
        .option('--verbose', 'include diagnostic evidence, skip reasons, and durations for each check')
        .option('--only <ids>', 'run only these comma-separated check ids')
        .option('--category <name>', 'run only checks in this category')
        .addHelpText('after', '\nExit codes: 0 ran without a non-optional failure, 1 ran with a non-optional failure, 2 could not run (usage error; SPEC §10).')
        .action((options) => {
        const doctorOptions = { fix: options.fix === true };
        if (options.only !== undefined) {
            doctorOptions.only = options.only.split(',').map((id) => id.trim());
        }
        if (options.category !== undefined)
            doctorOptions.category = options.category;
        const report = runDoctor(doctorOptions);
        process.stdout.write(options.json === true
            ? `${JSON.stringify(report, null, 2)}\n`
            : formatReport(report, { verbose: options.verbose === true }));
        process.exitCode = report.exitCode;
    });
};
//# sourceMappingURL=report.js.map