/**
 * #959: what a cold index costs, in processes, against a budget.
 *
 * Nothing noticed this number moving. It went 261 -> 172 -> 31 across two
 * releases and would have gone back just as quietly — every one of those was
 * found by attaching a PATH shim by hand.
 *
 * Counts, never durations. The same code has timed at 145ms and 3.7s on one
 * machine depending on what else was running, and a budget on that would either
 * be useless or flap. A process count is exact and load cannot move it.
 *
 * The fixture is built here rather than taken from `scripts/make-synthetic-repo.mjs`,
 * and that is the point of it: a generated history carries no multi-block
 * messages, so it never reaches the pass this is guarding. 20,000 generated
 * commits spend **zero** `interpret-trailers` processes and would hold a budget
 * of zero for ever while the real cost went unwatched. Every shape below is one
 * this repository's own history contains.
 *
 * When this fails: measure, then either fix the regression or raise the budget
 * in a commit that records why. A budget raised without a reason is the same as
 * no budget, arrived at more slowly.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const dir = mkdtempSync(join(tmpdir(), `commitlore-budget-${label}-`));
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

/** A record block, the way this repository writes them. */
const block = (id: string, extra = ''): string =>
  `Record-Id: r-${id}\nRuled-out: the obvious way | it loses the ordering\nBlast: local\n${extra}`;

/**
 * A history with every shape that costs something.
 *
 * `single` commits carry one block and are answered by the walk's own atom.
 * `multi` commits carry an earlier block as well — what `squash-preserve`
 * writes, and the only shape that reaches the paragraph probes. `prose`
 * commits mention the key without carrying one, which is what makes the
 * prefilter's loose test fire on a paragraph that yields nothing.
 */
const fixtureRepo = (): string => {
  const dir = scratch('repo');
  git(dir, ['init', '-q', '--initial-branch=main']);

  const commit = (message: string, file: string): void => {
    writeFileSync(join(dir, file), `${file}\n${message.slice(0, 20)}\n`);
    git(dir, ['add', '-A']);
    git(dir, [...IDENTITY, 'commit', '-q', '--no-verify', '--cleanup=verbatim', '-m', message]);
  };

  for (let i = 0; i < 40; i += 1) commit(`plain ${String(i)}\n\nno record here\n`, `plain-${String(i)}.ts`);
  for (let i = 0; i < 20; i += 1) {
    commit(`single ${String(i)}\n\nA constraint the diff cannot show.\n\n${block(`s${i.toString(36)}`)}`, `single-${String(i)}.ts`);
  }
  for (let i = 0; i < 12; i += 1) {
    // Two blocks in one message: an inherited one, then the message's own.
    commit(
      `multi ${String(i)}\n\n${block(`m${i.toString(36)}a`)}\ninherited from a squashed commit\n\n${block(`m${i.toString(36)}b`)}`,
      `multi-${String(i)}.ts`,
    );
  }
  for (let i = 0; i < 8; i += 1) {
    commit(
      `prose ${String(i)}\n\nThis paragraph talks about a record-id without carrying one.\n\n${block(`p${i.toString(36)}`)}`,
      `prose-${String(i)}.ts`,
    );
  }

  // A notes mirror, which is its own reader with its own costs.
  for (const sha of git(dir, ['rev-list', '-6', 'HEAD']).split('\n').filter((s) => s !== '')) {
    git(dir, [
      ...IDENTITY,
      'notes',
      '--ref=refs/notes/commitlore',
      'add',
      '-f',
      '-m',
      `note\n\n${block(`n${sha.slice(0, 5)}`)}`,
      sha,
    ]);
  }

  return dir;
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

/** Processes by subcommand, for one cold `index --rebuild`. */
const coldRebuildShapes = (repo: string): { total: number; byShape: Map<string, number> } => {
  rmSync(join(repo, '.git', 'commitlore'), { recursive: true, force: true });
  mkdirSync(join(repo, '.git', 'commitlore'), { recursive: true });

  const log = join(scratch('log'), 'calls.txt');
  writeFileSync(log, '');
  const result = spawnSync(process.execPath, [CLI, 'index', '--rebuild', '--json'], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${shim()}:${process.env['PATH'] ?? ''}`,
      COMMITLORE_TEST_CALL_LOG: log,
    },
  });
  if (result.status !== 0) {
    throw new Error(`index --rebuild failed (${String(result.status)}): ${result.stderr}`);
  }

  const calls = readFileSync(log, 'utf8').split('\n').filter((line) => line !== '');
  const byShape = new Map<string, number>();
  for (const argv of calls) {
    const word = argv.split(' ').find((part) => part !== '' && !part.startsWith('-') && !part.includes('=')) ?? '?';
    byShape.set(word, (byShape.get(word) ?? 0) + 1);
  }
  return { total: calls.length, byShape };
};

describe('#959 a cold index stays inside its process budget', () => {
  it('spends no more processes than the budget recorded beside it', () => {
    const repo = fixtureRepo();
    const { total, byShape } = coldRebuildShapes(repo);
    const shapes = Object.fromEntries([...byShape].sort((a, b) => b[1] - a[1]));

    // Measured on this fixture at 1.3.3:
    //
    //   total 21 — interpret-trailers 7, log 5, rev-parse 4, config 2,
    //              rev-list 1, notes 1, cat-file 1
    //
    // The ceilings are those numbers plus one or two. The headroom is chosen
    // against the shape of a regression rather than as a round number: the
    // fixture carries 40 record-bearing commits and 6 notes, so anything that
    // slips back to a process per commit, per record or per paragraph adds
    // twenty or more and fails immediately, while a change that legitimately
    // needs one more `config` read does not flap the suite.
    //
    // Loose budgets are the failure mode to avoid here. At `total: 40` — which
    // is what this had before the numbers were read — a rebuild could spend
    // ninety per cent more than it does and still pass.
    const BUDGET: Record<string, number> = {
      total: 26,
      'interpret-trailers': 9,
      log: 7,
      'rev-parse': 6,
      config: 3,
      'rev-list': 2,
      notes: 2,
      'cat-file': 2,
    };

    const over = Object.entries(BUDGET)
      .filter(([shape, ceiling]) => (shape === 'total' ? total : (byShape.get(shape) ?? 0)) > ceiling)
      .map(([shape, ceiling]) => `${shape}: ${String(shape === 'total' ? total : byShape.get(shape) ?? 0)} > ${String(ceiling)}`);

    expect(over, `measured ${JSON.stringify(shapes)}`).toEqual([]);

    // The premise. A rebuild that did nothing would be comfortably inside every
    // budget above and would pass having guarded nothing.
    expect(byShape.get('log') ?? 0, 'the rebuild must have read the history').toBeGreaterThan(0);
    expect(total, 'and must have run at all').toBeGreaterThan(8);
  }, 300_000);

  it('reaches the pass a generated history never would', () => {
    // The reason the fixture is built here. If this ever reads zero, the budget
    // above is guarding a path nothing walks, and the number it protects is not
    // the number that matters.
    const repo = fixtureRepo();
    const { byShape } = coldRebuildShapes(repo);
    expect(byShape.get('interpret-trailers') ?? 0).toBeGreaterThan(0);
  }, 300_000);
});
