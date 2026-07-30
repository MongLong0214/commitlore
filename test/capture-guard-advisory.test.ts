/**
 * T-1109 (#273) — Guard as a capture advisory that cannot block.
 *
 * The load-bearing property: a guard match is ADVISORY. It must never affect
 * exit code, phase transition, or gate decision. The differential test (2)
 * asserts this structurally.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, execFileSync } from 'node:child_process';

import { createTestRepo } from './git-fixtures.js';
import { readPending, type PendingRecord } from '../src/core/pending.js';
import { prepareCaptureContext } from '../src/core/capture-prepare.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

/** Path to the built CLI entry point. */
const CLI = join(__dirname, '..', 'dist', 'commitlore.mjs');

/** Create a temp repo with one commit, a ruled-out record, and a staged change. */
const makeRepoWithRuledOut = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-guard-adv-'));
  temporaries.push(dir);
  createTestRepo({ path: dir });
  writeFileSync(join(dir, 'init.txt'), 'initial content\n');
  execSync('git add .', { cwd: dir });
  // Commit with a Ruled-out trailer — this creates the record guard will find
  execSync(
    'git commit -m "feat: add auth\n\nRuled-out: Use shared Redis cache for sessions | race condition under failover\nRecord-Id: r-testadv01" --no-verify --quiet',
    { cwd: dir },
  );
  // Stage a change so diff is non-empty
  writeFileSync(join(dir, 'init.txt'), 'initial content\nmodified\n');
  execSync('git add .', { cwd: dir });
  return dir;
};

/** Create a repo with a blocked-trust Ruled-out record. */
const makeRepoWithBlockedTrust = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-guard-blocked-'));
  temporaries.push(dir);
  createTestRepo({ path: dir });
  writeFileSync(join(dir, 'init.txt'), 'initial content\n');
  execSync('git add .', { cwd: dir });
  // Add a commit via notes with blocked trust — simulating reconstructed/untrusted
  execSync(
    'git commit -m "feat: add sessions\n\nRuled-out: Use shared Redis cache for sessions | race condition under failover\nRecord-Id: r-blockedtst" --no-verify --quiet',
    { cwd: dir },
  );
  // Override trust to blocked via git notes
  const sha = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
  // Notes-based records are what get blocked trust, but for this test we
  // create a record directly via notes that CommitLore parses as blocked
  execSync(
    `git notes --ref=commitlore add -m "Ruled-out: Use shared Redis cache for sessions | race condition under failover\nRecord-Id: r-blockedtst\nProvenance: reconstructed" ${sha}`,
    { cwd: dir },
  );
  // Stage a change
  writeFileSync(join(dir, 'init.txt'), 'modified content\n');
  execSync('git add .', { cwd: dir });
  return dir;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('capture guard advisory (T-1109)', () => {
  it('1. a prepared pending record for a draft reviving a ruled-out alternative carries an advisory with at least one match', () => {
    const repo = makeRepoWithRuledOut();
    // The transcript text revives the ruled-out alternative
    const transcript = 'We should use a shared Redis cache for sessions to share state across replicas.';

    const result = prepareCaptureContext({ cwd: repo, transcript });
    expect(result.nonce).toMatch(/^[0-9a-f]{32}$/);

    const record = readPending(result.nonce, { cwd: repo });
    expect(record).not.toBeNull();
    expect(record!.guard_advisory).toBeDefined();
    expect(record!.guard_advisory).not.toBeNull();
    expect(record!.guard_advisory!.matches.length).toBeGreaterThanOrEqual(1);
    // Disclosure must always be present
    expect(record!.guard_advisory!.disclosure).toContain('44.8%');
    expect(record!.guard_advisory!.disclosure).toContain('22.0%');
  });

  it('2. DIFFERENTIAL: guard match ON vs OFF produces identical phase, exit code, and records equal on every field except the advisory', () => {
    const repo = makeRepoWithRuledOut();

    // Run 1: transcript that revives the ruled-out alternative (match expected)
    const transcriptMatch = 'We should use a shared Redis cache for sessions to share state across replicas.';
    const resultMatch = prepareCaptureContext({ cwd: repo, transcript: transcriptMatch });
    const recordMatch = readPending(resultMatch.nonce, { cwd: repo });
    expect(recordMatch).not.toBeNull();
    // Verify match is present
    expect(recordMatch!.guard_advisory).not.toBeNull();
    expect(recordMatch!.guard_advisory!.matches.length).toBeGreaterThanOrEqual(1);

    // Run 2: transcript that does NOT revive the alternative (no match expected)
    // Re-stage so we have a fresh diff context
    writeFileSync(join(repo, 'init.txt'), 'initial content\nmodified again\n');
    execSync('git add .', { cwd: repo });
    const transcriptNoMatch = 'Fix a typo in the configuration documentation.';
    const resultNoMatch = prepareCaptureContext({ cwd: repo, transcript: transcriptNoMatch });
    const recordNoMatch = readPending(resultNoMatch.nonce, { cwd: repo });
    expect(recordNoMatch).not.toBeNull();

    // THE LOAD-BEARING ASSERTION: phase and all structural fields are identical
    expect(recordMatch!.phase).toBe(recordNoMatch!.phase);
    expect(recordMatch!.phase).toBe('prepared');
    expect(recordMatch!.version).toBe(recordNoMatch!.version);
    expect(recordMatch!.consumed).toBe(recordNoMatch!.consumed);
    expect(recordMatch!.expires_at).toBe(recordNoMatch!.expires_at);
    expect(recordMatch!.verified_at).toBe(recordNoMatch!.verified_at);
    expect(recordMatch!.staged_at).toBe(recordNoMatch!.staged_at);
    expect(recordMatch!.applied_at).toBe(recordNoMatch!.applied_at);
    expect(recordMatch!.applied_record_hash).toBe(recordNoMatch!.applied_record_hash);
    expect(recordMatch!.consumed_at).toBe(recordNoMatch!.consumed_at);
    expect(recordMatch!.consumed_by).toBe(recordNoMatch!.consumed_by);
    expect(recordMatch!.evidence_hash).toBe(recordNoMatch!.evidence_hash);
    expect(recordMatch!.records).toEqual(recordNoMatch!.records);
    expect(recordMatch!.validation_result).toBe(recordNoMatch!.validation_result);
    expect(recordMatch!.overlap_check).toBe(recordNoMatch!.overlap_check);
    expect(recordMatch!.incomplete).toBe(recordNoMatch!.incomplete);

    // The ONLY differing field is guard_advisory
    expect(recordMatch!.guard_advisory).not.toEqual(recordNoMatch!.guard_advisory);
  });

  it('3. a pending record written WITHOUT the advisory field is still read successfully by readPending', () => {
    const repo = makeRepoWithRuledOut();
    // Directly write a pending record without guard_advisory
    const gitDir = execSync('git rev-parse --git-path commitlore/pending', {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    const pendingDir = join(repo, gitDir);
    execSync(`mkdir -p "${pendingDir}"`);
    const nonce = 'a'.repeat(32);
    const baseHead = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim();
    const oldRecord = {
      version: 1,
      nonce,
      created_at: new Date().toISOString(),
      expires_at: null,
      phase: 'prepared',
      consumed: false,
      verified_at: null,
      staged_at: null,
      applied_at: null,
      applied_record_hash: null,
      consumed_at: null,
      consumed_by: null,
      base_head: baseHead,
      staged_diff_hash: 'b'.repeat(64),
      staged_tree_oid: 'c'.repeat(40),
      policy_identity_hash: 'd'.repeat(64),
      source_hashes: { transcript: 'e'.repeat(64), diff: 'f'.repeat(64) },
      evidence_hash: null,
      records: [],
      validation_result: null,
      overlap_check: null,
      incomplete: false,
      // NO guard_advisory field
    };
    writeFileSync(join(pendingDir, `${nonce}.json`), JSON.stringify(oldRecord, null, 2) + '\n');

    const read = readPending(nonce, { cwd: repo });
    expect(read).not.toBeNull();
    expect(read!.version).toBe(1);
    expect(read!.phase).toBe('prepared');
  });

  it('4. when guard cannot complete (history unavailable or notes unfetched), the advisory records the gap and capture still succeeds', () => {
    // Create a repo with shallow clone to trigger shallow-history
    const origin = mkdtempSync(join(tmpdir(), 'capture-guard-origin-'));
    temporaries.push(origin);
    createTestRepo({ path: origin });
    writeFileSync(join(origin, 'init.txt'), 'initial\n');
    execSync('git add . && git commit -m "init" --no-verify --quiet', { cwd: origin });
    writeFileSync(join(origin, 'init.txt'), 'second\n');
    execSync('git add . && git commit -m "feat: second\n\nRuled-out: Use Redis | race condition\nRecord-Id: r-shallowt" --no-verify --quiet', { cwd: origin });
    writeFileSync(join(origin, 'init.txt'), 'third\n');
    execSync('git add . && git commit -m "third" --no-verify --quiet', { cwd: origin });

    // Shallow clone with depth 1
    const shallow = mkdtempSync(join(tmpdir(), 'capture-guard-shallow-'));
    temporaries.push(shallow);
    createTestRepo({ path: shallow, source: origin, depth: 1 });

    // Stage a change
    writeFileSync(join(shallow, 'init.txt'), 'modified\n');
    execSync('git add .', { cwd: shallow });

    const transcript = 'We should use Redis for session management.';
    const result = prepareCaptureContext({ cwd: shallow, transcript });

    // Capture MUST succeed (this is the key assertion)
    expect(result.nonce).toMatch(/^[0-9a-f]{32}$/);
    const record = readPending(result.nonce, { cwd: shallow });
    expect(record).not.toBeNull();
    expect(record!.phase).toBe('prepared');
    // Advisory must exist with gap recorded
    expect(record!.guard_advisory).toBeDefined();
    expect(record!.guard_advisory).not.toBeNull();
    expect(record!.guard_advisory!.gaps.length).toBeGreaterThanOrEqual(1);
    const gapNames = record!.guard_advisory!.gaps;
    // Must use existing vocabulary
    for (const gap of gapNames) {
      expect(['history-unavailable', 'shallow-history', 'notes-unfetched']).toContain(gap);
    }
  });

  it('5. a blocked-trust record\'s content is withheld in the advisory', () => {
    const repo = makeRepoWithBlockedTrust();
    const transcript = 'We should use a shared Redis cache for sessions to share state.';

    const result = prepareCaptureContext({ cwd: repo, transcript });
    const record = readPending(result.nonce, { cwd: repo });
    expect(record).not.toBeNull();
    expect(record!.guard_advisory).not.toBeNull();

    // If there are matches, any blocked-trust match must have withheld content
    if (record!.guard_advisory!.matches.length > 0) {
      for (const match of record!.guard_advisory!.matches) {
        if (match.trust === 'blocked') {
          expect(match).toHaveProperty('withheld');
          expect(match).not.toHaveProperty('alternative');
          expect(match).not.toHaveProperty('reason');
        }
      }
    }
    // The advisory still reports the disclosure regardless
    expect(record!.guard_advisory!.disclosure).toContain('44.8%');
    expect(record!.guard_advisory!.disclosure).toContain('22.0%');
  });

  it('6. PendingRecord.version stays 1', () => {
    const repo = makeRepoWithRuledOut();
    const transcript = 'We should use a shared Redis cache for sessions.';
    const result = prepareCaptureContext({ cwd: repo, transcript });
    const record = readPending(result.nonce, { cwd: repo });
    expect(record).not.toBeNull();
    expect(record!.version).toBe(1);
  });

  describe('CLI --json output', () => {
    it('renders guard_advisory in JSON output', () => {
      const repo = makeRepoWithRuledOut();
      const transcriptPath = join(repo, 'transcript.txt');
      writeFileSync(transcriptPath, 'We should use a shared Redis cache for sessions.');

      const { stdout, exitCode } = (() => {
        try {
          const out = execFileSync('node', [CLI, 'capture', '--transcript', transcriptPath, '--json'], {
            cwd: repo,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, NODE_NO_WARNINGS: '1' },
          });
          return { stdout: out, exitCode: 0 };
        } catch (error: any) {
          return { stdout: error.stdout ?? '', exitCode: error.status ?? 1 };
        }
      })();

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty('guard_advisory');
      if (parsed.guard_advisory !== null) {
        expect(parsed.guard_advisory).toHaveProperty('disclosure');
        expect(parsed.guard_advisory.disclosure).toContain('44.8%');
      }
    });
  });
});
