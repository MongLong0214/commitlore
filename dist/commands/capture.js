/**
 * `commitlore capture` — T-1006 (#198), ADR-0021.
 *
 * Composes the three capture phases (prepare → verify → stage) into a single
 * CLI command. Adds no new logic — every decision lives in the core modules.
 *
 * CEO amendment (binding):
 * - The CLI passes the nonce and nothing else to stage. It never forwards a
 *   caller-supplied `base_head`, diff hash, policy hash, or timestamp.
 * - The user never types trailer syntax.
 * - Most commits produce nothing.
 * - At most one record per commit by default.
 * - A verification failure produces no record and exits 0 as `rejected`.
 * - A host failure exits 3; an unanticipated exception exits 4. Neither is
 *   silence (#543). The hook wrapper, not this command, is what fails open.
 *
 * Structured for subcommand extension (T-1019 will add `capture gc`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepareCaptureContext } from '../core/capture-prepare.js';
import { verifyCaptureRecords } from '../core/capture-verify.js';
import { stageCaptureRecord } from '../core/capture-stage.js';
import { POLICY_FILE_NAME } from '../core/capture-policy.js';
import { classifyCaptureError, exitCodeForCaptureOutcome, markCaptureError, messageOf, } from '../core/capture-outcome.js';
import { runCaptureShadow } from '../core/capture-shadow.js';
import { execGitOrThrow } from '../core/git.js';
import { configuredTrustedAuthors } from '../core/trusted-authors.js';
import { parseDraft } from '../core/harvest.js';
import { gcPending } from '../core/pending-gc.js';
/** Render historical measurement output without ever echoing a blocked secret. */
export const formatCaptureShadow = (result) => {
    const lines = [
        'commitlore capture --shadow',
        `approximation: ${result.summary.approximation}`,
        '',
    ];
    for (const commit of result.commits) {
        lines.push(`${commit.sha.slice(0, 12)} ${commit.subject === '' ? '(no subject)' : commit.subject}`);
        if (!commit.would_record) {
            lines.push('  would record: no', `  reason: ${commit.silence_reason ?? 'no record survived'}`, '');
            continue;
        }
        lines.push('  would record: yes');
        if (commit.secret_guard === 'blocked') {
            const findings = (commit.secret_findings ?? [])
                .map((finding) => `${finding.ruleId} at line ${finding.line}`)
                .join(', ');
            lines.push(`  secret-guard: BLOCKED${findings === '' ? '' : ` (${findings})`}`, '  record: withheld', '');
            continue;
        }
        lines.push('  secret-guard: clear', '  record:');
        for (const line of (commit.record ?? '').trimEnd().split('\n'))
            lines.push(`    ${line}`);
        lines.push('');
    }
    const percent = (result.summary.silence_rate * 100).toFixed(1);
    lines.push('summary:', `  silence rate: ${result.summary.silence}/${result.summary.commits_examined} (${percent}%)`, `  commits examined: ${result.summary.commits_examined}`, `  would produce a record: ${result.summary.would_record}`, `  secret-guard would block: ${result.summary.blocked}`, `  ${result.summary.read_only}`);
    return `${lines.join('\n')}\n`;
};
// ---------------------------------------------------------------------------
// Core logic — separated from registration for testability
// ---------------------------------------------------------------------------
const errnoCode = (error) => {
    if (typeof error !== 'object' || error === null || !('code' in error))
        return undefined;
    return typeof error.code === 'string' ? error.code : undefined;
};
/** A file the caller named. Missing is usage; any other read failure is the host. */
const readCallerFile = (path) => {
    try {
        return readFileSync(path, 'utf8');
    }
    catch (error) {
        const wrapped = new Error(`cannot read ${JSON.stringify(path)}: ${messageOf(error)}`);
        throw markCaptureError(wrapped, errnoCode(error) === 'ENOENT' ? 'usage' : 'operational');
    }
};
const failureResult = (error) => ({
    outcome: classifyCaptureError(error),
    nonce: null,
    staged: false,
    error: messageOf(error),
});
/**
 * Run the full capture pipeline: prepare → verify → stage.
 *
 * Returns a typed outcome on every path. Never throws: a verification refusal
 * is `rejected`, a git or filesystem failure is `operational`, and an
 * exception the code did not anticipate is `internal`. Silence is a
 * conclusion, not a place exceptions fall into (#543).
 */
export const runCapture = (opts) => {
    try {
        return runCapturePipeline(opts);
    }
    catch (error) {
        return failureResult(error);
    }
};
const runCapturePipeline = (opts) => {
    const { transcriptPath, diffPath, draftPath, cwd } = opts;
    const transcript = readCallerFile(transcriptPath);
    // Prepare hashes `git diff --cached` itself, so verification has to be given
    // the same bytes. This used to default to the empty string, whose hash never
    // matches -- every record was refused with `source-mismatch` and the command
    // printed `no record staged`, so `capture --draft` could not succeed at all
    // unless the caller happened to pass a --diff file byte-identical to the
    // staged diff. A caller-supplied --diff that differs is still a real mismatch
    // and is still refused.
    const diff = diffPath ? readCallerFile(diffPath) : execGitOrThrow(['diff', '--cached'], { cwd });
    // 1. Prepare: compute bindings, generate prompt, persist prepared transaction
    const prepareResult = prepareCaptureContext({
        cwd,
        transcript,
        ...(opts.trustedAuthors === undefined ? {} : { trustedAuthors: opts.trustedAuthors }),
        ...(opts.unattended === true ? { unattended: true } : {}),
    });
    if (prepareResult.policy_error !== null) {
        // The defaults ran. Say which policy actually applied rather than letting a
        // user assume their file did (T-1110, PRD-F13 requirement 10).
        process.stderr.write(`commitlore capture: ${prepareResult.policy_error}\ncommitlore capture: the built-in defaults were used for this capture\n`);
    }
    // 2. If no draft provided, print the prompt contract and exit (prompt-only mode)
    if (!draftPath) {
        return {
            outcome: 'empty',
            nonce: null,
            staged: false,
            prompt: prepareResult.prompt,
            guard_advisory: prepareResult.guard_advisory,
        };
    }
    // 3. Parse and verify the draft
    const rawDraft = readCallerFile(draftPath);
    let draftRecords;
    // Rejections from the draft parser. Keeping them is the whole of #309: they
    // were computed here and dropped, so the caller saw "no record staged" with no
    // reason while `harvest --draft` printed one for the same input.
    const draftRejections = [];
    const collect = (review) => {
        for (const rejection of review.rejected) {
            draftRejections.push({
                index: rejection.index,
                rule: rejection.rule,
                detail: rejection.detail,
            });
        }
        return review.records;
    };
    // Both shapes go through the same review. The envelope branch used to bypass it
    // and hand its records straight to verification, which checks citations rather
    // than shape -- so a record with fields the vocabulary has no place for was
    // dropped with no rejection recorded at all, while `harvest --draft` reported
    // `unknown-field` for the identical bytes (#309). One draft format, one set of
    // rules, whichever command reads it.
    try {
        JSON.parse(rawDraft);
        draftRecords = collect(parseDraft(rawDraft));
    }
    catch {
        draftRecords = collect(parseDraft(rawDraft));
    }
    // Verify — never throws on verification failure
    const verifyResult = verifyCaptureRecords({
        nonce: prepareResult.nonce,
        draft: draftRecords,
        transcript,
        diff,
        cwd,
    });
    // 4. Stage — passes ONLY the nonce and cwd to stage (CEO amendment)
    //    Never forwards base_head, diff hash, policy hash, or timestamp.
    const stagedNonce = stageCaptureRecord({
        nonce: prepareResult.nonce,
        cwd,
    });
    const rejected = [
        ...draftRejections,
        ...verifyResult.rejected.map((rejection, index) => ({
            index,
            rule: rejection.reason,
            detail: rejection.detail,
            reason: rejection.reason,
        })),
    ];
    if (stagedNonce !== null) {
        return {
            outcome: 'staged',
            nonce: stagedNonce,
            staged: true,
            guard_advisory: prepareResult.guard_advisory,
            rejected,
        };
    }
    return {
        outcome: rejected.length > 0 ? 'rejected' : 'empty',
        nonce: prepareResult.nonce,
        staged: false,
        guard_advisory: prepareResult.guard_advisory,
        rejected,
    };
};
const writeGuardMatches = (advisory) => {
    for (const match of advisory.matches) {
        if (match.trust === 'blocked') {
            process.stdout.write(`  ${match.sha.slice(0, 7)} [${match.trust}] ${match.withheld}\n`);
        }
        else {
            process.stdout.write(`  ${match.sha.slice(0, 7)} [${match.trust}] ${match.alternative} | ${match.reason}\n`);
        }
    }
};
/**
 * Emit the envelope on every path, including failure. `--json` callers used
 * to get empty stdout and exit 0 when the pipeline broke (#543).
 */
const emitCaptureOutcome = (result, opts) => {
    if (opts.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    else if (result.prompt) {
        process.stdout.write(result.prompt);
        if (result.guard_advisory && result.guard_advisory.matches.length > 0) {
            process.stdout.write('\n--- guard advisory ---\n');
            process.stdout.write(`${result.guard_advisory.disclosure}\n`);
            writeGuardMatches(result.guard_advisory);
        }
        else if (result.guard_advisory) {
            process.stdout.write('\n--- guard advisory ---\n');
            process.stdout.write(`${result.guard_advisory.disclosure}\n`);
        }
    }
    else if (result.staged) {
        process.stdout.write(`staged: ${result.nonce}\n`);
        if (result.guard_advisory && result.guard_advisory.matches.length > 0) {
            process.stdout.write(`guard advisory (${result.guard_advisory.disclosure}):\n`);
            writeGuardMatches(result.guard_advisory);
        }
    }
    else if (result.outcome === 'empty' || result.outcome === 'rejected') {
        process.stdout.write('no record staged\n');
    }
    for (const rejection of result.rejected ?? []) {
        process.stderr.write(`commitlore: discarded record ${rejection.index} (${rejection.rule}): ${rejection.detail}\n`);
    }
    if (result.error !== undefined) {
        const prefix = opts.humanPrefix ?? 'commitlore capture';
        process.stderr.write(`${prefix}: ${result.error}\n`);
    }
    process.exitCode = exitCodeForCaptureOutcome(result.outcome);
};
// ---------------------------------------------------------------------------
// CLI registration
// ---------------------------------------------------------------------------
export const register = (program) => {
    const capture = program
        .command('capture')
        .description('prepare → verify → stage a record from a transcript and draft (no trailer syntax needed)')
        // Not `requiredOption`: commander enforces a parent's required options even
        // when a subcommand was invoked, so `capture gc` — which needs no transcript
        // — would fail before its own action ran. The requirement is enforced in the
        // action below instead, where it applies only to the capture flow itself.
        .option('--transcript <path>', 'path to the session transcript file')
        .option('--diff <path>', 'path to the diff file (defaults to the staged diff)')
        .option('--draft <path>', 'path to the draft JSON file (omit for prompt-only mode)')
        .option('--out <path>', 'write the pending nonce to a file')
        .option('--shadow', 'measure historical capture candidates without writing anything')
        .option('--since <rev>', 'exclusive historical lower bound for --shadow')
        .option('--json', 'emit structured JSON output')
        .option('--unattended', 'declare this capture unattended: prepared, verified and staged without asking. ' +
        `Refused unless the repository opted in (${POLICY_FILE_NAME}: "unattended": true, mode "auto")`)
        .addHelpText('after', '\nExit codes: 0 staged, empty, or rejected (rejected names the reason), ' +
        '2 usage, 3 operational (git, filesystem, host), 4 internal (unanticipated exception).')
        .action((options) => {
        if (options.shadow === true) {
            if (options.since === undefined) {
                process.stderr.write("error: required option '--since <rev>' not specified with --shadow\n");
                process.exitCode = 2;
                return;
            }
            if (options.out !== undefined) {
                process.stderr.write('commitlore capture: --out cannot be used with --shadow because shadow writes nothing\n');
                process.exitCode = 2;
                return;
            }
            if (options.transcript !== undefined || options.diff !== undefined || options.draft !== undefined) {
                process.stderr.write('commitlore capture: --shadow reads historical commits; do not pass --transcript, --diff, or --draft\n');
                process.exitCode = 2;
                return;
            }
            try {
                const result = runCaptureShadow({ cwd: process.cwd(), since: options.since });
                process.stdout.write(options.json === true ? `${JSON.stringify(result, null, 2)}\n` : formatCaptureShadow(result));
                process.exitCode = 0;
            }
            catch (error) {
                process.stderr.write(`commitlore capture --shadow: ${error instanceof Error ? error.message : String(error)}\n`);
                process.exitCode = 2;
            }
            return;
        }
        if (options.transcript === undefined) {
            emitCaptureOutcome({
                outcome: 'usage',
                nonce: null,
                staged: false,
                error: "required option '--transcript <path>' not specified",
            }, { json: options.json === true, humanPrefix: 'error' });
            return;
        }
        const cwd = process.cwd();
        const runOpts = { transcriptPath: options.transcript, cwd };
        if (options.diff !== undefined)
            runOpts.diffPath = options.diff;
        if (options.draft !== undefined)
            runOpts.draftPath = options.draft;
        runOpts.trustedAuthors = configuredTrustedAuthors(cwd);
        if (options.unattended === true)
            runOpts.unattended = true;
        let result = runCapture(runOpts);
        if (options.out && result.nonce) {
            try {
                writeFileSync(options.out, result.nonce + '\n');
            }
            catch (error) {
                result = {
                    ...result,
                    outcome: 'operational',
                    error: `cannot write ${JSON.stringify(options.out)}: ${messageOf(error)}`,
                };
            }
        }
        emitCaptureOutcome(result, { json: options.json === true });
    });
    // T-1019: gc subcommand — garbage-collect expired pending transactions
    capture
        .command('gc')
        .description('remove expired pending transaction files')
        .option('--json', 'emit structured JSON output')
        .action((options, command) => {
        // `capture` declares `--json` too, and commander binds a flag declared on
        // both a parent and a subcommand to the parent — so reading only the
        // subcommand's own opts silently drops `capture gc --json`.
        const parentOpts = command.parent?.opts();
        const json = options.json === true || parentOpts?.json === true;
        try {
            const cwd = process.cwd();
            const result = gcPending(cwd);
            if (json) {
                process.stdout.write(JSON.stringify(result, null, 2) + '\n');
            }
            else {
                if (result.removed.length > 0) {
                    process.stdout.write(`removed ${result.removed.length} expired pending file(s)\n`);
                }
                else {
                    process.stdout.write('nothing to collect\n');
                }
            }
            process.exitCode = 0;
        }
        catch (error) {
            process.stderr.write(`commitlore capture gc: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 2;
        }
    });
};
//# sourceMappingURL=capture.js.map