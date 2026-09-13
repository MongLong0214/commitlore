/**
 * #963: `validate --range` reads each message's grammar once, not twice.
 *
 * The issue proposes parent-specific reachable sets, on the theory that the
 * per-commit graph walk is the cost. The measurement says otherwise: over a
 * 79-commit range of this repository's history, 81 of 445 processes were the
 * walk (18%) and 339 were the grammar (76%) — and 156 of those were the same
 * messages parsed twice apiece, because the shape pass and the reference pass
 * held separate caches and neither handed the other what it had computed.
 *
 * So the walks stay. Each one's reachable set is still what decides whether a
 * `Follows:` resolves at that commit, and no shared walk can answer that for
 * two commits at once. What changed is that the grammar stopped being re-read:
 * one cache across both passes, warmed in two batched processes for the whole
 * range.
 *
 * Two things are checked, and the count is the lesser of them. A faster answer
 * that is a different answer is not an optimisation, so the fixture carries
 * violations of several kinds and the report is compared in full.
 *
 * On this repository at 79 commits: 179 `interpret-trailers` before, 14 after;
 * 445 git processes before, 281 after.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'commitlore.mjs');

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const scratch = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-963-${label}-`));
  temporaries.push(dir);
  return dir;
};

const IDENTITY = [
  '-c',
  'user.name=CommitLore Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

const git = (dir: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });

/** Enough commits that a process per commit is unmistakable against a batch. */
const COMMITS = 40;

/**
 * A range whose messages exercise every shape that costs a parse.
 *
 * A single-block message is answered from the walk's own atom; only a message
 * with an earlier block reaches the paragraph probes. Both are here, along with
 * messages carrying no record at all, because the prefilter's loose test has to
 * fire on a paragraph that yields nothing.
 */
const fixtureRepo = (): { dir: string; range: string } => {
  const dir = scratch('repo');
  git(dir, ['init', '-q', '--initial-branch=main']);

  const commit = (message: string, file: string): void => {
    writeFileSync(join(dir, file), `${file}\n`);
    git(dir, ['add', '-A']);
    git(dir, [...IDENTITY, 'commit', '-q', '--no-verify', '--cleanup=verbatim', '-m', message]);
  };

  commit('base\n\nnothing recorded\n', 'base.ts');
  const base = git(dir, ['rev-parse', 'HEAD']).trim();

  for (let i = 0; i < COMMITS; i += 1) {
    const tag = i.toString(36).padStart(2, '0');
    if (i % 4 === 0) {
      commit(`plain ${tag}\n\nno record here\n`, `plain-${tag}.ts`);
    } else if (i % 4 === 1) {
      commit(
        `single ${tag}\n\nA constraint the diff cannot show.\n\n` +
          `Record-Id: r-single${tag}0\nBlast: local\n`,
        `single-${tag}.ts`,
      );
    } else if (i % 4 === 2) {
      // Two blocks: an inherited one and the message's own. The only shape
      // that reaches the earlier-paragraph probes at all.
      commit(
        `multi ${tag}\n\nRecord-Id: r-inher${tag}0\nBlast: local\n` +
          `\ninherited from a squashed commit\n\n` +
          `Record-Id: r-ownxx${tag}0\nWarn: the next reader needs to know\nBlast: module\n`,
        `multi-${tag}.ts`,
      );
    } else {
      // Prose that mentions the key without carrying one.
      commit(
        `prose ${tag}\n\nThis paragraph talks about a record-id without carrying one.\n\n` +
          `Record-Id: r-prose${tag}0\nBlast: local\n`,
        `prose-${tag}.ts`,
      );
    }
  }

  // Findings of three different kinds, so the report has something to differ
  // about. A comparison over a clean range proves nothing.
  commit(`bad enum\n\nRecord-Id: r-badenum001\nBlast: galaxy\n`, 'enum.ts');
  commit(`dangling\n\nRecord-Id: r-dangling01\nFollows: r-nothinghere\nBlast: local\n`, 'dangle.ts');

  return { dir, range: `${base}..HEAD` };
};

/** A git that records its own argv before running. */
const shim = (): string => {
  const dir = scratch('bin');
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  writeFileSync(
    join(dir, 'git'),
    `#!/bin/sh\necho "$*" >> "\${COMMITLORE_TEST_CALL_LOG:-/dev/null}"\nexec ${real} "$@"\n`,
  );
  execFileSync('chmod', ['+x', join(dir, 'git')]);
  return dir;
};

const validateRange = (repo: string, range: string): { report: unknown; shapes: Map<string, number> } => {
  const log = join(scratch('log'), 'calls.txt');
  writeFileSync(log, '');
  const result = spawnSync(process.execPath, [CLI, 'validate', '--range', range, '--json'], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    env: {
      ...process.env,
      PATH: `${shim()}:${process.env['PATH'] ?? ''}`,
      COMMITLORE_TEST_CALL_LOG: log,
    },
  });
  if (result.stdout === '') throw new Error(`validate produced nothing: ${result.stderr}`);

  const shapes = new Map<string, number>();
  for (const argv of readFileSync(log, 'utf8').split('\n').filter((line) => line !== '')) {
    const word =
      argv.split(' ').find((part) => part !== '' && !part.startsWith('-') && !part.includes('=')) ??
      '?';
    shapes.set(word, (shapes.get(word) ?? 0) + 1);
  }
  return { report: JSON.parse(result.stdout) as unknown, shapes };
};

describe('#963 validate --range reads a message once', () => {
  it('still reports every finding, of every kind', () => {
    const { dir, range } = fixtureRepo();
    const { report } = validateRange(dir, range);

    const violations = (report as { violations?: { rule: string }[] }).violations ?? [];
    const rules = [...new Set(violations.map((v) => v.rule))].sort();

    // The comparison this test exists for is the one in the negative control:
    // the same report, before and after. What is pinned here is that the report
    // is not empty — a byte-identical pair of empty reports would have proved
    // nothing, which is what a first pass over a clean range actually did.
    expect(rules).toEqual(['dangling-ref', 'enum']);
    expect((report as { examined?: number }).examined).toBe(COMMITS + 2);
  }, 300_000);

  /**
   * The revisions go to git on stdin, never on argv.
   *
   * A range is unbounded, and 780 object names is 32 KB of command line --
   * exactly where Windows refuses. Neither matrix leg runs Windows, so nothing
   * in CI would have caught it; what this asserts instead is the property that
   * makes the platform irrelevant, read from the invocation itself.
   *
   * Counted as object names rather than as argv length, which is the second
   * version of this test. The first asserted "no long git command line" and
   * failed on `isolateBlocks`, whose probe passes temp file paths on argv --
   * bounded by its own batch size and not by the range, so it is the legitimate
   * case the blunt assertion could not tell from the defect.
   */
  it('passes the range to git on stdin rather than on the command line', () => {
    const { dir, range } = fixtureRepo();
    const log = join(scratch('log'), 'calls.txt');
    writeFileSync(log, '');
    spawnSync(process.execPath, [CLI, 'validate', '--range', range, '--json'], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 1 << 26,
      env: {
        ...process.env,
        PATH: `${shim()}:${process.env['PATH'] ?? ''}`,
        COMMITLORE_TEST_CALL_LOG: log,
      },
    });

    const calls = readFileSync(log, 'utf8').split('\n').filter((line) => line !== '');
    const objectNames = (line: string): number => (line.match(/\b[0-9a-f]{40}\b/g) ?? []).length;
    const worst = calls.reduce(
      (found, line) => (objectNames(line) > objectNames(found) ? line : found),
      '',
    );

    // A range endpoint or two on a command line is ordinary. A list of them is
    // the shape that grows without bound.
    expect(
      objectNames(worst),
      `most object names on one git command line: ${worst.slice(0, 200)}`,
    ).toBeLessThanOrEqual(4);
  }, 300_000);

  it('spends no more parses than the budget recorded beside it', () => {
    const { dir, range } = fixtureRepo();
    const { shapes } = validateRange(dir, range);
    const parses = shapes.get('interpret-trailers') ?? 0;

    // Measured on this fixture: 125 before the change, 2 after. The ceiling has
    // room for a message shape that legitimately needs a process of its own,
    // and sits far enough below 125 that a return to a parse per commit per
    // pass fails here rather than passing quietly.
    expect(
      parses,
      'interpret-trailers on this fixture (batched: 2, unbatched: 125)',
    ).toBeLessThanOrEqual(12);
    // A floor: zero would mean the range was never read and the ceiling above
    // proved nothing.
    expect(parses).toBeGreaterThan(0);
  }, 300_000);
});
