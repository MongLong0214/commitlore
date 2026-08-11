/**
 * T-303 acceptance: `--follow` accuracy regression (issue #11).
 *
 * D4 is "a record recorded against a path disappears from that path's query
 * once the path is renamed" (see `core/query.ts`'s module doc). `test/query.ts`
 * already pins the headline case — a.ts -> b.ts -> c/d.ts, queried from the
 * final name. This file exists because `--follow` is a *boundary*, not a
 * guarantee, and the boundary needs its own fixtures:
 *
 *   1. a single rename (the minimal case underneath the two-step one)
 *   2. a two-step rename through a directory move specifically (not just a
 *      leaf rename)
 *   3. a pure directory move with untouched content
 *   4. the similarity threshold git's rename detector uses, found
 *      empirically on this machine, with a case pinned on each side of it
 *   5. the multi-path case, in the specific situation the ticket cares about
 *      -- a query that includes a renamed file among several paths, where
 *      `--follow` cannot run at all
 *   6. delete-then-recreate under the same name, which is not a rename at
 *      all and is pinned here so nobody "fixes" `resolveScope` into treating
 *      it as one
 *
 * Every repository is built under `os.tmpdir()`. Nothing here touches the
 * repository the tests run in, and nothing here imports from or duplicates
 * fixtures owned by `test/query.test.ts` — the harness below is deliberately
 * self-contained so this file has no dependency on another suite's fixtures.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { execGitOrThrow } from '../src/core/git.js';
import { closeIndex, openIndex, rebuildIndex } from '../src/core/index-db.js';
import { runQuery, valuesOf, type GradedRecord } from '../src/core/query.js';
import { createTestRepo } from './git-fixtures.js';

/** Config pinned per invocation: the developer's global git config is not input. */
const GIT_CONFIG = [
  '-c',
  'user.name=CommitLore Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.hooksPath=/dev/null',
];

const temporaries: string[] = [];

afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-follow-'));
  temporaries.push(dir);
  return createTestRepo({ path: dir });
};

/** Commits at an explicit instant so ordering in a suite never depends on wall-clock time. */
const commitAt = (
  dir: string,
  stamp: string,
  message: string,
  files: Record<string, string> = {},
): string => {
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(dir, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents.endsWith('\n') ? contents : `${contents}\n`);
  }

  const previous = {
    author: process.env['GIT_AUTHOR_DATE'],
    committer: process.env['GIT_COMMITTER_DATE'],
  };
  process.env['GIT_AUTHOR_DATE'] = stamp;
  process.env['GIT_COMMITTER_DATE'] = stamp;
  try {
    execGitOrThrow([...GIT_CONFIG, 'add', '-A'], { cwd: dir });
    execGitOrThrow(
      [...GIT_CONFIG, 'commit', '-q', '--no-verify', '--allow-empty', '--cleanup=verbatim', '-F', '-'],
      { cwd: dir, stdin: message },
    );
  } finally {
    if (previous.author === undefined) delete process.env['GIT_AUTHOR_DATE'];
    else process.env['GIT_AUTHOR_DATE'] = previous.author;
    if (previous.committer === undefined) delete process.env['GIT_COMMITTER_DATE'];
    else process.env['GIT_COMMITTER_DATE'] = previous.committer;
  }

  return execGitOrThrow(['rev-parse', 'HEAD'], { cwd: dir }).trim();
};

/** `git rm` a path, standalone from any add, so a delete is its own commit. */
const gitRm = (dir: string, path: string): void => {
  execGitOrThrow([...GIT_CONFIG, 'rm', '-q', path], { cwd: dir });
};

const record = (subject: string, trailers: string[]): string =>
  `${subject}\n\nBody prose that is not a trailer block.\n\n${trailers.join('\n')}\n`;

const recordIds = (records: readonly GradedRecord[]): (string | undefined)[] =>
  records.map((entry) => entry.recordId);

/** `n` lines, each unique, so a diff between two variants is measurable line-by-line. */
const uniqueLines = (n: number, tag = 'base'): string =>
  Array.from({ length: n }, (_, i) => `line-${String(i).padStart(3, '0')}-${tag}-token`).join('\n');

/**
 * `uniqueLines(n)` with the first `changedPct`% of lines replaced by content
 * that shares no token with the original. This is what lets case 4 dial the
 * post-rename similarity precisely: replacing `changedPct`% of lines leaves
 * git's line-based similarity estimator reporting almost exactly
 * `100 - changedPct`% similarity (confirmed empirically below).
 */
const mutateLines = (n: number, changedPct: number): string => {
  const changedCount = Math.round((n * changedPct) / 100);
  return Array.from({ length: n }, (_, i) =>
    i < changedCount
      ? `line-${String(i).padStart(3, '0')}-CHANGED-${changedPct}-token`
      : `line-${String(i).padStart(3, '0')}-base-token`,
  ).join('\n');
};

// ---------------------------------------------------------------------------
// 1. A single rename
// ---------------------------------------------------------------------------

describe('single rename: a.ts -> b.ts', () => {
  const dir = makeRepo();
  commitAt(
    dir,
    '2026-05-01T00:00:00Z',
    record('Add the retry helper', [
      'Limit: retries are capped at three attempts',
      'Record-Id: r-fol001',
    ]),
    { 'a.ts': uniqueLines(20, 'retry') },
  );
  execGitOrThrow([...GIT_CONFIG, 'mv', 'a.ts', 'b.ts'], { cwd: dir });
  commitAt(dir, '2026-05-02T00:00:00Z', 'Rename a.ts to b.ts\n');

  it('finds the a.ts-era record when b.ts is queried', () => {
    const result = runQuery({ cwd: dir, path: 'b.ts' });
    expect(recordIds(result.records)).toEqual(['r-fol001']);
    expect(result.follow).toBe(true);
    expect(result.aliases).toEqual(['b.ts', 'a.ts']);
  });

  it('is still reachable from the retired name', () => {
    expect(recordIds(runQuery({ cwd: dir, path: 'a.ts' }).records)).toEqual(['r-fol001']);
  });
});

// ---------------------------------------------------------------------------
// 2. Two-step rename through a directory move
// ---------------------------------------------------------------------------

describe('two-step rename: a.ts -> b.ts -> lib/b.ts', () => {
  // `test/query.test.ts` already pins the headline D4 case (a.ts -> b.ts ->
  // c/d.ts, both a leaf rename and a directory move folded into the second
  // step). This is kept deliberately minimal and does not re-assert every
  // angle that suite covers (aliases order, the raw scanTrailers contrast,
  // the never-existed path) -- it exists only so this file's regression net
  // for the *chain* case does not depend on another file's fixtures.
  const dir = makeRepo();
  commitAt(
    dir,
    '2026-05-10T00:00:00Z',
    record('Add the batching helper', [
      'Limit: batches flush at 500 items',
      'Record-Id: r-fol002',
    ]),
    { 'a.ts': uniqueLines(20, 'batch') },
  );
  execGitOrThrow([...GIT_CONFIG, 'mv', 'a.ts', 'b.ts'], { cwd: dir });
  commitAt(dir, '2026-05-11T00:00:00Z', 'Rename a.ts to b.ts\n');
  mkdirSync(join(dir, 'lib'), { recursive: true });
  execGitOrThrow([...GIT_CONFIG, 'mv', 'b.ts', 'lib/b.ts'], { cwd: dir });
  commitAt(dir, '2026-05-12T00:00:00Z', 'Move b.ts into lib/\n');

  it('the original record is reachable through both steps of the chain', () => {
    const result = runQuery({ cwd: dir, path: 'lib/b.ts' });
    expect(recordIds(result.records)).toEqual(['r-fol002']);
    expect(result.aliases).toEqual(['lib/b.ts', 'b.ts', 'a.ts']);
  });
});

// ---------------------------------------------------------------------------
// 3. A pure directory move, content untouched
// ---------------------------------------------------------------------------

describe('directory move: src/x.ts -> lib/x.ts', () => {
  const dir = makeRepo();
  commitAt(
    dir,
    '2026-05-15T00:00:00Z',
    record('Add the config loader', [
      'Limit: config is read once at startup, never hot-reloaded',
      'Record-Id: r-fol003',
    ]),
    { 'src/x.ts': uniqueLines(15, 'config') },
  );
  mkdirSync(join(dir, 'lib'), { recursive: true });
  execGitOrThrow([...GIT_CONFIG, 'mv', 'src/x.ts', 'lib/x.ts'], { cwd: dir });
  commitAt(dir, '2026-05-16T00:00:00Z', 'Move src/x.ts to lib/x.ts\n');

  it('the record follows the file across the directory boundary', () => {
    const result = runQuery({ cwd: dir, path: 'lib/x.ts' });
    expect(recordIds(result.records)).toEqual(['r-fol003']);
    expect(result.aliases).toEqual(['lib/x.ts', 'src/x.ts']);
  });

  it('a query scoped to the old directory still sees it — path scope is historical, not current-tree', () => {
    // Not a gap: `commit_paths` (index-db.ts) indexes the literal path each
    // commit's own diff touched, and the commit that carries this record
    // touched `src/x.ts` at the time. That membership does not expire when
    // the file later moves elsewhere -- there is no notion of "is this path
    // still under src/ *today*" anywhere in the engine, only "did some
    // commit's diff touch a path under this prefix". Expected and desirable:
    // asking "what do we know about src/" should include work later moved
    // out of it, the same way `--follow` keeps a renamed file's own history.
    expect(recordIds(runQuery({ cwd: dir, path: 'src' }).records)).toEqual(['r-fol003']);
  });
});

// ---------------------------------------------------------------------------
// 4. The similarity threshold, empirically located
// ---------------------------------------------------------------------------

/**
 * git's rename detector runs at its default threshold here (`-M50%`, since
 * `resolveScope`'s `git log --follow` passes no `-M` override), and that
 * threshold is a similarity percentage, not a lines-changed percentage --
 * the two are close but not identical, because git's estimator works over
 * byte-hashed chunks, not a line-for-line count. Sweeping this repository's
 * git (2.50.1) confirmed the threshold itself is exactly 50% similarity,
 * inclusive, but where that lands in *lines changed* depends on the exact
 * byte shape of the content:
 *
 *   - a 100-line fixture using `line-NNN-unique-content-token` /
 *     `line-NNN-CHANGED-{pct}-xyz` crosses at 50% lines changed (50%
 *     similarity, detected) vs 51% (49% similarity, not detected).
 *   - `uniqueLines`/`mutateLines` below, with their own token shape, cross
 *     at 43% lines changed (measured similarity 50%, detected) vs 44%
 *     (not detected) -- an 11-point difference from the fixture above, from
 *     token-length alone.
 *
 * The exact-percentage test below pins the second pair, since that is what
 * this file's own generator actually produces; the "50% of lines" framing
 * from git's docs is not a number this suite can assert about *content in
 * general*, only about the fixture it built. The two cases before it (30% /
 * 70% changed) carry the actual regression signal, with margin wide enough
 * to survive a shift like the one measured above.
 */
describe('rename + drastic content change: the similarity boundary', () => {
  const LINES = 100;

  it('is still followed when most of the file survives (30% changed, 70% similar)', () => {
    const dir = makeRepo();
    commitAt(
      dir,
      '2026-05-20T00:00:00Z',
      record('Add the parser core', ['Limit: only one parse pass runs at a time', 'Record-Id: r-fol004']),
      { 'a.ts': uniqueLines(LINES, 'base') },
    );
    execGitOrThrow([...GIT_CONFIG, 'mv', 'a.ts', 'b.ts'], { cwd: dir });
    commitAt(dir, '2026-05-21T00:00:00Z', 'Rename and partially rewrite a.ts as b.ts\n', {
      'b.ts': mutateLines(LINES, 30),
    });

    const result = runQuery({ cwd: dir, path: 'b.ts' });
    expect(recordIds(result.records)).toEqual(['r-fol004']);
    expect(result.aliases).toEqual(['b.ts', 'a.ts']);
  });

  it('the chain breaks when most of the file is rewritten (70% changed, 30% similar)', () => {
    const dir = makeRepo();
    commitAt(
      dir,
      '2026-05-22T00:00:00Z',
      record('Add the formatter core', [
        'Limit: only one format pass runs at a time',
        'Record-Id: r-fol005',
      ]),
      { 'a.ts': uniqueLines(LINES, 'base') },
    );
    execGitOrThrow([...GIT_CONFIG, 'mv', 'a.ts', 'b.ts'], { cwd: dir });
    commitAt(dir, '2026-05-23T00:00:00Z', 'Rename and mostly rewrite a.ts as b.ts\n', {
      'b.ts': mutateLines(LINES, 70),
    });

    // git itself no longer calls this a rename, so the D4 defect is back:
    // the record silently does not reach the new name. `follow` stays true
    // (one path was asked for), but no historical alias was found for it.
    const result = runQuery({ cwd: dir, path: 'b.ts' });
    expect(result.records).toEqual([]);
    expect(result.follow).toBe(true);
    expect(result.aliases).toEqual(['b.ts']);

    // The record still exists and is still reachable — from the name git
    // actually associates it with.
    expect(recordIds(runQuery({ cwd: dir, path: 'a.ts' }).records)).toEqual(['r-fol005']);
  });

  it('pins this fixture generator\'s exact crossover: 43% changed still follows, 44% does not', () => {
    const build = (changedPct: number): string => {
      const dir = makeRepo();
      commitAt(
        dir,
        '2026-05-24T00:00:00Z',
        record('Add the boundary probe', [
          `Limit: probe at ${changedPct}pct`,
          'Record-Id: r-folbnd',
        ]),
        { 'a.ts': uniqueLines(LINES, 'base') },
      );
      execGitOrThrow([...GIT_CONFIG, 'mv', 'a.ts', 'b.ts'], { cwd: dir });
      commitAt(dir, '2026-05-25T00:00:00Z', `Rename at exactly ${changedPct}pct changed\n`, {
        'b.ts': mutateLines(LINES, changedPct),
      });
      return dir;
    };

    const atLimit = runQuery({ cwd: build(43), path: 'b.ts' });
    expect(recordIds(atLimit.records)).toEqual(['r-folbnd']);

    const overLimit = runQuery({ cwd: build(44), path: 'b.ts' });
    expect(overLimit.records).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Multiple path arguments, one of them a renamed file
// ---------------------------------------------------------------------------

describe('multiple paths where one has been renamed', () => {
  const dir = makeRepo();
  commitAt(
    dir,
    '2026-06-01T00:00:00Z',
    record('Add the renamed helper', ['Limit: retry budget is fixed', 'Record-Id: r-fol006']),
    { 'a.ts': uniqueLines(10, 'renamed') },
  );
  execGitOrThrow([...GIT_CONFIG, 'mv', 'a.ts', 'b.ts'], { cwd: dir });
  commitAt(dir, '2026-06-02T00:00:00Z', 'Rename a.ts to b.ts\n');
  commitAt(
    dir,
    '2026-06-03T00:00:00Z',
    record('Add the untouched helper', ['Limit: cache TTL is 60s', 'Record-Id: r-fol007']),
    { 'c.ts': uniqueLines(10, 'stable') },
  );

  it('warns that --follow cannot run, and still answers for the paths it can match literally', () => {
    // `init` builds the index; without one every query also reports that it
    // answered by full scan (#522), which is true and about something else.
    const handle = openIndex({ cwd: dir });
    rebuildIndex(handle, { reason: 'test fixture' });
    closeIndex(handle);

    const result = runQuery({ cwd: dir, paths: ['b.ts', 'c.ts'] });
    expect(result.follow).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toContain('--follow accepts exactly one pathspec');

    // c.ts was never renamed, so the literal match finds it regardless.
    // b.ts's record lives on the commit that touched a.ts -- without
    // --follow that alias is never resolved, so it goes missing here. This
    // is the "useful but incomplete" shape the ticket asks to pin: no error,
    // no silent full-repo answer, just a documented gap plus every record a
    // literal match can still reach.
    expect(recordIds(result.records)).toEqual(['r-fol007']);
    expect(result.aliases).toEqual(['b.ts', 'c.ts']);
  });

  it('the same rename resolves fully when b.ts is queried alone', () => {
    const result = runQuery({ cwd: dir, path: 'b.ts' });
    expect(result.follow).toBe(true);
    expect(recordIds(result.records)).toEqual(['r-fol006']);
  });
});

// ---------------------------------------------------------------------------
// 6. Delete, then recreate the same name — not a rename
// ---------------------------------------------------------------------------

describe('delete then recreate under the same name', () => {
  const dir = makeRepo();
  commitAt(
    dir,
    '2026-06-10T00:00:00Z',
    record('Add the original session store', [
      'Limit: sessions are memory-only, lost on restart',
      'Record-Id: r-fol008',
    ]),
    { 'a.ts': uniqueLines(10, 'session-v1') },
  );
  gitRm(dir, 'a.ts');
  commitAt(dir, '2026-06-11T00:00:00Z', 'Remove a.ts (session store retired)\n');
  commitAt(
    dir,
    '2026-06-12T00:00:00Z',
    record('Add an unrelated a.ts (rate limiter)', [
      'Limit: 100 requests per minute per key',
      'Record-Id: r-fol009',
    ]),
    { 'a.ts': uniqueLines(10, 'ratelimiter-v1') },
  );

  it('resolves no rename alias for a bare re-add (git never links the two lineages)', () => {
    // `followedNames` walks `git log --follow -- a.ts`, and because the name
    // never changed there is nothing to resolve beyond the name itself --
    // `aliases` stays exactly ['a.ts'].
    const result = runQuery({ cwd: dir, path: 'a.ts' });
    expect(result.aliases).toEqual(['a.ts']);
  });

  it(
    'documented, decided behavior: querying the literal path returns records from both ' +
      'unrelated lineages, oldest first is not assumed -- indexing is per-commit-diff path, ' +
      'not per-file identity',
    () => {
      // `commit_paths` (index-db.ts) records the literal path each commit's
      // own diff touched. Both the original add and the later, unrelated
      // re-add touch the literal path "a.ts" in their own diff, so both are
      // indexed under it and both come back. CommitLore has no notion of
      // "this blob's lineage" below the path string -- a path is scoped by
      // name, and a name that dies and is reused names two different things
      // to a human but one string to the index. This is the deliberately
      // chosen behavior to regress against, not an oversight: silently
      // hiding the retired record would be its own kind of D4.
      const result = runQuery({ cwd: dir, path: 'a.ts' });
      expect(recordIds(result.records).sort()).toEqual(['r-fol008', 'r-fol009']);

      const retired = result.records.find((entry) => entry.recordId === 'r-fol008');
      const current = result.records.find((entry) => entry.recordId === 'r-fol009');
      expect(valuesOf(retired as GradedRecord, 'Limit')).toEqual([
        'sessions are memory-only, lost on restart',
      ]);
      expect(valuesOf(current as GradedRecord, 'Limit')).toEqual([
        '100 requests per minute per key',
      ]);
    },
  );
});
