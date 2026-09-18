/**
 * One bounded last-result file — #1049, ADR D6.
 *
 * This is deliberately the smallest thing that answers "did the prototype do
 * anything the last time I committed". It replaces r2's per-attempt persistent
 * ledger, post-commit observer and consumed-source checkpoint, all of which were
 * removed: existing pending records and receipts already own capture lifecycle,
 * and a second bookkeeping system would be a second source of truth about
 * whether a record exists.
 *
 * Three properties, and each rules something out:
 *
 * - **Never read for a capture decision.** Nothing in `producer.ts` consults it.
 *   A diagnostic that can authorize is not a diagnostic.
 * - **Never asserts a commit exists.** Staging succeeded, or a message was
 *   published — neither is a commit. The commit can still fail afterwards, and a
 *   file written before that would be a claim about a commit that never
 *   happened. Actual Git and pending reads answer that question.
 * - **Never a prerequisite.** Every write is wrapped and every failure ignored.
 *   A full disk must not fail a commit whose validation passed.
 *
 * It holds no key, no source text and no provider prose. What it does hold is a
 * *stale* answer the moment the next commit runs, so its own timestamp is in the
 * file: a reader who takes it as describing the latest commit is reading it
 * wrong, and the timestamp is what lets them notice.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execGit } from '../core/git.js';
export const DIAGNOSTIC_VERSION = 1;
/** A ceiling, so a pathological note list cannot grow this file without bound. */
const MAX_NOTES = 24;
const MAX_NOTE_CHARS = 400;
const lastResultPath = (cwd) => {
    const result = execGit(['rev-parse', '--git-path', 'commitlore/jev-last-result.json'], { cwd });
    if (result.code !== 0)
        return null;
    const value = result.stdout.trim();
    return value === '' ? null : resolve(cwd, value);
};
/**
 * Writes the file, atomically, and swallows every failure.
 *
 * Returns whether it landed, so a test can assert the write without the caller
 * ever being able to branch on it.
 */
export const writeLastResult = (input) => {
    const path = lastResultPath(input.cwd);
    if (path === null)
        return false;
    const usage = input.usage ?? null;
    const record = {
        version: DIAGNOSTIC_VERSION,
        at: (input.now ?? (() => new Date()))().toISOString(),
        outcome: input.outcome,
        nonce: input.nonce ?? null,
        usage: usage === null
            ? null
            : {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                estimatedUsd: usage.estimatedUsd,
            },
        notes: input.notes.slice(0, MAX_NOTES).map((note) => note.slice(0, MAX_NOTE_CHARS)),
    };
    const temporary = `${path}.tmp-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
    try {
        mkdirSync(resolve(path, '..'), { recursive: true });
        writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, path);
        return true;
    }
    catch {
        try {
            rmSync(temporary, { force: true });
        }
        catch {
            // Already gone, or never created.
        }
        return false;
    }
};
/**
 * Reads it, for `doctor --jev` and for tests. Never called during a commit.
 *
 * A missing file is `null` and means nothing has been recorded here — not that
 * the prototype is broken and not that the last commit was uninspected.
 */
export const readLastResult = (cwd) => {
    const path = lastResultPath(cwd);
    if (path === null)
        return null;
    try {
        if (!statSync(path).isFile())
            return null;
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (typeof parsed !== 'object' || parsed === null)
            return null;
        const value = parsed;
        if (value['version'] !== DIAGNOSTIC_VERSION)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
};
/**
 * A sentence for `doctor --jev`, with the caveat attached rather than implied.
 *
 * The caveat is the whole reason this renders through a function: a reader who
 * sees "published" next to a time naturally concludes the latest commit carries
 * a record, and this file cannot support that. It describes one earlier
 * invocation, and the commit it belongs to may have failed afterwards.
 */
export const describeLastResult = (result) => {
    if (result === null)
        return 'no prototype result has been recorded in this working tree';
    const cost = result.usage?.estimatedUsd === null || result.usage === null
        ? 'usage unknown'
        : `~$${result.usage.estimatedUsd.toFixed(6)} estimated from ${String(result.usage.inputTokens)} input token(s)`;
    return (`last result ${result.outcome} at ${result.at} (${cost}). ` +
        'This describes one earlier invocation and does not prove the latest commit was ' +
        'inspected or that a record was committed — read git and `commitlore pending` for that.');
};
//# sourceMappingURL=diagnostic.js.map