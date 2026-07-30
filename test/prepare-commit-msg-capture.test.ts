/**
 * T-1005 (#197): prepare-commit-msg application guard — five-gate check.
 *
 * The hook appends a trailer block from a staged pending transaction ONLY when
 * all five conditions hold (ADR-0021 §3):
 *   1. HEAD unchanged from base_head
 *   2. Staged diff hash unchanged
 *   3. Unexpired (now < expires_at)
 *   4. Unconsumed (consumed === false)
 *   5. Policy identity hash unchanged
 *
 * If any gate fails, the commit proceeds with NO record. Consumption is exactly
 * once, and only by post-commit (not here).
 */

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestRepo } from './git-fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HARDCODED_DEFAULTS = {
  mode: 'suggest' as const,
  max_records_per_commit: 1,
  require_verified_evidence: true,
} as const;

const policyIdentityHash = (): string =>
  createHash('sha256').update(JSON.stringify(HARDCODED_DEFAULTS)).digest('hex');

interface PendingFileOptions {
  nonce?: string;
  base_head?: string;
  staged_diff_hash?: string;
  staged_tree_oid?: string;
  policy_identity_hash?: string;
  expires_at?: string | null;
  consumed?: boolean;
  phase?: string;
  records?: unknown[];
  applied_record_hash?: string | null;
}

/**
 * Create a staged pending file in a test repo's .git/commitlore/pending/.
 */
const writePendingFile = (cwd: string, opts: PendingFileOptions = {}): string => {
  const nonce = opts.nonce ?? randomBytes(16).toString('hex');
  const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  const pendingDir = resolve(cwd, gitDir, 'commitlore', 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  const diff = execFileSync('git', ['diff', '--cached'], {
    cwd,
    encoding: 'utf8',
  });
  const diffHash = createHash('sha256').update(diff).digest('hex');
  const treeOid = execFileSync('git', ['write-tree'], {
    cwd,
    encoding: 'utf8',
  }).trim();

  const now = new Date();
  const expiresAt = opts.expires_at !== undefined
    ? opts.expires_at
    : new Date(now.getTime() + 5 * 60_000).toISOString();

  const record = {
    version: 1,
    nonce,
    created_at: now.toISOString(),
    expires_at: expiresAt,
    phase: opts.phase ?? 'staged',
    consumed: opts.consumed ?? false,
    verified_at: now.toISOString(),
    staged_at: now.toISOString(),
    applied_at: null,
    applied_record_hash: opts.applied_record_hash ?? null,
    consumed_at: null,
    consumed_by: null,
    base_head: opts.base_head ?? head,
    staged_diff_hash: opts.staged_diff_hash ?? diffHash,
    staged_tree_oid: opts.staged_tree_oid ?? treeOid,
    policy_identity_hash: opts.policy_identity_hash ?? policyIdentityHash(),
    source_hashes: { transcript: 'abc123', diff: diffHash },
    evidence_hash: 'deadbeef',
    records: opts.records ?? [
      {
        trailers: [
          { key: 'Record-Id', value: `r-test${nonce.slice(0, 8)}` },
          { key: 'Limit', value: 'do not exceed 100 connections' },
        ],
        evidence: [
          {
            source: 'transcript',
            quote: 'we decided to limit connections to 100',
            locator: { line: 1 },
          },
        ],
      },
    ],
    validation_result: 'pass',
    overlap_check: 'canonical_exact_only',
    incomplete: false,
  };

  const filePath = join(pendingDir, `${nonce}.json`);
  writeFileSync(filePath, JSON.stringify(record, null, 2));
  return nonce;
};

/**
 * Run the prepare-commit-msg hook action directly.
 */
const runHook = async (messageFile: string, cwd: string): Promise<void> => {
  const mod = await import('../src/hooks/prepare-commit-msg.js');
  const { Command } = await import('commander');
  const program = new Command();
  program.exitOverride(); // prevent process.exit
  mod.register(program);
  const origCwd = process.cwd();
  try {
    process.chdir(cwd);
    await program.parseAsync(['node', 'commitlore', 'prepare-commit-msg', messageFile]);
  } finally {
    process.chdir(origCwd);
  }
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('prepare-commit-msg capture guard', () => {
  let repoDir: string;
  let messageFile: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'pcm-capture-'));
    createTestRepo({ path: repoDir });
    // Initial commit so HEAD exists
    writeFileSync(join(repoDir, 'file.txt'), 'hello\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoDir });
    // Stage a change to have a non-empty diff
    writeFileSync(join(repoDir, 'file.txt'), 'hello world\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });
    // Write commit message file
    messageFile = join(repoDir, 'COMMIT_EDITMSG');
    writeFileSync(messageFile, 'test commit\n');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Happy path — all five gates pass
  // -----------------------------------------------------------------------

  it('hook appends trailer block from pending file when all five conditions hold', async () => {
    const nonce = writePendingFile(repoDir);
    await runHook(messageFile, repoDir);

    const msg = readFileSync(messageFile, 'utf8');
    expect(msg).toContain('Record-Id:');
    expect(msg).toContain('Limit:');
  });

  it('happy path appends trailers and leaves consumed:false', async () => {
    const nonce = writePendingFile(repoDir);
    await runHook(messageFile, repoDir);

    // Verify Record-Id appended
    const msg = readFileSync(messageFile, 'utf8');
    expect(msg).toContain(`r-test${nonce.slice(0, 8)}`);

    // Verify consumed is still false (we don't consume here)
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingPath = resolve(repoDir, gitDir, 'commitlore', 'pending', `${nonce}.json`);
    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    expect(pending.consumed).toBe(false);
    expect(pending.phase).toBe('applied');
  });

  // -----------------------------------------------------------------------
  // Gate 1: HEAD unchanged
  // -----------------------------------------------------------------------

  it('different HEAD skips pending (gate 1)', async () => {
    writePendingFile(repoDir, { base_head: 'a'.repeat(40) });
    await runHook(messageFile, repoDir);

    const msg = readFileSync(messageFile, 'utf8');
    expect(msg).toBe('test commit\n');
    expect(msg).not.toContain('Record-Id:');
  });

  // -----------------------------------------------------------------------
  // Gate 2: Staged diff unchanged
  // -----------------------------------------------------------------------

  it('modified staging skips pending (gate 2)', async () => {
    writePendingFile(repoDir, { staged_diff_hash: 'b'.repeat(64) });
    await runHook(messageFile, repoDir);

    const msg = readFileSync(messageFile, 'utf8');
    expect(msg).toBe('test commit\n');
    expect(msg).not.toContain('Record-Id:');
  });

  // -----------------------------------------------------------------------
  // Gate 3: Unexpired
  // -----------------------------------------------------------------------

  it('expired pending is skipped (gate 3)', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    writePendingFile(repoDir, { expires_at: past });
    await runHook(messageFile, repoDir);

    const msg = readFileSync(messageFile, 'utf8');
    expect(msg).toBe('test commit\n');
    expect(msg).not.toContain('Record-Id:');
  });

  // -----------------------------------------------------------------------
  // Gate 4: Unconsumed
  // -----------------------------------------------------------------------

  it('consumed:true is never re-applied (gate 4)', async () => {
    writePendingFile(repoDir, { consumed: true, phase: 'applied' });
    await runHook(messageFile, repoDir);

    const msg = readFileSync(messageFile, 'utf8');
    expect(msg).toBe('test commit\n');
    expect(msg).not.toContain('Record-Id:');
  });

  // -----------------------------------------------------------------------
  // Gate 5: Policy identity unchanged
  // -----------------------------------------------------------------------

  it('policy mismatch skips pending (gate 5)', async () => {
    writePendingFile(repoDir, { policy_identity_hash: 'c'.repeat(64) });
    await runHook(messageFile, repoDir);

    const msg = readFileSync(messageFile, 'utf8');
    expect(msg).toBe('test commit\n');
    expect(msg).not.toContain('Record-Id:');
  });

  // -----------------------------------------------------------------------
  // Record-Id deduplication
  // -----------------------------------------------------------------------

  it('retry message containing id stays byte-identical', async () => {
    const nonce = writePendingFile(repoDir);

    // First run — appends
    await runHook(messageFile, repoDir);
    const afterFirst = readFileSync(messageFile, 'utf8');
    expect(afterFirst).toContain('Record-Id:');

    // Reset phase to staged for retry (simulating an aborted commit retry)
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingPath = resolve(repoDir, gitDir, 'commitlore', 'pending', `${nonce}.json`);
    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    pending.phase = 'staged';
    pending.applied_at = null;
    pending.applied_record_hash = null;
    writeFileSync(pendingPath, JSON.stringify(pending, null, 2));

    // Second run — should not append again since Record-Id already present
    await runHook(messageFile, repoDir);
    const afterSecond = readFileSync(messageFile, 'utf8');
    expect(afterSecond).toBe(afterFirst);
  });

  // -----------------------------------------------------------------------
  // Error handling — does not block
  // -----------------------------------------------------------------------

  it('corrupt JSON in pending dir does not block', async () => {
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingDir = resolve(repoDir, gitDir, 'commitlore', 'pending');
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(join(pendingDir, 'deadbeef'.repeat(4) + '.json'), '{corrupt');

    // Should not throw — exits 0 silently
    await runHook(messageFile, repoDir);
    const msg = readFileSync(messageFile, 'utf8');
    expect(msg).toBe('test commit\n');
  });

  // -----------------------------------------------------------------------
  // Regression: preserveSquashRecords still works
  // -----------------------------------------------------------------------

  it('preserveSquashRecords path unchanged', async () => {
    // Verify the existing function is still exported and callable
    const mod = await import('../src/hooks/prepare-commit-msg.js');
    expect(typeof mod.preserveSquashRecords).toBe('function');
  });

  // -----------------------------------------------------------------------
  // Non-blocking property: failed gate does not block commit
  // -----------------------------------------------------------------------

  it('failed gate exits 0 and commit proceeds unchanged', async () => {
    // All gates fail
    writePendingFile(repoDir, {
      base_head: 'f'.repeat(40),
      staged_diff_hash: 'f'.repeat(64),
      policy_identity_hash: 'f'.repeat(64),
      consumed: true,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    // Should not throw
    await runHook(messageFile, repoDir);
    const msg = readFileSync(messageFile, 'utf8');
    expect(msg).toBe('test commit\n');
  });

  // -----------------------------------------------------------------------
  // Exactly-once property
  // -----------------------------------------------------------------------

  it('only one pending file is applied per invocation (first-match wins)', async () => {
    const nonce1 = writePendingFile(repoDir);
    const nonce2 = writePendingFile(repoDir);

    await runHook(messageFile, repoDir);

    const msg = readFileSync(messageFile, 'utf8');
    // At most one Record-Id should be appended
    const recordIdMatches = msg.match(/Record-Id:/g);
    expect(recordIdMatches?.length ?? 0).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Mutation oracles — each gate MUST fail if removed
  // -----------------------------------------------------------------------

  describe('mutation oracles', () => {
    it('ORACLE gate 1: removing HEAD check would allow wrong-HEAD pending to apply', async () => {
      // This pending has a different base_head — it MUST NOT be applied
      writePendingFile(repoDir, { base_head: 'a'.repeat(40) });
      await runHook(messageFile, repoDir);
      const msg = readFileSync(messageFile, 'utf8');
      // If gate 1 were removed, this would contain Record-Id
      expect(msg).not.toContain('Record-Id:');
    });

    it('ORACLE gate 2: removing diff check would allow wrong-diff pending to apply', async () => {
      writePendingFile(repoDir, { staged_diff_hash: 'b'.repeat(64) });
      await runHook(messageFile, repoDir);
      const msg = readFileSync(messageFile, 'utf8');
      expect(msg).not.toContain('Record-Id:');
    });

    it('ORACLE gate 3: removing expiry check would allow expired pending to apply', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      writePendingFile(repoDir, { expires_at: past });
      await runHook(messageFile, repoDir);
      const msg = readFileSync(messageFile, 'utf8');
      expect(msg).not.toContain('Record-Id:');
    });

    it('ORACLE gate 4: removing consumed check would allow consumed pending to re-apply', async () => {
      writePendingFile(repoDir, { consumed: true, phase: 'applied' });
      await runHook(messageFile, repoDir);
      const msg = readFileSync(messageFile, 'utf8');
      expect(msg).not.toContain('Record-Id:');
    });

    it('ORACLE gate 5: removing policy check would allow wrong-policy pending to apply', async () => {
      writePendingFile(repoDir, { policy_identity_hash: 'c'.repeat(64) });
      await runHook(messageFile, repoDir);
      const msg = readFileSync(messageFile, 'utf8');
      expect(msg).not.toContain('Record-Id:');
    });

    it('ORACLE positive: a valid pending IS applied (proves tests are not trivially passing)', async () => {
      writePendingFile(repoDir);
      await runHook(messageFile, repoDir);
      const msg = readFileSync(messageFile, 'utf8');
      expect(msg).toContain('Record-Id:');
      expect(msg).toContain('Limit:');
    });
  });
});
