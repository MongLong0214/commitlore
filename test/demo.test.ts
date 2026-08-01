/**
 * T-1011 (#203): `commitlore demo` command.
 *
 * Tests that the demo creates a temporary repository, shows lifecycle
 * filtering, removes its temp directory on success and crash, never writes
 * into the user's repository, needs no network, and reports unsupported
 * platforms rather than half-running.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestRepo } from './git-fixtures.js';
import { runDemo } from '../src/commands/demo.js';

describe('commitlore demo', () => {
  /** A real git repo used as the cwd for the demo — must remain untouched. */
  let userRepo: string;
  let userRepoHeadBefore: string;
  /**
   * A temp root this suite owns, so that "the demo left nothing behind" is a
   * question about this call rather than about the machine. Asked of the
   * process-wide tmpdir it was neither: a concurrent worker holding its own
   * `commitlore-demo-*` directory during the assertion window answered it, and
   * turned the two cleanup tests red for a reason unrelated to `runDemo` (#364).
   * Keeping the demo under this root also stops the suite leaking that prefix
   * into the shared tmpdir, where another checkout's run would read it.
   */
  let demoRoot: string;

  beforeAll(() => {
    demoRoot = mkdtempSync(join(tmpdir(), 'demo-tmproot-'));
    userRepo = mkdtempSync(join(tmpdir(), 'demo-user-repo-'));
    createTestRepo({ path: userRepo });
    // Create an initial commit so HEAD exists
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: userRepo });
    userRepoHeadBefore = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: userRepo,
      encoding: 'utf8',
    }).trim();
  });

  afterAll(() => {
    rmSync(userRepo, { recursive: true, force: true });
    rmSync(demoRoot, { recursive: true, force: true });
  });

  it('demo runs without error on a supported platform', async () => {
    const result = await runDemo({ cwd: userRepo, tmpRoot: demoRoot });
    expect(result.exitCode).toBe(0);
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('output shows lifecycle filtering — active record present, superseded excluded', async () => {
    const result = await runDemo({ cwd: userRepo, tmpRoot: demoRoot });
    // The active record (r-demo02, SQLite) should be visible
    expect(result.output).toContain('r-demo02');
    // The superseded record (r-demo01, Redis predecessor) should be filtered out
    expect(result.output).not.toContain('r-demo01');
  });

  it('temporary directory does not exist after successful completion', async () => {
    // A root used by this case alone, so emptiness is the whole assertion —
    // no prefix filter, and nothing anyone else wrote can satisfy or break it.
    const caseRoot = mkdtempSync(join(demoRoot, 'success-'));
    await runDemo({ cwd: userRepo, tmpRoot: caseRoot });
    expect(readdirSync(caseRoot)).toEqual([]);
  });

  it('temporary directory is gone after a simulated crash (safety property)', async () => {
    const caseRoot = mkdtempSync(join(demoRoot, 'crash-'));
    // Inject a crash trigger — runDemo with crashTest: true throws mid-execution
    try {
      await runDemo({ cwd: userRepo, crashTest: true, tmpRoot: caseRoot });
    } catch {
      // Expected to throw
    }
    // But the temp directory must still be cleaned up
    expect(readdirSync(caseRoot)).toEqual([]);
  });

  it('user repository is never written to (safety property)', async () => {
    await runDemo({ cwd: userRepo, tmpRoot: demoRoot });
    // HEAD must be unchanged
    const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: userRepo,
      encoding: 'utf8',
    }).trim();
    expect(headAfter).toBe(userRepoHeadBefore);
    // No .git/commitlore directory should appear in the user repo
    expect(existsSync(join(userRepo, '.git', 'commitlore'))).toBe(false);
    // No new untracked files
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: userRepo,
      encoding: 'utf8',
    }).trim();
    expect(status).toBe('');
  });

  it('on an unsupported platform prints a reason and exits non-zero', async () => {
    const result = await runDemo({ cwd: userRepo, tmpRoot: demoRoot, platformOverride: 'win32' });
    expect(result.exitCode).toBe(1);
    expect(result.output.toLowerCase()).toContain('not supported');
  });

  it('completes in under 30 seconds', async () => {
    const start = Date.now();
    await runDemo({ cwd: userRepo, tmpRoot: demoRoot });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(30_000);
  });
});
