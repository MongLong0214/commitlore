/**
 * `execGit` contract: a failing git run is data, not an exception, and the
 * child never sees a shell.
 */

import { describe, expect, it } from 'vitest';

import { GIT_SPAWN_FAILED, execGit, execGitOrThrow } from '../src/core/git.js';

describe('execGit', () => {
  it('returns stdout and exit 0 for a successful run', () => {
    const result = execGit(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^git version /);
    expect(result.stderr).toBe('');
  });

  it('returns the exit code and stderr for a failing run instead of throwing', () => {
    const result = execGit(['no-such-subcommand-here']);
    expect(result.code).not.toBe(0);
    expect(result.code).not.toBe(GIT_SPAWN_FAILED);
    expect(result.stderr).not.toBe('');
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
