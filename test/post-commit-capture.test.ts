/**
 * T-1018 (#213): post-commit consumption finaliser.
 *
 * After a successful commit, the post-commit hook inspects applied pending
 * files and consumes exactly the one whose:
 *   1. base_head equals the new commit's first parent
 *   2. staged_tree_oid equals the new commit's tree
 *   3. applied_record_hash matches the canonical record block in the message
 *   4. every applied Record-Id is present in the commit message
 *
 * Consumption happens AFTER the commit succeeds, exactly once. If no candidate
 * matches, exit 0. If state is unreadable, print a diagnostic and exit 0.
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

import { serializeTrailers } from '../src/core/trailers.js';
import type { Trailer } from '../src/core/types.js';
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
  staged_tree_oid?: string;
  applied_record_hash?: string | null;
  consumed?: boolean;
  phase?: string;
  records?: unknown[];
  expires_at?: string | null;
}

/**
 * Create an applied pending file in a test repo's .git/commitlore/pending/.
 */
const writeAppliedPendingFile = (cwd: string, opts: PendingFileOptions = {}): string => {
  const nonce = opts.nonce ?? randomBytes(16).toString('hex');
  const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  const pendingDir = resolve(cwd, gitDir, 'commitlore', 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const head = opts.base_head ?? execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  }).trim();

  const treeOid = opts.staged_tree_oid ?? execFileSync('git', ['write-tree'], {
    cwd,
    encoding: 'utf8',
  }).trim();

  const diffHash = createHash('sha256').update('').digest('hex');
  const now = new Date();
  const expiresAt = opts.expires_at !== undefined
    ? opts.expires_at
    : new Date(now.getTime() + 5 * 60_000).toISOString();

  const records = opts.records ?? [
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
  ];

  // Compute canonical trailer block hash using the same serialization as production code
  const trailerBlock = records
    .map((rec: unknown) => {
      const r = rec as { trailers?: Trailer[] };
      if (!Array.isArray(r.trailers)) return '';
      return serializeTrailers(r.trailers);
    })
    .filter(Boolean)
    .join('\n');
  const recordHash = opts.applied_record_hash ?? createHash('sha256').update(trailerBlock).digest('hex');

  const record = {
    version: 1,
    nonce,
    created_at: now.toISOString(),
    expires_at: expiresAt,
    phase: opts.phase ?? 'applied',
    consumed: opts.consumed ?? false,
    verified_at: now.toISOString(),
    staged_at: now.toISOString(),
    applied_at: now.toISOString(),
    applied_record_hash: recordHash,
    consumed_at: null,
    consumed_by: null,
    base_head: head,
    staged_diff_hash: diffHash,
    staged_tree_oid: treeOid,
    policy_identity_hash: policyIdentityHash(),
    source_hashes: { transcript: 'abc123', diff: diffHash },
    evidence_hash: 'deadbeef',
    records,
    validation_result: 'pass',
    overlap_check: 'canonical_exact_only',
    incomplete: false,
  };

  const filePath = join(pendingDir, `${nonce}.json`);
  writeFileSync(filePath, JSON.stringify(record, null, 2));
  return nonce;
};

/**
 * Run the post-commit hook action directly via the registered CLI command.
 */
const runPostCommitHook = async (cwd: string): Promise<void> => {
  const mod = await import('../src/hooks/post-commit.js');
  const { Command } = await import('commander');
  const program = new Command();
  program.exitOverride();
  mod.register(program);
  const origCwd = process.cwd();
  try {
    process.chdir(cwd);
    await program.parseAsync(['node', 'commitlore', 'post-commit']);
  } finally {
    process.chdir(origCwd);
  }
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('post-commit consumption finaliser', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'post-commit-'));
    createTestRepo({ path: repoDir });
    // Initial commit so HEAD exists
    writeFileSync(join(repoDir, 'file.txt'), 'hello\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoDir });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Happy path — parent/tree/message/ids match → consumed_by=HEAD
  // -----------------------------------------------------------------------

  it('successful commit finalises exact nonce when parent/tree/message/ids match', async () => {
    // Stage a change
    writeFileSync(join(repoDir, 'file.txt'), 'hello world\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });

    // Get the current HEAD (will be first parent of new commit)
    const parentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    // Get the tree oid for the staged content
    const treeOid = execFileSync('git', ['write-tree'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    // Create the pending file with matching base_head and staged_tree_oid
    const nonce = writeAppliedPendingFile(repoDir, {
      base_head: parentHead,
      staged_tree_oid: treeOid,
    });

    // Read pending to get the record block for the commit message
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingPath = resolve(repoDir, gitDir, 'commitlore', 'pending', `${nonce}.json`);
    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    const trailerBlock = pending.records
      .map((rec: { trailers?: Trailer[] }) =>
        rec.trailers ? serializeTrailers(rec.trailers) : '',
      )
      .filter(Boolean)
      .join('\n');

    // Commit with the trailer block in the message
    execFileSync('git', ['commit', '-m', `test commit\n\n${trailerBlock}`], { cwd: repoDir });

    // Run post-commit
    await runPostCommitHook(repoDir);

    // Verify consumed
    const after = JSON.parse(readFileSync(pendingPath, 'utf8'));
    const newHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    expect(after.phase).toBe('consumed');
    expect(after.consumed).toBe(true);
    expect(after.consumed_by).toBe(newHead);
  });

  // -----------------------------------------------------------------------
  // Failed commit does not consume
  // -----------------------------------------------------------------------

  it('commit-msg failure leaves consumed:false (no consumption before success)', async () => {
    writeFileSync(join(repoDir, 'file.txt'), 'hello world\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });

    const parentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const treeOid = execFileSync('git', ['write-tree'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    // Create applied pending file — but we will NOT make a commit, simulating failure
    const nonce = writeAppliedPendingFile(repoDir, {
      base_head: parentHead,
      staged_tree_oid: treeOid,
    });

    // HEAD has not moved — post-commit finds no matching commit
    // (The pending file's base_head = current HEAD, meaning the commit that
    // should have moved HEAD to a new value never happened)
    // Run post-commit — it should find no match and do nothing
    await runPostCommitHook(repoDir);

    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingPath = resolve(repoDir, gitDir, 'commitlore', 'pending', `${nonce}.json`);
    const after = JSON.parse(readFileSync(pendingPath, 'utf8'));
    expect(after.consumed).toBe(false);
    expect(after.phase).toBe('applied');
  });

  // -----------------------------------------------------------------------
  // Wrong parent cannot consume
  // -----------------------------------------------------------------------

  it('different first parent is skipped', async () => {
    writeFileSync(join(repoDir, 'file.txt'), 'hello world\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });

    const treeOid = execFileSync('git', ['write-tree'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    // Create pending with a WRONG base_head
    const nonce = writeAppliedPendingFile(repoDir, {
      base_head: 'a'.repeat(40),
      staged_tree_oid: treeOid,
    });

    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingPath = resolve(repoDir, gitDir, 'commitlore', 'pending', `${nonce}.json`);
    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    const trailerBlock = pending.records
      .map((rec: { trailers?: Trailer[] }) =>
        rec.trailers ? serializeTrailers(rec.trailers) : '',
      )
      .filter(Boolean)
      .join('\n');

    execFileSync('git', ['commit', '-m', `test commit\n\n${trailerBlock}`], { cwd: repoDir });

    await runPostCommitHook(repoDir);

    const after = JSON.parse(readFileSync(pendingPath, 'utf8'));
    expect(after.consumed).toBe(false);
    expect(after.phase).toBe('applied');
  });

  // -----------------------------------------------------------------------
  // Wrong tree cannot consume
  // -----------------------------------------------------------------------

  it('different committed tree is skipped', async () => {
    writeFileSync(join(repoDir, 'file.txt'), 'hello world\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });

    const parentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    // Create pending with a WRONG staged_tree_oid
    const nonce = writeAppliedPendingFile(repoDir, {
      base_head: parentHead,
      staged_tree_oid: 'c'.repeat(40),
    });

    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingPath = resolve(repoDir, gitDir, 'commitlore', 'pending', `${nonce}.json`);
    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    const trailerBlock = pending.records
      .map((rec: { trailers?: Trailer[] }) =>
        rec.trailers ? serializeTrailers(rec.trailers) : '',
      )
      .filter(Boolean)
      .join('\n');

    execFileSync('git', ['commit', '-m', `test commit\n\n${trailerBlock}`], { cwd: repoDir });

    await runPostCommitHook(repoDir);

    const after = JSON.parse(readFileSync(pendingPath, 'utf8'));
    expect(after.consumed).toBe(false);
    expect(after.phase).toBe('applied');
  });

  // -----------------------------------------------------------------------
  // Wrong/missing record block cannot consume
  // -----------------------------------------------------------------------

  it('message without prepared id/hash is skipped', async () => {
    writeFileSync(join(repoDir, 'file.txt'), 'hello world\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });

    const parentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const treeOid = execFileSync('git', ['write-tree'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    const nonce = writeAppliedPendingFile(repoDir, {
      base_head: parentHead,
      staged_tree_oid: treeOid,
    });

    // Commit WITHOUT the trailer block
    execFileSync('git', ['commit', '-m', 'test commit without trailers'], { cwd: repoDir });

    await runPostCommitHook(repoDir);

    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingPath = resolve(repoDir, gitDir, 'commitlore', 'pending', `${nonce}.json`);
    const after = JSON.parse(readFileSync(pendingPath, 'utf8'));
    expect(after.consumed).toBe(false);
    expect(after.phase).toBe('applied');
  });

  // -----------------------------------------------------------------------
  // Idempotent — second run changes nothing
  // -----------------------------------------------------------------------

  it('second post-commit run changes nothing (finaliser is idempotent)', async () => {
    writeFileSync(join(repoDir, 'file.txt'), 'hello world\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });

    const parentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const treeOid = execFileSync('git', ['write-tree'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    const nonce = writeAppliedPendingFile(repoDir, {
      base_head: parentHead,
      staged_tree_oid: treeOid,
    });

    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingPath = resolve(repoDir, gitDir, 'commitlore', 'pending', `${nonce}.json`);
    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    const trailerBlock = pending.records
      .map((rec: { trailers?: Trailer[] }) =>
        rec.trailers ? serializeTrailers(rec.trailers) : '',
      )
      .filter(Boolean)
      .join('\n');

    execFileSync('git', ['commit', '-m', `test commit\n\n${trailerBlock}`], { cwd: repoDir });

    // First run — consumes
    await runPostCommitHook(repoDir);
    const afterFirst = JSON.parse(readFileSync(pendingPath, 'utf8'));
    expect(afterFirst.consumed).toBe(true);

    // Second run — no change
    await runPostCommitHook(repoDir);
    const afterSecond = JSON.parse(readFileSync(pendingPath, 'utf8'));
    expect(afterSecond.consumed_at).toBe(afterFirst.consumed_at);
    expect(afterSecond.consumed_by).toBe(afterFirst.consumed_by);
  });

  // -----------------------------------------------------------------------
  // Crash-repair: already-present record can be finalised later
  // -----------------------------------------------------------------------

  it('prepared record already present in HEAD can be finalised later', async () => {
    writeFileSync(join(repoDir, 'file.txt'), 'hello world\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });

    const parentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const treeOid = execFileSync('git', ['write-tree'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    const nonce = writeAppliedPendingFile(repoDir, {
      base_head: parentHead,
      staged_tree_oid: treeOid,
    });

    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingPath = resolve(repoDir, gitDir, 'commitlore', 'pending', `${nonce}.json`);
    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    const trailerBlock = pending.records
      .map((rec: { trailers?: Trailer[] }) =>
        rec.trailers ? serializeTrailers(rec.trailers) : '',
      )
      .filter(Boolean)
      .join('\n');

    // Commit with the trailer block
    execFileSync('git', ['commit', '-m', `test commit\n\n${trailerBlock}`], { cwd: repoDir });

    // Simulate post-commit crash: do NOT run post-commit here.
    // Now run it later — should still finalise correctly.
    await runPostCommitHook(repoDir);

    const after = JSON.parse(readFileSync(pendingPath, 'utf8'));
    expect(after.consumed).toBe(true);
    expect(after.phase).toBe('consumed');
  });

  // -----------------------------------------------------------------------
  // Error cannot fail commit
  // -----------------------------------------------------------------------

  it('corrupt pending state reports and exits 0', async () => {
    writeFileSync(join(repoDir, 'file.txt'), 'hello world\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'test'], { cwd: repoDir });

    // Write corrupt JSON to pending dir
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingDir = resolve(repoDir, gitDir, 'commitlore', 'pending');
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(join(pendingDir, 'badbadbadbadbadbadbadbadbadbadba.json'), 'not json {{{');

    // Should not throw — exits 0 (never fails a successful commit)
    await expect(runPostCommitHook(repoDir)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Mutation oracles — these verify the exact-once and containment properties
// ---------------------------------------------------------------------------

describe('post-commit mutation oracles', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'post-commit-oracle-'));
    createTestRepo({ path: repoDir });
    writeFileSync(join(repoDir, 'file.txt'), 'hello\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoDir });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Oracle 1 (must fail): consuming BEFORE the commit succeeds
  // -----------------------------------------------------------------------

  it('ORACLE: a staged (not yet applied) record cannot be consumed — consumption requires applied phase', async () => {
    writeFileSync(join(repoDir, 'file.txt'), 'hello world\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });

    const parentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const treeOid = execFileSync('git', ['write-tree'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    // Create a STAGED (not applied) pending file — simulating pre-commit state
    const nonce = writeAppliedPendingFile(repoDir, {
      base_head: parentHead,
      staged_tree_oid: treeOid,
      phase: 'staged', // <-- NOT applied
    });

    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingPath = resolve(repoDir, gitDir, 'commitlore', 'pending', `${nonce}.json`);
    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    const trailerBlock = pending.records
      .map((rec: { trailers?: Trailer[] }) =>
        rec.trailers ? serializeTrailers(rec.trailers) : '',
      )
      .filter(Boolean)
      .join('\n');

    // Make a commit with the trailers
    execFileSync('git', ['commit', '-m', `test\n\n${trailerBlock}`], { cwd: repoDir });

    // Run post-commit — it should NOT consume because phase is 'staged', not 'applied'
    await runPostCommitHook(repoDir);

    const after = JSON.parse(readFileSync(pendingPath, 'utf8'));
    expect(after.consumed).toBe(false);
    expect(after.phase).toBe('staged');
  });

  // -----------------------------------------------------------------------
  // Oracle 2 (must fail): consuming TWICE
  // -----------------------------------------------------------------------

  it('ORACLE: an already-consumed record cannot be consumed a second time', async () => {
    writeFileSync(join(repoDir, 'file.txt'), 'hello world\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });

    const parentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const treeOid = execFileSync('git', ['write-tree'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    // Create an ALREADY CONSUMED pending file
    const nonce = writeAppliedPendingFile(repoDir, {
      base_head: parentHead,
      staged_tree_oid: treeOid,
      consumed: true,
      phase: 'consumed',
    });

    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingPath = resolve(repoDir, gitDir, 'commitlore', 'pending', `${nonce}.json`);
    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    const trailerBlock = pending.records
      .map((rec: { trailers?: Trailer[] }) =>
        rec.trailers ? serializeTrailers(rec.trailers) : '',
      )
      .filter(Boolean)
      .join('\n');

    execFileSync('git', ['commit', '-m', `test\n\n${trailerBlock}`], { cwd: repoDir });

    // Run post-commit — should NOT consume again
    await runPostCommitHook(repoDir);

    const after = JSON.parse(readFileSync(pendingPath, 'utf8'));
    // Still consumed from before, but consumed_by/consumed_at should not change
    expect(after.consumed).toBe(true);
    expect(after.phase).toBe('consumed');
    // The consumed_at should still be null from our manual setup (we didn't set it)
    expect(after.consumed_by).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Oracle 3 (must fail): overwriting a foreign post-commit hook
  // -----------------------------------------------------------------------

  it('ORACLE: installPostCommitHook refuses to overwrite a foreign post-commit hook', async () => {
    const { installPostCommitHook: installHook } = await import('../src/hooks/post-commit.js');

    // Install a foreign hook first
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const hooksDir = resolve(repoDir, gitDir, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho "I am a foreign hook"\n', { mode: 0o755 });

    // Try to install — should refuse
    const result = installHook(repoDir);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('not a commitlore hook');
    expect(result.stderr).toContain('left in place');

    // Verify the foreign hook is still there, unchanged
    const content = readFileSync(hookPath, 'utf8');
    expect(content).toContain('I am a foreign hook');
  });

  // -----------------------------------------------------------------------
  // Oracle 4 (must pass): normal consumption works correctly
  // -----------------------------------------------------------------------

  it('ORACLE: exact-once consumption succeeds when all conditions match', async () => {
    writeFileSync(join(repoDir, 'file.txt'), 'hello world\n');
    execFileSync('git', ['add', '.'], { cwd: repoDir });

    const parentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const treeOid = execFileSync('git', ['write-tree'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    const nonce = writeAppliedPendingFile(repoDir, {
      base_head: parentHead,
      staged_tree_oid: treeOid,
    });

    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const pendingPath = resolve(repoDir, gitDir, 'commitlore', 'pending', `${nonce}.json`);
    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    const trailerBlock = pending.records
      .map((rec: { trailers?: Trailer[] }) =>
        rec.trailers ? serializeTrailers(rec.trailers) : '',
      )
      .filter(Boolean)
      .join('\n');

    execFileSync('git', ['commit', '-m', `test\n\n${trailerBlock}`], { cwd: repoDir });

    await runPostCommitHook(repoDir);

    const after = JSON.parse(readFileSync(pendingPath, 'utf8'));
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    expect(after.consumed).toBe(true);
    expect(after.phase).toBe('consumed');
    expect(after.consumed_by).toBe(headSha);
    expect(after.consumed_at).not.toBeNull();
  });
});
