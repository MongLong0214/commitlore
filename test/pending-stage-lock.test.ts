/**
 * Advancing a transaction's phase happens under the nonce lock.
 *
 * `storeVerification` took the lock for its read-check-write. `stagePending`
 * and `markApplied` did the same shape of update to the same file and took
 * nothing — so two callers could both read `verified` and both write `staged`,
 * and a delayed one could write `staged` over a record another process had
 * already advanced to `applied`, losing the marker that says the trailer
 * reached a commit.
 *
 * The atomic rename these use keeps a file from being half-written. It does
 * nothing about two whole files written from the same stale read, which is the
 * failure here — the asymmetry was that verification held the nonce and the two
 * phase advances did not.
 *
 * What is asserted is the lock, not a race. A live owner is created for the
 * nonce and the advance must decline rather than write; a test that raced for
 * it would report on the schedule it happened to get.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  createPending,
  markApplied,
  readPending,
  stagePending,
  storeVerification,
} from '../src/core/pending.js';

const temporaries: string[] = [];
const children: { kill: () => void }[] = [];
afterAll(() => {
  for (const child of children) child.kill();
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-stagelock-'));
  temporaries.push(dir);
  return dir;
};

/**
 * A nonce whose transaction is verified and ready to stage.
 *
 * The bindings are this test's own: nothing here reaches git, because the
 * question is the lock around the phase write and not what the phase means.
 */
const verifiedNonce = (cwd: string): string => {
  const nonce = createPending({
    cwd,
    source_hashes: { transcript: 'a'.repeat(64), diff: 'b'.repeat(64) },
    staged_diff_hash: 'b'.repeat(64),
    staged_tree_oid: 'c'.repeat(40),
    policy_identity_hash: 'd'.repeat(64),
  });
  const stored = storeVerification(nonce, {
    cwd,
    accepted: [{ trailers: [{ key: 'Record-Id', value: 'r-locktest001' }] }],
    rejected: [],
    validation_result: 'pass',
    overlap_check: 'canonical_exact_only',
    incomplete: false,
    evidence_hash: 'e'.repeat(64),
  });
  if (!stored) throw new Error('the fixture could not verify its own transaction');
  return nonce;
};

/**
 * A lock held by a process that is genuinely alive.
 *
 * A pid that is not running is stolen on sight — deliberately, so a crash
 * cannot pin a nonce for ever — so a fixture writing its own pid, or any dead
 * one, would be testing the steal rather than the lock.
 */
const heldByALiveOtherProcess = (cwd: string, nonce: string): void => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  children.push(child);
  const pid = child.pid;
  if (pid === undefined) throw new Error('could not start a live lock owner');
  // `<nonce>.json.lock`, beside the transaction file rather than named after
  // the nonce alone. Writing `<nonce>.lock` creates a file nothing reads, and
  // the advance then takes a lock of its own and succeeds -- a fixture that
  // tests nothing while looking like it tests the lock.
  writeFileSync(lockPathFor(cwd, nonce), `${String(pid)}\n`);
};

/** A real repository, because `createPending` resolves the git directory. */
const gitDirRepo = (): string => {
  const dir = scratch();
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir });
  writeFileSync(join(dir, 'placeholder'), 'x\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync(
    'git',
    [
      '-c', 'user.name=CommitLore Test',
      '-c', 'user.email=test@example.invalid',
      '-c', 'commit.gpgsign=false',
      'commit', '-q', '--no-verify', '-m', 'initial\n\nno record\n',
    ],
    { cwd: dir },
  );
  return dir;
};

const lockPathFor = (cwd: string, nonce: string): string =>
  join(cwd, '.git', 'commitlore', 'pending', `${nonce}.json.lock`);

const phaseOf = (cwd: string, nonce: string): string | undefined =>
  readPending(nonce, { cwd })?.phase;

describe('a phase advance holds the nonce', () => {
  it('stages when nothing else holds it', () => {
    // The control. Without this, "it declined" below could mean the fixture
    // never had a stageable transaction.
    const cwd = gitDirRepo();
    const nonce = verifiedNonce(cwd);
    expect(stagePending(nonce, { cwd })).toBe(true);
    expect(phaseOf(cwd, nonce)).toBe('staged');
  }, 120_000);

  it('declines to stage while a live process holds the nonce', () => {
    const cwd = gitDirRepo();
    const nonce = verifiedNonce(cwd);
    heldByALiveOtherProcess(cwd, nonce);

    expect(stagePending(nonce, { cwd }), 'a held nonce must not be advanced').toBe(false);
    expect(phaseOf(cwd, nonce), 'and the phase must be untouched').toBe('verified');
  }, 120_000);

  it('declines to mark applied while a live process holds the nonce', () => {
    const cwd = gitDirRepo();
    const nonce = verifiedNonce(cwd);
    expect(stagePending(nonce, { cwd })).toBe(true);

    heldByALiveOtherProcess(cwd, nonce);
    expect(markApplied(nonce, 'f'.repeat(64), { cwd }), 'a held nonce must not be advanced').toBe(
      false,
    );
    expect(phaseOf(cwd, nonce)).toBe('staged');
  }, 120_000);

  it('leaves no lock behind after a successful advance', () => {
    // A lock the advance forgot to release would pin the nonce for every later
    // caller, which is the opposite failure and just as silent.
    const cwd = gitDirRepo();
    const nonce = verifiedNonce(cwd);
    expect(stagePending(nonce, { cwd })).toBe(true);

    let held = true;
    try {
      readFileSync(lockPathFor(cwd, nonce), 'utf8');
    } catch {
      held = false;
    }
    expect(held, 'the advance left its lock in place').toBe(false);
    expect(markApplied(nonce, 'f'.repeat(64), { cwd })).toBe(true);
  }, 120_000);
});
