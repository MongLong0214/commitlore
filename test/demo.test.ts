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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
    // The active record (r-price02, separate admin quote path) should be visible
    expect(result.output).toContain('r-price02');
    // The superseded record (r-price01, reuse calculatePrice) should be filtered out
    expect(result.output).not.toContain('r-price01');
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

  /**
   * bug-issue-1163. The crash-cleanup test went red once in CI naming a
   * leftover `commitlore-demo-*` directory, passed on re-run of the same
   * commit, and passed on the other node leg of the same run. Nothing said why,
   * because `cleanup` discarded the `rmSync` error — so the one occurrence
   * carried no errno, and a race, a permission and a full disk were
   * indistinguishable from each other and from "the removal never ran".
   *
   * The failure is injected rather than provoked: a real race is not reliably
   * reproducible, and a test that waits for one would be the flake it is meant
   * to explain. What is pinned here is the reporting — a cleanup that fails
   * says so, naming the directory and the reason — plus the repository setting
   * that removes the most plausible writer.
   */
  it('reports a cleanup failure instead of discarding it (bug-issue-1163)', async () => {
    const caseRoot = mkdtempSync(join(demoRoot, 'cleanupfail-'));
    const stderr: string[] = [];

    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        default: actual,
        rmSync: (): never => {
          throw Object.assign(
            new Error(`EACCES: permission denied, rmdir '${caseRoot}/injected'`),
            { code: 'EACCES' },
          );
        },
      };
    });

    try {
      const { runDemo: isolated } = await import('../src/commands/demo.js');
      const spy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: unknown): boolean => {
          stderr.push(String(chunk));
          return true;
        });

      let thrown: unknown;
      try {
        await isolated({ cwd: userRepo, crashTest: true, tmpRoot: caseRoot });
      } catch (error) {
        thrown = error;
      } finally {
        spy.mockRestore();
      }

      // The error being unwound still reaches the caller: reporting the cleanup
      // failure must not replace the reason the run ended.
      expect((thrown as Error | undefined)?.message).toContain('simulated crash');

      const reported = stderr.join('');
      expect(reported).toContain('could not remove');
      // The two things the CI occurrence lacked: which directory, and why.
      expect(reported).toContain(caseRoot);
      expect(reported).toContain('EACCES');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }

    // Arrival: the injection really did stop the removal, so the assertions
    // above were made about a cleanup that failed rather than one that never
    // happened. The directory is also the artifact the next assertion reads.
    const leftOver = readdirSync(caseRoot);
    expect(leftOver).toHaveLength(1);
    const repo = join(caseRoot, leftOver[0] as string);

    // The demo's repository forbids background maintenance, so `git commit`
    // cannot leave a process writing inside the directory that is about to be
    // removed — the mechanism this issue's one occurrence is most consistent
    // with.
    const config = (key: string): string =>
      execFileSync('git', ['-C', repo, 'config', '--get', key], { encoding: 'utf8' }).trim();
    expect(config('gc.auto')).toBe('0');
    expect(config('maintenance.auto')).toBe('false');

    rmSync(caseRoot, { recursive: true, force: true });
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

describe('the demo does not claim more than the product does', () => {
  // `commitlore demo` is the first thing many people run, so it is the last
  // place to overstate. It used to end with "the agent cannot revive it" -- an
  // absolute about a model's reasoning, from a tool that controls what is
  // delivered and nothing else. Nothing owned that sentence, so it survived
  // every run until a reader caught it. These tests own it now.
  let repo: string;
  let root: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'demo-claims-repo-'));
    root = mkdtempSync(join(tmpdir(), 'demo-claims-root-'));
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', repo]);
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.invalid']);
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test']);
    execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '--quiet', '-m', 'root']);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it.each(['cannot revive', 'prevents', 'never forgets', 'blocks the edit'])(
    'does not say %o',
    async (claim) => {
      const { output } = await runDemo({ cwd: repo, tmpRoot: root });
      expect(output.toLowerCase()).not.toContain(claim);
    },
  );

  it('says what actually happens to the superseded record', async () => {
    const { output } = await runDemo({ cwd: repo, tmpRoot: root });
    expect(output).toContain('remains in Git');
    expect(output).toContain('not delivered as current guidance');
  });
});
