#!/usr/bin/env node
/**
 * Prints the commit range this repository holds to its own protocol.
 *
 * The boundary is derived, not configured: it is the oldest commit whose
 * trailers declare `CommitLore-Version:`. Everything older predates the
 * vocabulary — this repository ran under two retired names — and everything
 * from there forward must validate.
 *
 * `test/dogfood.test.ts` derives the same boundary for the library path. This
 * script exists so the CLI path in CI does not hardcode a sha instead, because
 * a hand-maintained cutoff goes stale and a stale cutoff reads as passing.
 *
 * Usage: node scripts/adoption-range.mjs        -> "<sha>..HEAD"
 *        node scripts/adoption-range.mjs --sha  -> "<sha>"
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const git = (args) =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
  console.error('ERROR: shallow clone — the adoption boundary cannot be derived');
  console.error('  → check out with fetch-depth: 0');
  process.exit(1);
}

// One pass, oldest first, so the first hit is the adoption commit.
// `%(trailers:key=…)` is git's own trailer parser — the only parser this
// protocol accepts (SPEC §2), and it avoids spawning git per commit. NUL
// between fields and RS between commits: a message can legally contain
// anything else.
const rows = git([
  'log',
  '--reverse',
  '--format=%H%x00%(trailers:key=CommitLore-Version,valueonly,separator=%x2C)%x1e',
]);

let adoption = null;

for (const chunk of rows.split('\x1e')) {
  const row = chunk.replace(/^\n/, '');
  if (row.trim().length === 0) continue;
  const [sha = '', version = ''] = row.split('\x00');
  if (version.trim().length > 0) {
    adoption = sha.trim();
    break;
  }
}

if (adoption === null) {
  console.error('ERROR: no commit declares CommitLore-Version:');
  console.error('  → the repository does not use the protocol it defines');
  process.exit(1);
}

process.stdout.write(process.argv.includes('--sha') ? adoption : `${adoption}..HEAD`);
