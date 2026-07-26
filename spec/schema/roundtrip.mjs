#!/usr/bin/env node
// Round-trip check (SPEC §2.3): parsing a canonically serialized trailer
// block MUST yield an identical trailer list. "Identical" is checked here as
// the same multiset of {key, value} pairs — canonical serialization
// intentionally reorders into vocabulary order, so re-parsing it is not
// expected to reproduce the *original* commit's line order (that ordering
// guarantee is checked separately, against the real fixture, by
// compare-trailers.mjs).
//
// Usage: node roundtrip.mjs <fixture.expected.json>
// Exit 0 = round-trips, exit 1 = does not (diff printed to stderr).

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [, , jsonPath] = process.argv;
if (!jsonPath) {
  console.error('usage: node roundtrip.mjs <fixture.expected.json>');
  process.exit(2);
}

const fixture = JSON.parse(readFileSync(jsonPath, 'utf8'));
const expected = fixture.trailers ?? [];
const canonical = fixture.canonical ?? '';

if (canonical === '') {
  // Zero-trailer records (B3, B7) have no trailer block to round-trip.
  process.exit(expected.length === 0 ? 0 : 1);
}

// A trailer block needs a preceding subject + blank line to be recognized as
// the *last* paragraph rather than as the message's only paragraph (which
// git treats as the subject, not as trailers — verified empirically).
const message = `Round-trip check\n\n${canonical}`;
const gitOutput = execFileSync('git', ['interpret-trailers', '--parse', '--no-divider'], {
  input: message,
}).toString('utf8');

const reparsed = gitOutput
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => {
    const idx = line.indexOf(': ');
    if (idx === -1) {
      throw new Error(`unparseable git interpret-trailers output line: ${JSON.stringify(line)}`);
    }
    return { key: line.slice(0, idx), value: line.slice(idx + 2) };
  });

const normalize = (list) => [...list].map((t) => JSON.stringify(t)).sort();
const same = JSON.stringify(normalize(reparsed)) === JSON.stringify(normalize(expected));

if (!same) {
  console.error('round-trip mismatch:');
  console.error('  reparsed canonical: ' + JSON.stringify(reparsed));
  console.error('  expected.trailers:  ' + JSON.stringify(expected));
}
process.exit(same ? 0 : 1);
