#!/usr/bin/env node
// T-704: the README's measured numbers must be regenerable, byte for byte.
//
// The rule this enforces is the one the project states in "Numbers or silence":
// every figure in the README comes out of `bench/results/*.jsonl` through
// `bench/report.ts`, and nothing reaches it by hand. A rate that someone typed —
// or one that was generated honestly and then went stale when the matrix grew —
// fails here, which is the only way a documentation claim stays checkable.
//
// It does three things:
//
//   1. when the declared datasets carry provenance, regenerates
//      `bench/report.ts --section` and compares it byte for byte with README.md;
//   2. while any row lacks provenance, requires the withdrawal notice in all
//      four READMEs and refuses a generated block;
//   3. refuses a small set of statistics *outside* the block. A generated block
//      is worth nothing if the paragraph above it carries a hand-written p-value.
//
// Usage:
//   node scripts/check-readme-numbers.mjs [--write] [--readme <path>] [<results.jsonl>...]
//
// With no result files it checks the sources declared in bench/report.ts
// (README_SOURCES) — which is what CI runs. `--write` replaces a generated block
// only after the provenance gate passes.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC_READMES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md'].map((file) =>
  path.join(REPO_ROOT, file),
);
const WITHDRAWAL_MARKER = '<!-- BENCH:WITHDRAWN -->';
const GENERATED_BEGIN = '<!-- BENCH:BEGIN -->';
const GENERATED_END = '<!-- BENCH:END -->';

const usage = () => {
  process.stderr.write(
    'usage: check-readme-numbers.mjs [--write] [--readme <path>] [<results.jsonl>...]\n' +
      '  --readme  one markdown file to check (default: all four public READMEs)\n' +
      '  --write   regenerate the block in place instead of only checking it\n',
  );
  return 2;
};

const parseArgs = (argv) => {
  const files = [];
  let readme = null;
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
    if (/\bunrecorded:\s*\d+/.test(result.stderr)) {
      return { expected: null, provenanceRecorded: false };
    }
    process.stderr.write(result.stderr || '');
    process.stderr.write(`check-readme-numbers: bench/report.ts exited ${result.status}\n`);
    return null;
  }
  return { expected: result.stdout, provenanceRecorded: true };
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

const relativePath = (file) => {
  const inside = path.relative(REPO_ROOT, file);
  return inside !== '' && !inside.startsWith('..') ? inside : file;
};

/**
 * The M5 verdict is the strongest provenance any figure in this repository has:
 * `bench/m5-analysis.ts` run once over the shards `bench/PREREGISTRATION-M5.md`
 * names, frozen before the run. The generated block is checked byte-for-byte,
 * but these figures live in prose outside it, so the README and the verdict
 * could disagree about the same preregistered experiment indefinitely — and do
 * (issue #590).
 *
 * Reported rather than enforced for now: the README is corrected in one pass
 * once the figures it depends on stop moving, and a check that fails the build
 * before then blocks every unrelated change. `--enforce-verdict` flips it, and
 * that flag is how this becomes a gate rather than a note.
 */
const VERDICT_M5 = path.join(REPO_ROOT, 'bench', 'VERDICT-M5.md');

/** `| \`commitlore-on\` | 16 / 580 | **2.8%** | …` -> {arm, reproposed, total, rate}. */
const verdictArms = () => {
  if (!fs.existsSync(VERDICT_M5)) return [];
  const rows = [];
  for (const line of fs.readFileSync(VERDICT_M5, 'utf8').split('\n')) {
    const match = /^\|\s*`(commitlore-(?:on|off))`\s*\|\s*(\d+)\s*\/\s*(\d+)\s*\|\s*\*\*([\d.]+)%\*\*/.exec(line);
    if (match !== null) {
      const [, arm = '', reproposed = '', total = '', rate = ''] = match;
      rows.push({ arm, reproposed, total, rate });
    }
  }
  return rows;
};

/**
 * Every `(n/m)` the README prints must be a row of that table. A fraction that
 * is not is either a figure the verdict never produced or one it has since
 * revised; both are the disagreement this checks for, and neither is decided
 * here — the message names both documents so a reader can see which moved.
 */
const findVerdictMismatches = (markdown) => {
  const arms = verdictArms();
  if (arms.length === 0) return [];
  const known = new Set(arms.map(({ reproposed, total }) => `${reproposed}/${total}`));
  const seen = new Set();
  const mismatches = [];
  for (const match of markdown.matchAll(/\((\d+)\/(\d+)\)/g)) {
    const fraction = `${match[1]}/${match[2]}`;
    // Arm sizes are in the hundreds. A small fraction in this prose is an
    // ordinary count — "2 of 2 routes" — and matching it would drown the real
    // signal in noise the first time anyone writes one.
    if (Number(match[2]) < 100) continue;
    if (known.has(fraction) || seen.has(fraction)) continue;
    seen.add(fraction);
    mismatches.push(fraction);
  }
  return mismatches;
};

const findStrays = (markdown) =>
  STRAY_STATISTIC_PATTERNS.filter(({ pattern }) => pattern.test(markdown));

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) return usage();

  const generation = regenerate(args.files);
  if (generation === null) return 1;

  const readmePaths = args.readme === null ? PUBLIC_READMES : [args.readme];
  const readmes = [];
  for (const file of readmePaths) {
    if (!fs.existsSync(file)) {
      process.stderr.write(`check-readme-numbers: no such file: ${file}\n`);
      return 1;
    }
    readmes.push({ file, markdown: fs.readFileSync(file, 'utf8'), relative: relativePath(file) });
  }

  for (const { relative, markdown } of readmes) {
    const mismatches = findVerdictMismatches(markdown);
    if (mismatches.length > 0) {
      // stderr and a non-zero exit: drift between the README and the
      // preregistered verdict is a failure now, not a note. It was a note only
      // while the README still disagreed; correcting it is what let this become
      // a gate.
      process.stderr.write(
        `${relative}: ${mismatches.join(', ')} not in bench/VERDICT-M5.md's registered table ` +
          `(${verdictArms().map(({ arm, reproposed, total }) => `${arm} ${reproposed}/${total}`).join(', ')}). ` +
          `One of the two documents is stale; see #590.\n`,
      );
      return 1;
    }
  }

  if (!generation.provenanceRecorded) {
    for (const { markdown, relative } of readmes) {
      const withdrawalCount = markdown.split(WITHDRAWAL_MARKER).length - 1;
      const hasGeneratedBlock = markdown.includes(GENERATED_BEGIN) || markdown.includes(GENERATED_END);
      if (withdrawalCount !== 1 || hasGeneratedBlock) {
        process.stderr.write(
          `${relative}: dataset provenance is unrecorded; expected exactly one withdrawal notice and no generated numbers block.\n`,
        );
        return 1;
      }
      const strays = findStrays(markdown);
      if (strays.length > 0) {
        process.stderr.write(
          `${relative}: found ${strays.map(({ label }) => label).join(', ')} while benchmark numbers are withdrawn.\n`,
        );
        return 1;
      }
    }
    if (!args.write) {
      process.stdout.write(
        `${readmes.map(({ relative }) => relative).join(', ')}: withdrawal notice present; declared datasets lack provenance\n`,
      );
    }
    return 0;
  }

  for (const { markdown, relative } of readmes) {
    if (markdown.includes(WITHDRAWAL_MARKER)) {
      process.stderr.write(
        `${relative}: a provenanced dataset can be summarized, but the README still carries the withdrawal notice.\n`,
      );
      return 1;
    }
  }

  const expected = generation.expected;
  if (expected === null) return 1;
  const expectedLines = expected.replace(/\n$/, '').split('\n');
  // The markers are whatever the generator emits, read off its own output.
  const begin = expectedLines[0];
  const end = expectedLines[expectedLines.length - 1];
  const target = readmes[0];
  if (target === undefined) return 1;
  const { file: readme, markdown, relative } = target;

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
        readme,
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
  const strays = findStrays(outside);
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
