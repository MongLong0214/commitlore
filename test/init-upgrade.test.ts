/**
 * T-1607 (#742): `init` says what it pinned; `--upgrade` moves it.
 *
 * `init` writes `commitlore.bin` through `<data-root>/current`, so the
 * repository then validates every commit with whatever that resolves to.
 * Initialising on a stale install wires a repository to a stale protocol —
 * #742's opening sentence — and this is the ticket that closes it.
 *
 * The assertion most likely to be quietly relaxed later is that a bare `init`
 * spawns no installer, so it is tested with every other gate open.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PACKAGE_ROOT, 'dist', 'commitlore.mjs');
const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `cl-initup-${label}-`));

const remoteWithTags = (tags: readonly string[]): string => {
  const dir = join(scratch('remote'), 'origin');
  const g = (args: readonly string[]) => execFileSync('git', args as string[], { stdio: 'ignore' });
  g(['init', '--quiet', '--bare', '--initial-branch=main', dir]);
  const work = join(scratch('work'), 'work');
  g(['init', '--quiet', '--initial-branch=main', work]);
  g(['-C', work, 'config', 'user.email', 'test@example.invalid']);
  g(['-C', work, 'config', 'user.name', 'Test']);
  g(['-C', work, 'commit', '--allow-empty', '--quiet', '-m', 'root']);
  for (const tag of tags) g(['-C', work, 'tag', tag]);
  g(['-C', work, 'remote', 'add', 'origin', dir]);
  g(['-C', work, 'push', '--quiet', '--tags', 'origin', 'main']);
  return dir;
};

/**
 * Runs a command with `sh` and `git` shadowed on PATH, so every process it
 * starts is recorded. An installer invocation runs through `sh`, so this is
 * what makes "spawns no installer" an assertion rather than a claim.
 */
const runRecorded = (
  args: readonly string[],
  extra: NodeJS.ProcessEnv,
): { calls: string[]; out: string; code: number } => {
  const bin = scratch('bin');
  const log = join(bin, 'calls.log');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "git $*" >> ${log}\nexec ${realGit} "$@"\n`);
  writeFileSync(join(bin, 'sh'), `#!/bin/sh\necho "sh $*" >> ${log}\nexec /bin/sh "$@"\n`);
  execFileSync('chmod', ['+x', join(bin, 'git'), join(bin, 'sh')]);

  const repo = join(scratch('repo'), 'repo');
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '--quiet', '-m', 'root']);

  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [CLI, 'init', ...args], {
      encoding: 'utf8',
      cwd: repo,
      env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, HOME: scratch('home'), ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const e = error as { stdout?: string; status?: number };
    out = e.stdout ?? '';
    code = e.status ?? 1;
  }
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter((l) => l !== '') : [];
  return { calls, out, code };
};

/** Anything through `sh` that is not the check's own git is an installer run. */
const installerRuns = (calls: readonly string[]): string[] =>
  calls.filter((c) => c.startsWith('sh ') && c.includes('install.'));

describe('T-1607 a bare init reports and does not act', () => {
  it('names what it pinned and the newer release, in its own output', () => {
    const { out } = runRecorded([], { COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']) });
    expect(out).toContain('pinned to');
    expect(out).toContain('v99.0.0');
    expect(out).toContain('commitlore upgrade');
  });

  // The whole point of the ticket. Every other gate is open here: an update
  // exists, no off-switch is set, the check succeeds.
  it('never moves current, even when an update exists', () => {
    const { calls } = runRecorded([], { COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']) });
    expect(installerRuns(calls)).toEqual([]);
  });

  // #746: an upgrade leaves `commitlore.root` on the old version while
  // `current` moves, so a repository-scoped command doing it would invalidate
  // the recorded path in every already-wired repository on the machine.
  it('prints one report, not one plus a trailing notice', () => {
    const { out } = runRecorded([], { COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']) });
    expect(out).not.toContain('is available (running');
  });
});

describe('T-1607 the three ways --upgrade can fail are three facts', () => {
  it('unreachable: wires anyway and says so', () => {
    const { out, code } = runRecorded(['--upgrade'], {
      COMMITLORE_INSTALL_SOURCE: 'https://commitlore.invalid/x.git',
    });
    expect(code).not.toBe(2);
    expect(out).toContain('could not check');
  });

  it('refused: wires anyway, and says which happened', () => {
    const { out, code } = runRecorded(['--upgrade'], {
      COMMITLORE_INSTALL_SOURCE: join(scratch('gone'), 'not-a-repository.git'),
    });
    expect(code).not.toBe(2);
    // Named as its own case rather than folded into "offline".
    expect(out).toMatch(/reachable but gave no usable answer|could not check/);
  });

  it('COMMITLORE_NO_AUTO_UPDATE: reports, continues, and still succeeds', () => {
    const { out, code, calls } = runRecorded(['--upgrade'], {
      COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']),
      COMMITLORE_NO_AUTO_UPDATE: '1',
    });
    expect(code).not.toBe(2);
    expect(out).toContain('COMMITLORE_NO_AUTO_UPDATE');
    expect(installerRuns(calls)).toEqual([]);
  });
});

describe('T-1607 only two commands may spawn an installer', () => {
  it.each([['status'], ['doctor'], ['query']])('%s spawns none', (name) => {
    const bin = scratch('bin');
    const log = join(bin, 'calls.log');
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "git $*" >> ${log}\nexec ${realGit} "$@"\n`);
    writeFileSync(join(bin, 'sh'), `#!/bin/sh\necho "sh $*" >> ${log}\nexec /bin/sh "$@"\n`);
    execFileSync('chmod', ['+x', join(bin, 'git'), join(bin, 'sh')]);

    const repo = join(scratch('repo'), 'repo');
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', repo]);
    try {
      execFileSync(process.execPath, [CLI, name], {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env['PATH'] ?? ''}`,
          HOME: scratch('home'),
          COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      // A non-zero exit is still a run worth inspecting.
    }
    const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
    expect(installerRuns(calls)).toEqual([]);
  });
});
