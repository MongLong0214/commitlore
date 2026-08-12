#!/usr/bin/env node
/**
 * Fails when a dependency demands a newer Node than this package promises.
 *
 * The floor is whatever `engines.node` in package.json says -- 22.12.0 as of
 * 0.8.1, raised from 20 when commander began requiring it. This script reads
 * that field rather than repeating it, so the number cannot drift out of a
 * comment. A dependency that requires more than the floor makes the package's
 * promise false for every user on it -- and the failure does
 * not show up locally, because the person adding the dependency is usually on
 * a newer runtime than the floor they are breaking. It showed up here as two
 * test workers dying in CI with no explanation, on a module that had already
 * been reviewed and its issue closed.
 *
 * npm prints EBADENGINE as a warning and installs anyway, so the signal exists
 * but does not stop anything. This turns it into a failure.
 *
 * Usage: node scripts/check-engines.mjs
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const NODE_MODULES = join(REPO_ROOT, 'node_modules');

import { rangeMinimum, admits } from './engine-floor.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const pkg = readJson(join(REPO_ROOT, 'package.json'));
const declared = pkg.engines?.node;
if (!declared) {
  console.error('ERROR: package.json declares no engines.node, so there is no floor to check');
  process.exit(2);
}

const floor = rangeMinimum(declared);
if (floor === null) {
  console.error(`ERROR: cannot read a version out of engines.node = ${declared}`);
  process.exit(2);
}
const floorText = floor.join('.');


const directDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });

const offenders = [];
for (const name of directDeps) {
  const manifest = join(NODE_MODULES, ...name.split('/'), 'package.json');
  if (!existsSync(manifest)) continue;
  const range = readJson(manifest).engines?.node;
  if (!range) continue;
  if (!admits(range, floor)) {
    offenders.push({ name, range });
  }
}

if (offenders.length > 0) {
  console.error(`ERROR: ${offenders.length} dependency(ies) do not support Node ${floorText}, which package.json promises (${declared}):`);
  for (const { name, range } of offenders) {
    console.error(`  → ${name} requires node ${range}`);
  }
  console.error('  Either pin a version that supports the floor, or change the floor in an ADR');
  console.error('  and update package.json, the CI matrix, and the README together.');
  process.exit(1);
}

console.log(`all ${directDeps.length} direct dependencies support Node ${floorText} (${declared})`);
