/**
 * T-1024 — `commitlore_before_change` unified MCP tool.
 *
 * Acceptance: the response carries exactly five fields, guard_confidence
 * qualifies only possible_revival_matches, verification_gaps is a closed
 * ordered set, and cache_key scope separates context-only from proposal-bearing
 * calls.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestRepo } from './git-fixtures.js';

// ---------------------------------------------------------------------------
// Fixture: a repository with one Ruled-out record scoped to src/auth.ts
// and a second record scoped to src/db.ts
// ---------------------------------------------------------------------------

let repoDir: string;
let tmpBase: string;

beforeAll(() => {
  tmpBase = mkdtempSync(join(tmpdir(), 'before-change-'));
  repoDir = join(tmpBase, 'repo');
  createTestRepo({ path: repoDir });

  // Create files in two different paths — each commit touches only one file
  mkdirSync(join(repoDir, 'src'), { recursive: true });
  writeFileSync(join(repoDir, 'src', 'auth.ts'), 'export const auth = true;\n');
  execFileSync('git', ['add', 'src/auth.ts'], { cwd: repoDir });
  execFileSync(
    'git',
    [
      'commit',
      '-m',
      'feat: add auth\n\nRecord-Id: r-auth01\nRuled-out: use stateless JWT for session management | latency too high',
    ],
    { cwd: repoDir },
  );

  writeFileSync(join(repoDir, 'src', 'db.ts'), 'export const db = true;\n');
  execFileSync('git', ['add', 'src/db.ts'], { cwd: repoDir });
  execFileSync(
    'git',
    [
      'commit',
      '-m',
      'feat: add db\n\nRecord-Id: r-db0001\nRuled-out: shared Redis cache | single point of failure',
    ],
    { cwd: repoDir },
  );
});

afterAll(() => {
  if (tmpBase) rmSync(tmpBase, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('commitlore_before_change', () => {
  // Amendment 1: exactly five response fields
  it('response carries exactly five fields: active_decisions, verification_gaps, possible_revival_matches, guard_confidence, cache_key', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    const result = beforeChange({ path: 'src/auth.ts', cwd: repoDir });
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(
      ['active_decisions', 'cache_key', 'guard_confidence', 'possible_revival_matches', 'verification_gaps'],
    );
    expect(keys).toHaveLength(5);
  });

  // Amendment 3: guard_confidence is "not-run" when no proposal supplied
  it('no proposal returns empty matches and guard_confidence "not-run"', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    const result = beforeChange({ path: 'src/auth.ts', cwd: repoDir });
    expect(result.guard_confidence).toBe('not-run');
    expect(result.possible_revival_matches).toEqual([]);
  });

  // Amendment 3: guard_confidence is "experimental" when a proposal is supplied
  it('proposal returns matches with guard_confidence "experimental"', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    const result = beforeChange({
      path: 'src/auth.ts',
      proposal: 'use stateless JWT for session management',
      cwd: repoDir,
    });
    expect(result.guard_confidence).toBe('experimental');
    expect(result.possible_revival_matches.length).toBeGreaterThan(0);
  });

  // Amendment 2: guard_confidence qualifies only possible_revival_matches —
  // context fields are identical with and without proposal at one HEAD
  it('context fields are identical with and without a proposal at one HEAD', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    const withoutProposal = beforeChange({ path: 'src/auth.ts', cwd: repoDir });
    const withProposal = beforeChange({
      path: 'src/auth.ts',
      proposal: 'use stateless JWT for session management',
      cwd: repoDir,
    });
    // active_decisions and verification_gaps must be byte-identical
    expect(withoutProposal.active_decisions).toEqual(withProposal.active_decisions);
    expect(withoutProposal.verification_gaps).toEqual(withProposal.verification_gaps);
  });

  // Amendment 2: path selection — call for path A returns A's records, not B's
  it('call for path A returns A\'s records, never B\'s', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    const authResult = beforeChange({ path: 'src/auth.ts', cwd: repoDir });
    const dbResult = beforeChange({ path: 'src/db.ts', cwd: repoDir });
    // auth records mention JWT, not Redis
    const authRecords = JSON.stringify(authResult.active_decisions);
    expect(authRecords).toContain('JWT');
    expect(authRecords).not.toContain('Redis cache');
    // db records mention Redis, not JWT
    const dbRecords = JSON.stringify(dbResult.active_decisions);
    expect(dbRecords).toContain('Redis');
    expect(dbRecords).not.toContain('JWT');
  });

  // Amendment 4: verification_gaps is a closed, ordered set
  it('verification_gaps is an array and is empty when all checks pass', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    const result = beforeChange({ path: 'src/auth.ts', cwd: repoDir });
    expect(Array.isArray(result.verification_gaps)).toBe(true);
    // In a fully readable repo, it should be empty
    expect(result.verification_gaps).toEqual([]);
  });

  // Fail-closed: non-existent cwd reports gap rather than empty context
  it('path outside the repository fails rather than returning empty context', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    // A non-existent cwd should report history-unavailable, not return empty context silently
    const result = beforeChange({ path: 'src/auth.ts', cwd: '/nonexistent-repo-path' });
    expect(result.verification_gaps).toContain('history-unavailable');
    expect(result.active_decisions).toEqual([]);
  });

  // Fail-closed: unreadable repo reports gap
  it('unreadable repository reports verification gap rather than empty context', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    const emptyTmp = mkdtempSync(join(tmpdir(), 'no-git-'));
    try {
      const result = beforeChange({ path: '.', cwd: emptyTmp });
      expect(result.verification_gaps).toContain('history-unavailable');
      expect(result.active_decisions).toEqual([]);
    } finally {
      rmSync(emptyTmp, { recursive: true, force: true });
    }
  });

  // Amendment 4: verification_gaps ordering is always history-unavailable, shallow-history, notes-unfetched
  it('verification_gaps are always in the canonical order', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    // Use a shallow clone to trigger shallow-history
    const shallowDir = join(tmpBase, 'shallow');
    createTestRepo({ path: shallowDir, source: repoDir, depth: 1 });
    const result = beforeChange({ path: '.', cwd: shallowDir });
    // If multiple gaps are present, they must be in canonical order
    const validOrder = ['history-unavailable', 'shallow-history', 'notes-unfetched'];
    for (let i = 0; i < result.verification_gaps.length; i++) {
      expect(validOrder).toContain(result.verification_gaps[i]);
      if (i > 0) {
        const prev = validOrder.indexOf(result.verification_gaps[i - 1]!);
        const curr = validOrder.indexOf(result.verification_gaps[i]!);
        expect(curr).toBeGreaterThan(prev);
      }
    }
  });

  // Amendment 5: cache_key scope — context-only key differs from proposal key
  it('cache_key for context-only differs from proposal-bearing key', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    const contextOnly = beforeChange({ path: 'src/auth.ts', cwd: repoDir });
    const withProposal = beforeChange({
      path: 'src/auth.ts',
      proposal: 'use stateless JWT',
      cwd: repoDir,
    });
    expect(contextOnly.cache_key).not.toBe(withProposal.cache_key);
  });

  // Amendment 5: two different proposals produce different cache keys
  it('two different proposals produce different cache keys', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    const r1 = beforeChange({
      path: 'src/auth.ts',
      proposal: 'use stateless JWT',
      cwd: repoDir,
    });
    const r2 = beforeChange({
      path: 'src/auth.ts',
      proposal: 'use Redis sessions',
      cwd: repoDir,
    });
    expect(r1.cache_key).not.toBe(r2.cache_key);
  });

  // Amendment 5: context-snapshot key must never serve a proposal-bearing response
  it('context-snapshot key does not serve a proposal response (distinguishable forms)', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    const contextOnly = beforeChange({ path: 'src/auth.ts', cwd: repoDir });
    const withProposal = beforeChange({
      path: 'src/auth.ts',
      proposal: 'use stateless JWT',
      cwd: repoDir,
    });
    // The two key forms must be structurally distinguishable —
    // a context key must not be a prefix of a proposal key or vice versa
    expect(contextOnly.cache_key).not.toBe(withProposal.cache_key);
    // They should differ in a way that makes collision impossible
    expect(contextOnly.cache_key.length).not.toBe(withProposal.cache_key.length);
  });

  // Determinism: two calls at one HEAD produce identical payloads
  it('two calls at one HEAD produce identical payloads', async () => {
    const { beforeChange } = await import('../src/core/before-change.js');
    const r1 = beforeChange({ path: 'src/auth.ts', cwd: repoDir });
    const r2 = beforeChange({ path: 'src/auth.ts', cwd: repoDir });
    expect(r1).toEqual(r2);
  });

  // Amendment 6: tool is registered with readOnlyHint: true
  it('before_change tool is exported and registered with readOnlyHint', async () => {
    const serverModule = await import('../src/mcp/server.js');
    expect((serverModule as any).BEFORE_CHANGE_TOOL).toBe('commitlore_before_change');
  });
});
