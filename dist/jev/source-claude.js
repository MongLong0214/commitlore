/**
 * The one supported conversation source: a Claude Code root session — #1049.
 *
 * Two halves. `registerClaudeSession` runs from a `SessionStart` hook and writes
 * a small descriptor beside the repository's other capture state.
 * `readClaudeSource` runs from the commit-msg producer, finds the descriptor for
 * *this* session, and decodes a bounded window of the transcript.
 *
 * ## What was measured, and what that changed
 *
 * The plan was `CLAUDE_ENV_FILE`. It is not in the hooks reference, and it is
 * unset in the host this was built against — so the descriptor could not have
 * been propagated that way, and claiming it would have been claiming a path
 * nobody ran. What *is* observably propagated to a Bash tool command, and
 * therefore to a `git commit` and its hooks, is `CLAUDE_CODE_SESSION_ID`:
 * measured equal to the session's own id, in this repository, on
 * claude-code with a 47 MB transcript at
 * `~/.claude/projects/<slug>/<session-id>.jsonl`.
 *
 * So the environment carries the *key* and the descriptor carries the *binding*.
 * That is one representation, not two: there is no env-encoded descriptor and no
 * second lookup path.
 *
 * `CLAUDE_CODE_CHILD_SESSION` was observed set in a child session. It is the
 * host identity signal #1049 asks for: an inherited session id does not prove
 * the actor is the registered root, and where the host says it is a child, this
 * reports unavailable rather than guessing. Subagent records also carry
 * `isSidechain`, and those are dropped inside the reader.
 *
 * ## Lookup is exact
 *
 * Session id from the environment, worktree from git, descriptor at a path
 * derived from both. No global "latest session" pointer, no newest-mtime scan,
 * no walk of `~/.claude`. Each of those answers when it should not: two sessions
 * in two worktrees are the ordinary case, and a wrong answer there records one
 * branch's decisions onto another's commit.
 */
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { execGit } from '../core/git.js';
import { unavailable, } from './source.js';
/** Where the environment carries this session's identity. Measured, not documented. */
export const SESSION_ENV = 'CLAUDE_CODE_SESSION_ID';
/** Set by the host in a child session. Its presence denies root-actor status. */
export const CHILD_ENV = 'CLAUDE_CODE_CHILD_SESSION';
/** Descriptor format. Bumped only for a shape a reader cannot accept. */
export const DESCRIPTOR_VERSION = 1;
/**
 * Bytes of the container read, from the end.
 *
 * The transcript this was measured against is 47 MB, so reading it whole is not
 * a window at all. The tail is the right end: a decision made ten thousand
 * messages ago is not the decision this commit records, and the newest complete
 * blocks are what #1047 prefers anyway.
 */
export const WINDOW_BYTES = 192 * 1024;
/** A hard record ceiling on top of the byte window, so a file of tiny lines is bounded too. */
export const WINDOW_RECORDS = 600;
/** Longest single message kept. A pasted file is not a decision. */
const MAX_BLOCK_CHARS = 4000;
/**
 * Host containers that wear a conversation role and are not authored speech.
 *
 * Every one of these was observed in a real transcript. `<local-command-stdout>`
 * is literally command output arriving as `type: "user"`, and a reader that
 * treated it as a user statement would let a tool's output author a record —
 * which is the failure #1047 forbids, reached through a door that is not
 * `tool_result`.
 */
const HOST_CONTAINERS = [
    '<system-reminder>',
    '<local-command-caveat>',
    '<local-command-stdout>',
    '<local-command-stderr>',
    '<command-name>',
    '<command-message>',
    '<command-args>',
    '<task-notification>',
    '<user-prompt-submit-hook>',
];
const gitValue = (cwd, args) => {
    const result = execGit([...args], { cwd });
    if (result.code !== 0)
        return null;
    const value = result.stdout.trim();
    return value === '' ? null : value;
};
/**
 * Where descriptors live: beside `pending`, in the worktree's own git directory.
 *
 * `--git-path` is what makes this per-worktree. A single directory at the
 * repository root would let two worktrees read each other's descriptor, which is
 * the mix-up this binding exists to prevent.
 */
export const descriptorDir = (cwd) => {
    const located = gitValue(cwd, ['rev-parse', '--git-path', 'commitlore/jev-sessions']);
    return located === null ? null : resolve(cwd, located);
};
/** One file per session id. The id is validated before it becomes a filename. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const descriptorPath = (cwd, sessionId) => {
    if (!SESSION_ID.test(sessionId))
        return null;
    const dir = descriptorDir(cwd);
    return dir === null ? null : resolve(dir, `${sessionId}.json`);
};
/**
 * Writes the descriptor for one session in one worktree.
 *
 * Carries identity and nothing else: no key, no transcript content, no
 * conversation archive. The transcript is referenced by path, so removing the
 * key or deleting this file leaves no copy of anybody's session behind.
 *
 * Refuses rather than guessing when git cannot answer — a descriptor naming a
 * worktree that was inferred is a descriptor that can bind the wrong tree.
 */
export const registerClaudeSession = (input) => {
    const worktree = gitValue(input.cwd, ['rev-parse', '--show-toplevel']);
    const gitdir = gitValue(input.cwd, ['rev-parse', '--absolute-git-dir']);
    if (worktree === null || gitdir === null) {
        return { status: 'skipped', reason: 'not a git working tree' };
    }
    const path = descriptorPath(input.cwd, input.sessionId);
    if (path === null) {
        return { status: 'skipped', reason: 'unusable session id' };
    }
    // A transcript that is not a readable regular file now will not become one,
    // and a descriptor pointing at nothing is worse than no descriptor: it turns
    // "not registered, restart the host" into "registered and unreadable".
    try {
        if (!statSync(input.transcriptPath).isFile()) {
            return { status: 'skipped', reason: 'transcript is not a regular file' };
        }
    }
    catch {
        return { status: 'skipped', reason: 'transcript is not readable' };
    }
    const descriptor = {
        version: DESCRIPTOR_VERSION,
        host: 'claude-code',
        sessionId: input.sessionId,
        worktree,
        gitdir,
        transcript: resolve(input.transcriptPath),
        format: 'claude-jsonl-v1',
        registeredAt: (input.now ?? (() => new Date()))().toISOString(),
    };
    try {
        mkdirSync(resolve(path, '..'), { recursive: true });
        const temporary = `${path}.tmp-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
        // 0o600: the path is identity rather than content, and it still names a
        // file in the user's home that other accounts have no business reading.
        writeFileSync(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, path);
    }
    catch (error) {
        return {
            status: 'skipped',
            reason: `could not write the descriptor: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    return { status: 'registered', path, descriptor };
};
/** Removes one descriptor. Used by `uninstall`; never removes another session's. */
export const forgetClaudeSession = (cwd, sessionId) => {
    const path = descriptorPath(cwd, sessionId);
    if (path === null)
        return false;
    try {
        rmSync(path, { force: true });
        return true;
    }
    catch {
        return false;
    }
};
const readDescriptor = (path) => {
    let raw;
    try {
        raw = readFileSync(path, 'utf8');
    }
    catch {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null)
        return null;
    const value = parsed;
    if (value['version'] !== DESCRIPTOR_VERSION)
        return null;
    if (value['host'] !== 'claude-code' || value['format'] !== 'claude-jsonl-v1')
        return null;
    for (const key of ['sessionId', 'worktree', 'gitdir', 'transcript', 'registeredAt']) {
        if (typeof value[key] !== 'string' || value[key] === '')
            return null;
    }
    return parsed;
};
const readRange = (path, from, want) => {
    let handle = null;
    try {
        handle = openSync(path, 'r');
        const buffer = Buffer.allocUnsafe(want);
        let filled = 0;
        while (filled < want) {
            const read = readSync(handle, buffer, filled, want - filled, from + filled);
            if (read === 0)
                break;
            filled += read;
        }
        return { text: buffer.subarray(0, filled).toString('utf8'), read: filled };
    }
    catch {
        return null;
    }
    finally {
        if (handle !== null) {
            try {
                closeSync(handle);
            }
            catch {
                // Closing a handle that is already gone is not a failure worth reporting.
            }
        }
    }
};
/** Reads at most `WINDOW_BYTES` from the end of a file, without loading the rest. */
const readTail = (path) => {
    let size;
    let mtimeMs;
    try {
        const stats = statSync(path);
        if (!stats.isFile())
            return null;
        size = stats.size;
        mtimeMs = stats.mtimeMs;
    }
    catch {
        return null;
    }
    const want = Math.min(size, WINDOW_BYTES);
    const from = size - want;
    const range = readRange(path, from, want);
    if (range === null)
        return null;
    return {
        text: range.text,
        from,
        to: from + range.read,
        size,
        mtimeMs,
        fromStart: from === 0,
    };
};
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Whether a decoded string is a host container wearing a conversation role. */
const isHostContainer = (text) => {
    const head = text.trimStart();
    return HOST_CONTAINERS.some((tag) => head.startsWith(tag));
};
/**
 * One container record → the visible text it authored, or nothing.
 *
 * The exclusions are the whole point of this function, so they are enumerated
 * rather than filtered by a heuristic:
 *
 * - `isSidechain` — a subagent's transcript. Not the registered root actor.
 * - `thinking` blocks — hidden reasoning. Never authored speech.
 * - `tool_use` / `tool_result` — arguments and output. Not decisions.
 * - `attachment`, `system`, and the bookkeeping types (`last-prompt`, `mode`,
 *   `file-history-*`, …) — injected context and host state, both of which would
 *   let an old memory be recorded as a new statement.
 * - anything whose text opens with a host container tag.
 *
 * A type this function does not recognise returns `'unknown'`, which the caller
 * counts. An unrecognised record is not an empty one.
 */
const decodeRecord = (value) => {
    if (!isRecord(value))
        return 'unknown';
    if (value['isSidechain'] === true)
        return null;
    const type = value['type'];
    if (type !== 'user' && type !== 'assistant') {
        // Known bookkeeping and injected-context types are deliberate omissions;
        // everything else is a shape this adapter does not claim to read.
        const known = new Set([
            'attachment',
            'system',
            'queue-operation',
            'last-prompt',
            'custom-title',
            'agent-name',
            'mode',
            'permission-mode',
            'bridge-session',
            'atis-latch',
            'pr-link',
            'file-history-delta',
            'file-history-snapshot',
            'summary',
            'compact-boundary',
        ]);
        return typeof type === 'string' && known.has(type) ? null : 'unknown';
    }
    const message = value['message'];
    if (!isRecord(message))
        return 'unknown';
    const content = message['content'];
    if (typeof content === 'string') {
        const text = content.trim();
        if (text === '' || isHostContainer(text))
            return null;
        return { role: type, text };
    }
    if (!Array.isArray(content))
        return 'unknown';
    const parts = [];
    for (const block of content) {
        if (!isRecord(block))
            continue;
        // Only `text`. `thinking`, `tool_use` and `tool_result` are excluded by
        // being absent from this condition rather than by a deny-list, so a new
        // block type is excluded by default.
        if (block['type'] !== 'text')
            continue;
        const text = block['text'];
        if (typeof text !== 'string')
            continue;
        const trimmed = text.trim();
        if (trimmed === '' || isHostContainer(trimmed))
            continue;
        parts.push(trimmed);
    }
    if (parts.length === 0)
        return null;
    return { role: type, text: parts.join('\n\n') };
};
/**
 * The producer's entry point. Never throws; every failure is an `unavailable`.
 *
 * Order matters: the environment is checked before the filesystem, and the
 * filesystem before anything is decoded. A default installation with no host
 * session leaves here having touched no files at all.
 */
export const readClaudeSource = (input) => {
    const sessionId = input.env[SESSION_ENV]?.trim();
    if (sessionId === undefined || sessionId === '')
        return unavailable('no-session');
    // An inherited id is not proof of being the root actor. Where the host says
    // otherwise, believe the host.
    if ((input.env[CHILD_ENV] ?? '').trim() !== '')
        return unavailable('not-root-session');
    const path = descriptorPath(input.cwd, sessionId);
    if (path === null)
        return unavailable('not-registered');
    const descriptor = readDescriptor(path);
    if (descriptor === null)
        return unavailable('not-registered');
    const worktree = gitValue(input.cwd, ['rev-parse', '--show-toplevel']);
    const gitdir = gitValue(input.cwd, ['rev-parse', '--absolute-git-dir']);
    if (worktree === null || gitdir === null)
        return unavailable('identity-mismatch');
    if (descriptor.sessionId !== sessionId)
        return unavailable('identity-mismatch');
    if (resolve(descriptor.worktree) !== resolve(worktree))
        return unavailable('identity-mismatch');
    if (resolve(descriptor.gitdir) !== resolve(gitdir))
        return unavailable('identity-mismatch');
    const tail = readTail(descriptor.transcript);
    if (tail === null)
        return unavailable('transcript-unreadable');
    const lines = tail.text.split('\n');
    // The first line of a mid-file read is a fragment of a record, not a record.
    const usable = tail.fromStart ? lines : lines.slice(1);
    const recent = usable.slice(-WINDOW_RECORDS);
    const decoded = [];
    let omitted = 0;
    let unknown = 0;
    let firstWasTruncated = false;
    for (const [index, line] of recent.entries()) {
        const trimmed = line.trim();
        if (trimmed === '')
            continue;
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            // A line the window cut in half is not a malformed transcript. Only the
            // first can be in that state, and it is reported as truncation rather
            // than as an unknown form.
            if (index === 0 && !tail.fromStart)
                firstWasTruncated = true;
            else
                unknown += 1;
            continue;
        }
        const record = decodeRecord(parsed);
        if (record === 'unknown')
            unknown += 1;
        else if (record === null)
            omitted += 1;
        else
            decoded.push(record);
    }
    if (decoded.length === 0) {
        // Told apart on purpose. A window full of records this adapter cannot read
        // is an unsupported format; a window of records it read and correctly
        // omitted is a conversation with nothing visible in it.
        return unavailable(unknown > decoded.length + omitted ? 'unsupported-format' : 'no-visible-messages');
    }
    const blocks = [];
    const bodies = [];
    let text = '';
    let line = 1;
    for (const [index, entry] of decoded.entries()) {
        const body = entry.text.length > MAX_BLOCK_CHARS ? entry.text.slice(0, MAX_BLOCK_CHARS) : entry.text;
        const complete = body === entry.text && !(index === 0 && firstWasTruncated);
        const header = `${entry.role}:\n`;
        const start = text.length + header.length;
        const chunk = `${header}${body}\n\n`;
        const startLine = line + 1;
        const endLine = startLine + body.split('\n').length - 1;
        text += chunk;
        line += chunk.split('\n').length - 1;
        bodies.push(body);
        blocks.push({
            id: `b${String(index)}`,
            role: entry.role,
            start,
            end: start + body.length,
            startLine,
            endLine,
            complete,
        });
    }
    // Asserted, not trusted. Every consumer slices `text` by these offsets and
    // every quote handed to native verification comes out of one of them, so an
    // off-by-one here would surface much later as an unexplained verification
    // rejection. The invariant `text.slice(start, end) === body` is cheap to state
    // and the only place it can be checked against the value it was built from.
    for (const [index, block] of blocks.entries()) {
        if (text.slice(block.start, block.end) !== bodies[index]) {
            return unavailable('unsupported-format');
        }
        const upTo = text.slice(0, block.start).split('\n').length;
        if (upTo !== block.startLine)
            return unavailable('unsupported-format');
    }
    const source = {
        host: 'claude-code',
        sessionId,
        worktree: resolve(worktree),
        gitdir: resolve(gitdir),
        path: descriptor.transcript,
        digest: createHash('sha256').update(tail.text).digest('hex'),
        windowFrom: tail.from,
        windowTo: tail.to,
        size: tail.size,
        mtimeMs: tail.mtimeMs,
        text,
        blocks,
        coverage: {
            recordsInspected: decoded.length,
            recordsOmitted: omitted,
            unknownForms: unknown,
            bytesInspected: tail.to - tail.from,
            bytesTotal: tail.size,
            complete: tail.fromStart,
        },
    };
    return { status: 'available', source };
};
/**
 * The post-request recheck (#1049, ADR D5).
 *
 * Re-reads **the same absolute byte range** and compares its digest — not the
 * tail again. A transcript is appended to on every turn, including by the very
 * session that is committing, so "read the tail again" would find different
 * bytes on essentially every commit and reject all of them. The question is
 * narrower and answerable: does the region that was assessed still say what it
 * said?
 *
 * Truncation and replacement are caught by the size check before the digest:
 * a file that shrank below the assessed region no longer contains it, and a
 * rewritten file at the same length fails the digest.
 */
export const sourceStillCurrent = (source) => {
    let size;
    try {
        const stats = statSync(source.path);
        if (!stats.isFile())
            return false;
        size = stats.size;
    }
    catch {
        return false;
    }
    if (size < source.windowTo)
        return false;
    const range = readRange(source.path, source.windowFrom, source.windowTo - source.windowFrom);
    if (range === null)
        return false;
    if (range.read !== source.windowTo - source.windowFrom)
        return false;
    return createHash('sha256').update(range.text).digest('hex') === source.digest;
};
//# sourceMappingURL=source-claude.js.map