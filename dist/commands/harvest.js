/**
 * `commitlore harvest` — hand the prompt contract to the session, take the draft
 * back (T-403, ADR-0006 §5).
 *
 * The command has three modes and one of them is doing nothing:
 *
 * - `--prompt-only` prints the contract. The user's agent session reads it,
 *   asks its own model, and writes a draft. This is the integration path.
 * - `--draft <f>` format-checks that draft and prints what survived.
 * - Neither: there is no model here, so there is nothing to do. Exit 0, print
 *   nothing, say so once on stderr.
 *
 * That last mode is the important one. Harvest runs next to a commit, and a
 * commit must never fail because an optional enrichment step had nothing to
 * work with (ADR-0006: 전량 실패 시 비차단). Only two things are errors here: a
 * path the user named that cannot be read, and a draft that is not a draft.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execGit } from '../core/git.js';
import { buildHarvestPrompt, parseDraft } from '../core/harvest.js';
const PREFIX = 'commitlore:';
/** Nothing to harvest is a normal outcome, not a failure. */
const skip = (reason) => ({
    stdout: '',
    stderr: `${PREFIX} harvest skipped — ${reason}\n`,
    exitCode: 0,
});
const readTextFile = (path, label) => {
    try {
        return readFileSync(path, 'utf8');
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`cannot read ${label}: ${detail}`);
    }
};
const emit = (payload, out) => {
    if (out === undefined)
        return { stdout: payload, stderr: '', exitCode: 0 };
    try {
        writeFileSync(out, payload);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`cannot write --out: ${detail}`);
    }
    return { stdout: '', stderr: '', exitCode: 0 };
};
/**
 * `--diff` when given, the staged diff otherwise. A repository that git will
 * not answer for is a skip, not an error: harvest is invoked from hooks in
 * places (bare checkouts, fresh clones) where that is simply the situation.
 */
const resolveDiff = (options) => {
    if (options.diff !== undefined) {
        const text = readTextFile(options.diff, `--diff ${JSON.stringify(options.diff)}`);
        return text.trim() === '' ? null : text;
    }
    const result = execGit(['diff', '--cached'], options.cwd === undefined ? {} : { cwd: options.cwd });
    if (result.code !== 0)
        return null;
    return result.stdout.trim() === '' ? null : result.stdout;
};
const formatRejection = (rejection) => `${PREFIX} discarded record ${rejection.index} (${rejection.rule}): ${rejection.detail}\n`;
const runDraftMode = (draft, out) => {
    const review = parseDraft(readTextFile(draft, `--draft ${JSON.stringify(draft)}`));
    const payload = `${JSON.stringify({ records: review.records }, null, 2)}\n`;
    const outcome = emit(payload, out);
    return { ...outcome, stderr: review.rejected.map(formatRejection).join('') };
};
const runPromptMode = (options) => {
    if (options.transcript === undefined) {
        return skip('no --transcript, and there is no session to read one from');
    }
    const transcript = readTextFile(options.transcript, `--transcript ${JSON.stringify(options.transcript)}`);
    if (transcript.trim() === '')
        return skip('the transcript is empty');
    const diff = resolveDiff(options);
    if (diff === null)
        return skip('no --diff and nothing staged');
    return emit(buildHarvestPrompt({ transcript, diff }), options.out);
};
const harvest = (options) => {
    const promptOnly = options.promptOnly === true;
    if (promptOnly && options.draft !== undefined) {
        throw new Error('--prompt-only and --draft are mutually exclusive');
    }
    if (options.draft !== undefined)
        return runDraftMode(options.draft, options.out);
    if (!promptOnly) {
        return skip('this build has no model of its own; pass --prompt-only to get the contract');
    }
    return runPromptMode(options);
};
/**
 * Runs the command and reports what it would print. Failures come back as an
 * outcome rather than an exception so the caller prints one line and never a
 * stack trace — a stack trace in the middle of somebody's commit is noise that
 * tells them nothing they can act on.
 */
export const runHarvest = (options) => {
    try {
        return harvest(options);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { stdout: '', stderr: `${PREFIX} ${detail}\n`, exitCode: 1 };
    }
};
export const register = (program) => {
    program
        .command('harvest')
        .description('build the harvest prompt contract, or check a draft a session produced')
        .option('--transcript <file>', 'agent session transcript to harvest from')
        .option('--diff <file>', 'diff to harvest from (default: the staged diff)')
        .option('--out <file>', 'write the output here instead of stdout')
        .option('--prompt-only', 'print the prompt contract for the session and exit')
        .option('--draft <file>', 'check a draft the session produced and print what survived')
        .action((options) => {
        const outcome = runHarvest(options);
        if (outcome.stdout !== '')
            process.stdout.write(outcome.stdout);
        if (outcome.stderr !== '')
            process.stderr.write(outcome.stderr);
        process.exitCode = outcome.exitCode;
    });
};
//# sourceMappingURL=harvest.js.map