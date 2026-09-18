/**
 * #1046 / #1048: the optional half can break in any way and native validation
 * still runs.
 *
 * ADR D1 is specific about this: "Lazy-load optional modules inside their own
 * error boundary; optional load/init failure must not bypass or prevent native
 * validation. Do not wrap the native validator in a catch that returns
 * success." The three tests here are the three ways that can go wrong — the
 * module fails to load, it loads and throws on use, or it returns and the
 * diagnostic write fails — and each asserts the same thing: `runValidate`'s
 * verdict for the bytes in the file is what comes back.
 *
 * `vi.doMock` with `vi.resetModules` is what makes an import failure injectable
 * without shipping a seam for it.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.doUnmock('../src/jev/producer.js');
  vi.doUnmock('../src/jev/diagnostic.js');
  vi.resetModules();
});

const KEY = 'apikey_test_dispatcher_0000000000000000';

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'] ?? '',
      GIT_CONFIG_GLOBAL: '/nonexistent/commitlore-tests-must-not-read-this',
      GIT_CONFIG_SYSTEM: '/nonexistent/commitlore-tests-must-not-read-this',
    },
  });

const repo = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-jevdisp-${name}-`));
  scratch.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main', '.']);
  git(dir, ['config', 'user.email', 'd@example.invalid']);
  git(dir, ['config', 'user.name', 'D']);
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'initial']);
  return dir;
};

const CLEAN = 'Raise the ceiling\n\nOrdinary prose with no trailers.\n';
const BROKEN = 'Bad\n\nProse.\n\nBlast: worldwide\nRecord-Id: r-dispatch01\n';

describe('#1048 an optional failure never reaches the verdict', () => {
  it('validates normally when the producer module will not even load', async () => {
    vi.resetModules();
    vi.doMock('../src/jev/producer.js', () => {
      throw new Error('simulated: the optional bundle is broken');
    });
    const { runCommitMsg } = await import('../src/commands/commit-msg.js');
    const { runValidate } = await import('../src/commands/validate.js');

    const cwd = repo('loadfail');
    const messageFile = join(cwd, 'MSG');

    writeFileSync(messageFile, CLEAN);
    const clean = await runCommitMsg({ messageFile, cwd, env: { COMMITLORE_JEV_API_KEY: KEY } });
    expect(clean.code, clean.stderr).toBe(0);

    // And a broken message is still refused: the catch did not swallow the
    // validator along with the import.
    writeFileSync(messageFile, BROKEN);
    const broken = await runCommitMsg({ messageFile, cwd, env: { COMMITLORE_JEV_API_KEY: KEY } });
    writeFileSync(messageFile, BROKEN);
    const native = runValidate({ messageFile, cwd });
    expect(broken.code).toBe(native.code);
    expect(broken.code).not.toBe(0);
    expect(broken.stdout).toBe(native.stdout);
  }, 300_000);

  it('validates normally when the producer loads and then throws', async () => {
    vi.resetModules();
    vi.doMock('../src/jev/producer.js', () => ({
      produce: () => {
        throw new Error('simulated: the producer threw on use');
      },
    }));
    const { runCommitMsg } = await import('../src/commands/commit-msg.js');

    const cwd = repo('throwfail');
    const messageFile = join(cwd, 'MSG');
    writeFileSync(messageFile, BROKEN);
    const result = await runCommitMsg({ messageFile, cwd, env: { COMMITLORE_JEV_API_KEY: KEY } });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain('enum Blast');
    // The original is exactly as it was: a throwing producer wrote nothing.
    expect(result.stderr).not.toContain('simulated');
  }, 300_000);

  it('validates normally when the diagnostic module will not load', async () => {
    // The diagnostic is best effort and is imported beside the producer. Its
    // failure must not take the commit with it.
    vi.resetModules();
    vi.doMock('../src/jev/diagnostic.js', () => {
      throw new Error('simulated: the diagnostic module is broken');
    });
    const { runCommitMsg } = await import('../src/commands/commit-msg.js');

    const cwd = repo('diagfail');
    const messageFile = join(cwd, 'MSG');
    writeFileSync(messageFile, CLEAN);
    const result = await runCommitMsg({ messageFile, cwd, env: { COMMITLORE_JEV_API_KEY: KEY } });
    expect(result.code, result.stderr).toBe(0);
  }, 300_000);

  it('says nothing to the user about any of it', async () => {
    // A default installation prints nothing, and an enabled one whose optional
    // half broke must not turn a working commit into a confusing one. The
    // diagnostic file is where a failure is visible.
    vi.resetModules();
    vi.doMock('../src/jev/producer.js', () => {
      throw new Error('simulated: the optional bundle is broken');
    });
    const { runCommitMsg } = await import('../src/commands/commit-msg.js');

    const cwd = repo('quiet');
    const messageFile = join(cwd, 'MSG');
    writeFileSync(messageFile, CLEAN);
    const result = await runCommitMsg({ messageFile, cwd, env: { COMMITLORE_JEV_API_KEY: KEY } });
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toMatch(/jev/i);
  }, 300_000);
});
