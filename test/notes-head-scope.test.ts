/**
 * A note row is not a property of the mirror alone.
 *
 * `annotatedNotes` filters the mirror by what HEAD reaches, so one mirror
 * yields different rows at different HEADs — and `indexNotes`'s early return
 * compared only the mirror. 1.3.5 pinned *which* mirror a pass reads and left
 * the other half of the scope unpinned; the commit that added it said so as a
 * `Limit:` and expected the gap to need a race.
 *
 * It needs no race. Index at an ancestor whose mirror already carries a note on
 * a descendant, then fast-forward. The commit scan advances; the notes scan
 * returns at once because the ref did not move; the descendant's note is
 * missing and nothing is queued. Every later call repeats the answer, because
 * the condition that would re-read it is the one that is already satisfied.
 *
 * A plain `git pull --ff-only` is enough. On the reproduction the indexed
 * answer was `coverage: "complete"` with no records while `--no-index` returned
 * the note — the two paths disagreeing, which `r-busy420` names as the one
 * thing they may never do.
 *
 * What is asserted here is that equality, not a count. A count would pass
 * against a build that indexed the wrong note.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const cli = (dir: string, args: readonly string[]): unknown => {
  const out = execFileSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as unknown;
};

const answer = (dir: string, extra: readonly string[] = []): { coverage: unknown; ids: unknown[] } => {
  const report = cli(dir, ['warnings', '--json', ...extra]) as {
    coverage?: unknown;
    records?: { recordId?: unknown }[];
  };
  return {
    coverage: report.coverage,
    ids: (report.records ?? []).map((record) => record.recordId).sort(),
  };
};

const cold = (dir: string): void => {
  rmSync(join(dir, '.git', 'commitlore'), { recursive: true, force: true });
  mkdirSync(join(dir, '.git', 'commitlore'), { recursive: true });
};

/**
 * Two commits, and a note that only the second one carries.
 *
 * The note goes on the descendant deliberately: a note on the ancestor is in
 * scope at both HEADs and cannot show the difference.
 */
const fixtureRepo = (): { dir: string; ancestor: string; descendant: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-notescope-'));
  temporaries.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main']);

  const commit = (name: string): string => {
    writeFileSync(join(dir, `${name}.ts`), `${name}\n`);
    git(dir, ['add', '-A']);
    git(dir, [...IDENTITY, 'commit', '-q', '--no-verify', '-m', `${name}\n\nno record in the message\n`]);
    return git(dir, ['rev-parse', 'HEAD']).trim();
  };

  const ancestor = commit('first');
  const descendant = commit('second');

  git(dir, [
    ...IDENTITY,
    'notes',
    '--ref=refs/notes/commitlore',
    'add',
    '-f',
    '-m',
    'note\n\nRecord-Id: r-onlyondesc1\nWarn: this note is on the descendant only\nBlast: local\n',
    descendant,
  ]);

  return { dir, ancestor, descendant };
};

describe('a notes pass is scoped by HEAD, not by the mirror alone', () => {
  it('sees a note on a commit a fast-forward has just made reachable', () => {
    const { dir, ancestor, descendant } = fixtureRepo();

    // Indexed at the ancestor: the note is out of scope, correctly.
    git(dir, ['reset', '-q', '--hard', ancestor]);
    cold(dir);
    execFileSync(process.execPath, [CLI, 'index', '--rebuild', '--json'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(answer(dir).ids, 'the note must be out of scope at the ancestor').toEqual([]);

    const mirrorBefore = git(dir, ['rev-parse', 'refs/notes/commitlore']).trim();

    // An ordinary fast-forward. The mirror does not move, which is the whole
    // point: the early return that fires here reads the mirror and nothing else.
    git(dir, ['reset', '-q', '--hard', descendant]);
    expect(
      git(dir, ['rev-parse', 'refs/notes/commitlore']).trim(),
      'the fixture must not move the mirror, or it proves nothing',
    ).toBe(mirrorBefore);

    execFileSync(process.execPath, [CLI, 'index', '--json'], { cwd: dir, encoding: 'utf8' });

    // The index and the scan must agree. Asserted as equality rather than as a
    // count, because a build that indexed some other note would satisfy a count.
    const indexed = answer(dir);
    const scanned = answer(dir, ['--no-index']);
    expect(indexed).toEqual(scanned);
    expect(indexed.ids, 'the note the fast-forward made reachable').toEqual(['r-onlyondesc1']);
    expect(indexed.coverage).toBe('complete');
  }, 300_000);

  /**
   * The narrow pass must not become a way to miss a note either.
   *
   * Binding the scope to HEAD costs a whole notes pass per commit unless a
   * fast-forward is answered narrowly -- measured at 40 `interpret-trailers`
   * for one commit on a 40-note repository, paid by the post-commit hook every
   * time, against 0 with the narrow pass. That narrowing is only sound because
   * a fast-forward can add reachable commits and never remove them, and this is
   * the case where the added commit is exactly where the missing note lives.
   */
  it('picks up a note on a commit created after the last pass', () => {
    const { dir, descendant } = fixtureRepo();
    git(dir, ['reset', '-q', '--hard', descendant]);
    cold(dir);
    execFileSync(process.execPath, [CLI, 'index', '--rebuild', '--json'], {
      cwd: dir,
      encoding: 'utf8',
    });

    writeFileSync(join(dir, 'third.ts'), 'third\n');
    git(dir, ['add', '-A']);
    git(dir, [...IDENTITY, 'commit', '-q', '--no-verify', '-m', 'third\n\nno record in the message\n']);
    const third = git(dir, ['rev-parse', 'HEAD']).trim();
    git(dir, [
      ...IDENTITY,
      'notes',
      '--ref=refs/notes/commitlore',
      'add',
      '-f',
      '-m',
      'note\n\nRecord-Id: r-onthethird1\nWarn: written after its commit\nBlast: local\n',
      third,
    ]);

    execFileSync(process.execPath, [CLI, 'index', '--json'], { cwd: dir, encoding: 'utf8' });

    const indexed = answer(dir);
    expect(indexed).toEqual(answer(dir, ['--no-index']));
    expect(indexed.ids).toEqual(['r-onlyondesc1', 'r-onthethird1']);
  }, 300_000);

  it('drops a note a reset has just put out of scope', () => {
    const { dir, ancestor, descendant } = fixtureRepo();

    // The other direction: indexed with the note in scope, then moved back so
    // it is not.
    //
    // This one is **not** a control for the scope stamp, and saying so matters.
    // Moving HEAD backwards makes it stop descending from the last indexed
    // commit, which `incrementalProblem` already answers with a full rebuild --
    // so it passes with the stamp removed. It is kept as a guard on the
    // property the two cases share, not as evidence for this change. The
    // fast-forward case above is the one that goes red without the fix, because
    // a fast-forward is precisely the move that stays incremental.
    git(dir, ['reset', '-q', '--hard', descendant]);
    cold(dir);
    execFileSync(process.execPath, [CLI, 'index', '--rebuild', '--json'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(answer(dir).ids).toEqual(['r-onlyondesc1']);

    git(dir, ['reset', '-q', '--hard', ancestor]);
    execFileSync(process.execPath, [CLI, 'index', '--json'], { cwd: dir, encoding: 'utf8' });

    const indexed = answer(dir);
    expect(indexed).toEqual(answer(dir, ['--no-index']));
    expect(indexed.ids, 'the note is no longer reachable and must not be served').toEqual([]);
  }, 300_000);
});
