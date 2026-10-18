/**
 * bug-issue-1169: an empty, incomplete verification now says which empty it is.
 *
 * Four causes shared one shape — `{"validation_result":"empty","accepted":[],
 * "rejected":[],"incomplete":true}` — so unfetched notes, an unreadable
 * history, a held lock and an internal error were indistinguishable from each
 * other and from the ordinary "nothing survived". The reporter spent a
 * diagnosis on the wrong one, and nothing told them to fetch
 * `refs/notes/commitlore`, although `context` and `doctor` already knew how to
 * say exactly that.
 *
 * The internal-error branch is pinned by `capture-verify-internal-error`
 * (#1168). This file covers the three the environment produces, and each is
 * provoked rather than injected: a clone without notes, a history made
 * unreadable, and a lock held by another call.
 */

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCapture } from '../src/commands/capture.js';
import { verifyCaptureRecords } from '../src/core/capture-verify.js';
import { createPending } from '../src/core/pending.js';
import { writeRecord } from '../src/core/notes.js';
import type { DraftRecord } from '../src/core/harvest.js';

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

const POLICY_DEFAULTS = {
  mode: 'suggest',
  max_records_per_commit: 1,
  require_verified_evidence: true,
} as const;

const temporaries: string[] = [];
afterEach(() => {
  while (temporaries.length > 0) {
    const dir = temporaries.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const temp = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `cl-${label}-`));
  temporaries.push(dir);
  return dir;
};

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' });

const seedRepo = (): string => {
  const dir = temp('reason-origin');
  execSync('git init --quiet --template= --initial-branch=main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email t@e.invalid && git config user.name t', { cwd: dir, stdio: 'ignore' });
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'file.txt'), 'hello\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'init']);
  // A record on the notes mirror, so a clone that does not fetch notes is a
  // clone that is missing something rather than one with nothing to miss.
  writeRecord(
    git(dir, ['rev-parse', 'HEAD']).trim(),
    [{ key: 'Limit', value: 'the vendor caps us at three workers' }],
    { cwd: dir },
  );
  return dir;
};

const prepare = (cwd: string, transcript: string, diff: string): string => {
  const diffHash = sha256(diff);
  const treeOid = git(cwd, ['write-tree']).trim();
  return createPending({
    cwd,
    source_hashes: { transcript: sha256(transcript), diff: diffHash },
    staged_diff_hash: diffHash,
    staged_tree_oid: treeOid,
    policy_identity_hash: sha256(JSON.stringify(POLICY_DEFAULTS)),
  });
};

const TRANSCRIPT = 'We decided to keep the retry ceiling at three attempts.\n';
const DIFF = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n';
const draft: DraftRecord[] = [
  {
    trailers: [{ key: 'Limit', value: 'the retry ceiling stays at three attempts' }],
    evidence: [
      {
        key: 'Limit',
        source: 'transcript',
        quote: 'We decided to keep the retry ceiling at three attempts.',
        locator: 'L1-L1',
      },
    ],
  },
];

describe('an empty verification says which empty it is (bug-issue-1169)', () => {
  it('names unfetched notes, and the fetch that resolves them', () => {
    const origin = seedRepo();
    const clone = temp('reason-clone');
    execSync(`git clone --quiet --template= "${origin}" "${clone}"`, { stdio: 'ignore' });
    execSync('git config user.email t@e.invalid && git config user.name t', { cwd: clone, stdio: 'ignore' });
    writeFileSync(join(clone, 'file.txt'), 'hello again\n');
    git(clone, ['add', '.']);

    const nonce = prepare(clone, TRANSCRIPT, DIFF);
    const result = verifyCaptureRecords({ nonce, draft, transcript: TRANSCRIPT, diff: DIFF, cwd: clone });

    // Arrival: this is the reported shape, not some other refusal.
    expect(result.validation_result).toBe('empty');
    expect(result.incomplete).toBe(true);
    expect(result.accepted).toEqual([]);

    expect(result.reason).toBe('notes-unfetched');
    expect(result.detail).toContain('refs/notes');
    // The move that resolves it, which nothing used to say.
    expect(result.detail).toContain('doctor --fix');

    // Control: the same call in the repository that has the notes passes, so
    // the reason above describes the clone and not the draft.
    writeFileSync(join(origin, 'file.txt'), 'hello again\n');
    git(origin, ['add', '.']);
    const ownNonce = prepare(origin, TRANSCRIPT, DIFF);
    const ownResult = verifyCaptureRecords({
      nonce: ownNonce,
      draft,
      transcript: TRANSCRIPT,
      diff: DIFF,
      cwd: origin,
    });
    expect(ownResult.reason).toBeUndefined();
    expect(ownResult.validation_result).toBe('pass');
  });

  it('is reported by the CLI as operational, with the fix in the message', () => {
    const origin = seedRepo();
    const clone = temp('reason-cli-clone');
    rmSync(clone, { recursive: true, force: true });
    execSync(`git clone --quiet --template= "${origin}" "${clone}"`, { stdio: 'ignore' });
    execSync('git config user.email t@e.invalid && git config user.name t', { cwd: clone, stdio: 'ignore' });
    writeFileSync(join(clone, 'file.txt'), 'hello again\n');
    git(clone, ['add', '.']);
    const transcriptPath = join(clone, 'transcript.txt');
    const draftPath = join(clone, 'draft.json');
    writeFileSync(transcriptPath, TRANSCRIPT);
    writeFileSync(draftPath, JSON.stringify({ records: draft }));

    const result = runCapture({ transcriptPath, draftPath, cwd: clone });

    // `operational` is exit 3, the code this product already uses for a host
    // condition. `internal` would send the reader after a bug in the verifier.
    expect(result.outcome).toBe('operational');
    expect(result.staged).toBe(false);
    expect(result.error).toContain('notes-unfetched');
    expect(result.error).toContain('refs/notes');
  });

  it('names a held lock, and binds nothing while another call holds it', () => {
    const cwd = seedRepo();
    writeFileSync(join(cwd, 'file.txt'), 'hello again\n');
    git(cwd, ['add', '.']);
    const nonce = prepare(cwd, TRANSCRIPT, DIFF);

    // The lock is written for *another* live pid, because `tryLockPending`
    // allows re-entry from this one on purpose — the verifier holds its own
    // lock across the store. `process.ppid` is alive and is not us, which is
    // exactly the state a concurrent caller leaves behind.
    const lockPath = join(cwd, '.git', 'commitlore', 'pending', `${nonce}.json.lock`);
    writeFileSync(lockPath, `${process.ppid}\n`, { flag: 'wx' });
    try {
      const result = verifyCaptureRecords({ nonce, draft, transcript: TRANSCRIPT, diff: DIFF, cwd });
      expect(result.reason).toBe('locked');
      expect(result.detail).toContain('another call is verifying this transaction');
      expect(result.receipt).toBeUndefined();
    } finally {
      rmSync(lockPath, { force: true });
    }

    // Control: with the lock gone the same call verifies, so `locked` reported
    // the lock rather than anything about the draft.
    const after = verifyCaptureRecords({ nonce, draft, transcript: TRANSCRIPT, diff: DIFF, cwd });
    expect(after.reason).toBeUndefined();
    expect(after.validation_result).toBe('pass');
  });

  it('names a history it could not read', () => {
    const cwd = seedRepo();
    writeFileSync(join(cwd, 'file.txt'), 'hello again\n');
    git(cwd, ['add', '.']);
    const nonce = prepare(cwd, TRANSCRIPT, DIFF);

    // `null` is what the loader returns when it cannot read this repository's
    // active records, and it is a supported argument because shadow passes its
    // own snapshot through the same door. Provoking the loader itself would be
    // provoking git, which says nothing about this branch.
    const result = verifyCaptureRecords({
      nonce,
      draft,
      transcript: TRANSCRIPT,
      diff: DIFF,
      cwd,
      history: null,
    });

    expect(result.validation_result).toBe('empty');
    expect(result.incomplete).toBe(true);
    expect(result.reason).toBe('history-unavailable');
    expect(result.detail).toContain('could not be read');
    expect(result.detail).toContain('doctor');

    // Control: the same call with the repository's real history passes.
    const after = verifyCaptureRecords({ nonce, draft, transcript: TRANSCRIPT, diff: DIFF, cwd });
    expect(after.reason).toBeUndefined();
    expect(after.validation_result).toBe('pass');
  });
});
