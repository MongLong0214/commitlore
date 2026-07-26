/**
 * `commitlore backfill` — reconstruct records for commits made before this
 * repository kept any (T-801, PRD-F8).
 *
 * Three modes, and the default one does no reconstruction at all:
 *
 * - no flags: index the past commits that already carry trailers. There is no
 *   model here (ADR-0006), so there is nothing to reconstruct *with*, and
 *   indexing what already exists is the whole of what can be done for free.
 * - `--prompt-only`: emit the reconstruction contract for each target commit.
 *   The user's own session answers it. This is the integration path.
 * - `--draft <file>`: take that answer back, verify it against the same text,
 *   and attach what survives to the notes mirror.
 *
 * The output always names what stopped the run, because a cold-start command
 * that quietly does part of the job is worse than one that does none: "12
 * records, stopped at --limit" and "12 records, that was all of them" are
 * different facts and the user acts differently on each.
 */
import { DEFAULT_BATCH_SIZE, DEFAULT_LIMIT, backfill, buildEnvelope, } from '../core/backfill.js';
const PREFIX = 'commitlore:';
/** What each stop reason means to somebody deciding whether to run it again. */
const STOP_EXPLANATION = {
    exhausted: 'every selected commit was processed',
    limit: 'the --limit cap was reached — raise it to go further back',
    'budget-tokens': 'the --budget-tokens cap was reached — raise it to emit more prompts',
    converged: 'two consecutive batches produced nothing, so the rest of the range was left alone',
};
const count = (n, singular, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;
const nonNegativeInteger = (raw, flag) => {
    if (raw === undefined)
        return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${flag} is not a non-negative integer: ${raw}`);
    }
    return parsed;
};
export const toBackfillOptions = (options) => {
    const limit = nonNegativeInteger(options.limit, '--limit');
    const budgetTokens = nonNegativeInteger(options.budgetTokens, '--budget-tokens');
    return {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(limit === undefined ? {} : { limit }),
        ...(budgetTokens === undefined ? {} : { budgetTokens }),
        ...(options.draft === undefined ? {} : { draft: options.draft }),
        ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
        withPrs: options.withPrs === true,
        promptOnly: options.promptOnly === true,
        dryRun: options.dryRun === true,
    };
};
const shortSha = (sha) => sha.slice(0, 12);
const discardLine = (entry) => `${PREFIX} ${shortSha(entry.sha)} discarded (${entry.reason}): ${entry.detail}\n`;
const skipLine = (entry) => `${PREFIX} ${shortSha(entry.sha)} skipped (${entry.reason}): ${entry.detail}\n`;
const pullRequestLine = (report) => {
    const prs = report.pullRequests;
    if (!prs.requested)
        return [];
    if (!prs.available)
        return [`  pull requests: skipped — ${prs.reason ?? 'unavailable'}`];
    return [`  pull requests: ${count(prs.collected, 'body')} collected via gh`];
};
const indexLine = (report) => {
    const index = report.index;
    if (index === null)
        return [];
    if (!index.updated)
        return [`  index: not updated (${index.reason ?? 'unknown'})`];
    return [
        `  index: ${count(index.trailersIndexed, 'commit trailer')}, ` +
            `${count(index.noteTrailersIndexed, 'note trailer')} from ${count(index.commitsScanned, 'commit')}`,
    ];
};
/**
 * The summary. Every reconstruction mode prints the same shape, so that reading
 * two runs against each other does not mean reading two formats.
 */
const summary = (report) => {
    const would = report.dryRun ? 'would attach' : 'attached';
    const lines = [
        `${PREFIX} backfill (${report.mode}${report.dryRun ? ', dry run' : ''})`,
        `  history: ${count(report.commitsWalked, 'commit')} walked, ` +
            `${count(report.recorded, 'commit')} already recorded`,
        `  targets: ${count(report.targets, 'commit')} with no record` +
            (report.mode === 'index-only' ? ' — pass --prompt-only to reconstruct them' : ''),
    ];
    if (report.mode === 'prompt-only') {
        lines.push(`  prompts: ${count(report.prompts, 'prompt')} over ${count(report.batches, 'batch', 'batches')}, ` +
            `~${count(report.estimatedTokens, 'token')} estimated`);
    }
    if (report.mode === 'apply') {
        lines.push(`  records: ${would} ${count(report.attached, 'record')} ` +
            `over ${count(report.batches, 'batch', 'batches')}` +
            (report.attached === 0 ? '' : ', all Provenance: reconstructed'), `  discarded: ${count(report.discarded.length, 'record')} failed verification`);
    }
    if (report.skipped.length > 0) {
        lines.push(`  skipped: ${count(report.skipped.length, 'commit')}`);
    }
    lines.push(...pullRequestLine(report), ...indexLine(report));
    lines.push(`  stopped: ${report.stoppedBy} — ${STOP_EXPLANATION[report.stoppedBy]}`);
    return `${lines.join('\n')}\n`;
};
/**
 * The prompt payload. Each commit's contract is self-contained; the envelope in
 * front of them says how to hand the answers back as one document.
 */
const promptPayload = (result) => {
    if (result.prompts.length === 0)
        return '';
    const envelope = buildEnvelope(result.prompts.length, result.report.pullRequests.requested);
    return `${envelope}\n${result.prompts.map((entry) => entry.prompt).join('\n')}`;
};
const jsonPayload = (result) => `${JSON.stringify({
    report: result.report,
    prompts: result.prompts.map((entry) => ({
        sha: entry.sha,
        subject: entry.subject,
        estimatedTokens: entry.estimatedTokens,
        prompt: entry.prompt,
    })),
}, null, 2)}\n`;
const present = (result, json) => {
    const detail = [
        ...result.report.discarded.map(discardLine),
        ...result.report.skipped.map(skipLine),
    ].join('');
    if (json)
        return { stdout: jsonPayload(result), stderr: detail, exitCode: 0 };
    /* In prompt mode stdout is the payload a session consumes, so the summary
       goes to stderr and stays out of whatever the user pipes it into. */
    if (result.report.mode === 'prompt-only') {
        return {
            stdout: promptPayload(result),
            stderr: `${detail}${summary(result.report)}`,
            exitCode: 0,
        };
    }
    return { stdout: summary(result.report), stderr: detail, exitCode: 0 };
};
/**
 * Runs the command and reports what it would print. A failure comes back as an
 * outcome rather than an exception: the one thing a user of a cold-start command
 * should never see is a stack trace telling them nothing they can act on.
 */
export const runBackfill = (options) => {
    try {
        return present(backfill(toBackfillOptions(options)), options.json === true);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { stdout: '', stderr: `${PREFIX} ${detail}\n`, exitCode: 1 };
    }
};
export const register = (program) => {
    program
        .command('backfill')
        .description('reconstruct records for past commits that have none (all Provenance: reconstructed)')
        .option('--limit <n>', `consider at most n commits with no record (default: ${DEFAULT_LIMIT})`)
        .option('--with-prs', 'collect linked pull request bodies through the gh CLI')
        .option('--budget-tokens <n>', 'stop emitting prompts past this estimated token count')
        .option('--prompt-only', 'print the reconstruction contract for the session and exit')
        .option('--draft <file>', 'verify a draft the session produced and attach what survives')
        .option('--dry-run', 'compute everything, write nothing')
        .option('--json', 'emit the report as JSON')
        .action((options) => {
        const outcome = runBackfill({ ...options, batchSize: DEFAULT_BATCH_SIZE });
        if (outcome.stdout !== '')
            process.stdout.write(outcome.stdout);
        if (outcome.stderr !== '')
            process.stderr.write(outcome.stderr);
        process.exitCode = outcome.exitCode;
    });
};
//# sourceMappingURL=backfill.js.map