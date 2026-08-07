/**
 * `pre-push` hook — #416: the half of the notes round trip that was missing.
 *
 * `doctor --fix` writes the fetch refspec, so a clone *receives* the mirror on
 * any `git fetch`. Nothing ever sent one. This hook is where the other half
 * goes, and the choice of hook is the decision worth stating:
 *
 * **The mirror rides an operation the user already started.** Pushing notes on
 * every commit would put a network call, and a possible failure, into an
 * operation that had none — on a machine that may be offline, in a repository
 * whose remote the user was not ready to write to. `pre-push` fires exactly
 * when the user has decided to publish, and carries the records with the code
 * they describe.
 *
 * **It cannot fail a push.** git aborts a push when `pre-push` exits non-zero,
 * so every path here ends in 0. A notes ref that will not sync is a
 * synchronisation problem; a code push refused because of one is a worse
 * problem that this hook would have caused. Anything worth knowing goes to
 * stderr, where git shows it without acting on it.
 *
 * git passes the remote name as the first argument, so only the remote actually
 * being pushed to is synced — not every remote the repository happens to have.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execGit } from '../core/git.js';
import { syncNotes } from '../core/sync.js';
import { CHAINED_SUFFIX, HOOK_MODE, captureHookStub } from './commit-msg.js';
export const PRE_PUSH_HOOK_MARKER = '# commitlore:pre-push:v1';
export const PRE_PUSH_HOOK_NAME = 'pre-push';
export const PRE_PUSH_CHAINED_HOOK_NAME = `${PRE_PUSH_HOOK_NAME}${CHAINED_SUFFIX}`;
const hookSuccess = (line) => ({ code: 0, stdout: `${line}\n`, stderr: '' });
const hookFailure = (line) => ({ code: 2, stdout: '', stderr: `commitlore: ${line}\n` });
/**
 * The stub, from the same shared body as the other hooks.
 *
 * `captureHookStub()` is the ending that lets the operation through, which is
 * the required one here: see the module comment.
 */
export const prePushStub = () => captureHookStub()
    .replaceAll('commit-msg', PRE_PUSH_HOOK_NAME)
    .replaceAll('validate --message-file "$1"', 'pre-push "$@"');
/** Written through a temporary name so a hook is never half-written. */
const writePrePushHook = (path) => {
    const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    writeFileSync(temporary, prePushStub(), { mode: HOOK_MODE });
    chmodSync(temporary, HOOK_MODE);
    renameSync(temporary, path);
};
export const installPrePushHook = (cwd = process.cwd()) => {
    let hookPath;
    try {
        const result = execGit(['rev-parse', '--git-path', `hooks/${PRE_PUSH_HOOK_NAME}`], { cwd });
        if (result.code !== 0)
            return hookFailure(result.stderr.trim() || 'not a git repository');
        hookPath = resolve(cwd, result.stdout.trim());
        mkdirSync(resolve(hookPath, '..'), { recursive: true });
    }
    catch (error) {
        return hookFailure(error instanceof Error ? error.message : String(error));
    }
    try {
        if (existsSync(hookPath)) {
            const current = readFileSync(hookPath, 'utf8');
            if (!current.includes(PRE_PUSH_HOOK_MARKER)) {
                return hookFailure(`${hookPath} is not a commitlore hook — left in place`);
            }
            if (current === prePushStub()) {
                return hookSuccess(`${PRE_PUSH_HOOK_NAME} hook already installed: ${hookPath} (unchanged)`);
            }
            writePrePushHook(hookPath);
            return hookSuccess(`updated ${PRE_PUSH_HOOK_NAME} hook: ${hookPath}`);
        }
        writePrePushHook(hookPath);
        return hookSuccess(`installed ${PRE_PUSH_HOOK_NAME} hook: ${hookPath}`);
    }
    catch (error) {
        return hookFailure(`could not install the ${PRE_PUSH_HOOK_NAME} hook: ${error instanceof Error ? error.message : String(error)}`);
    }
};
/** One line per remote, for stderr. Silence when there was nothing to say. */
export const describeSync = (results) => results
    .filter((result) => result.detail !== '' && result.outcome !== 'nothing-to-do')
    .map((result) => `commitlore: notes mirror (${result.remote}): ${result.detail}`);
export const register = (program) => {
    program
        .command(PRE_PUSH_HOOK_NAME)
        .argument('[remote]', 'the remote git is pushing to')
        .argument('[url]', 'its URL, as git passes it')
        .description('internal hook command: publish the notes mirror alongside a push')
        .action((remote) => {
        try {
            const results = syncNotes(remote === undefined || remote === '' ? {} : { remotes: [remote] });
            for (const line of describeSync(results))
                process.stderr.write(`${line}\n`);
        }
        catch (error) {
            // A push must never fail because the mirror could not be published.
            process.stderr.write(`commitlore: notes mirror not published: ${error instanceof Error ? error.message : String(error)}\n`);
        }
    });
};
//# sourceMappingURL=pre-push.js.map