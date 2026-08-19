/**
 * T-1606 (#742): `commitlore upgrade` performs the upgrade, and the negative
 * control reproduces #735 rather than its outcome.
 *
 * A fixture that exits 0 without touching `current` traverses none of
 * `ln -sfn` → `mv -h` → `mv -T` → `rm -f && mv -f` → `readlink`, and does not
 * build the machine #735 actually made. It catches a CLI that trusts an exit
 * code -- worth catching, and not the claim being defended.
 *
 * The real state, from `install.sh:603-671`: the wrapper is written and
 * renamed *before* the `current` move. So a #735 machine has the wrapper
 * pointing at the new checkout, `current` still on the old one, a stray
 * `current.commitlore-install.<pid>` symlink inside the data root, and an
 * installer that exited 0 saying it worked.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dataRoot, performUpgrade, pointsAtTarget, resolvedCurrent } from '../src/commands/update.js';

const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `cl-upg-${label}-`));

/** A data root with `old` installed and `current` pointing at it. */
const machineOn = (old: string): { home: string; root: string } => {
  const home = scratch('home');
  const root = join(home, '.local', 'share', 'commitlore');
  mkdirSync(join(root, old), { recursive: true });
  symlinkSync(join(root, old), join(root, 'current'));
  return { home, root };
};

const installCheckout = (root: string, tag: string): void => {
  mkdirSync(join(root, tag), { recursive: true });
  writeFileSync(join(root, tag, 'install.sh'), '#!/bin/sh\nexit 0\n');
};

const env = (home: string): NodeJS.ProcessEnv => ({ HOME: home });

describe('T-1606 the #735 fixture is the machine, not the outcome', () => {
  /**
   * Builds the half-upgraded state: the checkout lands, the wrapper points at
   * it, `current` does not move, and a stray temp symlink is left behind.
   */
  const brokenMove = (root: string, target: string) => (script: string, tag: string) => {
    installCheckout(root, tag);
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(
      join(root, 'bin', 'commitlore'),
      `#!/bin/sh\nexec node "${join(root, tag, 'dist', 'commitlore.mjs')}" "$@"\n`,
    );
    if (!existsSync(join(root, `current.commitlore-install.4242`))) {
      symlinkSync(join(root, tag), join(root, `current.commitlore-install.4242`));
    }
    void script;
    void target;
    return { status: 0 };
  };

  it('produces all three artefacts of a #735 machine', () => {
    const { root } = machineOn('v1.0.1');
    brokenMove(root, 'v1.0.1')(join(root, 'current', 'install.sh'), 'v9.0.0');

    // 1. the wrapper resolves to the NEW checkout
    expect(readFileSync(join(root, 'bin', 'commitlore'), 'utf8')).toContain('v9.0.0');
    // 2. `current` still resolves to the OLD one
    expect(resolvedCurrent(root, 'linux')).toContain('v1.0.1');
    // 3. a stray temp symlink is left inside the data root
    expect(readdirSync(root).some((e) => e.startsWith('current.commitlore-install.'))).toBe(true);
  });

  it('does not report success on that machine, retries, and completes', () => {
    const { home, root } = machineOn('v1.0.1');
    let call = 0;
    const outcome = performUpgrade('v9.0.0', {
      env: env(home),
      platform: 'linux',
      runInstaller: (script, tag) => {
        call += 1;
        if (call === 1) return brokenMove(root, 'v1.0.1')(script, tag);
        // The new tree's installer carries the fixed move.
        installCheckout(root, tag);
        symlinkSync(join(root, tag), join(root, 'current.new'));
        require('node:fs').renameSync(join(root, 'current.new'), join(root, 'current'));
        return { status: 0 };
      },
    });

    expect(call).toBe(2);
    expect(outcome.code).toBe(0);
    // Asserted by reading the link, not by the command's own report.
    expect(pointsAtTarget(root, 'v9.0.0', 'linux')).toBe(true);
  });
});

describe('T-1606 step 2 asks whether it is right, not whether it moved', () => {
  it('catches a move to some other installed version', () => {
    const { home, root } = machineOn('v1.0.1');
    installCheckout(root, 'v1.0.2');
    let call = 0;
    const outcome = performUpgrade('v9.0.0', {
      env: env(home),
      platform: 'linux',
      runInstaller: () => {
        call += 1;
        // Exits 0 and *does* change the link -- to the wrong thing. Revision 1
        // said "if it did not move", which this satisfies.
        const fs = require('node:fs') as typeof import('node:fs');
        fs.rmSync(join(root, 'current'), { force: true });
        fs.symlinkSync(join(root, 'v1.0.2'), join(root, 'current'));
        return { status: 0 };
      },
    });

    expect(call).toBe(2);
    expect(outcome.code).toBe(1);
    expect(outcome.lines.join('\n')).toContain('install.sh');
  });
});

describe('T-1606 when both steps leave it wrong', () => {
  it('exits non-zero and prints the canonical one-liner, not the local script', () => {
    const { home, root } = machineOn('v1.0.1');
    const outcome = performUpgrade('v9.0.0', {
      env: env(home),
      platform: 'linux',
      runInstaller: () => ({ status: 0 }),
    });
    const text = outcome.lines.join('\n');

    expect(outcome.code).toBe(1);
    // The canonical line, which comes from neither installer that just failed.
    expect(text).toContain('curl');
    expect(text).toContain('v9.0.0');
    expect(text).not.toContain(join(root, 'current', 'install.sh'));
    // A link that is right over a checkout that is wrong is beyond this
    // command, so the failure names doctor.
    expect(text).toContain('commitlore doctor');
  });

  it('spawns nothing but the two installer invocations', () => {
    const { home, root } = machineOn('v1.0.1');
    const outcome = performUpgrade('v9.0.0', {
      env: env(home),
      platform: 'linux',
      runInstaller: () => ({ status: 0 }),
    });
    expect(outcome.invoked).toEqual([
      join(root, 'current', 'install.sh'),
      join(root, 'v9.0.0', 'install.sh'),
    ]);
  });
});

describe('T-1606 the Windows path', () => {
  // `install.ps1` writes no `current` symlink: activation is a `.cmd` shim
  // whose last line names the versioned entry point. Reading a link that is
  // never created would report every Windows upgrade as failed.
  //
  // This runs on the platform CI has, which is the point of
  // `guard-a-platform-ci-cannot-run`: the shape is checked here rather than
  // trusted to a runner nobody has.
  it('asks the shim rather than a link, and invokes install.ps1', () => {
    const { home, root } = machineOn('v1.0.1');
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(
      join(root, 'bin', 'commitlore.cmd'),
      `@echo off\r\nnode "${join(root, 'v9.0.0', 'dist', 'commitlore.mjs')}" %*\r\n`,
    );

    expect(pointsAtTarget(root, 'v9.0.0', 'win32')).toBe(true);
    expect(pointsAtTarget(root, 'v1.0.1', 'win32')).toBe(false);

    const outcome = performUpgrade('v9.0.0', {
      env: env(home),
      platform: 'win32',
      runInstaller: () => ({ status: 0 }),
    });
    expect(outcome.code).toBe(0);
    expect(outcome.invoked).toEqual([join(root, 'current', 'install.ps1')]);
  });
});

describe('T-1606 the data root', () => {
  it('matches install.sh, including XDG_DATA_HOME', () => {
    expect(dataRoot({ HOME: '/h' })).toBe(join('/h', '.local', 'share', 'commitlore'));
    expect(dataRoot({ HOME: '/h', XDG_DATA_HOME: '/x' })).toBe(join('/x', 'commitlore'));
  });
});

describe('T-1606 the read-only form stays read-only', () => {
  const CLI = join(process.cwd(), 'dist', 'commitlore.mjs');

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

  /** Records everything the run starts, by shadowing the binaries on PATH. */
  const runRecorded = (args: readonly string[], extra: NodeJS.ProcessEnv): string[] => {
    const bin = scratch('bin');
    const log = join(bin, 'calls.log');
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "git $@" >> ${log}\nexec ${realGit} "$@"\n`);
    writeFileSync(join(bin, 'sh'), `#!/bin/sh\necho "sh $@" >> ${log}\nexec /bin/sh "$@"\n`);
    execFileSync('chmod', ['+x', join(bin, 'git'), join(bin, 'sh')]);

    try {
      execFileSync(process.execPath, [CLI, 'upgrade', ...args], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, HOME: scratch('home'), ...extra },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      // A non-zero exit is still a run worth inspecting.
    }
    return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter((l) => l !== '') : [];
  };

  it.each([['--check'], ['--json']])('%s starts no installer', (flag) => {
    const calls = runRecorded([flag], { COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']) });
    for (const call of calls) expect(call.startsWith('git ls-remote')).toBe(true);
  });

  it('COMMITLORE_NO_AUTO_UPDATE stops the action and not the report', () => {
    const calls = runRecorded([], {
      COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']),
      COMMITLORE_NO_AUTO_UPDATE: '1',
    });
    for (const call of calls) expect(call.startsWith('git ls-remote')).toBe(true);
  });

  it('refuses to act when the newest release is not newer', () => {
    const calls = runRecorded([], { COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v0.0.1']) });
    for (const call of calls) expect(call.startsWith('git ls-remote')).toBe(true);
  });
});
