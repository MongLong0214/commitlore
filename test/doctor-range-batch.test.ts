/**
 * #975: `doctor`'s squash row parses every candidate branch in one pass.
 *
 * `collectRange` batches the paragraph probes of one range. The squash row
 * walks one short range per candidate branch, and a short range's own batch
 * saves nothing — below two uncached messages `collectRange` skips the trailer
 * atom outright, because for one message the batch costs exactly the process it
 * saves. Summed over the candidates that was the parse cost the row still had
 * after the per-range batching landed.
 *
 * Two things have to hold, and only one of them is a count:
 *
 *  1. The row must spend materially fewer parses. Measured, not timed.
 *  2. It must report exactly what the unbatched walk reported. A faster answer
 *     that is a different answer is not an optimisation, and this is the half
 *     that a process budget alone would never catch — so the equivalence is
 *     asserted directly against `collectRange` with the cache cold.
 *
 * Measured on this fixture, a `doctor --json` spending `interpret-trailers`:
 * 31 before the change, 2 after. On this repository
 * (1573 commits, 11 notes, index complete) the whole run went 70 -> 30, with 41
 * of the 70 being this row -- attributed by stack, not inferred from the total.
 *
 * The fixture carries 30 candidate branches on purpose. At six the two numbers
 * were 7 and 2, and any ceiling between them is one a later unrelated change
 * can cross by accident; at thirty it is 31 against 2 -- an order of magnitude
 * clear of the batched one, so the ceiling separates them rather than
 * straddling them. A first version of this test used six and passed against
 * the defect.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { collectRange, newRangeCache, warmRangeCache } from '../src/core/squash.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'commitlore.mjs');

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const scratch = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-975-${label}-`));
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

const block = (id: string): string =>
  `Record-Id: r-${id}\nRuled-out: the obvious way | it loses the ordering\nBlast: local\n`;

const BRANCHES = 30;

/**
 * A repository whose branches look like squash sources.
 *
 * Each branch leaves `main` at the same base and is never merged back, which is
 * what `squashCandidates` selects. Every branch commit carries *two* blocks —
 * an inherited one and its own — because that is the only shape that reaches
 * the paragraph probes at all; a single-block message is answered by the walk's
 * own trailer atom and would make this test pass against the defect.
 */
const fixtureRepo = (): { dir: string; ranges: string[] } => {
  const dir = scratch('repo');
  git(dir, ['init', '-q', '--initial-branch=main']);

  const commit = (message: string, file: string): void => {
    writeFileSync(join(dir, file), `${file}\n${message.slice(0, 16)}\n`);
    git(dir, ['add', '-A']);
    git(dir, [...IDENTITY, 'commit', '-q', '--no-verify', '--cleanup=verbatim', '-m', message]);
  };

  commit('base\n\nnothing recorded\n', 'base.ts');
  const base = git(dir, ['rev-parse', 'HEAD']).trim();

  const ranges: string[] = [];
  for (let b = 0; b < BRANCHES; b += 1) {
    const name = `feature-${String(b)}`;
    git(dir, ['checkout', '-q', '-b', name, base]);
    // Two commits each: enough that the range is real, few enough that its own
    // batch would still be skipped as unprofitable.
    for (let c = 0; c < 2; c += 1) {
      const tag = `${b.toString(36)}${c.toString(36)}`;
      commit(
        `feature ${tag}\n\n${block(`i${tag}`)}\ninherited from a squashed commit\n\n${block(`o${tag}`)}`,
        `feature-${tag}.ts`,
      );
    }
    ranges.push(`${base}..${git(dir, ['rev-parse', 'HEAD']).trim()}`);
  }

  git(dir, ['checkout', '-q', 'main']);
  // HEAD moves on so the branches are not ancestors of it — a branch HEAD
  // already contains is not a candidate, and the row would skip every one.
  commit('main moves on\n\nnothing recorded\n', 'later.ts');
  return { dir, ranges };
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

const doctorShapes = (repo: string): Map<string, number> => {
  const log = join(scratch('log'), 'calls.txt');
  writeFileSync(log, '');
  const result = spawnSync(process.execPath, [CLI, 'doctor', '--json'], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    env: {
      ...process.env,
      PATH: `${shim()}:${process.env['PATH'] ?? ''}`,
      COMMITLORE_TEST_CALL_LOG: log,
    },
  });
  // `doctor` exits non-zero when a row warns, which this fixture's rows do —
  // it is a report, not a gate, and the counts are what this reads.
  if (result.stdout === '') throw new Error(`doctor produced nothing: ${result.stderr}`);

  const byShape = new Map<string, number>();
  for (const argv of readFileSync(log, 'utf8').split('\n').filter((line) => line !== '')) {
    const word =
      argv.split(' ').find((part) => part !== '' && !part.startsWith('-') && !part.includes('=')) ??
      '?';
    byShape.set(word, (byShape.get(word) ?? 0) + 1);
  }
  return byShape;
};

describe('#975 the squash row parses its candidates in one pass', () => {
  it('reports exactly what walking each range separately reports', () => {
    const { dir, ranges } = fixtureRepo();

    // Cold: every range parses its own messages, as before the change.
    const separate = ranges.map((range) =>
      collectRange(range, { cwd: dir, cache: newRangeCache() }),
    );

    // Warmed: one pass over every range, then the same walks reading from it.
    const cache = newRangeCache();
    warmRangeCache(ranges, { cwd: dir, cache });
    const batched = ranges.map((range) => collectRange(range, { cwd: dir, cache }));

    expect(batched).toEqual(separate);
    // And it actually collected something, or the equality above is vacuous:
    // two blocks on each of two commits, per branch.
    expect(separate.flat()).toHaveLength(BRANCHES * 4);
  }, 120_000);

  it('spends no more parses than the budget recorded beside it', () => {
    const { dir } = fixtureRepo();
    const shapes = doctorShapes(dir);
    const parses = shapes.get('interpret-trailers') ?? 0;

    // The ceiling sits just above the batched cost and far below the unbatched
    // one. Both numbers are in the header, and a change that raises this has to
    // say which of them moved. The message carries the count so a failure does
    // not need the harness re-run by hand to learn what it was.
    expect(parses, `interpret-trailers on this fixture (batched: 2, unbatched: 31)`).toBeLessThanOrEqual(8);
    // A floor as well: zero would mean the row never ran and the ceiling above
    // proved nothing. The probes for the inherited blocks still cost one pass.
    expect(parses).toBeGreaterThan(0);
  }, 300_000);
});
