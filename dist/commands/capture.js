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
 * - A verification failure produces no record and does not fail the command.
 *
 * Structured for subcommand extension (T-1019 will add `capture gc`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { prepareCaptureContext } from '../core/capture-prepare.js';
import { verifyCaptureRecords } from '../core/capture-verify.js';
import { stageCaptureRecord } from '../core/capture-stage.js';
import { parseDraft } from '../core/harvest.js';
import { gcPending } from '../core/pending-gc.js';
// ---------------------------------------------------------------------------
// Core logic — separated from registration for testability
// ---------------------------------------------------------------------------
/**
 * Run the full capture pipeline: prepare → verify → stage.
 *
 * Returns a structured result. Never throws on pipeline failures (verification
 * failure, nothing to stage) — those are communicated via the result. Only
 * throws for true usage errors (unreadable files).
 */
export const runCapture = (opts) => {
    const { transcriptPath, diffPath, draftPath, cwd } = opts;
    // Read input files — these throw on unreadable paths (usage error)
    const transcript = readFileSync(transcriptPath, 'utf8');
    const diff = diffPath ? readFileSync(diffPath, 'utf8') : '';
    // 1. Prepare: compute bindings, generate prompt, persist prepared transaction
    const prepareResult = prepareCaptureContext({ cwd, transcript });
    // 2. If no draft provided, print the prompt contract and exit (prompt-only mode)
    if (!draftPath) {
        return { nonce: null, staged: false, prompt: prepareResult.prompt };
    }
    // 3. Parse and verify the draft
    const rawDraft = readFileSync(draftPath, 'utf8');
    let draftRecords;
    try {
        const parsed = JSON.parse(rawDraft);
        if (parsed.records && Array.isArray(parsed.records)) {
            draftRecords = parsed.records;
        }
        else {
            // Try parseDraft for the text-based format
            const review = parseDraft(rawDraft);
            draftRecords = review.records;
        }
    }
    catch {
        // Try parseDraft for text-based draft format
        const review = parseDraft(rawDraft);
        draftRecords = review.records;
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
    return {
        nonce: stagedNonce ?? prepareResult.nonce,
        staged: stagedNonce !== null,
    };
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
        .option('--diff <path>', 'path to the diff file (defaults to empty)')
        .option('--draft <path>', 'path to the draft JSON file (omit for prompt-only mode)')
        .option('--out <path>', 'write the pending nonce to a file')
        .option('--json', 'emit structured JSON output')
        .action((options) => {
        if (options.transcript === undefined) {
            process.stderr.write("error: required option '--transcript <path>' not specified\n");
            process.exitCode = 2;
            return;
        }
        try {
            const cwd = process.cwd();
            const runOpts = { transcriptPath: options.transcript, cwd };
            if (options.diff !== undefined)
                runOpts.diffPath = options.diff;
            if (options.draft !== undefined)
                runOpts.draftPath = options.draft;
            const result = runCapture(runOpts);
            if (options.json) {
                process.stdout.write(JSON.stringify(result, null, 2) + '\n');
            }
            else if (result.prompt) {
                // Prompt-only mode
                process.stdout.write(result.prompt);
            }
            else if (result.staged) {
                process.stdout.write(`staged: ${result.nonce}\n`);
            }
            else {
                process.stdout.write('no record staged\n');
            }
            // Write nonce to --out file if requested
            if (options.out && result.nonce) {
                writeFileSync(options.out, result.nonce + '\n');
            }
            process.exitCode = 0;
        }
        catch (error) {
            // Usage errors: unreadable file paths → exit 2
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                process.stderr.write(`commitlore capture: ${error.message}\n`);
                process.exitCode = 2;
                return;
            }
            // Pipeline errors (verification failure, staging failure) → exit 0
            process.stderr.write(`commitlore capture: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 0;
        }
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