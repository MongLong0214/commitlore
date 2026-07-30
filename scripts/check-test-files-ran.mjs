#!/usr/bin/env node
/**
 * Fails when a test file on disk did not appear in the run.
 *
 * A vitest worker that dies takes its file's results with it. The run reports
 * every other file as green, the missing file is simply absent, and the summary
 * looks like a pass. That is how `better-sqlite3` silently removed both index
 * test files from CI while the job stayed green on everything else -- the crash
 * only surfaced because it also raised an unhandled error, which is luck, not a
 * guarantee.
 *
 * Comparing the files on disk to the files in the report turns "absent" into
 * "failed", which is what it always was.
 *
 * Usage: node scripts/check-test-files-ran.mjs <vitest-json-report>
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TEST_DIR = resolve(REPO_ROOT, 'test');

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('usage: check-test-files-ran.mjs <vitest-json-report>');
  process.exit(2);
}
if (!existsSync(reportPath)) {
  console.error(`ERROR: report not found: ${reportPath}`);
  console.error('  → run vitest with --reporter=json --outputFile=<path>');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`ERROR: ${reportPath} is not valid JSON — ${error.message}`);
  process.exit(2);
}

const onDisk = readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => `test/${name}`)
  .sort();

if (onDisk.length === 0) {
  console.error('ERROR: no test files found on disk — the glob or the layout changed');
  process.exit(1);
}

const ran = new Set(
  (report.testResults ?? [])
    .map((result) => result.name)
    .filter((name) => typeof name === 'string')
    .map((name) => relative(REPO_ROOT, name)),
);

const missing = onDisk.filter((file) => !ran.has(file));

if (missing.length > 0) {
  console.error(`ERROR: ${missing.length} test file(s) on disk did not appear in the run:`);
  for (const file of missing) console.error(`  → ${file}`);
  console.error('  A worker that dies removes its file from the report without failing the run.');
  console.error('  Check for a native module loaded under the thread pool (vitest `pool: forks`).');
  process.exit(1);
}

console.log(`all ${onDisk.length} test files ran`);
