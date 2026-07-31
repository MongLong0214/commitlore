/**
 * Pending transaction store — ADR-0021.
 *
 * Owns the monotonic prepare → verify → stage → apply → consume lifecycle
 * of a single capture pipeline run. Every mutation is an atomic rename so
 * no concurrent reader can observe a partial file.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execGitOrThrow } from './git.js';
export class PendingFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PendingFormatError';
    }
}
// ---------------------------------------------------------------------------
// Nonce validation — trust boundary (CEO amendment 2)
// ---------------------------------------------------------------------------
const NONCE_RE = /^[0-9a-f]{32}$/;
const validateNonce = (nonce) => {
    if (!NONCE_RE.test(nonce)) {
        throw new Error(`Invalid nonce: must be exactly 32 lowercase hex characters, got "${nonce}"`);
    }
};
// ---------------------------------------------------------------------------
// Path resolution — via git rev-parse --git-path (ADR-0021, per-worktree)
// ---------------------------------------------------------------------------
const pendingDir = (cwd) => {
    const reported = execGitOrThrow(['rev-parse', '--git-path', 'commitlore/pending'], { cwd }).trim();
    return resolve(cwd, reported);
};
const pendingFilePath = (nonce, cwd) => {
    validateNonce(nonce);
    const dir = pendingDir(cwd);
    return resolve(dir, `${nonce}.json`);
};
// ---------------------------------------------------------------------------
// Atomic write helper (pattern: claude-settings.ts:283-293)
// ---------------------------------------------------------------------------
const atomicWriteJson = (filePath, data) => {
    const dir = resolve(filePath, '..');
    mkdirSync(dir, { recursive: true });
    const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    const body = JSON.stringify(data, null, 2) + '\n';
    try {
        writeFileSync(temporary, body);
        renameSync(temporary, filePath);
    }
    catch (error) {
        try {
            unlinkSync(temporary);
        }
        catch { /* best-effort cleanup */ }
        throw error;
    }
};
/**
 * Creates a pending transaction in `prepared` phase.
 * Returns the nonce (32 hex chars).
 */
export const createPending = (opts) => {
    const nonce = randomBytes(16).toString('hex');
    const baseHead = execGitOrThrow(['rev-parse', 'HEAD'], { cwd: opts.cwd }).trim();
    if (!baseHead || !/^[0-9a-f]{40}$/.test(baseHead)) {
        throw new Error('Cannot resolve HEAD — is this a git repository with at least one commit?');
    }
    const now = new Date().toISOString();
    const record = {
        version: 1,
        nonce,
        created_at: now,
        // CEO amendment 1: expires_at is null while phase is prepared or verified
        expires_at: null,
        phase: 'prepared',
        consumed: false,
        verified_at: null,
        staged_at: null,
        applied_at: null,
        applied_record_hash: null,
        consumed_at: null,
        consumed_by: null,
        base_head: baseHead,
        staged_diff_hash: opts.staged_diff_hash,
        staged_tree_oid: opts.staged_tree_oid,
        policy_identity_hash: opts.policy_identity_hash,
        source_hashes: opts.source_hashes,
        evidence_hash: null,
        records: [],
        validation_result: null,
        overlap_check: null,
        incomplete: false,
        guard_advisory: opts.guard_advisory ?? null,
    };
    const filePath = pendingFilePath(nonce, opts.cwd);
    atomicWriteJson(filePath, record);
    return nonce;
};
/**
 * The nonces of every pending transaction in this repository, sorted oldest name
 * first so a listing is stable between runs.
 *
 * Returns an empty list when the directory does not exist: a repository that has
 * never captured has nothing pending, which is an answer rather than an error
 * (#311).
 */
export const listPendingNonces = (cwd) => {
    let entries;
    try {
        entries = readdirSync(pendingDir(cwd));
    }
    catch {
        return [];
    }
    return entries
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .filter((nonce) => /^[0-9a-f]{32}$/.test(nonce))
        .sort();
};
/**
 * Reads a pending transaction by nonce.
 * Returns null if the file is absent.
 * Throws PendingFormatError for corrupt or unknown-version content.
 */
export const readPending = (nonce, opts) => {
    validateNonce(nonce);
    const filePath = pendingFilePath(nonce, opts.cwd);
    if (!existsSync(filePath))
        return null;
    let content;
    try {
        content = readFileSync(filePath, 'utf8');
    }
    catch {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch {
        throw new PendingFormatError(`Corrupt pending file for nonce ${nonce}: invalid JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new PendingFormatError(`Corrupt pending file for nonce ${nonce}: not an object`);
    }
    const obj = parsed;
    if (obj['version'] !== 1) {
        throw new PendingFormatError(`Unsupported pending file version ${String(obj['version'])} for nonce ${nonce}`);
    }
    return obj;
};
/**
 * Stores verification results in the pending transaction.
 * Only succeeds if the current phase is 'prepared'.
 */
export const storeVerification = (nonce, opts) => {
    validateNonce(nonce);
    const record = readPending(nonce, { cwd: opts.cwd });
    if (!record)
        return false;
    if (record.phase !== 'prepared')
        return false;
    const now = new Date().toISOString();
    const updated = {
        ...record,
        phase: 'verified',
        verified_at: now,
        // CEO amendment 1: expires_at remains null in verified phase
        expires_at: null,
        records: opts.accepted,
        evidence_hash: opts.evidence_hash,
        validation_result: opts.validation_result,
        overlap_check: opts.overlap_check,
        incomplete: opts.incomplete,
    };
    const filePath = pendingFilePath(nonce, opts.cwd);
    atomicWriteJson(filePath, updated);
    return true;
};
/**
 * Stages a verified transaction.
 * Returns true on success, false if the phase is not 'verified'.
 * CEO amendment 1: stamps expires_at = staged_at + 5 minutes (or expiryMinutes).
 */
export const stagePending = (nonce, opts) => {
    validateNonce(nonce);
    const record = readPending(nonce, { cwd: opts.cwd });
    if (!record)
        return false;
    if (record.phase !== 'verified')
        return false;
    const now = new Date();
    const minutes = opts.expiryMinutes ?? 5;
    const expiresAt = new Date(now.getTime() + minutes * 60_000);
    const updated = {
        ...record,
        phase: 'staged',
        staged_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
    };
    const filePath = pendingFilePath(nonce, opts.cwd);
    atomicWriteJson(filePath, updated);
    return true;
};
/**
 * Records that the pending transaction was applied (trailer appended to commit message).
 * Only succeeds if phase is 'staged'.
 */
export const markApplied = (nonce, recordHash, opts) => {
    validateNonce(nonce);
    const record = readPending(nonce, { cwd: opts.cwd });
    if (!record)
        return false;
    if (record.phase !== 'staged')
        return false;
    const now = new Date().toISOString();
    const updated = {
        ...record,
        phase: 'applied',
        applied_at: now,
        applied_record_hash: recordHash,
    };
    const filePath = pendingFilePath(nonce, opts.cwd);
    atomicWriteJson(filePath, updated);
    return true;
};
/**
 * Consumes a pending transaction after a successful commit.
 * Only succeeds if phase is 'applied' and consumed is false.
 */
export const consumePending = (nonce, commitSha, opts) => {
    validateNonce(nonce);
    const record = readPending(nonce, { cwd: opts.cwd });
    if (!record)
        return false;
    if (record.phase !== 'applied')
        return false;
    if (record.consumed)
        return false;
    const now = new Date().toISOString();
    const updated = {
        ...record,
        phase: 'consumed',
        consumed: true,
        consumed_at: now,
        consumed_by: commitSha,
    };
    const filePath = pendingFilePath(nonce, opts.cwd);
    atomicWriteJson(filePath, updated);
    return true;
};
//# sourceMappingURL=pending.js.map