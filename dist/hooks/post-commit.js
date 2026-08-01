/**
 * `post-commit` hook — T-1018 (#213): consumption finaliser.
 *
 * After a successful commit, this hook inspects applied pending transactions
 * and consumes exactly the one whose:
 *   1. base_head equals the new commit's first parent
 *   2. staged_tree_oid equals the new commit's tree
 *   3. applied_record_hash matches the canonical record block in the message
 *   4. every applied Record-Id is present in the commit message
 *
 * Consumption happens AFTER the commit succeeds, exactly once. If no candidate
 * matches, exit 0. If state is unreadable, print a diagnostic and exit 0.
 * Never retroactively fail a successful Git commit.
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execGit } from '../core/git.js';
import { consumePending } from '../core/pending.js';
import { serializeTrailers } from '../core/trailers.js';
import { CHAINED_SUFFIX, HOOK_MODE, captureHookStub } from './commit-msg.js';
export const POST_COMMIT_HOOK_MARKER = '# commitlore:post-commit:v1';
export const POST_COMMIT_HOOK_NAME = 'post-commit';
export const POST_COMMIT_CHAINED_HOOK_NAME = `${POST_COMMIT_HOOK_NAME}${CHAINED_SUFFIX}`;
const hookSuccess = (line) => ({ code: 0, stdout: `${line}\n`, stderr: '' });
const hookFailure = (line) => ({ code: 2, stdout: '', stderr: `commitlore: ${line}\n` });
/**
 * Generate the post-commit hook stub.
 *
 * The gate's resolution chain with the ending that does not refuse (#354). Git
 * ignores this hook's exit code, so this is not the change that unblocks a
 * commit — `prepare-commit-msg` is. It is here because a hook that runs after
 * the commit already exists has nothing left to refuse, and because whatever
 * does read a status from it — a wrapper, a hook runner, this project's own
 * tests — would otherwise read a refusal nobody made.
 */
export const postCommitStub = () => captureHookStub()
    .replaceAll('commit-msg', POST_COMMIT_HOOK_NAME)
    .replaceAll('validate --message-file "$1"', 'post-commit');
const writePostCommitHook = (path) => {
    const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    writeFileSync(temporary, postCommitStub(), { mode: HOOK_MODE });
    chmodSync(temporary, HOOK_MODE);
    renameSync(temporary, path);
};
/**
 * Install the post-commit hook. Follows the same containment rules as the
 * commit-msg hook: preserves a foreign hook by refusing to overwrite it.
 */
export const installPostCommitHook = (cwd = process.cwd()) => {
    let hookPath;
    try {
        const result = execGit(['rev-parse', '--git-path', `hooks/${POST_COMMIT_HOOK_NAME}`], { cwd });
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
            if (!current.includes(POST_COMMIT_HOOK_MARKER)) {
                // Foreign hook — do not overwrite. Preserve/refuse per containment policy.
                return hookFailure(`${hookPath} is not a commitlore hook — left in place`);
            }
            if (current === postCommitStub()) {
                return hookSuccess(`${POST_COMMIT_HOOK_NAME} hook already installed: ${hookPath} (unchanged)`);
            }
            writePostCommitHook(hookPath);
            return hookSuccess(`updated ${POST_COMMIT_HOOK_NAME} hook: ${hookPath}`);
        }
        writePostCommitHook(hookPath);
        return hookSuccess(`installed ${POST_COMMIT_HOOK_NAME} hook: ${hookPath}`);
    }
    catch (error) {
        return hookFailure(`could not install the ${POST_COMMIT_HOOK_NAME} hook: ${error instanceof Error ? error.message : String(error)}`);
    }
};
// ---------------------------------------------------------------------------
// Consumption finaliser logic
// ---------------------------------------------------------------------------
/**
 * Resolve the pending directory via `git rev-parse --git-path`.
 * Returns null if not in a git repo or the path cannot be resolved.
 */
const resolvePendingDir = (cwd) => {
    const result = execGit(['rev-parse', '--git-path', 'commitlore/pending'], { cwd });
    if (result.code !== 0)
        return null;
    return resolve(cwd, result.stdout.trim());
};
/**
 * Read a pending file safely. Returns null on any error.
 */
const readPendingFile = (filePath) => {
    try {
        const content = readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed['version'] !== 1)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
};
/**
 * Serialize records' trailers into the canonical trailer block that
 * prepare-commit-msg uses. Must produce the same string so hashes match.
 */
const buildCanonicalTrailerBlock = (records) => {
    const blocks = [];
    for (const rec of records) {
        if (typeof rec !== 'object' || rec === null)
            continue;
        const r = rec;
        if (!Array.isArray(r.trailers))
            continue;
        const trailers = r.trailers;
        const serialized = serializeTrailers(trailers);
        if (serialized)
            blocks.push(serialized);
    }
    return blocks.join('\n');
};
/**
 * Extract all Record-Id values from a pending record's records array.
 */
const extractRecordIds = (records) => {
    const ids = [];
    for (const rec of records) {
        if (typeof rec !== 'object' || rec === null)
            continue;
        const r = rec;
        if (!Array.isArray(r.trailers))
            continue;
        for (const t of r.trailers) {
            if (t.key === 'Record-Id')
                ids.push(t.value);
        }
    }
    return ids;
};
/**
 * Check whether all Record-Id values from the pending record are present
 * in the commit message.
 */
const allRecordIdsPresent = (commitMessage, records) => {
    const ids = extractRecordIds(records);
    if (ids.length === 0)
        return false;
    return ids.every((id) => commitMessage.includes(`Record-Id: ${id}`));
};
/**
 * The post-commit consumption finaliser.
 *
 * Reads HEAD's parent, tree, and message. Scans pending dir for applied,
 * unconsumed records that match all four conditions. Consumes exactly one.
 */
const runPostCommitFinaliser = (cwd) => {
    // Fast path: resolve pending directory
    const pendingDirPath = resolvePendingDir(cwd);
    if (!pendingDirPath || !existsSync(pendingDirPath))
        return;
    // List pending files
    let files;
    try {
        files = readdirSync(pendingDirPath).filter((f) => f.endsWith('.json')).sort();
    }
    catch {
        return;
    }
    if (files.length === 0)
        return;
    // Read the current HEAD commit information
    const headResult = execGit(['rev-parse', 'HEAD'], { cwd });
    if (headResult.code !== 0)
        return;
    const headSha = headResult.stdout.trim();
    // Get first parent of HEAD
    const parentResult = execGit(['rev-parse', 'HEAD^'], { cwd });
    if (parentResult.code !== 0)
        return; // initial commit has no parent — nothing to match
    const firstParent = parentResult.stdout.trim();
    // Get committed tree of HEAD
    const treeResult = execGit(['rev-parse', 'HEAD^{tree}'], { cwd });
    if (treeResult.code !== 0)
        return;
    const committedTree = treeResult.stdout.trim();
    // Get commit message of HEAD
    const msgResult = execGit(['log', '-1', '--format=%B', 'HEAD'], { cwd });
    if (msgResult.code !== 0)
        return;
    const commitMessage = msgResult.stdout;
    // Check each candidate
    for (const file of files) {
        const filePath = resolve(pendingDirPath, file);
        const pending = readPendingFile(filePath);
        if (!pending)
            continue;
        // Only applied, unconsumed records are eligible
        if (pending.phase !== 'applied')
            continue;
        if (pending.consumed)
            continue;
        // Condition 1: base_head equals first parent
        if (pending.base_head !== firstParent)
            continue;
        // Condition 2: staged_tree_oid equals committed tree
        if (pending.staged_tree_oid !== committedTree)
            continue;
        // Condition 3: all Record-Id values present in commit message
        if (!allRecordIdsPresent(commitMessage, pending.records))
            continue;
        // Condition 4: applied_record_hash matches canonical block in message
        const canonicalBlock = buildCanonicalTrailerBlock(pending.records);
        const expectedHash = createHash('sha256').update(canonicalBlock).digest('hex');
        if (pending.applied_record_hash !== expectedHash)
            continue;
        // All four conditions match — consume exactly this one
        try {
            consumePending(pending.nonce, headSha, { cwd });
        }
        catch (error) {
            process.stderr.write(`commitlore: post-commit finalisation error: ${error instanceof Error ? error.message : String(error)}\n`);
        }
        // First match wins — exactly one consumption
        return;
    }
};
export const register = (program) => {
    program
        .command('post-commit')
        .description('internal hook command: finalise pending capture consumption after a successful commit')
        .action(() => {
        try {
            runPostCommitFinaliser(process.cwd());
        }
        catch (error) {
            // Never retroactively fail a successful Git commit
            process.stderr.write(`commitlore: post-commit error: ${error instanceof Error ? error.message : String(error)}\n`);
        }
    });
};
//# sourceMappingURL=post-commit.js.map