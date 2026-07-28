import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execGit } from '../core/git.js';
import { parseRecordBlocks, serializeTrailers } from '../core/trailers.js';
import { KNOWN_KEYS } from '../core/types.js';
import { CHAINED_SUFFIX, HOOK_MODE, commitMsgStub } from './commit-msg.js';
export const PREPARE_COMMIT_MSG_HOOK_MARKER = '# commitlore:prepare-commit-msg:v1';
export const PREPARE_COMMIT_MSG_HOOK_NAME = 'prepare-commit-msg';
export const PREPARE_COMMIT_MSG_CHAINED_HOOK_NAME = `${PREPARE_COMMIT_MSG_HOOK_NAME}${CHAINED_SUFFIX}`;
const RECORD_KEYS = new Set(KNOWN_KEYS);
export const prepareCommitMsgStub = () => commitMsgStub()
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
    for (const match of message.matchAll(/^commit ([0-9a-f]{40})$/gm)) {
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
export const register = (program) => {
    program
        .command('prepare-commit-msg')
        .argument('<message-file>')
        .argument('[source]')
        .argument('[sha]')
        .description('internal hook command: append records from a local squash draft')
        .action((messageFile) => {
        preserveSquashRecords(messageFile);
    });
};
//# sourceMappingURL=prepare-commit-msg.js.map