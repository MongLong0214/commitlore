#!/usr/bin/env node
// T-704: the README's measured numbers must be regenerable, byte for byte.
//
// The rule this enforces is the one the project states in "Numbers or silence":
// every figure in the README comes out of `bench/results/*.jsonl` through
// `bench/report.ts`, and nothing reaches it by hand. A rate that someone typed —
// or one that was generated honestly and then went stale when the matrix grew —
// fails here, which is the only way a documentation claim stays checkable.
//
// It does two things:
//
//   1. regenerates `bench/report.ts --section` and compares it byte for byte
//      with the block between the markers in README.md;
//   2. refuses a small set of statistics *outside* the block. A generated block
//      is worth nothing if the paragraph above it carries a hand-written p-value.
//
// Usage:
//   node scripts/check-readme-numbers.mjs [--write] [--readme <path>] [<results.jsonl>...]
//
// With no result files it regenerates from the sources declared in
// bench/report.ts (README_SOURCES) — which is what CI runs. `--write` replaces
// the block in place, so the block is never assembled by a human hand at all;
// CI never passes --write, so a repository that skipped it still fails.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const usage = () => {
  process.stderr.write(
    'usage: check-readme-numbers.mjs [--write] [--readme <path>] [<results.jsonl>...]\n' +
      '  --readme  the markdown file to check (default: README.md)\n' +
      '  --write   regenerate the block in place instead of only checking it\n',
  );
  return 2;
};

const parseArgs = (argv) => {
  const files = [];
  let readme = path.join(REPO_ROOT, 'README.md');
  let write = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') {
      write = true;
      continue;
    }
    if (arg === '--readme') {
      const value = argv[i + 1];
      if (value === undefined) return null;
      readme = path.resolve(REPO_ROOT, value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) return null;
    files.push(arg);
  }
  return { readme, files, write };
};

/**
 * Runs the generator in a child process rather than importing it.
 *
 * `bench/report.ts` is TypeScript, and this script has to run on the Node floor
 * the package declares (>=22), where type stripping is not on by default. The
 * flag is accepted on every supported version; importing the module directly is
 * not.
 */
const regenerate = (files) => {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', 'bench/report.ts', ...files, '--section'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  if (result.error) {
    process.stderr.write(`check-readme-numbers: could not run bench/report.ts — ${result.error.message}\n`);
    return null;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    process.stderr.write(`check-readme-numbers: bench/report.ts exited ${result.status}\n`);
    return null;
  }
  return result.stdout;
};

/**
 * Statistics that have no business appearing outside the generated block. Kept
 * deliberately short: each pattern is a shape that only ever comes out of the
 * benchmark, so a hit is a hand-written number rather than ordinary prose.
 */
const STRAY_STATISTIC_PATTERNS = [
  { label: 'a p-value', pattern: /\bp\s*=\s*[0-9.]/ },
  { label: 'a percentage-point figure', pattern: /\d+(?:\.\d+)?\s?pp\b/ },
  { label: 'an odds ratio', pattern: /odds ratio/i },
  { label: 'a Fisher test result', pattern: /Fisher exact/i },
];

const firstDifference = (expected, actual) => {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  for (let i = 0; i < Math.max(expectedLines.length, actualLines.length); i += 1) {
    if (expectedLines[i] !== actualLines[i]) {
      return { line: i + 1, expected: expectedLines[i] ?? '(no such line)', actual: actualLines[i] ?? '(no such line)' };
    }
  }
  return null;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) return usage();

  const expected = regenerate(args.files);
  if (expected === null) return 1;

  const expectedLines = expected.replace(/\n$/, '').split('\n');
  // The markers are whatever the generator emits, read off its own output. A
  // copy of them here would be one more thing that can drift.
  const begin = expectedLines[0];
  const end = expectedLines[expectedLines.length - 1];

  if (!fs.existsSync(args.readme)) {
    process.stderr.write(`check-readme-numbers: no such file: ${args.readme}\n`);
    return 1;
  }
  const markdown = fs.readFileSync(args.readme, 'utf8');
  // Repo-relative when it is inside the repo; the full path otherwise, because
  // a diagnostic reading "../../../../tmp/..." helps nobody.
  const inside = path.relative(REPO_ROOT, args.readme);
  const relative = inside !== '' && !inside.startsWith('..') ? inside : args.readme;

  const beginCount = markdown.split(begin).length - 1;
  const endCount = markdown.split(end).length - 1;
  if (beginCount !== 1 || endCount !== 1) {
    process.stderr.write(
      `${relative}: expected exactly one ${begin} ... ${end} block, found ${beginCount} begin and ${endCount} end markers.\n` +
        'A second block would let a stale copy of the numbers survive unnoticed.\n',
    );
    return 1;
  }

  const beginAt = markdown.indexOf(begin);
  const endAt = markdown.indexOf(end);
  if (endAt < beginAt) {
    process.stderr.write(`${relative}: ${end} appears before ${begin}.\n`);
    return 1;
  }

  const actual = markdown.slice(beginAt, endAt + end.length);
  const expectedBlock = expected.replace(/\n$/, '');

  if (args.write) {
    if (actual === expectedBlock) {
      process.stdout.write(`${relative}: already up to date, nothing written\n`);
    } else {
      fs.writeFileSync(
        args.readme,
        markdown.slice(0, beginAt) + expectedBlock + markdown.slice(endAt + end.length),
      );
      process.stdout.write(
        `${relative}: block regenerated (${actual.split('\n').length} lines -> ${expectedBlock.split('\n').length} lines)\n`,
      );
    }
    // Falls through to the stray-statistics check below. Regenerating the block
    // is not a licence to leave a hand-written p-value in the paragraph above
    // it, and that text is outside the block, so the write did not touch it.
  } else if (actual !== expectedBlock) {
    const diff = firstDifference(expectedBlock, actual);
    process.stderr.write(
      `${relative}: the measured-results block does not match what bench/report.ts generates.\n\n` +
        (diff === null
          ? ''
          : `  first difference at line ${diff.line} of the block\n` +
            `  generated: ${diff.expected}\n` +
            `  in README: ${diff.actual}\n\n`) +
        `  README block: ${actual.split('\n').length} lines, ${actual.length} bytes\n` +
        `  generated:    ${expectedBlock.split('\n').length} lines, ${expectedBlock.length} bytes\n\n` +
        'Every number in that block comes from bench/results/ through bench/report.ts. Regenerate it:\n' +
        '  node --experimental-strip-types bench/report.ts --section\n' +
        'and paste the output between the markers, replacing the block entirely.\n',
    );
    return 1;
  }

  const outside = markdown.slice(0, beginAt) + markdown.slice(endAt + end.length);
  const strays = STRAY_STATISTIC_PATTERNS.filter(({ pattern }) => pattern.test(outside));
  if (strays.length > 0) {
    process.stderr.write(
      `${relative}: found ${strays.map(({ label }) => label).join(', ')} outside the generated block.\n` +
        'Measured numbers belong between the markers, where they are regenerated and checked. Move it there,\n' +
        'or delete it if no log produces it.\n',
    );
    return 1;
  }

  if (!args.write) {
    process.stdout.write(
      `${relative}: measured-results block matches bench/report.ts (${expectedBlock.split('\n').length} lines, ${expectedBlock.length} bytes)\n`,
    );
  }
  return 0;
};

process.exitCode = main();
