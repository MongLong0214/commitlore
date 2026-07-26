#!/usr/bin/env node
// Compares `git interpret-trailers --parse --no-divider` output for a fixture
// .txt against the `trailers` array in its *.expected.json sibling. Order
// matters here (SPEC §2.1 B5: every occurrence preserved, in order).
// Used by spec/verify.sh.
//
// Usage: node compare-trailers.mjs <fixture.txt> <fixture.expected.json>
// Exit 0 = match, exit 1 = mismatch (diff printed to stderr).

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [, , txtPath, jsonPath] = process.argv;
if (!txtPath || !jsonPath) {
  console.error('usage: node compare-trailers.mjs <fixture.txt> <fixture.expected.json>');
  process.exit(2);
}

const raw = readFileSync(txtPath);
const gitOutput = execFileSync('git', ['interpret-trailers', '--parse', '--no-divider'], {
  input: raw,
}).toString('utf8');

const actual = gitOutput
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => {
    const idx = line.indexOf(': ');
    if (idx === -1) {
      throw new Error(`unparseable git interpret-trailers output line: ${JSON.stringify(line)}`);
    }
    return { key: line.slice(0, idx), value: line.slice(idx + 2) };
  });

const expected = JSON.parse(readFileSync(jsonPath, 'utf8')).trailers ?? [];

const same = JSON.stringify(actual) === JSON.stringify(expected);
if (!same) {
  console.error('trailer mismatch:');
  console.error('  git actual:    ' + JSON.stringify(actual));
  console.error('  expected.json: ' + JSON.stringify(expected));
}
process.exit(same ? 0 : 1);
