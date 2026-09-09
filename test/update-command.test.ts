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
import { packageVersion } from '../src/core/paths.js';

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

  /**
   * #893: `--force` is documented as "act even when the newest release is not
   * newer than this one", so it is what an operator reaches for when the
   * version looks stuck. It acted on whatever the resolver had decided and
   * printed `upgraded to v1.2.6` on a machine already running 1.2.6 — a
   * success line for a reinstall of the same bytes, which is what made the
   * operator believe an upgrade had happened.
   */
  it('--force names its target and refuses a no-op instead of reporting success', () => {
    const current = `v${packageVersion()}`;
    const out = execFileSync(process.execPath, [cli, 'upgrade', '--force'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        COMMITLORE_INSTALL_SOURCE: remoteWithTags([current]),
        HOME: scratch('home-force-noop'),
      },
    });

    expect(out).toContain('nothing to install');
    expect(out).toContain('Nothing was changed');
    expect(out, 'reported an upgrade it did not perform').not.toContain('upgraded to');
  });

  it('names the source the answer came from', () => {
    const source = remoteWithTags(['v96.0.0']);
    const out = execFileSync(process.execPath, [cli, 'upgrade', '--check'], {
      encoding: 'utf8',
      env: { ...process.env, COMMITLORE_INSTALL_SOURCE: source, HOME: scratch('home-src-cli') },
    });

    // "this is the newest release" and "the newest release I was told about
    // yesterday" were the same sentence; the source is what separates them.
    expect(out).toContain(`source     ${source}`);
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

/**
 * #885 (incidental): `upgrade` reported `latest v1.2.3` on a machine running
 * 1.2.5, and added "this is the newest release".
 *
 * The answer is cached in `~/.cache/commitlore/latest-release.json` for a day,
 * and only `upgrade` acting calls `forgetCachedRelease`. A release installed any
 * other way — `install.sh`, the plugin marketplace, a manual checkout — leaves
 * yesterday's answer standing, and the command then reports a tag older than the
 * binary printing it. Nothing was wrong with the lookup; the cache had simply
 * outlived the fact.
 *
 * #893 finished it. 1.2.6 re-asked only when the cached tag was strictly older
 * than the running version, reasoning that the equal case is every up-to-date
 * machine and re-asking it would spawn `git ls-remote` on every upgrade. The
 * equal case is precisely the one that goes stale: a machine on 1.2.6 with
 * `v1.2.6` cached kept being told it was current for the rest of the day after
 * 1.2.7 shipped, and `--force` reinstalled the version it already had.
 *
 * The cost was measured wrong rather than weighed wrong. `buildReport` has one
 * caller — the `upgrade` command — and the day-long cache exists for the
 * ambient callers (`core/update-notice.ts`, and `latestReleaseSync` under
 * `doctor` and `init`), none of which come through here. So the command that
 * exists to ask, asks.
 *
 * A test here previously asserted the opposite ("still serves the cache when it
 * agrees with the running version"). It pinned the defect, and it is replaced
 * rather than deleted so the reversal is visible.
 */
describe('#885/#893 upgrade does not serve a stale latest', () => {
  it('re-asks rather than reporting a tag older than the binary printing it', async () => {
    const home = scratch('home-stale');

    // Yesterday: the newest tag really was older than what is installed now.
    const primed = await buildReport({
      COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v0.0.1']),
      HOME: home,
    });
    expect(primed.latest, 'the cache was not primed').toBe('v0.0.1');

    // Today: a newer release exists, and the day-long cache still holds v0.0.1.
    const report = await buildReport({
      COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v0.0.1', 'v99.0.0']),
      HOME: home,
    });

    expect(report.latest).toBe('v99.0.0');
    expect(report.updateAvailable).toBe(true);
  });

  // The #893 case, and the one the replaced test asserted backwards. A machine
  // that is up to date today is the machine that will be out of date tomorrow,
  // so "the cached answer agrees with the running version" is not a reason to
  // stop asking — it is the state every stale answer starts from.
  it('asks again even when the cached answer agrees with the running version', async () => {
    const home = scratch('home-current');
    const current = `v${packageVersion()}`;

    const primed = await buildReport({
      COMMITLORE_INSTALL_SOURCE: remoteWithTags([current]),
      HOME: home,
    });
    expect(primed.latest, 'the cache was not primed').toBe(current);

    const report = await buildReport({
      COMMITLORE_INSTALL_SOURCE: remoteWithTags([current, 'v99.0.0']),
      HOME: home,
    });

    expect(report.latest).toBe('v99.0.0');
    expect(report.updateAvailable).toBe(true);
  });

  // The reporter could not tell "newest" from "newest as of yesterday" from the
  // output, so the answer now says what it consulted.
  it('names the source it resolved the answer from', async () => {
    const source = remoteWithTags(['v99.0.0']);
    const report = await buildReport({
      COMMITLORE_INSTALL_SOURCE: source,
      HOME: scratch('home-source'),
    });

    expect(report.source).toBe(source);
  });
});
