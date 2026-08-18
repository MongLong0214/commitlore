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
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { NOTES_REF, writeRecord } from '../src/core/notes.js';
import { installPrePushHook, PRE_PUSH_NOTES_SYNC_TIMEOUT_MS } from '../src/hooks/pre-push.js';
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
  env: NodeJS.ProcessEnv = process.env,
  deadlineMs = PUSH_DEADLINE_MS,
): Promise<{ code: number | null; timedOut: boolean; stderr: string; elapsedMs: number }> =>
  new Promise((resolveResult) => {
    const started = performance.now();
    const child = spawn('git', ['push', '--quiet', 'origin', 'HEAD:refs/heads/main'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // No `COMMITLORE_BIN`. The stub resolves through the `commitlore.bin` /
      // `commitlore.node` / `commitlore.root` triple `hooks install` records,
      // which is the path a real installation takes — and the only one that
      // names its own interpreter. Pointing the env var at `dist/cli.js`
      // instead runs the file directly, and that file is not executable.
      env,
    });
    let err = '';
    child.stderr?.on('data', (chunk) => { err += String(chunk); });
    child.stdout?.on('data', () => {});
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolveResult({ code: null, timedOut: true, stderr: err, elapsedMs: performance.now() - started });
    }, deadlineMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolveResult({ code, timedOut: false, stderr: err, elapsedMs: performance.now() - started });
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

/** Keep the branch remote usable while making only notes sync use this URL. */
const failNotesFetchOnly = (repo: string, origin: string, fetchUrl: string): void => {
  git(repo, ['remote', 'set-url', 'origin', fetchUrl]);
  git(repo, ['remote', 'set-url', '--push', 'origin', origin]);
};

const commitloreLines = (stderr: string): string[] =>
  stderr.split('\n').filter((line) => line.startsWith('commitlore:'));

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
    expect(result.stderr, 'a successful notes sync should be silent').toBe('');

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
    const { repo, origin } = repoWithHook('prepush-sync-fails');
    writeRecord(git(repo, ['rev-parse', 'HEAD']).trim(), [{ key: 'Warn', value: 'local' }], {
      cwd: repo,
    });
    advance(repo, 'export const a = 5;\n');
    // A refused loopback connection is an unreachable transport, rather than
    // the ordinary "remote has no notes ref" state that sync accepts.
    failNotesFetchOnly(repo, origin, 'http://127.0.0.1:1/nowhere.git');

    const result = await pushWithDeadline(repo);
    expect(result.timedOut).toBe(false);
    expect(result.code, 'a notes failure took the code push down with it').toBe(0);
    const lines = commitloreLines(result.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('notes mirror (origin) failed');
    expect(lines[0], 'the operator is told the branch went out').toContain('The branch was pushed');
    expect(lines[0], 'and what became of the records, and whether to act').toContain('retries this automatically');
  }, 60_000);

  it('bounds a hanging notes transport without holding the branch push', async () => {
    const { repo, origin } = repoWithHook('prepush-hanging-transport');
    writeRecord(git(repo, ['rev-parse', 'HEAD']).trim(), [{ key: 'Warn', value: 'local' }], { cwd: repo });
    advance(repo, 'export const a = 6;\n');
    const ssh = join(temp('hanging-ssh'), 'ssh-that-never-answers.sh');
    // Exit as soon as Git dies so the timeout test cannot leak a sleeping
    // transport child after the process under test has returned.
    writeFileSync(ssh, '#!/bin/sh\nparent=$PPID\nwhile kill -0 "$parent" 2>/dev/null; do sleep 0.1; done\n');
    chmodSync(ssh, 0o755);
    failNotesFetchOnly(repo, origin, 'ssh://git@example.invalid/commitlore.git');

    const result = await pushWithDeadline(
      repo,
      { ...process.env, GIT_SSH_COMMAND: ssh },
      PRE_PUSH_NOTES_SYNC_TIMEOUT_MS * 3,
    );
    expect(result.timedOut, 'the branch push exceeded its outer deadline').toBe(false);
    expect(result.code).toBe(0);
    expect(result.elapsedMs).toBeLessThan(PRE_PUSH_NOTES_SYNC_TIMEOUT_MS * 3);
    const lines = commitloreLines(result.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0], 'the operator is told the branch went out').toContain('The branch was pushed');
    expect(lines[0], 'and what became of the records, and whether to act').toContain('retries this automatically');
    // The budget is this hook's, so the line has to own it. `spawnSync git
    // ETIMEDOUT` names the call that returned rather than the decision that was
    // made, and it reads as git having failed -- which sends an operator to look
    // at a transport that is fine. #746 is the same shape in the commit-msg hook.
    expect(lines[0], 'the line still leaks the raw child-process code').not.toMatch(/ETIMEDOUT|spawnSync/);
    expect(lines[0], 'and it does not say whose budget ran out').toContain(
      `the ${PRE_PUSH_NOTES_SYNC_TIMEOUT_MS / 1000}s this hook waits for the remote ran out`,
    );
  }, 60_000);

  it('disables terminal credential prompts and still lets the branch push through', async () => {
    const { repo, origin } = repoWithHook('prepush-auth-prompt');
    writeRecord(git(repo, ['rev-parse', 'HEAD']).trim(), [{ key: 'Warn', value: 'local' }], { cwd: repo });
    advance(repo, 'export const a = 7;\n');
    const server = createServer((_request, response) => {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="commitlore-test"' });
      response.end();
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('test server has no TCP address');
    failNotesFetchOnly(repo, origin, `http://127.0.0.1:${address.port}/commitlore.git`);

    try {
      const result = await pushWithDeadline(repo, {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      });
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(0);
      const lines = commitloreLines(result.stderr);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('terminal prompts disabled');
      expect(lines[0], 'the operator is told the branch went out').toContain('The branch was pushed');
    expect(lines[0], 'and what became of the records, and whether to act').toContain('retries this automatically');
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 60_000);
});
