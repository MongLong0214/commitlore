/**
 * Pending-transaction garbage collection — T-1019 (#215).
 *
 * Removes expired pending files that are not in a protected phase.
 * Never removes `staged` or `applied` files regardless of expiry — those may
 * still be finalised by T-1018's post-commit hook.
 * Never removes a file whose age or phase cannot be determined (fail-closed).
 *
 * #367 narrows fail-closed by exactly one case. `expires_at` is stamped at stage
 * time (`capture-stage.ts`), so `prepared` and `verified` carry `expires_at:
 * null` and the expiry rule below could never fire on them — the branch that
 * kept them was not being cautious, it was unreachable by construction. Since
 * #341 made skipping the ordinary outcome of a capture, that leaked a file on
 * the common path. Those two phases age out on `created_at` instead, and only
 * once HEAD has moved past `base_head`. Fail-closed is otherwise untouched: the
 * protected phases, the consumed window, and every undeterminable file behave
 * exactly as before.
 */
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { execGitOrThrow } from './git.js';
import { headHasMovedPast, resolveHead } from './pending.js';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Default retention window for consumed files: 24 hours in milliseconds. */
const CONSUMED_RETENTION_MS = 24 * 60 * 60 * 1000;
/**
 * Retention window for a transaction that will never be stamped with an expiry:
 * 24 hours from `created_at`.
 *
 * Chosen, not inherited. The staleness test below already proves the
 * transaction cannot be staged, so this window is not what makes collection
 * safe — it is the margin for the one way that proof can be temporarily wrong.
 * HEAD moving away from `base_head` is not always permanent: an amend, a reset,
 * or a branch round-trip can put it back, and a transaction collected in the
 * middle of that would be lost work. Those cycles run in seconds to minutes, so
 * a day is several orders of magnitude of headroom while still bounding
 * `pending ls` to roughly one working day of skipped captures.
 *
 * It is deliberately the same 24 hours as the consumed window: one retention
 * story for this directory is easier to reason about than two, and nothing here
 * argues for the two numbers diverging.
 */
const UNSTAMPED_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Phases that are protected from gc regardless of expiry. */
const PROTECTED_PHASES = new Set(['staged', 'applied']);
/**
 * Phases that are never stamped with an `expires_at`, because staging is what
 * stamps it and they have not staged.
 */
const UNSTAMPED_PHASES = new Set(['prepared', 'verified']);
/** Phases we recognise as valid from ADR-0021. */
const KNOWN_PHASES = new Set(['prepared', 'verified', 'staged', 'applied', 'consumed']);
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/**
 * Resolve the pending directory via `git rev-parse --git-path`.
 */
const resolvePendingDir = (cwd) => {
    const reported = execGitOrThrow(['rev-parse', '--git-path', 'commitlore/pending'], { cwd }).trim();
    return resolve(cwd, reported);
};
/**
 * Safely read and parse a pending file. Returns null on any error
 * (missing, corrupt JSON, non-object, unknown version).
 */
const safeReadPending = (filePath) => {
    try {
        const content = readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(content);
        if (typeof parsed !== 'object' || parsed === null)
            return null;
        const obj = parsed;
        if (obj['version'] !== 1)
            return null;
        return obj;
    }
    catch {
        return null;
    }
};
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Garbage-collect expired pending transaction files.
 *
 * Behaviour:
 * - Removes a file when `now > expires_at` AND `phase` is neither `staged`
 *   nor `applied`.
 * - Removes a `consumed: true` file older than the retention window (24h).
 * - Removes a `prepared` or `verified` file — which never gets an `expires_at`
 *   — once it is older than 24h AND HEAD has moved past its `base_head`, so
 *   staging would refuse it anyway (#367).
 * - Skips a file whose age or phase cannot be determined.
 * - Never guesses — fail-closed.
 */
export const gcPending = (cwd) => {
    const removed = [];
    const kept = [];
    const dir = resolvePendingDir(cwd);
    if (!existsSync(dir))
        return { removed, kept };
    let files;
    try {
        files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    }
    catch {
        return { removed, kept };
    }
    const now = Date.now();
    // Read once: every file in this directory is judged against the same HEAD.
    const head = resolveHead(cwd);
    for (const file of files) {
        const filePath = resolve(dir, file);
        const record = safeReadPending(filePath);
        // Cannot read or parse — skip (fail-closed)
        if (!record) {
            kept.push(file);
            continue;
        }
        const phase = record['phase'];
        const consumed = record['consumed'];
        const expiresAt = record['expires_at'];
        const consumedAt = record['consumed_at'];
        // Phase must be a known string — otherwise skip
        if (typeof phase !== 'string' || !KNOWN_PHASES.has(phase)) {
            kept.push(file);
            continue;
        }
        // Protected phases are never removed, regardless of expiry
        if (PROTECTED_PHASES.has(phase)) {
            kept.push(file);
            continue;
        }
        // Consumed file: eligible if past retention window
        if (phase === 'consumed' && consumed === true) {
            // Need consumed_at to determine age
            if (typeof consumedAt !== 'string') {
                // Try created_at as fallback for age determination
                const createdAt = record['created_at'];
                if (typeof createdAt !== 'string') {
                    kept.push(file);
                    continue;
                }
                const createdMs = Date.parse(createdAt);
                if (isNaN(createdMs)) {
                    kept.push(file);
                    continue;
                }
                if (now - createdMs > CONSUMED_RETENTION_MS) {
                    try {
                        unlinkSync(filePath);
                        removed.push(file);
                    }
                    catch {
                        kept.push(file);
                    }
                }
                else {
                    kept.push(file);
                }
                continue;
            }
            const consumedMs = Date.parse(consumedAt);
            if (isNaN(consumedMs)) {
                kept.push(file);
                continue;
            }
            if (now - consumedMs > CONSUMED_RETENTION_MS) {
                try {
                    unlinkSync(filePath);
                    removed.push(file);
                }
                catch {
                    kept.push(file);
                }
            }
            else {
                kept.push(file);
            }
            continue;
        }
        // Non-consumed, non-protected phase (prepared/verified): a stamped expiry
        // still decides, when there is one to read.
        if (typeof expiresAt === 'string' && expiresAt !== '') {
            const expiresMs = Date.parse(expiresAt);
            if (isNaN(expiresMs)) {
                // Cannot parse — skip
                kept.push(file);
                continue;
            }
            if (now > expiresMs) {
                try {
                    unlinkSync(filePath);
                    removed.push(file);
                }
                catch {
                    kept.push(file);
                }
            }
            else {
                kept.push(file);
            }
            continue;
        }
        // No stamped expiry, and nothing will ever stamp one (#367). Only the two
        // phases that stage has not reached qualify — anything else with a missing
        // expiry is still undeterminable and is skipped.
        if (!UNSTAMPED_PHASES.has(phase)) {
            kept.push(file);
            continue;
        }
        // Age is measured from `created_at`, the only timestamp these phases have.
        const createdAt = record['created_at'];
        if (typeof createdAt !== 'string') {
            kept.push(file);
            continue;
        }
        const createdMs = Date.parse(createdAt);
        if (isNaN(createdMs)) {
            kept.push(file);
            continue;
        }
        if (now - createdMs <= UNSTAMPED_RETENTION_MS) {
            kept.push(file);
            continue;
        }
        // Age alone is not permission. The transaction is collected only once
        // staging would refuse it — `stageCaptureRecord` rejects when HEAD is not
        // `base_head`, so this is the point past which it can never be finalised.
        // A transaction still sitting on HEAD is left alone however old it is.
        if (!headHasMovedPast(record['base_head'], head)) {
            kept.push(file);
            continue;
        }
        try {
            unlinkSync(filePath);
            removed.push(file);
        }
        catch {
            kept.push(file);
        }
    }
    return { removed, kept };
};
//# sourceMappingURL=pending-gc.js.map