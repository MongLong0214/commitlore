/**
 * The `pre-push` hook, exercised through an actual `git push`.
 *
 * `test/sync.test.ts` calls `syncNotes` directly, which is the wrong shape for
 * the two properties that matter about the hook: that a real push survives it,
 * and that it does not re-enter itself.
 *
 * It re-entered itself. `git push` inside a `pre-push` hook fires `pre-push`
 * again, and the first version of this shipped a plain `git push` — measured at
 * 1,240 hook invocations in 40 seconds, never returning. Every property below
 * is asserted against `git push` rather than against a function, because that
 * defect is invisible from one.
 *
 * The push runs with a deadline. A hang must fail the test, not hang the suite.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { NOTES_REF, writeRecord } from '../src/core/notes.js';
import { installPrePushHook } from '../src/hooks/pre-push.js';
import { createTestRepo } from './git-fixtures.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO_ROOT, 'dist', 'cli.js');

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[]): string => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout;
};

/** A deadline, because the defect this file exists for is a hang. */
const PUSH_DEADLINE_MS = 30_000;

const pushWithDeadline = (
  cwd: string,
): Promise<{ code: number | null; timedOut: boolean; stderr: string }> =>
  new Promise((resolveResult) => {
    const child = spawn('git', ['push', 'origin', 'HEAD:refs/heads/main'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // No `COMMITLORE_BIN`. The stub resolves through the `commitlore.bin` /
      // `commitlore.node` / `commitlore.root` triple `hooks install` records,
      // which is the path a real installation takes — and the only one that
      // names its own interpreter. Pointing the env var at `dist/cli.js`
      // instead runs the file directly, and that file is not executable.
      env: process.env,
    });
    let err = '';
    child.stderr?.on('data', (chunk) => { err += String(chunk); });
    child.stdout?.on('data', () => {});
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolveResult({ code: null, timedOut: true, stderr: err });
    }, PUSH_DEADLINE_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolveResult({ code, timedOut: false, stderr: err });
    });
  });

/** A clone with a local bare "remote", the hook installed, and one commit pushed. */
const repoWithHook = (label: string): { repo: string; origin: string } => {
  const origin = createTestRepo({ path: temp(`${label}-origin`), bare: true });
  const repo = createTestRepo({ path: temp(label) });
  git(repo, ['config', 'user.email', `${label}@example.invalid`]);
  git(repo, ['config', 'user.name', label]);

  writeFileSync(join(repo, 'src.ts'), 'export const a = 1;\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'init']);
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);

  // Run as a subprocess, not in-process. `hooks install` records
  // `commitlore.bin` from the entry point it is running as, and inside a vitest
  // worker that is tinypool's process entry — the hook then re-enters the test
  // runner instead of the CLI. Spawning the real CLI records the real path,
  // which is also what a user's install does.
  execFileSync(process.execPath, [CLI, 'hooks', 'install'], { cwd: repo, stdio: 'ignore' });
  const installed = installPrePushHook(repo);
  expect(installed.code, installed.stderr).toBe(0);
  return { repo, origin };
};

const advance = (repo: string, body: string): void => {
  writeFileSync(join(repo, 'src.ts'), body);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'advance']);
};

describe('the pre-push hook publishes the mirror without re-entering itself', () => {
  it('does not recurse: the push completes', async () => {
    const { repo } = repoWithHook('prepush-recursion');
    writeRecord(git(repo, ['rev-parse', 'HEAD']).trim(), [{ key: 'Warn', value: 'published' }], {
      cwd: repo,
    });
    advance(repo, 'export const a = 2;\n');

    const result = await pushWithDeadline(repo);
    expect(result.timedOut, 'the push never returned — the hook re-entered itself').toBe(false);
    expect(result.code).toBe(0);
  }, 60_000);

  it('publishes the mirror to the remote', async () => {
    const { repo, origin } = repoWithHook('prepush-publish');
    const sha = git(repo, ['rev-parse', 'HEAD']).trim();
    writeRecord(sha, [{ key: 'Warn', value: 'carried by the hook' }], { cwd: repo });
    advance(repo, 'export const a = 3;\n');

    const result = await pushWithDeadline(repo);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);

    // The mirror reached the remote, without anyone running a sync command.
    expect(execGit(['rev-parse', '--verify', '--quiet', NOTES_REF], { cwd: origin }).code).toBe(0);
  }, 60_000);

  it('a repository with nothing to publish still pushes cleanly', async () => {
    const { repo } = repoWithHook('prepush-empty');
    advance(repo, 'export const a = 4;\n');

    const result = await pushWithDeadline(repo);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
  }, 60_000);

  /**
   * The contract that outranks publishing: a mirror that cannot be synced must
   * not cost the user their push. Here the notes ref points at an object the
   * remote will refuse, so the sync fails and the code push must not.
   */
  it('a failing sync does not fail the push', async () => {
    const { repo } = repoWithHook('prepush-sync-fails');
    writeRecord(git(repo, ['rev-parse', 'HEAD']).trim(), [{ key: 'Warn', value: 'local' }], {
      cwd: repo,
    });
    advance(repo, 'export const a = 5;\n');
    // A second remote that does not exist. `syncNotes` walks every remote, so
    // this one fails while `origin` — the one being pushed to — is fine.
    git(repo, ['remote', 'add', 'broken', join(temp('gone'), 'nowhere.git')]);

    const result = await pushWithDeadline(repo);
    expect(result.timedOut).toBe(false);
    expect(result.code, 'a notes failure took the code push down with it').toBe(0);
  }, 60_000);
});
