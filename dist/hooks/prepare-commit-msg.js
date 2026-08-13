import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvePolicy } from '../core/capture-policy.js';
import { execGit } from '../core/git.js';
import { markApplied } from '../core/pending.js';
import { parseRecordBlocks, serializeTrailers } from '../core/trailers.js';
import { FULL_OBJECT_ID_PATTERN, KNOWN_KEYS } from '../core/types.js';
import { captureHookFailOpen } from './capture-fail-open.js';
import { CHAINED_SUFFIX, HOOK_MODE, captureHookStub } from './commit-msg.js';
export const PREPARE_COMMIT_MSG_HOOK_MARKER = '# commitlore:prepare-commit-msg:v1';
export const PREPARE_COMMIT_MSG_HOOK_NAME = 'prepare-commit-msg';
export const PREPARE_COMMIT_MSG_CHAINED_HOOK_NAME = `${PREPARE_COMMIT_MSG_HOOK_NAME}${CHAINED_SUFFIX}`;
const RECORD_KEYS = new Set(KNOWN_KEYS);
/**
 * Renamed from the shared body, not from the gate's text: this hook composes a
 * message, it never rejects one, so it takes the ending that lets the commit
 * through (#354). The two replacements below only rename — the marker, the
 * chained hook beside it, and the subcommand it execs.
 */
export const prepareCommitMsgStub = () => captureHookStub()
    .replaceAll('commit-msg', PREPARE_COMMIT_MSG_HOOK_NAME)
    .replaceAll('validate --message-file "$1"', 'prepare-commit-msg "$@"');
const isRecordBlock = (trailers) => trailers.some((trailer) => RECORD_KEYS.has(trailer.key));
const squashMessagePath = (cwd) => {
    const result = execGit(['rev-parse', '--git-path', 'SQUASH_MSG'], { cwd });
    if (result.code !== 0)
        return null;
    return resolve(cwd, result.stdout.trim());
};
const squashCommitIds = (message) => {
    const ids = [];
    // Git writes SQUASH_MSG itself and always spells these ids in full, so the
    // full-id pattern is what actually appears. Matching abbreviations here would
    // also catch a prose line in a squashed commit body that happens to begin
    // `commit ` followed by a short hex word, and then `git show` that.
    const pattern = new RegExp(`^commit (${FULL_OBJECT_ID_PATTERN})$`, 'gm');
    for (const match of message.matchAll(pattern)) {
        const id = match[1];
        if (id !== undefined)
            ids.push(id);
    }
    return ids;
};
const recordsFromSquashMessage = (cwd, message) => {
    const blocks = [];
    for (const id of squashCommitIds(message)) {
        const result = execGit(['show', '--no-patch', '--format=%B', '--end-of-options', id], { cwd });
        if (result.code !== 0) {
            throw new Error(`could not read squashed commit ${id}: ${result.stderr.trim()}`);
        }
        blocks.push(...parseRecordBlocks(result.stdout).filter(isRecordBlock));
    }
    return blocks;
};
export const preserveSquashRecords = (messageFile, cwd = process.cwd()) => {
    const squashPath = squashMessagePath(cwd);
    if (squashPath === null || !existsSync(squashPath))
        return false;
    const draft = readFileSync(messageFile, 'utf8');
    if (parseRecordBlocks(draft).some(isRecordBlock))
        return false;
    const blocks = recordsFromSquashMessage(cwd, readFileSync(squashPath, 'utf8'));
    if (blocks.length === 0)
        return false;
    const separator = draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n';
    writeFileSync(messageFile, `${draft}${separator}${blocks.map((block) => serializeTrailers([...block])).join('\n')}`);
    return true;
};
const prepareHookPath = (cwd) => {
    const result = execGit(['rev-parse', '--git-path', `hooks/${PREPARE_COMMIT_MSG_HOOK_NAME}`], { cwd });
    if (result.code !== 0)
        throw new Error(result.stderr.trim() || 'not a git repository');
    return resolve(cwd, result.stdout.trim());
};
const hookSuccess = (line) => ({ code: 0, stdout: `${line}\n`, stderr: '' });
const hookFailure = (line) => ({ code: 2, stdout: '', stderr: `commitlore: ${line}\n` });
const writePrepareHook = (path) => {
    const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    writeFileSync(temporary, prepareCommitMsgStub(), { mode: HOOK_MODE });
    chmodSync(temporary, HOOK_MODE);
    renameSync(temporary, path);
};
export const installPrepareCommitMsgHook = (cwd = process.cwd()) => {
    let path;
    try {
        path = prepareHookPath(cwd);
        mkdirSync(resolve(path, '..'), { recursive: true });
    }
    catch (error) {
        return hookFailure(error instanceof Error ? error.message : String(error));
    }
    try {
        if (existsSync(path)) {
            const current = readFileSync(path, 'utf8');
            if (!current.includes(PREPARE_COMMIT_MSG_HOOK_MARKER)) {
                return hookFailure(`${path} is not a commitlore hook — left in place`);
            }
            if (current === prepareCommitMsgStub()) {
                return hookSuccess(`${PREPARE_COMMIT_MSG_HOOK_NAME} hook already installed: ${path} (unchanged)`);
            }
            writePrepareHook(path);
            return hookSuccess(`updated ${PREPARE_COMMIT_MSG_HOOK_NAME} hook: ${path}`);
        }
        writePrepareHook(path);
        return hookSuccess(`installed ${PREPARE_COMMIT_MSG_HOOK_NAME} hook: ${path}`);
    }
    catch (error) {
        return hookFailure(`could not install the ${PREPARE_COMMIT_MSG_HOOK_NAME} hook: ${error instanceof Error ? error.message : String(error)}`);
    }
};
// ---------------------------------------------------------------------------
// Capture application guard — ADR-0021 §3, five-gate check (T-1005)
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
 * Serialize the records array's trailers into a canonical trailer block string.
 */
const buildTrailerBlock = (records) => {
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
 * Check if the message already contains a Record-Id from the pending file.
 */
const messageContainsRecordId = (message, records) => {
    for (const rec of records) {
        if (typeof rec !== 'object' || rec === null)
            continue;
        const r = rec;
        if (!Array.isArray(r.trailers))
            continue;
        for (const t of r.trailers) {
            if (t.key === 'Record-Id' && message.includes(`Record-Id: ${t.value}`)) {
                return true;
            }
        }
    }
    return false;
};
/** The first Record-Id is the most useful name for a dropped capture. */
const captureLabel = (pending) => {
    for (const rec of pending.records) {
        if (typeof rec !== 'object' || rec === null)
            continue;
        const trailers = rec.trailers;
        if (!Array.isArray(trailers))
            continue;
        for (const trailer of trailers) {
            if (trailer.key === 'Record-Id')
                return trailer.value;
        }
    }
    return pending.nonce;
};
/**
 * A path-limited commit and some other ordinary commit forms give hooks an
 * alternate index. The capture must remain bound to the full index it was
 * verified against, but naming this case is much more actionable than a bare
 * hash mismatch.
 */
const usesTemporaryCommitIndex = (cwd) => {
    const currentIndex = process.env.GIT_INDEX_FILE;
    if (!currentIndex)
        return false;
    // `--git-path index` itself honours GIT_INDEX_FILE, so it would merely echo
    // the temporary path we are trying to recognise. The repository git-dir does
    // not, and its index is Git's normal persistent index for this worktree.
    const gitDir = execGit(['rev-parse', '--git-dir'], { cwd });
    if (gitDir.code !== 0)
        return false;
    return resolve(cwd, currentIndex) !== resolve(cwd, gitDir.stdout.trim(), 'index');
};
const reportDiffMismatch = (pending, cwd) => {
    const label = captureLabel(pending);
    const detail = usesTemporaryCommitIndex(cwd)
        ? 'this commit uses a temporary index whose staged diff differs from the verified capture'
        : 'the staged diff differs from the verified capture';
    process.stderr.write(`commitlore: staged capture ${label} was not attached: ${detail}; the record remains pending.\n`);
};
/**
 * Newer eligible capture first. `created_at` is the recorded instant, not the
 * nonce filename — the filename is `randomBytes(16)` hex, so lexicographic
 * order is a coin flip (#591).
 *
 * An `applied` file after a failed commit stays eligible (ADR-0021 §4, gate-a
 * scenario 6). It is not ranked below `staged`. Preferring staged would attach
 * an older leftover staged file over the capture that just nearly landed.
 * Marking `applied` abandoned was rejected: Git has no hook for a failed
 * commit, and abandoning would break the unchanged-index retry.
 */
export const compareCaptureCandidates = (left, right) => {
    const byCreated = right.created_at.localeCompare(left.created_at);
    if (byCreated !== 0)
        return byCreated;
    return left.nonce.localeCompare(right.nonce);
};
/**
 * The five-gate application check. Scans pending directory for a staged or
 * applied-but-unconsumed record that passes all five gates. The newest eligible
 * candidate wins. On no match or any error, does nothing (never blocks the
 * commit).
 */
const applyCaptureRecord = (messageFile, cwd) => {
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
    // Resolve current state for gate checks
    const headResult = execGit(['rev-parse', 'HEAD'], { cwd });
    if (headResult.code !== 0)
        return;
    const currentHead = headResult.stdout.trim();
    const diffResult = execGit(['diff', '--cached'], { cwd });
    if (diffResult.code !== 0)
        return;
    const currentDiffHash = createHash('sha256').update(diffResult.stdout).digest('hex');
    const currentPolicyHash = resolvePolicy(cwd).identityHash;
    const now = Date.now();
    // Read current message to check for existing Record-Id
    let currentMessage;
    try {
        currentMessage = readFileSync(messageFile, 'utf8');
    }
    catch {
        return;
    }
    const eligible = [];
    for (const file of files) {
        const filePath = resolve(pendingDirPath, file);
        const pending = readPendingFile(filePath);
        if (!pending)
            continue;
        // Only staged or applied-but-unconsumed records are eligible
        if (pending.phase !== 'staged' && pending.phase !== 'applied')
            continue;
        // Gate 4: Unconsumed
        if (pending.consumed)
            continue;
        // Gate 1: HEAD unchanged
        if (pending.base_head !== currentHead)
            continue;
        // Gate 2: Staged diff unchanged
        if (pending.staged_diff_hash !== currentDiffHash) {
            reportDiffMismatch(pending, cwd);
            continue;
        }
        // Gate 3: Unexpired (expires_at must be non-null and in the future)
        if (!pending.expires_at)
            continue;
        if (now >= new Date(pending.expires_at).getTime())
            continue;
        // Gate 5: Policy identity unchanged
        if (pending.policy_identity_hash !== currentPolicyHash)
            continue;
        eligible.push(pending);
    }
    eligible.sort(compareCaptureCandidates);
    const pending = eligible[0];
    if (!pending)
        return;
    // All five gates pass. Check if already present (dedup).
    if (messageContainsRecordId(currentMessage, pending.records))
        return;
    // Build and append the trailer block
    const trailerBlock = buildTrailerBlock(pending.records);
    if (!trailerBlock)
        return;
    const separator = currentMessage.endsWith('\n\n')
        ? ''
        : currentMessage.endsWith('\n')
            ? '\n'
            : '\n\n';
    writeFileSync(messageFile, `${currentMessage}${separator}${trailerBlock}`);
    // Mark applied — hash the canonical trailer block, not the full message
    const recordHash = createHash('sha256').update(trailerBlock).digest('hex');
    try {
        markApplied(pending.nonce, recordHash, { cwd });
    }
    catch {
        // Best-effort: message already written, crash here is recoverable by post-commit
    }
};
export const register = (program) => {
    program
        .command('prepare-commit-msg')
        .argument('<message-file>')
        .argument('[source]')
        .argument('[sha]')
        .description('internal hook command: append records from a local squash draft')
        .action((messageFile) => {
        preserveSquashRecords(messageFile);
        try {
            applyCaptureRecord(messageFile, process.cwd());
        }
        catch (error) {
            captureHookFailOpen('capture application error', error);
        }
    });
};
//# sourceMappingURL=prepare-commit-msg.js.map