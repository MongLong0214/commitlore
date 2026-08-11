/**
 * #458: doctor must not report a healthy install on a repository whose captures
 * are being silently dropped.
 *
 * The case that motivated this was a real one — 815 commits, hooks installed,
 * an index current with HEAD, **zero** CommitLore records, and doctor reporting
 * all ten of its checks `ok`. Four captures sat in the pending directory, one
 * staged with a passing validation and a record ready to attach, all four eight
 * days old. `pending ls` printed `stale` and `never-collected` on exactly those
 * rows; the command people actually run carried none of it.
 *
 * So the assertions here are about the *staged* case above all. A staged
 * capture that went stale is a decision that was drafted, verified, staged and
 * then dropped — that is a failed capture, and the wording has to say so rather
 * than calling it pending.
 */

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { runDoctor } from '../src/commands/doctor.js';
import { execGit } from '../src/core/git.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

let repo: string;

beforeEach(() => {
  repo = createTestRepo({ path: mkdtempSync(join(realpathSync(tmpdir()), 'cl-backlog-')) });
  scratch.push(repo);
  execGit(['config', 'user.email', 'owner@example.invalid'], { cwd: repo });
  execGit(['config', 'user.name', 'owner'], { cwd: repo });
  writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
  execGit(['add', '-A'], { cwd: repo });
  execGit(['commit', '--no-verify', '-m', 'feat: a'], { cwd: repo });
});

/** A nonce the reader accepts: `listPendingNonces` requires 32 hex characters. */
const nonceOf = (seed: string): string => seed.repeat(32).slice(0, 32);

/**
 * Writes a pending transaction whose base_head is `head`.
 *
 * The field set is the one the reader accepts, taken from the shape a real
 * transaction has — a partial object is rejected as unreadable, which is
 * correct of the reader and would otherwise make every case here pass for the
 * wrong reason.
 */
const pending = (
  nonce: string,
  phase: 'prepared' | 'verified' | 'staged',
  head: string,
): void => {
  const dir = join(repo, '.git', 'commitlore', 'pending');
  mkdirSync(dir, { recursive: true });
  const staged = phase === 'staged';
  writeFileSync(
    join(dir, `${nonce}.json`),
    `${JSON.stringify(
      {
        version: 1,
        nonce,
        phase,
        base_head: head,
        created_at: '2026-07-31T05:09:57.336Z',
        verified_at: '2026-07-31T05:09:58.000Z',
        staged_at: staged ? '2026-07-31T05:09:59.000Z' : null,
        expires_at: staged ? '2026-07-31T05:14:59.000Z' : null,
        applied_at: null,
        applied_record_hash: null,
        consumed: false,
        consumed_at: null,
        consumed_by: null,
        incomplete: false,
        records: [],
        validation_result: staged ? 'pass' : 'empty',
        evidence_hash: 'e'.repeat(64),
        policy_identity_hash: 'p0'.repeat(32),
        staged_diff_hash: 'd'.repeat(64),
        staged_tree_oid: '0'.repeat(40),
        overlap_check: 'not-checked-in-test',
        source_hashes: { transcript: 't'.repeat(64), diff: 'f'.repeat(64) },
      },
      null,
      2,
    )}\n`,
  );
};

const backlogCheck = (): { status: string; detail: string } => {
  const found = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'pending-backlog');
  if (found === undefined) throw new Error('doctor has no pending-backlog check');
  return { status: found.status, detail: found.detail };
};

/** Moves HEAD on, which is what makes an existing transaction stale. */
const advance = (): void => {
  writeFileSync(join(repo, 'b.ts'), 'export const b = 2;\n');
  execGit(['add', '-A'], { cwd: repo });
  execGit(['commit', '--no-verify', '-m', 'feat: b'], { cwd: repo });
};

describe('#458 doctor: pending captures', () => {
  it('reports ok when nothing has been captured here', () => {
    expect(backlogCheck().status).toBe('ok');
  });

  it('fails when the pending state cannot be read, rather than calling it empty', () => {
    const dir = join(repo, '.git', 'commitlore', 'pending');
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o000);
    try {
      const report = runDoctor({ cwd: repo });
      const check = report.checks.find((entry) => entry.id === 'pending-backlog');
      expect(check).toMatchObject({ status: 'fail', evidence: { state: 'unreadable', error: 'EACCES' } });
      expect(check?.detail).toMatch(/pending state could not be read/i);
      expect(check?.detail).not.toMatch(/no captures are waiting/i);
      expect(report).toMatchObject({ status: 'failed', exitCode: 1 });
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it('reports ok while a capture can still apply — a waiting capture is not a lost one', () => {
    const head = execGit(['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim();
    pending(nonceOf('a'), 'staged', head);

    const result = backlogCheck();
    expect(result.status).toBe('ok');
    expect(result.detail).toMatch(/still able to apply/);
  });

  it('warns that a staged capture was dropped, not that it is pending', () => {
    // The field case: staged, validation pass, then HEAD moved and
    // prepare-commit-msg skipped it. Nothing told the user.
    const head = execGit(['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim();
    pending(nonceOf('b'), 'staged', head);
    advance();

    const result = backlogCheck();
    expect(result.status).toBe('warn');
    expect(result.detail).toMatch(/1 staged capture\(s\) expired before reaching a commit/);
    expect(result.detail).toMatch(/never written to the history/);
  });

  it('counts the earlier drafts separately from the staged loss', () => {
    // The real repository held one staged and three that never staged. Merging
    // them into one number hides which decisions actually had a record ready.
    const head = execGit(['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim();
    pending(nonceOf('c'), 'staged', head);
    pending(nonceOf('d'), 'verified', head);
    pending(nonceOf('e'), 'verified', head);
    pending(nonceOf('f'), 'verified', head);
    advance();

    const result = backlogCheck();
    expect(result.status).toBe('warn');
    expect(result.detail).toMatch(/1 staged capture\(s\)/);
    expect(result.detail).toMatch(/alongside 3 earlier draft\(s\) that never staged/);
  });

  it('warns without claiming a record was lost when nothing reached staged', () => {
    const head = execGit(['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim();
    pending(nonceOf('7'), 'verified', head);
    advance();

    const result = backlogCheck();
    expect(result.status).toBe('warn');
    expect(result.detail).toMatch(/can no longer apply/);
    expect(result.detail).not.toMatch(/expired before reaching a commit/);
  });

  it('names the oldest capture so the age is visible without a second command', () => {
    const head = execGit(['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim();
    pending(nonceOf('8'), 'staged', head);
    advance();

    expect(backlogCheck().detail).toContain('2026-07-31T05:09:57.336Z');
  });
});
