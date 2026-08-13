/**
 * #591: two processes verifying the same prepared nonce must not both be told
 * their record was accepted. The store is a read → check prepared → write;
 * without an exclusive claim, both observers write and both return `pass`.
 *
 * These cases spawn real Node processes against `dist/`, not in-process
 * promises. A lock-free implementation fails this reliably; the count is the
 * one the issue reproduced (40).
 */

import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const TRIALS = 40;

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

const makeRepo = (): string => {
  const dir = createTestRepo({
    path: mkdtempSync(join(tmpdir(), 'commitlore-ledger-lock-')),
  });
  scratch.push(dir);
  writeFileSync(join(dir, 'init.txt'), 'init\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial', '--no-verify'], { cwd: dir });
  return dir;
};

const TRANSCRIPT =
  'We decided: Do not use shared mutable state for config because it causes race conditions. ' +
  'We also decided: Keep the retry ceiling at three attempts because more masks real failures.';
const DIFF = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n';
const QUOTE_A = 'Do not use shared mutable state for config because it causes race conditions';
const QUOTE_B = 'Keep the retry ceiling at three attempts because more masks real failures';
const ID_A = 'r-raceaaa001';
const ID_B = 'r-racebbb001';

const draft = (quote: string, recordId: string) => ({
  trailers: [
    { key: 'Limit', value: quote },
    { key: 'Record-Id', value: recordId },
  ],
  evidence: [
    {
      key: 'Limit',
      source: 'transcript',
      quote,
      locator: 'L1-L2',
    },
  ],
});

const writePayload = (dir: string, name: string, nonce: string, quote: string, recordId: string): string => {
  const path = join(dir, name);
  writeFileSync(
    path,
    JSON.stringify({
      nonce,
      draft: [draft(quote, recordId)],
      transcript: TRANSCRIPT,
      diff: DIFF,
      cwd: dir,
    }),
  );
  return path;
};

interface WorkerResult {
  validation_result: string;
  incomplete: boolean;
  acceptedIds: string[];
}

const runWorker = async (payloadPath: string): Promise<WorkerResult> => {
  const { stdout } = await run(process.execPath, [WORKER, payloadPath], {
    cwd: ROOT,
    env: process.env,
  });
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

describe('#591 concurrent verify on one nonce', () => {
  it('tells exactly one caller it passed, across enough trials that lock-free fails', async () => {
    const repo = makeRepo();
    let bothPassed = 0;
    let neitherPassed = 0;
    let singlePassed = 0;

    for (let trial = 0; trial < TRIALS; trial += 1) {
      const nonce = prepareNonce(repo);
      const payloadA = writePayload(repo, `a-${trial}.json`, nonce, QUOTE_A, ID_A);
      const payloadB = writePayload(repo, `b-${trial}.json`, nonce, QUOTE_B, ID_B);

      const [first, second] = await Promise.all([runWorker(payloadA), runWorker(payloadB)]);
      const passed = [first, second].filter((result) => result.validation_result === 'pass');

      if (passed.length === 2) bothPassed += 1;
      else if (passed.length === 0) neitherPassed += 1;
      else singlePassed += 1;

      expect(passed, `trial ${trial}: both callers were told they passed`).toHaveLength(1);

      const winner = first.validation_result === 'pass' ? first : second;
      const stored = readPending(nonce, { cwd: repo });
      expect(stored, `trial ${trial}: the winner's transaction was deleted`).not.toBeNull();
      expect(stored!.phase).toBe('verified');
      expect(stored!.validation_result).toBe('pass');
      const storedId = (stored!.records[0] as { trailers?: { key: string; value: string }[] } | undefined)
        ?.trailers?.find((trailer) => trailer.key === 'Record-Id')?.value;
      expect(storedId, `trial ${trial}: stored record is not the winner's`).toBe(winner.acceptedIds[0]);
    }

    expect({ bothPassed, neitherPassed, singlePassed, trials: TRIALS }).toEqual({
      bothPassed: 0,
      neitherPassed: 0,
      singlePassed: TRIALS,
      trials: TRIALS,
    });
  }, 180_000);
});
