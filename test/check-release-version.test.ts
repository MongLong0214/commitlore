/**
 * #492: release versions were compared only between the tag, package.json,
 * and the built CLI. The plugin manifest Claude Code installs and both
 * root-package fields npm records in package-lock.json could drift unnoticed.
 *
 * Each fixture is an isolated miniature checkout because the gate derives its
 * repository root from its own path. That makes these real process tests of
 * the release script without mutating this checkout's manifests.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(REPO_ROOT, 'scripts', 'check-release-version.mjs');
const VERSION = '0.7.1';

// The fixtures below build miniature repositories and prove the gate reasons
// correctly about them. They cannot notice that *this* repository disagrees
// with itself, and on 0.8.0 it did: `package.json` was bumped and both
// `package-lock.json` versions were left at the previous release, so the gate
// would have refused the tag at publish time. That is the second time a stale
// lock has reached a release candidate.
//
// A gate whose tests only ever see fixtures is a gate nobody is running.
describe('this repository agrees with itself', () => {
  it('every manifest the gate reads carries the same version as package.json', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8')) as {
      version?: unknown;
      packages?: Record<string, { version?: unknown }>;
    };
    const claudePlugin = JSON.parse(
      readFileSync(join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'),
    ) as { version?: unknown };
    const codexPlugin = JSON.parse(
      readFileSync(join(REPO_ROOT, '.codex-plugin', 'plugin.json'), 'utf8'),
    ) as { version?: unknown };

    expect(lock.version).toBe(pkg.version);
    expect(lock.packages?.['']?.version).toBe(pkg.version);
    expect(claudePlugin.version).toBe(pkg.version);
    expect(codexPlugin.version).toBe(pkg.version);
  });

  it('the gate itself accepts this repository at its own version', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      version?: string;
    };
    const run = spawnSync(process.execPath, [GATE, `v${String(pkg.version)}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(`${run.stdout}${run.stderr}`).not.toMatch(/version mismatch/);
    expect(run.status).toBe(0);
  });
});

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

interface FixtureVersions {
  package?: string;
  plugin?: string;
  codexPlugin?: string;
  packageLock?: string;
  packageLockRoot?: string;
  cli?: string;
  pluginManifest?: boolean;
  codexPluginManifest?: boolean;
}

const fixture = (versions: FixtureVersions = {}): string => {
  const root = mkdtempSync(join(tmpdir(), 'commitlore-release-version-'));
  scratch.push(root);

  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'dist'));
  copyFileSync(GATE, join(root, 'scripts', 'check-release-version.mjs'));

  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'commitlore', version: versions.package ?? VERSION }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, 'package-lock.json'),
    `${JSON.stringify(
      {
        name: 'commitlore',
        lockfileVersion: 3,
        version: versions.packageLock ?? VERSION,
        packages: { '': { name: 'commitlore', version: versions.packageLockRoot ?? VERSION } },
      },
      null,
      2,
    )}\n`,
  );
  if (versions.pluginManifest !== false) {
    mkdirSync(join(root, '.claude-plugin'));
    writeFileSync(
      join(root, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({ name: 'commitlore', version: versions.plugin ?? VERSION }, null, 2)}\n`,
    );
  }
  if (versions.codexPluginManifest !== false) {
    mkdirSync(join(root, '.codex-plugin'));
    writeFileSync(
      join(root, '.codex-plugin', 'plugin.json'),
      `${JSON.stringify({ name: 'commitlore', version: versions.codexPlugin ?? VERSION }, null, 2)}\n`,
    );
  }
  writeFileSync(
    join(root, 'dist', 'commitlore.mjs'),
    `#!/usr/bin/env node\nif (process.argv[2] === '--version') console.log(${JSON.stringify(versions.cli ?? VERSION)});\n`,
  );

  return root;
};

const run = (root: string) =>
  spawnSync(process.execPath, [join(root, 'scripts', 'check-release-version.mjs'), `v${VERSION}`], {
    encoding: 'utf8',
  });

describe('#492 check-release-version', () => {
  it('passes when the tag, every manifest field, and the CLI agree', () => {
    const result = run(fixture());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('version consistent');
  });

  it.each([
    ['the plugin manifest', { plugin: '0.7.0' }, '.claude-plugin/plugin.json .version'],
    // Added with the check itself: this manifest ships the Codex plugin, moves
    // every release, and was the one field the gate did not read -- so a stale
    // one would have published green and told a Codex user they had installed
    // the previous release.
    ['the codex plugin manifest', { codexPlugin: '0.7.0' }, '.codex-plugin/plugin.json .version'],
    ['the package-lock root version', { packageLock: '0.7.0' }, 'package-lock.json .version'],
    [
      'the package-lock root package version',
      { packageLockRoot: '0.7.0' },
      'package-lock.json .packages[""].version',
    ],
  ] satisfies [string, FixtureVersions, string][])('%s disagreement fails and names its field', (_, versions, source) => {
    const result = run(fixture(versions));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(source);
  });

  it('reports every disagreement instead of stopping at the first one', () => {
    const result = run(
      fixture({ plugin: '0.7.0', packageLock: '0.7.0', packageLockRoot: '0.6.0' }),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('.claude-plugin/plugin.json .version');
    expect(result.stderr).toContain('package-lock.json .version');
    expect(result.stderr).toContain('package-lock.json .packages[""].version');
  });

  it('fails when the required plugin manifest is missing', () => {
    const result = run(fixture({ pluginManifest: false }));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('.claude-plugin/plugin.json .version');
    expect(result.stderr).toContain('required manifest is missing');
  });
});
