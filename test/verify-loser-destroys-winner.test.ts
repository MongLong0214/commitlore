/**
 * #981: a second verification of one nonce deletes the first one's transaction.
 *
 * The issue reads the failure as a stolen lock: worker A dies, worker B finds
 * the lock held by a dead pid, steals it, and `settle` discards what A stored.
 * That is not what happens, and the difference decides the fix.
 *
 * `verifyCaptureRecords` already holds the nonce for the whole call, so an
 * *overlapping* loser is refused at the door and never reaches `settle`. The
 * case that fails is the one where the winner has entirely finished: it
 * released its lock in its own `finally`, so the loser acquires cleanly, and
 * from inside there is nothing left to distinguish it from a caller replaying a
 * nonce on purpose. That path deletes by design.
 *
 * So the two spawned workers do not need to race at all. Run them one after the
 * other and the same assertion fails — which is why the flake tracked machine
 * load rather than any particular trial: load skews the two processes until
 * they stop overlapping.
 */

import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { createPending, readPending } from '../src/core/pending.js';
import { createTestRepo } from './git-fixtures.js';

const run = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'test', 'concurrent-verify-worker.mjs');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

const policyHash = (): string =>
  sha256(
    JSON.stringify({
      mode: 'suggest',
      max_records_per_commit: 1,
      require_verified_evidence: true,
    }),
  );

const TRANSCRIPT =
  'We decided: Do not use shared mutable state for config because it causes race conditions. ' +
  'We also decided: Keep the retry ceiling at three attempts because more masks real failures.';
const DIFF = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n';
const QUOTE_A = 'Do not use shared mutable state for config because it causes race conditions';
const QUOTE_B = 'Keep the retry ceiling at three attempts because more masks real failures';

const draft = (quote: string, recordId: string) => ({
  trailers: [
    { key: 'Limit', value: quote },
    { key: 'Record-Id', value: recordId },
  ],
  evidence: [{ key: 'Limit', source: 'transcript', quote, locator: 'L1-L2' }],
});

const makeRepo = (): string => {
  const dir = createTestRepo({ path: mkdtempSync(join(tmpdir(), 'commitlore-981-')) });
  scratch.push(dir);
  writeFileSync(join(dir, 'init.txt'), 'init\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial', '--no-verify'], { cwd: dir });
  return dir;
};

const payload = (dir: string, name: string, nonce: string, quote: string, id: string): string => {
  const path = join(dir, name);
  writeFileSync(
    path,
    JSON.stringify({ nonce, draft: [draft(quote, id)], transcript: TRANSCRIPT, diff: DIFF, cwd: dir }),
  );
  return path;
};

interface WorkerResult {
  validation_result: string;
  incomplete: boolean;
  acceptedIds: string[];
}

const runWorker = async (path: string): Promise<WorkerResult> => {
  const { stdout } = await run(process.execPath, [WORKER, path], { cwd: ROOT, env: process.env });
  return JSON.parse(stdout) as WorkerResult;
};

const prepareNonce = (cwd: string): string => {
  const treeOid = execFileSync('git', ['write-tree'], { cwd, encoding: 'utf8' }).trim();
  return createPending({
    cwd,
    source_hashes: { transcript: sha256(TRANSCRIPT), diff: sha256(DIFF) },
    staged_diff_hash: sha256(DIFF),
    staged_tree_oid: treeOid,
    policy_identity_hash: policyHash(),
  });
};

describe('#981 a later verification must not destroy an earlier one', () => {
  /**
   * Deterministic where the #591 test is probabilistic. The two callers are
   * still real processes with nothing shared but the pending file; they simply
   * do not overlap, which is the schedule that produced both CI failures.
   */
  it('leaves the first caller\'s verified transaction in place when a second follows it', async () => {
    const repo = makeRepo();
    const nonce = prepareNonce(repo);

    const first = await runWorker(payload(repo, 'a.json', nonce, QUOTE_A, 'r-lose0aaa01'));
    expect(first.validation_result, 'the first caller must be the one that passed').toBe('pass');

    // Fully finished, lock released, process gone. Nothing overlaps.
    const second = await runWorker(payload(repo, 'b.json', nonce, QUOTE_B, 'r-lose0bbb01'));

    // The second caller's records were never bound to the transaction, so it
    // must not be told they were.
    expect(second.acceptedIds).toEqual([]);
    expect(second.validation_result).toBe('empty');
    expect(second.incomplete).toBe(true);

    // And the first caller's transaction is still there. It was verified, it
    // was reported as passing, and the arrival of a second caller is not a
    // reason to discard it.
    const stored = readPending(nonce, { cwd: repo });
    expect(stored, "the first caller's transaction was deleted").not.toBeNull();
    expect(stored?.phase).toBe('verified');
    const storedId = (stored?.records[0] as { trailers?: { key: string; value: string }[] } | undefined)
      ?.trailers?.find((trailer) => trailer.key === 'Record-Id')?.value;
    expect(storedId, 'the stored record is not the first caller\'s').toBe('r-lose0aaa01');
  }, 120_000);
});
