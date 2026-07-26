#!/usr/bin/env node
/**
 * Fails when a dependency demands a newer Node than this package promises.
 *
 * ADR-0002 sets the floor at Node 20. A dependency that requires 22 makes that
 * promise false for every user on the supported floor -- and the failure does
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

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const pkg = readJson(join(REPO_ROOT, 'package.json'));
const declared = pkg.engines?.node;
if (!declared) {
  console.error('ERROR: package.json declares no engines.node, so there is no floor to check');
  process.exit(2);
}

/** The lowest major this package claims to support, e.g. ">=20" -> 20, "20.x || 22.x" -> 20. */
const floor = (() => {
  const majors = [...declared.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  return majors.length > 0 ? Math.min(...majors) : null;
})();
if (floor === null) {
  console.error(`ERROR: cannot read a major version out of engines.node = ${declared}`);
  process.exit(2);
}

/** True when `range` admits the given major. Handles ">=N", "N.x", and "||" unions. */
const admitsMajor = (range, major) => {
  for (const clause of range.split('||').map((s) => s.trim())) {
    if (/^\*$/.test(clause)) return true;
    const gte = clause.match(/^>=\s*(\d+)/);
    if (gte && major >= Number(gte[1])) return true;
    const exact = clause.match(/^\^?~?(\d+)(?:\.[\dx*]+)*$/);
    if (exact && Number(exact[1]) === major) return true;
  }
  return false;
};

const directDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });

const offenders = [];
for (const name of directDeps) {
  const manifest = join(NODE_MODULES, ...name.split('/'), 'package.json');
  if (!existsSync(manifest)) continue;
  const range = readJson(manifest).engines?.node;
  if (!range) continue;
  if (!admitsMajor(range, floor)) {
    offenders.push({ name, range });
  }
}

if (offenders.length > 0) {
  console.error(`ERROR: ${offenders.length} dependency(ies) do not support Node ${floor}, which package.json promises (${declared}):`);
  for (const { name, range } of offenders) {
    console.error(`  → ${name} requires node ${range}`);
  }
  console.error('  Either pin a version that supports the floor, or change the floor in an ADR');
  console.error('  and update package.json, the CI matrix, and the README together.');
  process.exit(1);
}

console.log(`all ${directDeps.length} direct dependencies support Node ${floor} (${declared})`);
