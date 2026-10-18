/**
 * bug-issue-1168, second half: what an unhandled verifier error does to the
 * transaction and to the caller.
 *
 * The reported run was a 118.7 MB session transcript. `scan` threw
 * `RangeError: Invalid array length`, the catch in `runVerifyCaptureRecords`
 * swallowed it and persisted an empty verification — which moves the
 * transaction to `verified` and issues a receipt — and then returned the result
 * *without* that receipt. The pipeline staged, stage refused for a receipt that
 * was never handed over, and the CLI printed a message about receipt handling
 * for a fault that was a size limit. The nonce was left bound to a verification
 * nobody could stage.
 *
 * The size limit itself is gone (`core/harvest-verify.ts` builds no
 * per-character index), but a verifier can still throw for reasons nobody
 * anticipated — that is what `internal` exists for. So the error is injected
 * here rather than provoked: a real one would be a bug of its own, and this
 * file is about what happens around it.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPending, readPending } from '../src/core/pending.js';
import type { DraftRecord } from '../src/core/harvest.js';

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

const POLICY_DEFAULTS = {
  mode: 'suggest',
  max_records_per_commit: 1,
  require_verified_evidence: true,
} as const;

const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-verify-internal-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'file.txt'), 'hello\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m init', { cwd: dir, stdio: 'ignore' });
  return dir;
};

const prepare = (cwd: string, transcript: string, diff: string): string => {
  const diffHash = sha256(diff);
  const treeOid = execSync('git write-tree', { cwd, encoding: 'utf8' }).trim();
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

/** The verifier, with its one mechanical check replaced by a throw. */
const throwingVerifier = async (): Promise<typeof import('../src/core/capture-verify.js')> => {
  vi.resetModules();
  vi.doMock('../src/core/harvest-verify.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/core/harvest-verify.js')>();
    return {
      ...actual,
      verifyDraft: (): never => {
        throw new RangeError('Invalid array length');
      },
    };
  });
  return import('../src/core/capture-verify.js');
};

describe('an unhandled verifier error (bug-issue-1168)', () => {
  let cwd = '';

  beforeEach(() => {
    cwd = makeRepo();
  });

  afterEach(() => {
    vi.doUnmock('../src/core/harvest-verify.js');
    vi.resetModules();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('names the cause, binds nothing, and leaves the transaction verifiable', async () => {
    const nonce = prepare(cwd, TRANSCRIPT, DIFF);
    const { verifyCaptureRecords } = await throwingVerifier();

    const result = verifyCaptureRecords({ nonce, draft, transcript: TRANSCRIPT, diff: DIFF, cwd });

    // The cause reaches the caller instead of being inferred from an empty shape.
    expect(result.reason).toBe('internal-error');
    expect(result.detail).toContain('Invalid array length');
    expect(result.validation_result).toBe('empty');
    expect(result.incomplete).toBe(true);

    // The two faults #1168 reported. A verification that did not run must not
    // take ownership of the nonce, and must not leave a receipt it withholds.
    expect(result.receipt).toBeUndefined();
    expect(readPending(nonce, { cwd })?.phase).toBe('prepared');
  });

  it('is reported by the CLI pipeline as internal, not as a missing receipt', async () => {
    writeFileSync(join(cwd, 'file.txt'), 'hello again\n');
    execSync('git add .', { cwd, stdio: 'ignore' });
    const transcriptPath = join(cwd, 'transcript.txt');
    const draftPath = join(cwd, 'draft.json');
    writeFileSync(transcriptPath, TRANSCRIPT);
    writeFileSync(draftPath, JSON.stringify({ records: draft }));

    vi.resetModules();
    vi.doMock('../src/core/harvest-verify.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/core/harvest-verify.js')>();
      return {
        ...actual,
        verifyDraft: (): never => {
          throw new RangeError('Invalid array length');
        },
      };
    });
    const { runCapture } = await import('../src/commands/capture.js');

    const result = runCapture({ transcriptPath, draftPath, cwd });

    expect(result.outcome).toBe('internal');
    expect(result.staged).toBe(false);
    expect(result.error).toContain('internal-error');
    expect(result.error).toContain('Invalid array length');
    // The message that sent the reporter after receipt handling must not be
    // what this prints.
    expect(result.error ?? '').not.toContain('receipt');
  });
});
