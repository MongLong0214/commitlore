/**
 * #693: the hook records a path that survives an upgrade.
 *
 * `commitlore.bin` held `<data-root>/v0.8.2/dist/commitlore.mjs`, so an upgrade
 * left the repository validating commits with the old build. Three repositories
 * on the first machine to upgrade were in that state — this one among them,
 * through two releases — and `doctor` said so on every run without stopping
 * anything.
 *
 * `install.sh` now maintains `<data-root>/current`. Recording that keeps what
 * the versioned path was chosen for: an absolute path to a `.mjs`, launchable by
 * the recorded interpreter, independent of PATH. The `bin` wrapper cannot serve
 * here — it is a shell script, and a hook runs where PATH may carry no node.
 * That was measured, not assumed: #694 tried it and hooks failed under the
 * restricted PATH.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A data root with one versioned checkout, and `current` aimed wherever asked. */
const installation = (currentTarget?: string): { bundle: string; dataRoot: string } => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'cl-vfree-'));
  scratch.push(dataRoot);
  const versioned = join(dataRoot, 'v1.0.1');
  cpSync(join(REPO_ROOT, 'dist'), join(versioned, 'dist'), { recursive: true });
  cpSync(join(REPO_ROOT, 'spec'), join(versioned, 'spec'), { recursive: true });
  cpSync(join(REPO_ROOT, 'package.json'), join(versioned, 'package.json'));
  symlinkSync(currentTarget ?? versioned, join(dataRoot, 'current'));
  return { bundle: join(versioned, 'dist', 'commitlore.mjs'), dataRoot };
};

const repo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-vfree-repo-'));
  scratch.push(dir);
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  };
  run(['init', '-q']);
  run(['config', 'user.email', 'a@b']);
  run(['config', 'user.name', 'a']);
  return dir;
};

const recordedPin = (cwd: string, bundle: string): string => {
  execFileSync(process.execPath, [bundle, 'hooks', 'install'], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return execFileSync('git', ['config', '--local', '--get', 'commitlore.bin'], {
    cwd,
    encoding: 'utf8',
  }).trim();
};

describe('#693 what the hook pins itself to', () => {
  it('records the version-free path when it resolves to this bundle', () => {
    const { bundle, dataRoot } = installation();

    const pin = recordedPin(repo(), bundle);

    // Compared by realpath: macOS resolves /var to /private/var, and the
    // recorded value is the resolved form.
    expect(pin, 'the upgrade-surviving path').toBe(
      join(dataRoot, 'current', 'dist', 'commitlore.mjs'),
    );
    expect(pin, 'and it names no release').not.toMatch(/\/v\d+\.\d+\.\d+\//);
    expect(pin, 'still a .mjs, so the recorded interpreter can launch it').toMatch(/\.mjs$/);
  });

  // A `current` belonging to another installation would send the hook to code
  // this one never verified — worse than pinning a version.
  it('keeps the versioned path when current points at a different install', () => {
    // A *working* other installation, not a broken link. If the file simply
    // did not exist, realpathSync would throw and the fallback would happen for
    // that reason — the identity comparison would never run, and this case
    // would pass while proving nothing. It did, until this fixture was fixed.
    const elsewhere = mkdtempSync(join(tmpdir(), 'cl-vfree-other-'));
    scratch.push(elsewhere);
    cpSync(join(REPO_ROOT, 'dist'), join(elsewhere, 'dist'), { recursive: true });
    const { bundle } = installation(elsewhere);

    expect(recordedPin(repo(), bundle), 'an unrelated current is not trusted').toBe(bundle);
  });
});
