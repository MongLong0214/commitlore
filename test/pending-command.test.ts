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
 *  - `gc_eligible`: `capture gc` removes a non-consumed transaction only when
 *    `expires_at` parses, so a `verified` one with `expires_at: null` is never
 *    collected. The reporter asked for that to be reconciled either way; it is
 *    reported rather than changed.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runPendingList, runPendingShow } from '../src/commands/pending.js';
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

  it('reports that a transaction with no expiry is never collected', () => {
    const { cwd } = repoWithTransaction();
    const [only] = runPendingList({ cwd }).transactions;
    expect(only?.expires_at).toBeNull();
    expect(only?.gc_eligible).toBe(false);
  });
});
