/**
 * #693: the hook records a launcher that survives an upgrade.
 *
 * `commitlore.bin` held `<data-root>/v0.8.2/dist/commitlore.mjs`, so after
 * upgrading to 1.0.1 the repository was still validating commits with the 0.8.2
 * build while the CLI reported 1.0.1. `doctor` noticed and said so; nothing
 * fixed it, because `install.sh` cannot know which repositories have hooks.
 *
 * The fourth instance of one pattern in a day. `.mcp.json` recorded the bare
 * wrapper and followed every upgrade untouched; Hermes' `external_dirs`, the
 * plugin cache and this each held a version or a copy, and each needed a fix.
 *
 * The wrapper keeps what the versioned path was chosen for — an absolute path,
 * independent of PATH and of any `node_modules/.bin/commitlore` above the
 * repository. It just does not name a release.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const scratchDir = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `cl-launcher-${label}-`));
  scratch.push(dir);
  return dir;
};

/** The built CLI this test measures. A synthetic copy would need `spec/` and a
 * manifest beside it, so the real one is used and only the wrapper is faked. */
const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'commitlore.mjs');

/** A wrapper in a throwaway HOME, naming whichever bundle it is given. */
const wrapperNaming = (home: string, target: string): string => {
  const wrapper = join(home, '.local', 'bin', 'commitlore');
  mkdirSync(join(wrapper, '..'), { recursive: true });
  writeFileSync(wrapper, ['#!/bin/sh', `exec node ${JSON.stringify(target)} "$@"`, ''].join('\n'), 'utf8');
  chmodSync(wrapper, 0o755);
  return wrapper;
};

const repo = (): string => {
  const dir = scratchDir('repo');
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  };
  run(['init', '-q']);
  run(['config', 'user.email', 'a@b']);
  run(['config', 'user.name', 'a']);
  return dir;
};

/** `hooks install` run with HOME pointed at a synthetic installation. */
const installHooks = (cwd: string, home: string): void => {
  execFileSync(process.execPath, [BUNDLE, 'hooks', 'install'], {
    cwd,
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
};

const recorded = (cwd: string): string =>
  execFileSync('git', ['config', '--local', '--get', 'commitlore.bin'], { cwd, encoding: 'utf8' }).trim();

describe('#693 what the hook records as its entry point', () => {
  it('records the wrapper when it launches this build', () => {
    const home = scratchDir('home');
    const wrapper = wrapperNaming(home, BUNDLE);
    const cwd = repo();

    installHooks(cwd, home);

    expect(recorded(cwd), 'a versioned path pins the hook to one release').toBe(wrapper);
    expect(recorded(cwd), 'and this one names no version').not.toMatch(/\/v\d+\.\d+\.\d+\//);
  });

  // A wrapper belonging to some other installation is worse than a versioned
  // path: it would send the hook to code this install never verified.
  it('keeps the running bundle when the wrapper names a different install', () => {
    const home = scratchDir('foreign');
    wrapperNaming(home, '/opt/elsewhere/commitlore.mjs');
    const cwd = repo();

    installHooks(cwd, home);

    expect(recorded(cwd), 'an unrelated wrapper is not trusted').toBe(BUNDLE);
  });
});
