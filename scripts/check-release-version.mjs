#!/usr/bin/env node
/**
 * Release gate (`.github/workflows/release.yml`): the pushed tag, this
 * package's declared version, and the CLI's own `--version` output must all
 * agree before anything is built or attached to a release.
 *
 * This matters more than the usual "the numbers should match" check. A tag
 * is immutable the moment someone has fetched it, and a release asset is
 * immutable the moment someone has downloaded it — a `v0.1.0` release whose
 * binary reports `0.0.9` is not fixable after the fact, only replaceable
 * with a `v0.1.1` and an explanation. Catching the mismatch before the build
 * matrix runs is the only point where it is still cheap.
 *
 * Compares three sources:
 *   - the git tag this workflow triggered on (`GITHUB_REF_NAME`, e.g.
 *     `v0.1.0`; a plain argument for local testing), with exactly one
 *     leading `v` stripped
 *   - `package.json`'s `"version"` field
 *   - `node dist/commitlore.mjs --version` — the same value every build of
 *     the CLI reports, script or compiled binary, since both read it from
 *     the same `packageVersion()` (`src/core/paths.ts`) against the same
 *     `package.json`. Checking the script build is enough to cover both;
 *     `scripts/build-binary.mjs` does not touch the version.
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

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
const pkgVersion = pkg.version;
if (typeof pkgVersion !== 'string' || pkgVersion === '') {
  console.error('ERROR: package.json has no "version" string');
  process.exit(2);
}

const cliVersion = execFileSync(process.execPath, [BUNDLE, '--version'], { encoding: 'utf8' }).trim();

const mismatches = [];
if (tagVersion !== pkgVersion) {
  mismatches.push(`tag "${tagArg}" (${tagVersion}) != package.json "version" (${pkgVersion})`);
}
if (pkgVersion !== cliVersion) {
  mismatches.push(`package.json "version" (${pkgVersion}) != \`commitlore --version\` (${cliVersion})`);
}
if (tagVersion !== cliVersion) {
  mismatches.push(`tag "${tagArg}" (${tagVersion}) != \`commitlore --version\` (${cliVersion})`);
}

if (mismatches.length > 0) {
  console.error(`ERROR: version mismatch — refusing to release (${mismatches.length} disagreement(s)):`);
  for (const m of mismatches) console.error(`  - ${m}`);
  console.error('  Delete the tag, fix package.json (and rebuild), and push a corrected tag.');
  process.exit(1);
}

console.log(`version consistent: tag ${tagArg} == package.json ${pkgVersion} == commitlore --version ${cliVersion}`);
