import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

import { prepareCaptureContext } from '../src/core/capture-prepare.js';

/**
 * Helper: create a temporary git repo with at least one commit and a staged change.
 */
const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-prepare-'));
  execSync('git init --quiet --initial-branch=main', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config commit.gpgsign false', { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'hello\n');
  execSync('git add a.txt', { cwd: dir });
  execSync('git commit -m "init" --quiet', { cwd: dir });
  // Stage a change
  writeFileSync(join(dir, 'a.txt'), 'hello\nworld\n');
  execSync('git add a.txt', { cwd: dir });
  return dir;
};

describe('prepareCaptureContext', () => {
  const scratch: string[] = [];
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  it('returns a nonce, prompt contract, base_head, staged_diff_hash, and staged_tree_oid', () => {
    const cwd = makeRepo();
    scratch.push(cwd);

    const transcript = 'We decided to use sha256 for hashing because it is standard.';
    const result = prepareCaptureContext({ cwd, transcript });

    // Nonce is 32 hex chars (CEO amendment 2: lowercase hex, exactly 32)
    expect(result.nonce).toMatch(/^[0-9a-f]{32}$/);

    // base_head matches current HEAD (40-char SHA)
    const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
    expect(result.base_head).toBe(head);
    expect(result.base_head).toMatch(/^[0-9a-f]{40}$/);

    // staged_diff_hash is sha256 of cached diff
    const diff = execSync('git diff --cached', { cwd, encoding: 'utf8' });
    const expectedDiffHash = createHash('sha256').update(diff).digest('hex');
    expect(result.staged_diff_hash).toBe(expectedDiffHash);

    // staged_tree_oid matches git write-tree (40-char hex)
    const treeOid = execSync('git write-tree', { cwd, encoding: 'utf8' }).trim();
    expect(result.staged_tree_oid).toBe(treeOid);
    expect(result.staged_tree_oid).toMatch(/^[0-9a-f]{40}$/);

    // policy_identity_hash is deterministic
    const policyDefaults = {
      mode: 'suggest',
      max_records_per_commit: 1,
      require_verified_evidence: true,
    };
    const expectedPolicyHash = createHash('sha256')
      .update(JSON.stringify(policyDefaults))
      .digest('hex');
    expect(result.policy_identity_hash).toBe(expectedPolicyHash);

    // source_hashes present and correct
    const expectedTranscriptHash = createHash('sha256').update(transcript).digest('hex');
    expect(result.source_hashes.transcript).toBe(expectedTranscriptHash);
    expect(result.source_hashes.diff).toBe(expectedDiffHash);

    // prompt contains harvest contract fields
    expect(result.prompt).toContain('Record-Id');
    expect(typeof result.prompt).toBe('string');
    expect(result.prompt.length).toBeGreaterThan(0);
  });

  it('policy_identity_hash is deterministic across calls', () => {
    const cwd = makeRepo();
    scratch.push(cwd);

    const transcript = 'test transcript content';
    const r1 = prepareCaptureContext({ cwd, transcript });
    const r2 = prepareCaptureContext({ cwd, transcript });

    expect(r1.policy_identity_hash).toBe(r2.policy_identity_hash);
  });

  it('prepared file has source_hashes and no raw transcript content', () => {
    const cwd = makeRepo();
    scratch.push(cwd);

    const transcript = 'UNIQUE_SECRET_TRANSCRIPT_CONTENT_12345';
    const result = prepareCaptureContext({ cwd, transcript });

    // Read the pending file to verify it stores hashes, not raw content
    const pendingDirRel = execSync('git rev-parse --git-path commitlore/pending', {
      cwd,
      encoding: 'utf8',
    }).trim();
    const pendingPath = join(cwd, pendingDirRel, `${result.nonce}.json`);
    const content = readFileSync(pendingPath, 'utf8');

    // Must NOT contain the raw transcript
    expect(content).not.toContain('UNIQUE_SECRET_TRANSCRIPT_CONTENT_12345');
    // Must contain source_hashes
    const parsed = JSON.parse(content);
    expect(parsed.source_hashes).toBeDefined();
    expect(parsed.source_hashes.transcript).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.source_hashes.diff).toMatch(/^[0-9a-f]{64}$/);
  });

  it('prompt states maximum one record', () => {
    const cwd = makeRepo();
    scratch.push(cwd);

    const transcript = 'some transcript';
    const result = prepareCaptureContext({ cwd, transcript });

    // The output block says: emit {"records": []} and uses a single-element example
    // The prompt must convey max one record
    expect(result.prompt).toMatch(/one.*record|records.*\[\]/i);
  });

  it('writes expires_at as null (CEO amendment 1)', () => {
    const cwd = makeRepo();
    scratch.push(cwd);

    const transcript = 'test for expires_at';
    const result = prepareCaptureContext({ cwd, transcript });

    const pendingDirRel = execSync('git rev-parse --git-path commitlore/pending', {
      cwd,
      encoding: 'utf8',
    }).trim();
    const pendingPath = join(cwd, pendingDirRel, `${result.nonce}.json`);
    const content = JSON.parse(readFileSync(pendingPath, 'utf8'));

    expect(content.expires_at).toBeNull();
    expect(content.phase).toBe('prepared');
  });
});
