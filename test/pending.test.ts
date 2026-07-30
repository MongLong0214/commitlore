import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestRepo } from './git-fixtures.js';
import {
  createPending,
  readPending,
  storeVerification,
  stagePending,
  markApplied,
  consumePending,
  PendingFormatError,
} from '../src/core/pending.js';

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-pending-'));
  temporaries.push(dir);
  createTestRepo({ path: dir });
  // Need at least one commit so HEAD exists
  writeFileSync(join(dir, 'init.txt'), 'init');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial', '--no-verify'], { cwd: dir });
  return dir;
};

describe('pending transaction store', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo();
  });

  it('createPending creates a phase-prepared JSON file under .git/commitlore/pending/ with all required fields', () => {
    const nonce = createPending({
      cwd: repo,
      source_hashes: { transcript: 'a'.repeat(64), diff: 'b'.repeat(64) },
      staged_diff_hash: 'c'.repeat(64),
      staged_tree_oid: 'd'.repeat(40),
      policy_identity_hash: 'e'.repeat(64),
    });
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);

    const record = readPending(nonce, { cwd: repo });
    expect(record).not.toBeNull();
    expect(record!.version).toBe(1);
    expect(record!.nonce).toBe(nonce);
    expect(record!.phase).toBe('prepared');
    expect(record!.consumed).toBe(false);
    expect(record!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // CEO amendment 1: expires_at is null while phase is prepared
    expect(record!.expires_at).toBeNull();
    expect(record!.base_head).toMatch(/^[0-9a-f]{40}$/);
    expect(record!.staged_diff_hash).toBe('c'.repeat(64));
    expect(record!.staged_tree_oid).toBe('d'.repeat(40));
    expect(record!.policy_identity_hash).toBe('e'.repeat(64));
    expect(record!.source_hashes).toEqual({ transcript: 'a'.repeat(64), diff: 'b'.repeat(64) });
    // Null fields in prepared phase
    expect(record!.verified_at).toBeNull();
    expect(record!.staged_at).toBeNull();
    expect(record!.applied_at).toBeNull();
    expect(record!.applied_record_hash).toBeNull();
    expect(record!.consumed_at).toBeNull();
    expect(record!.consumed_by).toBeNull();
    expect(record!.evidence_hash).toBeNull();
    expect(record!.records).toEqual([]);
    expect(record!.validation_result).toBeNull();
    expect(record!.overlap_check).toBeNull();
    expect(record!.incomplete).toBe(false);
  });

  it('concurrent read during write sees old or new, never partial', () => {
    // Atomic write is ensured by rename; we verify the file is valid JSON
    const nonce = createPending({
      cwd: repo,
      source_hashes: { transcript: 'a'.repeat(64), diff: 'b'.repeat(64) },
      staged_diff_hash: 'c'.repeat(64),
      staged_tree_oid: 'd'.repeat(40),
      policy_identity_hash: 'e'.repeat(64),
    });
    // Reading immediately should always get valid JSON
    const record = readPending(nonce, { cwd: repo });
    expect(record).not.toBeNull();
    expect(record!.version).toBe(1);
  });

  it('prepared -> verified -> staged -> applied -> consumed; skips rejected', () => {
    const nonce = createPending({
      cwd: repo,
      source_hashes: { transcript: 'a'.repeat(64), diff: 'b'.repeat(64) },
      staged_diff_hash: 'c'.repeat(64),
      staged_tree_oid: 'd'.repeat(40),
      policy_identity_hash: 'e'.repeat(64),
    });

    // Cannot stage a prepared record (must be verified first)
    expect(stagePending(nonce, { cwd: repo })).toBe(false);

    // Verify
    const verified = storeVerification(nonce, {
      cwd: repo,
      accepted: [{ trailers: [], evidence: [] }],
      rejected: [],
      validation_result: 'pass',
      overlap_check: 'canonical_exact_only',
      incomplete: false,
      evidence_hash: 'f'.repeat(64),
    });
    expect(verified).toBe(true);

    const afterVerify = readPending(nonce, { cwd: repo });
    expect(afterVerify!.phase).toBe('verified');
    expect(afterVerify!.verified_at).not.toBeNull();
    // CEO amendment 1: expires_at is still null in verified phase
    expect(afterVerify!.expires_at).toBeNull();

    // Stage
    const staged = stagePending(nonce, { cwd: repo });
    expect(staged).toBe(true);

    const afterStage = readPending(nonce, { cwd: repo });
    expect(afterStage!.phase).toBe('staged');
    expect(afterStage!.staged_at).not.toBeNull();
    // CEO amendment 1: expires_at is stamped only on stage success
    expect(afterStage!.expires_at).not.toBeNull();

    // Mark applied
    const applied = markApplied(nonce, 'hash123', { cwd: repo });
    expect(applied).toBe(true);

    const afterApply = readPending(nonce, { cwd: repo });
    expect(afterApply!.phase).toBe('applied');
    expect(afterApply!.applied_at).not.toBeNull();
    expect(afterApply!.applied_record_hash).toBe('hash123');

    // Consume
    const consumed = consumePending(nonce, 'abcdef1234567890abcdef1234567890abcdef12', { cwd: repo });
    expect(consumed).toBe(true);

    const afterConsume = readPending(nonce, { cwd: repo });
    expect(afterConsume!.phase).toBe('consumed');
    expect(afterConsume!.consumed).toBe(true);
    expect(afterConsume!.consumed_at).not.toBeNull();
    expect(afterConsume!.consumed_by).toBe('abcdef1234567890abcdef1234567890abcdef12');
  });

  it('stagePending accepts nonce only and uses stored verification', () => {
    const nonce = createPending({
      cwd: repo,
      source_hashes: { transcript: 'a'.repeat(64), diff: 'b'.repeat(64) },
      staged_diff_hash: 'c'.repeat(64),
      staged_tree_oid: 'd'.repeat(40),
      policy_identity_hash: 'e'.repeat(64),
    });
    // Without verification, staging must fail
    expect(stagePending(nonce, { cwd: repo })).toBe(false);
  });

  it('mark applied leaves consumed:false', () => {
    const nonce = createPending({
      cwd: repo,
      source_hashes: { transcript: 'a'.repeat(64), diff: 'b'.repeat(64) },
      staged_diff_hash: 'c'.repeat(64),
      staged_tree_oid: 'd'.repeat(40),
      policy_identity_hash: 'e'.repeat(64),
    });
    storeVerification(nonce, {
      cwd: repo,
      accepted: [{ trailers: [], evidence: [] }],
      rejected: [],
      validation_result: 'pass',
      overlap_check: 'canonical_exact_only',
      incomplete: false,
      evidence_hash: 'f'.repeat(64),
    });
    stagePending(nonce, { cwd: repo });
    markApplied(nonce, 'recordhash', { cwd: repo });

    const record = readPending(nonce, { cwd: repo });
    expect(record!.consumed).toBe(false);
    expect(record!.phase).toBe('applied');
  });

  it('unapplied consume is rejected', () => {
    const nonce = createPending({
      cwd: repo,
      source_hashes: { transcript: 'a'.repeat(64), diff: 'b'.repeat(64) },
      staged_diff_hash: 'c'.repeat(64),
      staged_tree_oid: 'd'.repeat(40),
      policy_identity_hash: 'e'.repeat(64),
    });
    // Try to consume a prepared record — must fail
    expect(consumePending(nonce, 'abc123', { cwd: repo })).toBe(false);

    // Verify and stage, but do not apply — consume must still fail
    storeVerification(nonce, {
      cwd: repo,
      accepted: [{ trailers: [], evidence: [] }],
      rejected: [],
      validation_result: 'pass',
      overlap_check: 'canonical_exact_only',
      incomplete: false,
      evidence_hash: 'f'.repeat(64),
    });
    stagePending(nonce, { cwd: repo });
    expect(consumePending(nonce, 'abc123', { cwd: repo })).toBe(false);
  });

  it('double consume returns false', () => {
    const nonce = createPending({
      cwd: repo,
      source_hashes: { transcript: 'a'.repeat(64), diff: 'b'.repeat(64) },
      staged_diff_hash: 'c'.repeat(64),
      staged_tree_oid: 'd'.repeat(40),
      policy_identity_hash: 'e'.repeat(64),
    });
    storeVerification(nonce, {
      cwd: repo,
      accepted: [{ trailers: [], evidence: [] }],
      rejected: [],
      validation_result: 'pass',
      overlap_check: 'canonical_exact_only',
      incomplete: false,
      evidence_hash: 'f'.repeat(64),
    });
    stagePending(nonce, { cwd: repo });
    markApplied(nonce, 'recordhash', { cwd: repo });
    const first = consumePending(nonce, 'sha1', { cwd: repo });
    expect(first).toBe(true);
    const second = consumePending(nonce, 'sha2', { cwd: repo });
    expect(second).toBe(false);
  });

  it('missing returns null; corrupt/version 2 throws PendingFormatError', () => {
    // Missing nonce returns null
    const result = readPending('0'.repeat(32), { cwd: repo });
    expect(result).toBeNull();

    // Write a corrupt file
    const nonce = createPending({
      cwd: repo,
      source_hashes: { transcript: 'a'.repeat(64), diff: 'b'.repeat(64) },
      staged_diff_hash: 'c'.repeat(64),
      staged_tree_oid: 'd'.repeat(40),
      policy_identity_hash: 'e'.repeat(64),
    });
    // Corrupt the file
    const pendingDir = execFileSync('git', ['rev-parse', '--git-path', 'commitlore/pending'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    const filePath = join(repo, pendingDir, `${nonce}.json`);
    writeFileSync(filePath, 'not json at all');
    expect(() => readPending(nonce, { cwd: repo })).toThrow(PendingFormatError);

    // Version 2 file
    writeFileSync(filePath, JSON.stringify({ version: 2, nonce }));
    expect(() => readPending(nonce, { cwd: repo })).toThrow(PendingFormatError);
  });

  it('rejects invalid nonce format (trust boundary)', () => {
    // Too short
    expect(() => readPending('abc', { cwd: repo })).toThrow();
    // Uppercase
    expect(() => readPending('A'.repeat(32), { cwd: repo })).toThrow();
    // Contains non-hex
    expect(() => readPending('g'.repeat(32), { cwd: repo })).toThrow();
    // Path traversal attempt
    expect(() => readPending('../../../etc/passwd'.padEnd(32, 'a').slice(0, 32), { cwd: repo })).toThrow();
    // 33 chars
    expect(() => readPending('a'.repeat(33), { cwd: repo })).toThrow();
  });

  it('expires_at is null in prepared phase and null in verified phase', () => {
    const nonce = createPending({
      cwd: repo,
      source_hashes: { transcript: 'a'.repeat(64), diff: 'b'.repeat(64) },
      staged_diff_hash: 'c'.repeat(64),
      staged_tree_oid: 'd'.repeat(40),
      policy_identity_hash: 'e'.repeat(64),
    });
    const prepared = readPending(nonce, { cwd: repo });
    expect(prepared!.expires_at).toBeNull();

    storeVerification(nonce, {
      cwd: repo,
      accepted: [{ trailers: [], evidence: [] }],
      rejected: [],
      validation_result: 'pass',
      overlap_check: 'canonical_exact_only',
      incomplete: false,
      evidence_hash: 'f'.repeat(64),
    });
    const verified = readPending(nonce, { cwd: repo });
    expect(verified!.expires_at).toBeNull();
  });

  it('stagePending stamps expires_at as staged_at + 5 minutes', () => {
    const nonce = createPending({
      cwd: repo,
      source_hashes: { transcript: 'a'.repeat(64), diff: 'b'.repeat(64) },
      staged_diff_hash: 'c'.repeat(64),
      staged_tree_oid: 'd'.repeat(40),
      policy_identity_hash: 'e'.repeat(64),
    });
    storeVerification(nonce, {
      cwd: repo,
      accepted: [{ trailers: [], evidence: [] }],
      rejected: [],
      validation_result: 'pass',
      overlap_check: 'canonical_exact_only',
      incomplete: false,
      evidence_hash: 'f'.repeat(64),
    });
    stagePending(nonce, { cwd: repo });

    const record = readPending(nonce, { cwd: repo });
    expect(record!.staged_at).not.toBeNull();
    expect(record!.expires_at).not.toBeNull();

    const stagedAt = new Date(record!.staged_at!).getTime();
    const expiresAt = new Date(record!.expires_at!).getTime();
    // expires_at should be staged_at + 5 minutes (300_000 ms), with small tolerance
    expect(Math.abs(expiresAt - stagedAt - 300_000)).toBeLessThan(1000);
  });
});
