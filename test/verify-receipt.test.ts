/**
 * #1005 step 1: a verification that binds a transaction is issued a receipt.
 *
 * The open hole is a **third connection** — one that never verified the nonce —
 * staging it and attaching the first caller's record. `test/mcp-stage-after-refusal.test.ts:209`
 * runs that sequence through to the commit and shows it succeeding, so it is
 * observed rather than argued. The per-connection guard cannot close it: there
 * is no caller identity in the protocol, so "the caller that verified" is only
 * knowable when it is the same connection.
 *
 * A receipt is the identity the protocol lacks. Three steps, because only the
 * last is breaking:
 *
 *   1. issue it and store it; stage ignores it        <- this commit
 *   2. stage checks it when present, absence allowed
 *   3. stage requires it                               breaking, needs the bump
 *
 * This file pins step 1 and, as much as it can, pins that step 1 is *only* step
 * 1: staging without a receipt still works, because a host that has not
 * upgraded must keep working until step 3 says otherwise.
 *
 * ## What a receipt is worth, stated so step 3 is not oversold
 *
 * It defends against a *protocol* caller that never verified this nonce. It
 * does not defend against anything that can read the pending file, because the
 * receipt is stored in it — a local process can read it out and present it.
 * That is exactly the threat #989 described and no more, and step 3 should not
 * be described as closing more than that.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createPending, readPending, stagePending, storeVerification } from '../src/core/pending.js';

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

const repoWithATransaction = (): { cwd: string; nonce: string } => {
  const cwd = mkdtempSync(join(tmpdir(), 'commitlore-receipt-'));
  temporaries.push(cwd);
  git(cwd, ['init', '-q', '--initial-branch=main']);
  writeFileSync(join(cwd, 'a.ts'), 'export const a = 1;\n');
  git(cwd, ['add', '-A']);
  git(cwd, [...IDENTITY, 'commit', '-q', '--no-verify', '-m', 'first\n\nno record here\n']);

  const nonce = createPending({
    cwd,
    staged_diff_hash: 'a'.repeat(64),
    staged_tree_oid: 'b'.repeat(40),
    policy_identity_hash: 'c'.repeat(64),
    source_hashes: { transcript: 'd'.repeat(64), diff: 'e'.repeat(64) },
  });
  return { cwd, nonce };
};

const verify = (nonce: string, cwd: string): string | null =>
  storeVerification(nonce, {
    cwd,
    accepted: [{ trailers: [{ key: 'Record-Id', value: 'r-receipt0001' }] }],
    rejected: [],
    validation_result: 'pass',
    overlap_check: 'canonical_exact_only',
    incomplete: false,
    evidence_hash: 'f'.repeat(64),
  });

describe('#1005 step 1: verification issues a receipt', () => {
  it('returns a receipt and stores the same value on the transaction', () => {
    const { cwd, nonce } = repoWithATransaction();
    const receipt = verify(nonce, cwd);

    expect(receipt, 'the verification stored nothing').not.toBeNull();
    expect(receipt).toMatch(/^[0-9a-f]{32}$/);
    // The caller's copy and the stored copy are one value. If they could differ,
    // step 3 would compare a handle against something the caller never saw.
    expect(readPending(nonce, { cwd })?.receipt).toBe(receipt);
  }, 300_000);

  it('is not the nonce, and differs between transactions', () => {
    // A receipt equal to the nonce would be no identity at all: every caller
    // that can stage already holds the nonce.
    const first = repoWithATransaction();
    const firstReceipt = verify(first.nonce, first.cwd);
    expect(firstReceipt).not.toBe(first.nonce);

    const second = repoWithATransaction();
    const secondReceipt = verify(second.nonce, second.cwd);
    expect(secondReceipt).not.toBe(firstReceipt);
  }, 300_000);

  it('issues nothing to a second verification, which binds nothing', () => {
    // The property the whole issue rests on. `storeVerification` refuses every
    // phase but `prepared`, so the second caller stores nothing — and must
    // therefore come away with no handle to what the first caller stored.
    const { cwd, nonce } = repoWithATransaction();
    const first = verify(nonce, cwd);
    expect(first).not.toBeNull();

    const second = verify(nonce, cwd);
    expect(second, 'a refused verification was issued a receipt').toBeNull();

    // And the first caller's receipt is untouched by the second attempt.
    expect(readPending(nonce, { cwd })?.receipt).toBe(first);
  }, 300_000);

  it('does not yet gate staging, because that is step 3', () => {
    // Deliberate, and the reason this is three releases rather than one: a
    // transaction written before step 1 carries no receipt, and requiring one
    // now would make it unstageable. This asserts the migration is still in its
    // additive phase — when step 3 lands, this expectation inverts.
    const { cwd, nonce } = repoWithATransaction();
    expect(verify(nonce, cwd)).not.toBeNull();

    expect(stagePending(nonce, { cwd }), 'step 1 must not change what stage accepts').toBe(true);
    expect(readPending(nonce, { cwd })?.phase).toBe('staged');
  }, 300_000);

  it('leaves a transaction that predates it readable', () => {
    // `receipt` is optional for the same reason `unattended` is. A pending file
    // with no receipt must still parse, or step 1 breaks every transaction
    // written by the release before it.
    const { cwd, nonce } = repoWithATransaction();
    const prepared = readPending(nonce, { cwd });
    expect(prepared, 'the fixture produced no transaction').not.toBeNull();
    expect(prepared?.receipt, 'a prepared transaction carries no receipt yet').toBeUndefined();
    expect(prepared?.phase).toBe('prepared');
  }, 300_000);
});
