#!/usr/bin/env node
/**
 * Release gate (`.github/workflows/release.yml`): the pushed tag, this
 * package's declared version, every release manifest's declared version, and
 * the CLI's own `--version` output must all agree before anything is built or
 * attached to a release.
 *
 * This matters more than the usual "the numbers should match" check. A tag
 * is immutable the moment someone has fetched it, and a release asset is
 * immutable the moment someone has downloaded it — a `v0.1.0` release whose
 * binary reports `0.0.9` is not fixable after the fact, only replaceable
 * with a `v0.1.1` and an explanation. Catching the mismatch before the build
 * matrix runs is the only point where it is still cheap.
 *
 * Compares every release-version source:
 *   - the git tag this workflow triggered on (`GITHUB_REF_NAME`, e.g.
 *     `v0.1.0`; a plain argument for local testing), with exactly one
 *     leading `v` stripped
 *   - `package.json`'s `.version` field
 *   - `.codex-plugin/plugin.json`'s `.version` field — the same, for Codex
 *   - `.claude-plugin/plugin.json`'s `.version` field — the manifest Claude
 *     Code resolves when installing the canonical plugin distribution
 *   - `package-lock.json`'s `.version` and `.packages[""].version` fields.
 *     They are independent root-package declarations and must both move with
 *     the release, while dependency versions in that lockfile do not.
 *   - `node dist/commitlore.mjs --version` — the same value every build of
 *     the CLI reports, script or compiled binary, since both read it from
 *     the same `packageVersion()` (`src/core/paths.ts`) against the same
 *     `package.json`. Checking the script build is enough to cover both;
 *     the build does not touch the version.
 *
 * Usage:
 *   node scripts/check-release-version.mjs v0.1.0
 *   GITHUB_REF_NAME=v0.1.0 node scripts/check-release-version.mjs
 *
 * Requires `npm run build` to have already produced dist/commitlore.mjs.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUNDLE = join(REPO_ROOT, 'dist', 'commitlore.mjs');

/**
 * A missing or malformed manifest is an inability to run this gate (exit 2),
 * not a version disagreement (exit 1). Name every field it would have
 * supplied so the release operator knows exactly what to restore or repair.
 */
const readManifest = (relativePath, fields) => {
  const path = join(REPO_ROOT, relativePath);
  const sources = fields.map((field) => `${relativePath} ${field}`).join(' and ');
  if (!existsSync(path)) {
    console.error(`ERROR: ${sources} cannot be checked: required manifest is missing`);
    process.exit(2);
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: ${sources} cannot be checked: invalid JSON (${reason})`);
    process.exit(2);
  }
};

const requiredVersion = (value, source) => {
  if (typeof value !== 'string' || value === '') {
    console.error(`ERROR: ${source} must be a non-empty version string`);
    process.exit(2);
  }
  return value;
};

const tagArg = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tagArg) {
  console.error('ERROR: no tag given — pass one as an argument or set GITHUB_REF_NAME');
  console.error('  usage: node scripts/check-release-version.mjs v0.1.0');
  process.exit(2);
}
if (!/^v\d/.test(tagArg)) {
  console.error(`ERROR: tag "${tagArg}" does not look like "v<version>" — release.yml only triggers on v* tags`);
  process.exit(2);
}
const tagVersion = tagArg.slice(1);

if (!existsSync(BUNDLE)) {
  console.error(`ERROR: ${BUNDLE} does not exist — run \`npm run build\` first`);
  process.exit(2);
}

const pkg = readManifest('package.json', ['.version']);
const plugin = readManifest('.claude-plugin/plugin.json', ['.version']);
// The Codex manifest is the third one a release has to move, and it was not
// checked. Nothing else would have caught it: `--version` reads the bundle, and
// the plugin installs from a tag whose manifest a stale field does not block.
// A Codex user would have installed this release and been told it was the
// previous one.
const codexPlugin = readManifest('.codex-plugin/plugin.json', ['.version']);
const packageLock = readManifest('package-lock.json', ['.version', '.packages[""].version']);

const pkgVersion = requiredVersion(pkg.version, 'package.json .version');
const pluginVersion = requiredVersion(plugin.version, '.claude-plugin/plugin.json .version');
const codexPluginVersion = requiredVersion(
  codexPlugin.version,
  '.codex-plugin/plugin.json .version',
);
const packageLockVersion = requiredVersion(packageLock.version, 'package-lock.json .version');
const packageLockRootVersion = requiredVersion(
  packageLock.packages?.['']?.version,
  'package-lock.json .packages[""].version',
);

const cliVersion = execFileSync(process.execPath, [BUNDLE, '--version'], { encoding: 'utf8' }).trim();

const mismatches = [];
const versionSources = [
  ['package.json .version', pkgVersion],
  ['.claude-plugin/plugin.json .version', pluginVersion],
  ['.codex-plugin/plugin.json .version', codexPluginVersion],
  ['package-lock.json .version', packageLockVersion],
  ['package-lock.json .packages[""].version', packageLockRootVersion],
  ['dist/commitlore.mjs --version', cliVersion],
];
for (const [source, version] of versionSources) {
  if (tagVersion !== version) {
    mismatches.push(`tag "${tagArg}" (${tagVersion}) != ${source} (${version})`);
  }
}

if (mismatches.length > 0) {
  console.error(`ERROR: version mismatch — refusing to release (${mismatches.length} disagreement(s)):`);
  for (const m of mismatches) console.error(`  - ${m}`);
  console.error('  Delete the tag, fix every named manifest (and rebuild), and push a corrected tag.');
  process.exit(1);
}

console.log(
  `version consistent: tag ${tagArg} == package.json .version ${pkgVersion} == ` +
    `.claude-plugin/plugin.json .version ${pluginVersion} == ` +
    `.codex-plugin/plugin.json .version ${codexPluginVersion} == package-lock.json .version ` +
    `${packageLockVersion} == package-lock.json .packages[""].version ${packageLockRootVersion} == ` +
    `dist/commitlore.mjs --version ${cliVersion}`,
);
