/**
 * #1022: a substituted source cannot settle a transaction as verified.
 *
 * `verify_capture` reported a source-hash mismatch only by rejecting individual
 * records. With a draft of `{"records": []}` — which the harvest contract calls
 * a correct and common answer — the loop that produces those rejections never
 * ran, so a call whose transcript *and* diff were both wrong returned:
 *
 *   validation_result "empty"   rejected []   incomplete false   receipt issued
 *
 * the shape of a clean, final verification. Worse, it went through `settle`,
 * which persists the result and moves the transaction out of `prepared`. From
 * there `storeVerification` refuses every later call, so the nonce was locked
 * holding a verification built from sources it never matched — and the recovery
 * the refusal named, `commitlore pending rm`, is a CLI command an agent driving
 * the server over MCP cannot run.
 *
 * ## The shape of the defect
 *
 * The condition is transaction-shaped and the signal was record-shaped. Whether
 * the sources match has nothing to do with how many records the draft holds, so
 * counting on a record to carry the news makes it vanish for the draft that has
 * none.
 *
 * ## What is asserted
 *
 * That the transaction is still `prepared` afterwards is the load-bearing one:
 * it is what lets the real draft be verified against the real sources. The
 * `source_mismatch` field and `incomplete: true` are how a caller finds out,
 * and `incomplete: false` on that path was actively telling it nothing was
 * missing.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { prepareCaptureContext } from '../src/core/capture-prepare.js';
import { verifyCaptureRecords } from '../src/core/capture-verify.js';
import { readPending } from '../src/core/pending.js';

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = [
  '-c',
  'user.name=CommitLore Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

const git = (dir: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });

const TRANSCRIPT =
  'We chose sha256 because it is the standard hash function for integrity checking.';

const DRAFT = [
  {
    trailers: [
      { key: 'Limit', value: 'use sha256 for integrity checking' },
      { key: 'Record-Id', value: 'r-mismatch001' },
    ],
    evidence: [
      {
        key: 'Limit',
        source: 'transcript' as const,
        quote: 'chose sha256 because it is the standard hash function for integrity checking',
        locator: 'L1-L1',
      },
    ],
  },
];

const prepared = (): { cwd: string; nonce: string; diff: string } => {
  const cwd = mkdtempSync(join(tmpdir(), 'commitlore-mismatch-'));
  temporaries.push(cwd);
  git(cwd, ['init', '-q', '--initial-branch=main']);
  writeFileSync(join(cwd, 'init.txt'), 'initial content\n');
  git(cwd, ['add', '-A']);
  git(cwd, [...IDENTITY, 'commit', '-q', '--no-verify', '-m', 'init\n\nno record here\n']);
  writeFileSync(join(cwd, 'init.txt'), 'initial content\nmodified\n');
  git(cwd, ['add', '-A']);

  const { nonce } = prepareCaptureContext({ cwd, transcript: TRANSCRIPT });
  return { cwd, nonce, diff: git(cwd, ['diff', '--cached']) };
};

describe('#1022 a substituted source never settles the transaction', () => {
  it('leaves an empty-draft call with wrong sources prepared, and says why', () => {
    const { cwd, nonce, diff } = prepared();

    const result = verifyCaptureRecords({
      nonce,
      draft: [],
      transcript: 'probe — deliberately not the transcript that was hashed',
      diff,
      cwd,
    });

    expect(result.source_mismatch, 'the mismatch was not reported at all').toBe('transcript');
    // `incomplete: false` here told the caller the answer was final and nothing
    // was missing, about a call that verified nothing.
    expect(result.incomplete).toBe(true);
    // No receipt: nothing was bound, so there is no handle to what was stored.
    expect(result.receipt).toBeUndefined();

    // The load-bearing assertion. `verified` here is what locked the nonce.
    expect(readPending(nonce, { cwd })?.phase).toBe('prepared');
  }, 300_000);

  it('reports the diff the same way, with the transcript correct', () => {
    // The second branch was identical in shape and would have been missed by a
    // fix that only moved the first.
    const { cwd, nonce } = prepared();

    const result = verifyCaptureRecords({
      nonce,
      draft: [],
      transcript: TRANSCRIPT,
      diff: 'probe — deliberately not the diff that was hashed',
      cwd,
    });

    expect(result.source_mismatch).toBe('diff');
    expect(result.incomplete).toBe(true);
    expect(readPending(nonce, { cwd })?.phase).toBe('prepared');
  }, 300_000);

  it('lets the real draft verify afterwards, which is the whole point', () => {
    // Before this, the first call locked the nonce and the genuine verification
    // was refused with `not-prepared` for the rest of the transaction's life.
    const { cwd, nonce, diff } = prepared();

    verifyCaptureRecords({
      nonce,
      draft: [],
      transcript: 'probe — deliberately wrong',
      diff: 'probe — deliberately wrong',
      cwd,
    });

    const real = verifyCaptureRecords({ nonce, draft: DRAFT, transcript: TRANSCRIPT, diff, cwd });
    expect(real.accepted, `the real draft was refused: ${JSON.stringify(real.rejected)}`).toHaveLength(1);
    expect(real.source_mismatch).toBeUndefined();
    expect(real.receipt).toMatch(/^[0-9a-f]{32}$/);
    expect(readPending(nonce, { cwd })?.phase).toBe('verified');
  }, 300_000);

  it('still rejects each record when the caller sent some', () => {
    // The per-record rejections are how a caller with a draft learns which of
    // its records went nowhere, and they are not replaced by the new field.
    const { cwd, nonce, diff } = prepared();

    const result = verifyCaptureRecords({
      nonce,
      draft: DRAFT,
      transcript: 'probe — deliberately wrong',
      diff,
      cwd,
    });

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe('source-mismatch');
    expect(result.source_mismatch).toBe('transcript');
    // And a non-empty draft no longer settles either: the caller can correct
    // its sources and try again, which it could not do before.
    expect(readPending(nonce, { cwd })?.phase).toBe('prepared');
  }, 300_000);

  it('does not report a mismatch when the sources are right', () => {
    // The control. A check that always reported a mismatch would satisfy every
    // case above and refuse every genuine capture.
    const { cwd, nonce, diff } = prepared();

    const result = verifyCaptureRecords({ nonce, draft: [], transcript: TRANSCRIPT, diff, cwd });
    expect(result.source_mismatch).toBeUndefined();
  }, 300_000);
});
