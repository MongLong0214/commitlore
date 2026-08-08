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
export const register = (program) => {
    program
        .command('doctor')
        .description('check that this repository can carry and share CommitLore records')
        .option('--fix', 'apply the reversible local config fixes (notes fetch refspec)')
        .option('--json', 'emit the report as JSON')
        .addHelpText('after', '\nExit codes: 0 every check passed or warned, 1 a check failed (SPEC §10).')
        .action((options) => {
        const report = runDoctor({ fix: options.fix === true });
        process.stdout.write(options.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
        process.exitCode = report.exitCode;
    });
};
//# sourceMappingURL=report.js.map