/**
 * #311: a pending capture transaction was the one thing in the system you could
 * not review. `.git/commitlore/pending/<nonce>.json` held the answer to "did my
 * capture record anything?", and reaching it meant pointing a JSON parser at
 * another tool's `.git` subdirectory -- which is what a CLI exists to prevent, and
 * which breaks silently on any field rename.
 *
 * Two derived facts carry most of the value and neither is in the file:
 *  - `stale`: `base_head` no longer matches HEAD, so the transaction will not
 *    apply to the commit being written. Today that is a silent no-op.
 *  - `gc_eligible`: whether `capture gc` would ever remove this file. #367 made
 *    that a question about the phase alone; before it, a `verified` transaction
 *    with `expires_at: null` was never collected at all.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runPendingList, runPendingRemove, runPendingShow } from '../src/commands/pending.js';
import { prepareCaptureContext } from '../src/core/capture-prepare.js';

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

/** A repository with one prepared capture transaction. */
const repoWithTransaction = (): { cwd: string; nonce: string } => {
  const cwd = mkdtempSync(join(tmpdir(), 'commitlore-311-'));
  scratch.push(cwd);
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', ...args], { cwd });
  };
  execFileSync('git', ['init', '--quiet'], { cwd });
  writeFileSync(join(cwd, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '--quiet', '-m', 'seed');
  writeFileSync(join(cwd, 'a.txt'), 'a\nb\n');
  git('add', 'a.txt');
  const prepared = prepareCaptureContext({ cwd, transcript: 'we chose X because Y\n' });
  return { cwd, nonce: prepared.nonce };
};

describe('#311 pending transactions are reviewable with the CLI', () => {
  it('lists a prepared transaction with its phase, record count and base', () => {
    const { cwd, nonce } = repoWithTransaction();
    const listed = runPendingList({ cwd });
    expect(listed.transactions).toHaveLength(1);
    const [only] = listed.transactions;
    expect(only?.nonce).toBe(nonce);
    expect(only?.phase).toBe('prepared');
    expect(only?.records).toBe(0);
    expect(only?.base_head).toMatch(/^[0-9a-f]{40}$/);
    expect(only?.stale).toBe(false);
  });

  it('reports an empty list rather than failing when nothing is pending', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'commitlore-311-empty-'));
    scratch.push(cwd);
    execFileSync('git', ['init', '--quiet'], { cwd });
    execFileSync('git', ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', 'commit', '--quiet', '--allow-empty', '-m', 'seed'], { cwd });
    expect(runPendingList({ cwd }).transactions).toEqual([]);
  });

  it('reports an unreadable pending directory as unknown, not empty', () => {
    const { cwd } = repoWithTransaction();
    const pendingDir = join(cwd, '.git', 'commitlore', 'pending');
    chmodSync(pendingDir, 0o000);
    try {
      const result = runPendingList({ cwd });
      expect(result).toMatchObject({
        state: 'unreadable',
        transactions: [],
        unreadable: [],
      });
      expect(result.error).toBe('EACCES');
      expect(runPendingShow({ cwd, nonce: 'a' }).error).toMatch(/pending state could not be read/i);
    } finally {
      chmodSync(pendingDir, 0o700);
    }
  });

  it('marks a transaction stale once HEAD has moved past its base', () => {
    const { cwd } = repoWithTransaction();
    execFileSync('git', ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', 'commit', '--quiet', '-m', 'second'], { cwd });
    const [only] = runPendingList({ cwd }).transactions;
    expect(only?.stale).toBe(true);
  });

  it('shows one transaction by a nonce prefix', () => {
    const { cwd, nonce } = repoWithTransaction();
    const shown = runPendingShow({ cwd, nonce: nonce.slice(0, 8) });
    expect(shown.transaction?.nonce).toBe(nonce);
    expect(shown.transaction?.source_hashes).toBeDefined();
  });

  it('says a nonce matched nothing instead of throwing', () => {
    const { cwd } = repoWithTransaction();
    const shown = runPendingShow({ cwd, nonce: 'ffffffff' });
    expect(shown.transaction).toBeNull();
    expect(shown.error).toMatch(/no pending transaction/i);
  });

  it('refuses an ambiguous prefix by naming the candidates', () => {
    const { cwd } = repoWithTransaction();
    // A second transaction whose nonce shares no prefix would not collide, so the
    // ambiguity is provoked with the shortest possible prefix instead.
    prepareCaptureContext({ cwd, transcript: 'a second session\n' });
    const shown = runPendingShow({ cwd, nonce: '' });
    expect(shown.transaction).toBeNull();
    expect(shown.error).toMatch(/ambiguous|matched 2/i);
  });

  it('reports a transaction with no expiry as collectable anyway (#367)', () => {
    const { cwd } = repoWithTransaction();
    const [only] = runPendingList({ cwd }).transactions;
    expect(only?.expires_at).toBeNull();
    expect(only?.gc_eligible).toBe(true);
  });
});

/**
 * #367: gc collects an abandoned transaction a day after HEAD leaves it behind.
 * `rm` is for the user who wants the file gone before then — the affordance the
 * command was missing entirely, since `ls` and `show` could name a leaked file
 * and nothing could remove it.
 */
describe('#367 pending rm', () => {
  /** The on-disk file for a nonce, without going through the store. */
  const pendingFile = (cwd: string, nonce: string): string => {
    const relative = execFileSync('git', ['rev-parse', '--git-path', 'commitlore/pending'], {
      cwd,
      encoding: 'utf8',
    }).trim();
    return join(cwd, relative, `${nonce}.json`);
  };

  const setPhase = (cwd: string, nonce: string, phase: string): void => {
    const path = pendingFile(cwd, nonce);
    const record: Record<string, unknown> = JSON.parse(readFileSync(path, 'utf8'));
    record['phase'] = phase;
    writeFileSync(path, JSON.stringify(record, null, 2));
  };

  it('removes a prepared transaction named by a nonce prefix', () => {
    const { cwd, nonce } = repoWithTransaction();
    const result = runPendingRemove({ cwd, nonce: nonce.slice(0, 8) });
    expect(result.removed).toBe(nonce);
    expect(result.phase).toBe('prepared');
    expect(result.error).toBeNull();
    expect(existsSync(pendingFile(cwd, nonce))).toBe(false);
    expect(runPendingList({ cwd }).transactions).toEqual([]);
  });

  it('removes a verified transaction — the ordinary skipped capture', () => {
    const { cwd, nonce } = repoWithTransaction();
    setPhase(cwd, nonce, 'verified');
    expect(runPendingRemove({ cwd, nonce }).removed).toBe(nonce);
    expect(existsSync(pendingFile(cwd, nonce))).toBe(false);
  });

  it.each(['staged', 'applied'])('refuses to remove a %s transaction, and says why', (phase) => {
    const { cwd, nonce } = repoWithTransaction();
    setPhase(cwd, nonce, phase);
    const result = runPendingRemove({ cwd, nonce });
    expect(result.removed).toBeNull();
    expect(result.phase).toBe(phase);
    expect(result.error).toContain(phase);
    expect(result.error).toMatch(/post-commit/i);
    expect(existsSync(pendingFile(cwd, nonce))).toBe(true);
  });

  it('refuses a file it cannot read, rather than guessing at its phase', () => {
    const { cwd, nonce } = repoWithTransaction();
    writeFileSync(pendingFile(cwd, nonce), 'not valid json {{{');
    const result = runPendingRemove({ cwd, nonce });
    expect(result.removed).toBeNull();
    expect(result.error).toMatch(/phase is unknown/i);
    expect(existsSync(pendingFile(cwd, nonce))).toBe(true);
  });

  it('says a nonce matched nothing instead of throwing', () => {
    const { cwd } = repoWithTransaction();
    const result = runPendingRemove({ cwd, nonce: 'ffffffff' });
    expect(result.removed).toBeNull();
    expect(result.error).toMatch(/no pending transaction/i);
  });

  it('refuses an ambiguous prefix by naming the candidates', () => {
    const { cwd } = repoWithTransaction();
    prepareCaptureContext({ cwd, transcript: 'a second session\n' });
    const result = runPendingRemove({ cwd, nonce: '' });
    expect(result.removed).toBeNull();
    expect(result.error).toMatch(/ambiguous|matched 2/i);
    expect(runPendingList({ cwd }).transactions).toHaveLength(2);
  });
});
