/**
 * `execGit` contract: a failing git run is data, not an exception, and the
 * child never sees a shell.
 */

import type { SpawnSyncReturns } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { GIT_SPAWN_FAILED, canonicalCommittedAt, execGit, execGitOrThrow, gitResultFromSpawn } from '../src/core/git.js';

const spawnResult = (result: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> =>
  result as SpawnSyncReturns<string>;

describe('execGit', () => {
  it('returns stdout and exit 0 for a successful run', () => {
    const result = execGit(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^git version /);
    expect(result.stderr).toBe('');
  });

  it('returns the exit code and stderr for a failing run instead of throwing', () => {
    const result = execGit(['no-such-subcommand-here']);
    expect(result.code).toBe(1);
    expect(result.stderr).not.toBe('');
  });

  it('uses a completed status even when writing stdin reported EPIPE', () => {
    const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });

    expect(
      gitResultFromSpawn(spawnResult({ status: 1, signal: null, error, stdout: 'output\n', stderr: 'failed\n' })),
    ).toEqual({ code: 1, stdout: 'output\n', stderr: 'failed\n' });
  });

  it('keeps an absent executable as a spawn failure', () => {
    const error = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });

    expect(gitResultFromSpawn(spawnResult({ status: null, signal: null, error }))).toEqual({
      code: GIT_SPAWN_FAILED,
      stdout: '',
      stderr: 'spawn git ENOENT',
    });
  });

  it('keeps a signal kill as a spawn failure', () => {
    expect(gitResultFromSpawn(spawnResult({ status: null, signal: 'SIGTERM' }))).toEqual({
      code: GIT_SPAWN_FAILED,
      stdout: '',
      stderr: 'git terminated by signal SIGTERM',
    });
  });

  it('writes stdin to the child', () => {
    const result = execGit(['interpret-trailers', '--parse', '--no-divider'], {
      stdin: 'Subject\n\nLimit: piped through stdin\n',
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Limit: piped through stdin\n');
  });

  it('does not run arguments through a shell', () => {
    // With a shell, `;` would terminate the command and the rest would run.
    const result = execGit(['rev-parse', '--sq-quote', '; echo pwned']);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('pwned\n');
    expect(result.stdout).toContain("'; echo pwned'");
  });

  it('does not run a message containing shell metacharacters through a shell', () => {
    const result = execGit(['interpret-trailers', '--parse', '--no-divider'], {
      stdin: 'Subject\n\nWarn: `touch /tmp/commitlore-pwned`; rm -rf $HOME\n',
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Warn: `touch /tmp/commitlore-pwned`; rm -rf $HOME\n');
  });
});

describe('execGitOrThrow', () => {
  it('returns stdout on success', () => {
    expect(execGitOrThrow(['--version'])).toMatch(/^git version /);
  });

  it('throws a plain Error carrying the exit code and stderr', () => {
    let thrown: unknown;
    try {
      execGitOrThrow(['no-such-subcommand-here']);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    // No custom Error subclass: the structure rides on own properties.
    expect(Object.getPrototypeOf(thrown)).toBe(Error.prototype);

    const failure = thrown as Error & { code?: number; stderr?: string };
    expect(failure.code).toBeTypeOf('number');
    expect(failure.code).not.toBe(0);
    expect(failure.stderr).toBeTypeOf('string');
    expect(failure.message).toContain('git no-such-subcommand-here failed');
  });
});

/**
 * #650: `%cI` is a documented field of the --json output, and git changed how
 * it spells a zero offset — 2.39 writes `+00:00`, 2.50 writes `Z`. Measured on
 * one commit object: the two gits disagreed about the same repository.
 */
describe('canonicalCommittedAt', () => {
  it('spells a zero offset one way, whichever git produced it', () => {
    expect(canonicalCommittedAt('2026-02-01T00:00:00+00:00')).toBe('2026-02-01T00:00:00Z');
    expect(canonicalCommittedAt('2026-02-01T00:00:00Z')).toBe('2026-02-01T00:00:00Z');
  });

  it('leaves a real offset alone, because it says where the commit was made', () => {
    expect(canonicalCommittedAt('2026-08-14T17:22:24+09:00')).toBe('2026-08-14T17:22:24+09:00');
    expect(canonicalCommittedAt('2026-08-14T17:22:24-05:00')).toBe('2026-08-14T17:22:24-05:00');
  });

  it('does not touch a value that is not a timestamp', () => {
    expect(canonicalCommittedAt('')).toBe('');
    expect(canonicalCommittedAt('not a date')).toBe('not a date');
  });
});
