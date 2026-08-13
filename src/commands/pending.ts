/**
 * `commitlore pending` — look at capture transactions without reading `.git`.
 *
 * A pending transaction was the one piece of context in this system that could
 * not be reviewed (#311). Everything worth knowing already sat in
 * `.git/commitlore/pending/<nonce>.json`, and the only way to reach it was to
 * point a JSON parser at another tool's `.git` subdirectory — which is what a CLI
 * exists to prevent, and which breaks silently the first time a field is renamed.
 *
 * Two facts are derived here rather than stored, because both are relative to the
 * repository as it is now:
 *
 * - `stale` — `base_head` no longer matches `HEAD` and the transaction has not
 *   been consumed. It will not apply to the commit being written, and at commit
 *   time that is a silent no-op. A consumed one is never stale however far HEAD
 *   has moved: it moved because that transaction landed (#584).
 * - `gc_eligible` — whether `capture gc` would ever remove this file. Since #367
 *   that is a question about the phase alone: `staged` and `applied` are
 *   protected outright, and everything else is collected once its window has
 *   elapsed. The `stale` column says whether the wait has started.
 *
 * `rm` exists for the third question these two raised and could not answer: a
 * file the user simply wants gone now, without waiting out a retention window.
 */
import type { Command } from 'commander';

import {
  deletePending,
  listPendingNonces,
  pendingIsStale,
  readPending,
  resolveHead,
  type PendingRecord,
} from '../core/pending.js';

/** One row of `pending ls`: the fields worth scanning, plus the two derived ones. */
export interface PendingSummary {
  nonce: string;
  phase: PendingRecord['phase'];
  records: number;
  validation_result: PendingRecord['validation_result'];
  created_at: string;
  expires_at: string | null;
  base_head: string;
  /** `base_head` is no longer HEAD and nothing consumed it, so it cannot apply. */
  stale: boolean;
  /** Whether `capture gc` would ever remove this file. */
  gc_eligible: boolean;
}

export interface PendingListResult {
  transactions: PendingSummary[];
  /** Present when a file exists but cannot be read as a transaction. */
  unreadable: string[];
  /** Whether the pending directory was read, absent, or could not be inspected. */
  state: 'ready' | 'absent' | 'unreadable';
  /** Filesystem error code when `state` is `unreadable`; otherwise null. */
  error: string | null;
}

export interface PendingShowResult {
  transaction: (PendingRecord & { stale: boolean; gc_eligible: boolean }) | null;
  /** Why nothing is being shown, in the words a caller can act on. */
  error: string | null;
}

export interface PendingRemoveResult {
  /** The nonce that was removed, or null when nothing was. */
  removed: string | null;
  /** The phase it was in, when that could be read — the reason for a refusal. */
  phase: PendingRecord['phase'] | null;
  /** Why nothing was removed, in the words a caller can act on. */
  error: string | null;
}

/**
 * The two phases the post-commit hook can still turn into a record. `gcPending`
 * refuses to collect them and `rm` refuses to delete them, for that one reason —
 * so the set is written once here rather than twice with the same comment.
 */
const PROTECTED_PHASES = new Set<PendingRecord['phase']>(['staged', 'applied']);

/**
 * Whether `capture gc` could ever collect this transaction.
 *
 * Mirrors `gcPending`'s rule rather than restating it loosely: the protected two
 * are never collected, a `consumed` one ages out on its retention window, and
 * since #367 a `prepared` or `verified` one ages out on `created_at` once HEAD
 * has moved past its base. A stamped `expires_at` still decides where one
 * exists, but its absence is no longer a life sentence.
 */
const gcEligible = (record: PendingRecord): boolean => !PROTECTED_PHASES.has(record.phase);

const summarise = (record: PendingRecord, head: string | null): PendingSummary => ({
  nonce: record.nonce,
  phase: record.phase,
  records: record.records.length,
  validation_result: record.validation_result,
  created_at: record.created_at,
  expires_at: record.expires_at,
  base_head: record.base_head,
  stale: pendingIsStale(record, head),
  gc_eligible: gcEligible(record),
});

export const runPendingList = (opts: { cwd?: string }): PendingListResult => {
  const cwd = opts.cwd ?? process.cwd();
  const head = resolveHead(cwd);
  const transactions: PendingSummary[] = [];
  const unreadable: string[] = [];
  const listed = listPendingNonces(cwd);

  if (listed.state === 'unreadable') {
    return { transactions, unreadable, state: listed.state, error: listed.error };
  }

  for (const nonce of listed.nonces) {
    let record: PendingRecord | null = null;
    try {
      record = readPending(nonce, { cwd });
    } catch {
      // A file that cannot be parsed is named rather than dropped: silence here
      // would reproduce the reporting gap this command exists to close.
      unreadable.push(nonce);
      continue;
    }
    if (record === null) {
      unreadable.push(nonce);
      continue;
    }
    transactions.push(summarise(record, head));
  }

  transactions.sort((left, right) => right.created_at.localeCompare(left.created_at));
  return { transactions, unreadable, state: listed.state, error: listed.error };
};

/**
 * The single transaction a nonce prefix names, or why it names none. Shared by
 * `show` and `rm` so that "enough of the nonce" means the same thing to a
 * command that prints and a command that deletes.
 */
const resolvePrefix = (cwd: string, prefix: string): { nonce: string | null; error: string | null } => {
  const wanted = prefix.trim().toLowerCase();
  const listed = listPendingNonces(cwd);
  if (listed.state === 'unreadable') {
    return { nonce: null, error: `pending state could not be read (${listed.error ?? 'unknown'})` };
  }
  const candidates = listed.nonces.filter((nonce) => nonce.startsWith(wanted));

  if (candidates.length === 0) {
    return { nonce: null, error: `no pending transaction matches ${JSON.stringify(wanted)}` };
  }
  if (candidates.length > 1) {
    return {
      nonce: null,
      error:
        `ambiguous: ${JSON.stringify(wanted)} matched ${candidates.length} transactions ` +
        `(${candidates.map((nonce) => nonce.slice(0, 8)).join(', ')}); give more of the nonce`,
    };
  }
  const [only = ''] = candidates;
  return { nonce: only, error: null };
};

export const runPendingShow = (opts: { cwd?: string; nonce: string }): PendingShowResult => {
  const cwd = opts.cwd ?? process.cwd();
  const { nonce: only, error } = resolvePrefix(cwd, opts.nonce);
  if (only === null) return { transaction: null, error };

  let record: PendingRecord | null = null;
  try {
    record = readPending(only, { cwd });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { transaction: null, error: `${only} could not be read: ${detail}` };
  }
  if (record === null) {
    return { transaction: null, error: `${only} could not be read as a transaction` };
  }

  const head = resolveHead(cwd);
  return {
    transaction: {
      ...record,
      stale: pendingIsStale(record, head),
      gc_eligible: gcEligible(record),
    },
    error: null,
  };
};

/**
 * `pending rm` — delete one transaction file now, rather than waiting out a
 * retention window.
 *
 * Refuses `staged` and `applied`. Those are the two phases the post-commit hook
 * can still finalise, which is why gc will not touch them either (#367 changed
 * neither); deleting one loses a record the user is in the middle of writing,
 * and there is no way to tell that from a file they are tired of seeing. It
 * refuses a file it cannot read for the same reason inverted: an unknown phase
 * might be one of those two.
 */
export const runPendingRemove = (opts: { cwd?: string; nonce: string }): PendingRemoveResult => {
  const cwd = opts.cwd ?? process.cwd();
  const { nonce: only, error } = resolvePrefix(cwd, opts.nonce);
  if (only === null) return { removed: null, phase: null, error };

  let record: PendingRecord | null = null;
  try {
    record = readPending(only, { cwd });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      removed: null,
      phase: null,
      error: `${only} could not be read: ${detail}; its phase is unknown, so it is left in place`,
    };
  }
  if (record === null) {
    return {
      removed: null,
      phase: null,
      error: `${only} could not be read as a transaction; its phase is unknown, so it is left in place`,
    };
  }

  if (PROTECTED_PHASES.has(record.phase)) {
    return {
      removed: null,
      phase: record.phase,
      error:
        `${only} is ${record.phase}: the post-commit hook may still finalise it into a record, ` +
        `and removing it now would lose that. It is collected once the commit it belongs to lands.`,
    };
  }

  if (!deletePending(only, { cwd })) {
    return { removed: null, phase: record.phase, error: `${only} could not be removed` };
  }
  return { removed: only, phase: record.phase, error: null };
};

/** Age in whole hours or minutes, whichever reads better at this magnitude. */
const age = (from: string, now: number): string => {
  const started = Date.parse(from);
  if (Number.isNaN(started)) return '?';
  const minutes = Math.max(0, Math.round((now - started) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

const renderList = (result: PendingListResult, now: number): string => {
  if (result.state === 'unreadable') {
    return `pending state could not be read (${result.error ?? 'unknown'}); no conclusion can be drawn\n`;
  }
  if (result.transactions.length === 0 && result.unreadable.length === 0) {
    return 'no pending capture transactions\n';
  }
  const lines = ['NONCE     PHASE     RECORDS  VALIDATION  AGE   BASE      FLAGS'];
  for (const row of result.transactions) {
    const flags = [row.stale ? 'stale' : '', row.gc_eligible ? '' : 'never-collected']
      .filter((flag) => flag !== '')
      .join(',');
    lines.push(
      [
        row.nonce.slice(0, 8).padEnd(9),
        row.phase.padEnd(9),
        String(row.records).padEnd(8),
        (row.validation_result ?? '-').padEnd(11),
        age(row.created_at, now).padEnd(5),
        row.base_head.slice(0, 8).padEnd(9),
        flags,
      ].join(' '),
    );
  }
  for (const nonce of result.unreadable) {
    lines.push(`${nonce.slice(0, 8)} unreadable`);
  }
  return `${lines.join('\n')}\n`;
};

export const register = (program: Command): void => {
  const pending = program
    .command('pending')
    .description('inspect or remove capture transactions that have not reached a commit yet');

  pending
    .command('ls')
    .description('list pending capture transactions')
    .option('--json', 'emit structured JSON output')
    .action((options: { json?: boolean }) => {
      const result = runPendingList({});
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (result.state === 'unreadable') process.exitCode = 1;
        return;
      }
      process.stdout.write(renderList(result, Date.now()));
      if (result.state === 'unreadable') process.exitCode = 1;
    });

  pending
    .command('show')
    .argument('<nonce>', 'the transaction nonce, or enough of its start to be unambiguous')
    .description('print one capture transaction, with whether it is stale')
    .option('--json', 'emit structured JSON output')
    .action((nonce: string, options: { json?: boolean }) => {
      const result = runPendingShow({ nonce });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (result.transaction === null) process.exitCode = 1;
        return;
      }
      if (result.transaction === null) {
        process.stderr.write(`commitlore pending: ${result.error ?? 'not found'}\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`${JSON.stringify(result.transaction, null, 2)}\n`);
    });

  pending
    .command('rm')
    .argument('<nonce>', 'the transaction nonce, or enough of its start to be unambiguous')
    .description('delete one capture transaction; refuses a staged or applied one')
    .option('--json', 'emit structured JSON output')
    .action((nonce: string, options: { json?: boolean }) => {
      const result = runPendingRemove({ nonce });
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (result.removed === null) process.exitCode = 1;
        return;
      }
      if (result.removed === null) {
        process.stderr.write(`commitlore pending: ${result.error ?? 'not removed'}\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`removed ${result.removed} (${result.phase ?? 'unknown'})\n`);
    });
};
