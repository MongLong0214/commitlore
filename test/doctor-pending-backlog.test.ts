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
import { runPendingShow } from '../src/commands/pending.js';
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
  phase: 'prepared' | 'verified' | 'staged' | 'consumed',
  head: string,
  consumedBy?: string,
): void => {
  const dir = join(repo, '.git', 'commitlore', 'pending');
  mkdirSync(dir, { recursive: true });
  const staged = phase === 'staged' || phase === 'consumed';
  const consumed = phase === 'consumed';
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
        applied_at: consumed ? '2026-07-31T05:10:00.000Z' : null,
        applied_record_hash: consumed ? 'r'.repeat(64) : null,
        consumed,
        consumed_at: consumed ? '2026-07-31T05:10:01.000Z' : null,
        consumed_by: consumed ? (consumedBy ?? '9'.repeat(40)) : null,
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

/**
 * Moves HEAD on, which is what makes an existing transaction stale — and
 * returns the commit that did it, so a consumed transaction can name the commit
 * that consumed it rather than a plausible-looking sha.
 */
const advance = (): string => {
  writeFileSync(join(repo, 'b.ts'), 'export const b = 2;\n');
  execGit(['add', '-A'], { cwd: repo });
  execGit(['commit', '--no-verify', '-m', 'feat: b'], { cwd: repo });
  return execGit(['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim();
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
    /*
     * #923: this used to pin `never written to the history`, which the row asserted
     * from the binding rule without reading history. On the reporting repository
     * that claim was wrong by a factor of thirty — 69 of 77 trailer lines were
     * already on `origin/main` — and it pushed a reader toward re-attaching records
     * that were already there. The row measures now, so the claim is gone and what
     * is pinned instead is that it still distinguishes a dropped capture from a
     * waiting one, which is what this case is about.
     *
     * This fixture writes a transaction with no records, so the honest answer is
     * that the transaction failed and there was no decision inside it to lose.
     */
    expect(result.detail).toMatch(/no record lines at all/);
    expect(result.detail).not.toMatch(/never written to the history/);
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
    // The sentence that claims the loss is the trailing explanation, not the
    // count — this case asserted the absence of the first branch's wording and
    // let the stronger claim through, which is the whole of #710. The consumed
    // case below already uses this string as the loss claim.
    expect(result.detail, 'nothing staged means nothing was dropped').not.toMatch(
      /never written to the history/,
    );
  });

  it('does not call a consumed capture lost — HEAD moved because it landed (#584)', () => {
    // The reported case: phase `consumed`, `consumed_by` naming a commit that
    // is in the history and carries the record. Its base_head is behind HEAD by
    // construction, so a staleness test that only compares the two reports the
    // successful path as the failure this check exists to catch.
    const head = execGit(['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim();
    const consumer = advance();
    pending(nonceOf('9'), 'consumed', head, consumer);

    const result = backlogCheck();
    expect(result.status).toBe('ok');
    expect(result.detail).not.toMatch(/never written to the history/);
    expect(result.detail).not.toMatch(/can no longer apply/);
    // Nor is it waiting: it is the receipt of a capture that already landed.
    expect(result.detail).toMatch(/no captures are waiting/);
  });

  it('still counts a genuine loss when a consumed capture sits beside it', () => {
    // The alarm must survive the fix: one capture landed, one was dropped, and
    // only the dropped one is reported — neither silenced nor doubled.
    const head = execGit(['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim();
    pending(nonceOf('c'), 'staged', head);
    const consumer = advance();
    pending(nonceOf('d'), 'consumed', head, consumer);

    const result = backlogCheck();
    expect(result.status).toBe('warn');
    expect(result.detail).toMatch(/1 staged capture\(s\) expired before reaching a commit/);
    expect(result.detail).not.toMatch(/alongside/);
  });

  it('names the oldest capture so the age is visible without a second command', () => {
    const head = execGit(['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim();
    pending(nonceOf('8'), 'staged', head);
    advance();

    expect(backlogCheck().detail).toContain('2026-07-31T05:09:57.336Z');
  });
});

/**
 * #920 reported that `pending show` emits a trailing comma after
 * `guard_advisory.gaps`, which no strict parser accepts.
 *
 * It does not reproduce, and three measurements say so: the normal path parses,
 * a hand-written transaction shaped like the reporter's (a `guard_advisory` with
 * no `disclosure`, so `gaps` is the last key) parses, and the released 1.2.13
 * binary parses both. The command serialises with `JSON.stringify`, which cannot
 * emit a trailing comma, and `git log -S` finds no version of this file that ever
 * assembled the object text by hand.
 *
 * The guard the report asked for is worth having anyway, and it is the reason this
 * block exists rather than a fix: `pending show` is the only way to read a capture
 * that never reached a commit, so the situation where someone reaches for it is
 * recovery. A recovery script that cannot parse the output concludes the
 * transaction is corrupt when the records are intact — the worst available
 * reading. Every phase is covered because `guard_advisory` is populated for some
 * and not others, and the reported defect lived in that block.
 */
describe('#920 pending show is parseable by a strict parser in every phase', () => {
  // Seeds must be hex: `nonceOf` repeats the seed to 32 characters and
  // `listPendingNonces` requires 32 hex, so a seed like `p` is silently unreadable
  // and every assertion below it would pass against a null transaction.
  const PHASES = [
    ['prepared', '1'],
    ['verified', '2'],
    ['staged', '3'],
    ['consumed', '4'],
  ] as const;

  for (const [phase, seed] of PHASES) {
    it(`parses in the ${phase} phase`, () => {
      const nonce = nonceOf(seed);
      pending(nonce, phase, execGit(['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim());

      const shown = runPendingShow({ nonce, cwd: repo });
      expect(shown.transaction).not.toBeNull();
      // The bytes the command writes, not the object it holds: the report was
      // about serialisation, so asserting the object would test the wrong half.
      const text = `${JSON.stringify(shown.transaction, null, 2)}\n`;
      expect(() => JSON.parse(text) as unknown).not.toThrow();
      expect(text).not.toMatch(/,\s*[}\]]/);
    });
  }

  it('parses when guard_advisory carries gaps as its last key', () => {
    // The reporter's exact shape: an advisory written before `disclosure` existed,
    // so `gaps` is final and a stray separator would land where they saw one.
    const nonce = nonceOf('e');
    const dir = join(repo, '.git', 'commitlore', 'pending');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${nonce}.json`),
      `${JSON.stringify({
        version: 1,
        nonce,
        phase: 'staged',
        base_head: execGit(['rev-parse', 'HEAD'], { cwd: repo }).stdout.trim(),
        created_at: '2026-09-08T08:13:30.419Z',
        records: [{ trailers: [{ key: 'Limit', value: 'the cache times out at 30s' }] }],
        guard_advisory: { matches: [], gaps: [] },
      })}\n`,
    );

    const shown = runPendingShow({ nonce, cwd: repo });
    // Without this the case passes vacuously: JSON.stringify(null) is `null`,
    // which parses and carries no trailing comma.
    expect(shown.transaction).not.toBeNull();
    const text = `${JSON.stringify(shown.transaction, null, 2)}\n`;
    expect(() => JSON.parse(text) as unknown).not.toThrow();
    expect(text).not.toMatch(/,\s*[}\]]/);
  });
});
