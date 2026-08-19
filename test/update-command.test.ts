/**
 * T-1603 (#742): `commitlore upgrade` reports, and does not act.
 *
 * The read-only half ships before the acting half so that the reporting is
 * trustworthy before anything acts on it. Two of these assertions are the
 * point of the ticket rather than decoration: that nothing but the check's own
 * `git ls-remote` is ever started, and that the command answers inside CI.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildReport, installCommand } from '../src/commands/update.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `cl-upgrade-${label}-`));

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

describe('T-1603 upgrade reports', () => {
  it('names a newer release when one exists', async () => {
    const report = await buildReport({
      COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']),
      HOME: scratch('home'),
    });
    expect(report.latest).toBe('v99.0.0');
    expect(report.updateAvailable).toBe(true);
    expect(report.command).toContain('v99.0.0');
  });

  it('does not call an older tag an update', async () => {
    const report = await buildReport({
      COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v0.0.1']),
      HOME: scratch('home-old'),
    });
    expect(report.updateAvailable).toBe(false);
    expect(report.unknown).toBeUndefined();
  });

  // "We could not look" and "you are up to date" are different answers and
  // only one of them is true. `updateAvailable: false` alone cannot tell them
  // apart, which is why `unknown` exists.
  it('says it does not know rather than saying you are current', async () => {
    const report = await buildReport({
      COMMITLORE_INSTALL_SOURCE: join(scratch('gone'), 'not-a-repository.git'),
      HOME: scratch('home-unknown'),
    });
    expect(report.latest).toBeNull();
    expect(report.updateAvailable).toBe(false);
    expect(report.unknown).toBeTruthy();
  });

  it('reports that checking is disabled rather than reporting it is current', async () => {
    const report = await buildReport({
      COMMITLORE_NO_UPDATE_CHECK: '1',
      HOME: scratch('home-off'),
    });
    expect(report.unknown).toContain('COMMITLORE_NO_UPDATE_CHECK');
    expect(report.updateAvailable).toBe(false);
  });
});

describe('T-1603 the install command it prints', () => {
  // Asserted against the README rather than restated here. The two drifting is
  // #727's shape, and a literal in the test would be the first step of it.
  it('is the README one-liner with the target tag substituted', () => {
    const readme = readFileSync(join(PACKAGE_ROOT, 'README.md'), 'utf8');
    const printed = installCommand('v9.9.9', 'linux');
    expect(printed).toContain('install.sh');
    expect(printed).toContain('v9.9.9');
    expect(printed).not.toMatch(/v1\.\d+\.\d+/);
    const shape = printed.replace(/v9\.9\.9/g, '');
    const readmeShape = readme
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('curl ') && l.includes('install.sh'))
      ?.replace(/v\d+\.\d+\.\d+/g, '');
    expect(shape).toBe(readmeShape);
  });

  // Naming a command that cannot work is the failure `gh` sidesteps by
  // printing a URL instead. We only earn the more helpful form by being right.
  it('prints the PowerShell line on Windows, not the shell one', () => {
    const printed = installCommand('v9.9.9', 'win32');
    expect(printed).toContain('install.ps1');
    expect(printed).not.toContain('install.sh');
  });
});

describe('T-1603 ADR-0037 is enforced, not described', () => {
  const cli = join(PACKAGE_ROOT, 'dist', 'commitlore.mjs');

  it('answers inside CI and off a terminal', () => {
    // The revision-1 defect: a shared suppression table would have made the
    // one scriptable command silent in the one place scripts run.
    const out = execFileSync(process.execPath, [cli, 'upgrade', '--json'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: '1',
        COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v98.0.0']),
        HOME: scratch('home-ci'),
      },
    });
    const report = JSON.parse(out) as { latest: string | null };
    expect(report.latest).toBe('v98.0.0');
  });

  it('starts nothing but the check it owns', () => {
    // A comment saying the CLI does not replace itself is not a guard (#723).
    // `git` is replaced with a recorder for the length of the run; anything
    // else the command tried to start would fail to resolve and surface here.
    const bin = scratch('bin');
    const log = join(bin, 'spawned.log');
    const shim = join(bin, 'git');
    execFileSync('sh', ['-c', `printf '#!/bin/sh\\necho "$@" >> ${log}\\nexec ${execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()} "$@"\\n' > ${shim} && chmod +x ${shim}`]);

    execFileSync(process.execPath, [cli, 'upgrade', '--json'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v97.0.0']),
        HOME: scratch('home-spawn'),
      },
    });

    const calls = readFileSync(log, 'utf8').trim().split('\n').filter((l) => l !== '');
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.startsWith('ls-remote')).toBe(true);
  });
});
