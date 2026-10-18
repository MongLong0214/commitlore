/**
 * bug-issue-1170: a staged capture can be withdrawn, and one that was replaced
 * is called replaced.
 *
 * Reported shape: stage a record, notice its wording is wrong, and there is no
 * supported way back. `pending rm` refuses a staged transaction; capturing
 * again stages a second one for the same tree; `prepare-commit-msg` applies the
 * newest and passes over the first in silence; and `doctor` then describes the
 * first as a capture that "expired before reaching a commit and [was]
 * dropped" — a lost decision, when it had been deliberately replaced.
 *
 * Three things are pinned here: the stamp a second stage leaves, the withdrawal
 * `--force` allows for `staged` and still refuses for `applied`, and the
 * sentence `doctor` prints once a superseded transaction goes stale.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { runPendingList, runPendingRemove } from '../src/commands/pending.js';
import {
  createPending,
  markApplied,
  readPending,
  stagePending,
  storeVerification,
  supersedeStagedSiblings,
} from '../src/core/pending.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'commitlore.mjs');

const temporaries: string[] = [];
afterEach(() => {
  while (temporaries.length > 0) {
    const dir = temporaries.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' });

const cli = (cwd: string, args: readonly string[]): { out: string; status: number } => {
  try {
    return { out: execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' }), status: 0 };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { out: `${failure.stdout ?? ''}${failure.stderr ?? ''}`, status: failure.status ?? 1 };
  }
};

const TRANSCRIPT = 'We decided to keep the retry ceiling at three attempts.\n';

const draftFor = (warning: string): string =>
  JSON.stringify({
    records: [
      {
        trailers: [{ key: 'Warn', value: warning }],
        evidence: [
          {
            key: 'Warn',
            source: 'transcript',
            quote: 'We decided to keep the retry ceiling at three attempts.',
            locator: 'L1-L1',
          },
        ],
      },
    ],
  });

const repoWithStagedChange = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `cl-${label}-`));
  temporaries.push(dir);
  git(dir, ['init', '--quiet', '--template=', '--initial-branch=main', '.']);
  git(dir, ['config', 'user.name', 'CommitLore Test']);
  git(dir, ['config', 'user.email', 'test@example.invalid']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'seed.txt'), 'seed\n');
  git(dir, ['add', '--', 'seed.txt']);
  git(dir, ['commit', '--quiet', '-m', 'seed']);
  writeFileSync(join(dir, 'transcript.txt'), TRANSCRIPT);
  writeFileSync(join(dir, 'd1.json'), draftFor('do not raise the retry ceiling'));
  writeFileSync(join(dir, 'd2.json'), draftFor('do not raise the retry ceiling without the vendor quota'));
  writeFileSync(join(dir, 'queue.ts'), 'export const retries = 2;\n');
  git(dir, ['add', '--', 'queue.ts']);
  return dir;
};

const capture = (cwd: string, draft: string): { out: string; status: number } =>
  cli(cwd, ['capture', '--transcript', 'transcript.txt', '--draft', draft]);

const nonces = (cwd: string): { nonce: string; superseded_by?: string; gc_eligible: boolean }[] => {
  const listing = runPendingList({ cwd });
  return listing.transactions.map((transaction) => ({
    nonce: transaction.nonce,
    ...(transaction.superseded_by === undefined ? {} : { superseded_by: transaction.superseded_by }),
    gc_eligible: transaction.gc_eligible,
  }));
};

describe('a second stage on the same tree supersedes the first (bug-issue-1170)', () => {
  it('says so and stamps the older transaction', () => {
    const cwd = repoWithStagedChange('supersede');

    const first = capture(cwd, 'd1.json');
    expect(first.status).toBe(0);
    const firstNonce = nonces(cwd)[0]?.nonce ?? '';
    expect(firstNonce).not.toBe('');

    const second = capture(cwd, 'd2.json');
    expect(second.status).toBe(0);
    // The sentence that was missing: which transaction this one replaced.
    expect(second.out).toContain(`superseded ${firstNonce}`);
    expect(second.out).toContain('the commit will carry this record instead');

    const rows = nonces(cwd);
    const older = rows.find((row) => row.nonce === firstNonce);
    const newer = rows.find((row) => row.nonce !== firstNonce);
    expect(older?.superseded_by).toBe(newer?.nonce);
    expect(newer?.superseded_by).toBeUndefined();
    // Still protected from gc, and deliberately. `r-c44a1edb` holds that a
    // staged file is never collected because post-commit may still finalise it,
    // and "superseded" does not make that safe: withdraw the newer transaction
    // and this one is the newest candidate again. The label is the fix; the
    // leak r-gcunstageable records stays where that record left it.
    expect(older?.gc_eligible).toBe(false);
    expect(newer?.gc_eligible).toBe(false);
  });

  it('leaves a transaction for a different tree alone', () => {
    const cwd = repoWithStagedChange('supersede-other-tree');
    capture(cwd, 'd1.json');
    const firstNonce = nonces(cwd)[0]?.nonce ?? '';

    // A second transaction whose staged diff is not this one's. Nothing about
    // it rivals the first for the next commit, so staging it must not claim to
    // replace it.
    const other = createPending({
      cwd,
      source_hashes: { transcript: sha256(TRANSCRIPT), diff: sha256('other') },
      staged_diff_hash: sha256('other'),
      staged_tree_oid: git(cwd, ['write-tree']).trim(),
      policy_identity_hash: sha256('policy'),
    });
    storeVerification(other, {
      cwd,
      accepted: [{ record: { trailers: [], evidence: [] }, trailers: [] }] as never,
      rejected: [],
      validation_result: 'pass',
      incomplete: false,
      overlap_check: 'canonical_exact_only',
    } as never);
    stagePending(other, { cwd });

    expect(supersedeStagedSiblings(other, { cwd })).toEqual([]);
    expect(readPending(firstNonce, { cwd })?.superseded_by).toBeUndefined();
  });
});

describe('withdrawing a staged capture (bug-issue-1170)', () => {
  it('refuses without --force, names the way out, and removes it with --force', () => {
    const cwd = repoWithStagedChange('withdraw');
    capture(cwd, 'd1.json');
    const nonce = nonces(cwd)[0]?.nonce ?? '';

    const refused = runPendingRemove({ cwd, nonce });
    expect(refused.removed).toBeNull();
    expect(refused.phase).toBe('staged');
    // The report's complaint was that the refusal named no alternative.
    expect(refused.error).toContain('--force');

    const withdrawn = runPendingRemove({ cwd, nonce, force: true });
    expect(withdrawn.removed).toBe(nonce);
    expect(withdrawn.phase).toBe('staged');
    expect(nonces(cwd)).toEqual([]);
  });

  it('still refuses an applied transaction, with or without --force', () => {
    const cwd = repoWithStagedChange('withdraw-applied');
    capture(cwd, 'd1.json');
    const nonce = nonces(cwd)[0]?.nonce ?? '';
    expect(markApplied(nonce, sha256('record'), { cwd })).toBe(true);

    for (const force of [false, true]) {
      const result = runPendingRemove({ cwd, nonce, force });
      expect(result.removed).toBeNull();
      expect(result.phase).toBe('applied');
    }
    // Its trailer is already in a commit message; only the post-commit hook can
    // finish the job, so this one is not a withdrawal.
    expect(readPending(nonce, { cwd })?.phase).toBe('applied');
  });
});

describe('doctor calls a superseded capture superseded (bug-issue-1170)', () => {
  it('does not report it as expired and dropped', () => {
    const cwd = repoWithStagedChange('doctor-superseded');
    capture(cwd, 'd1.json');
    capture(cwd, 'd2.json');
    // HEAD moves, so both transactions become stale and reach the backlog row —
    // which is where the reported sentence was printed.
    writeFileSync(join(cwd, 'other.txt'), 'other\n');
    git(cwd, ['add', '--', 'other.txt']);
    git(cwd, ['commit', '--quiet', '-m', 'move HEAD']);

    const report = cli(cwd, ['doctor']);
    const row = report.out.split('\n').find((line) => line.includes('pending captures')) ?? '';

    expect(row).not.toBe('');
    expect(row).toContain('superseded by a later capture');
    // The sentence the report objected to, for the transaction that was
    // replaced rather than lost.
    expect(row).not.toContain('2 staged capture(s) expired before reaching a commit');
  });
});
