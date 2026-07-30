/**
 * Pending-transaction garbage collection — T-1019 (#215).
 *
 * Removes expired pending files that are not in a protected phase.
 * Never removes `staged` or `applied` files regardless of expiry — those may
 * still be finalised by T-1018's post-commit hook.
 * Never removes a file whose age or phase cannot be determined (fail-closed).
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

import { execGitOrThrow } from './git.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default retention window for consumed files: 24 hours in milliseconds. */
const CONSUMED_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Phases that are protected from gc regardless of expiry. */
const PROTECTED_PHASES = new Set(['staged', 'applied']);

/** Phases we recognise as valid from ADR-0021. */
const KNOWN_PHASES = new Set(['prepared', 'verified', 'staged', 'applied', 'consumed']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GcResult {
  removed: string[];
  kept: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the pending directory via `git rev-parse --git-path`.
 */
const resolvePendingDir = (cwd: string): string => {
  const reported = execGitOrThrow(
    ['rev-parse', '--git-path', 'commitlore/pending'],
    { cwd },
  ).trim();
  return resolve(cwd, reported);
};

/**
 * Safely read and parse a pending file. Returns null on any error
 * (missing, corrupt JSON, non-object, unknown version).
 */
const safeReadPending = (filePath: string): Record<string, unknown> | null => {
  try {
    const content = readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj['version'] !== 1) return null;
    return obj;
  } catch {
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
 * - Skips a file whose age or phase cannot be determined.
 * - Never guesses — fail-closed.
 */
export const gcPending = (cwd: string): GcResult => {
  const removed: string[] = [];
  const kept: string[] = [];

  const dir = resolvePendingDir(cwd);
  if (!existsSync(dir)) return { removed, kept };

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return { removed, kept };
  }

  const now = Date.now();

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
          } catch {
            kept.push(file);
          }
        } else {
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
        } catch {
          kept.push(file);
        }
      } else {
        kept.push(file);
      }
      continue;
    }

    // Non-consumed, non-protected phase (prepared/verified): check expiry
    // expires_at must be a parseable ISO string to determine eligibility
    if (typeof expiresAt !== 'string' || expiresAt === '') {
      // Cannot determine expiry — skip (fail-closed)
      kept.push(file);
      continue;
    }

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
      } catch {
        kept.push(file);
      }
    } else {
      kept.push(file);
    }
  }

  return { removed, kept };
};
