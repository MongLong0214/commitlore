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
 * - `stale` — `base_head` no longer matches `HEAD`. The transaction will not apply
 *   to the commit being written, and at commit time that is a silent no-op.
 * - `gc_eligible` — whether `capture gc` would ever remove this file. A
 *   non-consumed transaction is collected only when `expires_at` parses, and
 *   `expires_at` is stamped at stage time, so a `verified` transaction that was
 *   never staged is kept indefinitely. That is reported, not changed: altering the
 *   collection rule is a separate decision from being able to see it.
 */
import type { Command } from 'commander';

import { execGit } from '../core/git.js';
import { listPendingNonces, readPending, type PendingRecord } from '../core/pending.js';

/** One row of `pending ls`: the fields worth scanning, plus the two derived ones. */
export interface PendingSummary {
  nonce: string;
  phase: PendingRecord['phase'];
  records: number;
  validation_result: PendingRecord['validation_result'];
  created_at: string;
  expires_at: string | null;
  base_head: string;
  /** `base_head` is no longer HEAD, so this transaction cannot apply. */
  stale: boolean;
  /** Whether `capture gc` would ever remove this file. */
  gc_eligible: boolean;
}

export interface PendingListResult {
  transactions: PendingSummary[];
  /** Present when a file exists but cannot be read as a transaction. */
  unreadable: string[];
}

export interface PendingShowResult {
  transaction: (PendingRecord & { stale: boolean; gc_eligible: boolean }) | null;
  /** Why nothing is being shown, in the words a caller can act on. */
  error: string | null;
}

const headOf = (cwd: string): string | null => {
  const result = execGit(['rev-parse', 'HEAD'], { cwd });
  if (result.code !== 0) return null;
  const head = result.stdout.trim();
  return /^[0-9a-f]{40}$/.test(head) ? head : null;
};

/**
 * Whether `capture gc` could ever collect this transaction.
 *
 * Mirrors `gcPending`'s rule rather than restating it loosely: a `staged` or
 * `applied` transaction is protected, a `consumed` one ages out on its retention
 * window, and anything else needs a parseable `expires_at`.
 */
const gcEligible = (record: PendingRecord): boolean => {
  if (record.phase === 'staged' || record.phase === 'applied') return false;
  if (record.phase === 'consumed' && record.consumed) return true;
  if (record.expires_at === null || record.expires_at === '') return false;
  return !Number.isNaN(Date.parse(record.expires_at));
};

const summarise = (record: PendingRecord, head: string | null): PendingSummary => ({
  nonce: record.nonce,
  phase: record.phase,
  records: record.records.length,
  validation_result: record.validation_result,
  created_at: record.created_at,
  expires_at: record.expires_at,
  base_head: record.base_head,
  stale: head !== null && record.base_head !== head,
  gc_eligible: gcEligible(record),
});

export const runPendingList = (opts: { cwd?: string }): PendingListResult => {
  const cwd = opts.cwd ?? process.cwd();
  const head = headOf(cwd);
  const transactions: PendingSummary[] = [];
  const unreadable: string[] = [];

  for (const nonce of listPendingNonces(cwd)) {
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
  return { transactions, unreadable };
};

export const runPendingShow = (opts: { cwd?: string; nonce: string }): PendingShowResult => {
  const cwd = opts.cwd ?? process.cwd();
  const wanted = opts.nonce.trim().toLowerCase();
  const candidates = listPendingNonces(cwd).filter((nonce) => nonce.startsWith(wanted));

  if (candidates.length === 0) {
    return { transaction: null, error: `no pending transaction matches ${JSON.stringify(wanted)}` };
  }
  if (candidates.length > 1) {
    return {
      transaction: null,
      error:
        `ambiguous: ${JSON.stringify(wanted)} matched ${candidates.length} transactions ` +
        `(${candidates.map((nonce) => nonce.slice(0, 8)).join(', ')}); give more of the nonce`,
    };
  }

  const [only = ''] = candidates;
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

  const head = headOf(cwd);
  return {
    transaction: {
      ...record,
      stale: head !== null && record.base_head !== head,
      gc_eligible: gcEligible(record),
    },
    error: null,
  };
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
    .description('inspect capture transactions that have not reached a commit yet');

  pending
    .command('ls')
    .description('list pending capture transactions')
    .option('--json', 'emit structured JSON output')
    .action((options: { json?: boolean }) => {
      const result = runPendingList({});
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      process.stdout.write(renderList(result, Date.now()));
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
};
