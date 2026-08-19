/**
 * T-1604 (#742): the passive notice, which is mostly a list of places it must
 * not appear.
 *
 * The one positive property is that a hanging check costs the command nothing.
 * If that is not tested the concurrency is decoration, so it is tested against
 * a check that never resolves rather than one that is merely slow.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  beginUpdateCheck,
  finishUpdateCheck,
  hasSettledCheck,
  resetUpdateCheck,
  SILENT_SUBCOMMANDS,
  suppressedBecause,
  type NoticeContext,
} from '../src/core/update-notice.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PACKAGE_ROOT, 'dist', 'commitlore.mjs');
const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `cl-notice-${label}-`));

/** A real remote with real tags, so the check has something to resolve. */
const remoteWithTags = (tags: readonly string[]): string => {
  const dir = join(scratch('remote'), 'origin');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', dir]);
  const work = join(scratch('work'), 'work');
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', work]);
  execFileSync('git', ['-C', work, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', work, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', work, 'commit', '--allow-empty', '--quiet', '-m', 'root']);
  for (const tag of tags) execFileSync('git', ['-C', work, 'tag', tag]);
  execFileSync('git', ['-C', work, 'remote', 'add', 'origin', dir]);
  execFileSync('git', ['-C', work, 'push', '--quiet', '--tags', 'origin', 'main']);
  return dir;
};

/** Waits for an in-flight check to land, without the module exposing a way to
 *  await it in production -- where awaiting is the one thing that must not
 *  happen. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 200; i += 1) {
    if (hasSettledCheck()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
};

const ctx = (over: Partial<NoticeContext> = {}): NoticeContext => ({
  argv: ['status'],
  env: {},
  stdoutTty: true,
  stderrTty: true,
  ...over,
});

afterEach(() => resetUpdateCheck());

describe('T-1604 where the notice must not appear', () => {
  // Each is its own case rather than one loop: a command added to the silent
  // list later cannot then be quietly dropped from the test.
  it('is silent for prepare-commit-msg, which writes the commit message file', () => {
    expect(suppressedBecause(ctx({ argv: ['prepare-commit-msg', '.git/COMMIT_EDITMSG'] }))).toBe('prepare-commit-msg');
  });

  it('is silent for post-commit', () => {
    expect(suppressedBecause(ctx({ argv: ['post-commit'] }))).toBe('post-commit');
  });

  it('is silent for pre-push', () => {
    expect(suppressedBecause(ctx({ argv: ['pre-push'] }))).toBe('pre-push');
  });

  it('is silent for mcp, which speaks a protocol', () => {
    expect(suppressedBecause(ctx({ argv: ['mcp'] }))).toBe('mcp');
  });

  // Absent from the notice on purpose: doctor carries staleness inside its own
  // report (T-1605), and two mechanisms must not both print it.
  it('is silent for doctor, which reports staleness itself', () => {
    expect(suppressedBecause(ctx({ argv: ['doctor'] }))).toBe('doctor');
  });

  it('is silent for any --json invocation', () => {
    expect(suppressedBecause(ctx({ argv: ['query', '--json'] }))).toBe('--json');
  });

  it('is silent under CI', () => {
    expect(suppressedBecause(ctx({ env: { CI: '1' } }))).toBe('CI');
  });

  // Two cases, because a single `isatty` call passes both by accident.
  it('is silent when stdout is a terminal and stderr is not', () => {
    expect(suppressedBecause(ctx({ stderrTty: false }))).toBe('not a terminal');
  });

  it('is silent when stderr is a terminal and stdout is not', () => {
    expect(suppressedBecause(ctx({ stdoutTty: false }))).toBe('not a terminal');
  });

  it('may speak when nothing suppresses it', () => {
    expect(suppressedBecause(ctx())).toBeNull();
  });

  it('names every silent subcommand it claims to', () => {
    for (const name of ['prepare-commit-msg', 'post-commit', 'pre-push', 'mcp', 'doctor']) {
      expect(SILENT_SUBCOMMANDS).toContain(name);
    }
  });
});

describe('T-1604 what it costs the command', () => {
  // The property the concurrency buys. A check that never resolves must not
  // delay anything, which is why nothing awaits it.
  it('prints nothing and waits for nothing when the check never finishes', () => {
    beginUpdateCheck(ctx({ env: { COMMITLORE_INSTALL_SOURCE: 'https://commitlore.invalid/x.git' } }));
    const lines: string[] = [];
    const started = Date.now();
    finishUpdateCheck(ctx(), '1.0.0', false, (line) => lines.push(line));
    expect(Date.now() - started).toBeLessThan(50);
    expect(lines).toEqual([]);
  });

  // With a real answer waiting, not without one. A first version of this
  // asserted silence while nothing had resolved, so it passed through the
  // `no result` branch and would have kept passing with the failed-command
  // gate deleted -- which the negative control caught.
  it('says nothing when the command itself failed, even with an answer ready', async () => {
    const url = remoteWithTags(['v99.0.0']);
    const env = { COMMITLORE_INSTALL_SOURCE: url, HOME: scratch('failed') };

    beginUpdateCheck(ctx({ env }));
    await settle();

    const quiet: string[] = [];
    finishUpdateCheck(ctx({ env }), '1.0.0', true, (line) => quiet.push(line));
    expect(quiet).toEqual([]);

    // And the same answer does speak when the command succeeded, so the
    // assertion above is about `failed` rather than about an empty check.
    beginUpdateCheck(ctx({ env }));
    await settle();
    const spoken: string[] = [];
    finishUpdateCheck(ctx({ env }), '1.0.0', false, (line) => spoken.push(line));
    expect(spoken.join('')).toContain('v99.0.0');
  });

  it('says nothing when no check was ever started', () => {
    const lines: string[] = [];
    finishUpdateCheck(ctx(), '1.0.0', false, (line) => lines.push(line));
    expect(lines).toEqual([]);
  });
});

describe('T-1604 end to end, through the built CLI', () => {
  const run = (args: readonly string[], env: NodeJS.ProcessEnv): { out: string; err: string; code: number } => {
    try {
      const out = execFileSync(process.execPath, [CLI, ...args], {
        encoding: 'utf8',
        env: { ...process.env, HOME: scratch('home'), ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { out, err: '', code: 0 };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; status?: number };
      return { out: e.stdout ?? '', err: e.stderr ?? '', code: e.status ?? 1 };
    }
  };

  // Not a terminal here, so this is also the redirected-stderr case.
  it('never writes the notice to stdout', () => {
    const { out } = run(['--version'], {});
    expect(out).not.toContain('is available');
  });

  it('leaves the exit code alone whether the check works or not', () => {
    const good = run(['--version'], { COMMITLORE_INSTALL_SOURCE: 'https://commitlore.invalid/x.git' });
    const off = run(['--version'], { COMMITLORE_NO_UPDATE_CHECK: '1' });
    expect(good.code).toBe(off.code);
    expect(good.code).toBe(0);
  });

  it('leaves a failing command failing, with no notice appended', () => {
    const { err, code } = run(['definitely-not-a-command'], {});
    expect(code).not.toBe(0);
    expect(err).not.toContain('is available');
  });
});
