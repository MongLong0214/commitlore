/**
 * T-203 acceptance: the index is a cache of git and nothing else.
 *
 * Three properties are load bearing, and each has a suite below:
 *   1. A full rebuild and an incremental update produce the same index.
 *   2. `queryTrailers` (index) and `scanTrailers` (no index) return the same
 *      rows for the same query — the reason `--no-index` can exist.
 *   3. Any reason to distrust the file is a rebuild, never a failure
 *      (ADR-0003): wrong schema version, corrupt bytes, deleted file,
 *      rewritten history.
 *
 * Every repository here is built under `os.tmpdir()`. Nothing touches the
 * repository the tests run in.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Vite's transform pipeline (bundled with vitest) does not recognize
 * `node:sqlite` as a builtin — a static `import` of it fails the suite with
 * "Failed to load url sqlite". `src/core/index-db.ts` already reaches
 * `node:sqlite` through `createRequire` for an unrelated reason (ADR-0012's
 * laziness); the same call sidesteps this one too. Only `.prototype.close` is
 * used below (to spy on it), so the cast names just that surface.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (...args: never[]) => { close: () => void };
};

type InjectedGitFailure = {
  readonly matches: (args: readonly string[]) => boolean;
  readonly code: number;
  readonly stderr: string;
};

const gitInjection = vi.hoisted(
  (): { failure: InjectedGitFailure | null } => ({ failure: null }),
);

vi.mock('../src/core/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/git.js')>();
  return {
    ...actual,
    execGit: (
      args: Parameters<typeof actual.execGit>[0],
      opts?: Parameters<typeof actual.execGit>[1],
    ): ReturnType<typeof actual.execGit> => {
      const failure = gitInjection.failure;
      if (failure?.matches(args)) {
        return { stdout: '', stderr: failure.stderr, code: failure.code };
      }
      return actual.execGit(args, opts);
    },
    execGitOrThrow: (
      args: Parameters<typeof actual.execGitOrThrow>[0],
      opts?: Parameters<typeof actual.execGitOrThrow>[1],
    ): ReturnType<typeof actual.execGitOrThrow> => {
      const failure = gitInjection.failure;
      if (!failure?.matches(args)) return actual.execGitOrThrow(args, opts);
      throw Object.assign(
        new Error(`git ${args.join(' ')} failed (exit ${failure.code}): ${failure.stderr}`),
        { code: failure.code, stderr: failure.stderr },
      );
    },
  };
});

import {
  closeIndex,
  dumpIndex,
  ensureIndex,
  indexDbPath,
  indexInfo,
  openIndex,
  queryTrailers,
  rebuildIndex,
  SCHEMA_VERSION,
  scanTrailers,
  updateIndex,
  type IndexHandle,
  type TrailerQuery,
} from '../src/core/index-db.js';
import { execGitOrThrow } from '../src/core/git.js';
import { loadFixtures } from './fixtures.js';
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

afterEach(() => {
  gitInjection.failure = null;
  vi.restoreAllMocks();
});

const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-index-'));
  temporaries.push(dir);
  return createTestRepo({ path: dir });
};

let clock = 1785000000;

/**
 * Commits with an explicit committer date so ordering is reproducible.
 * `--cleanup=verbatim` keeps a fixture message byte-identical, which matters
 * for the B3 case: git's default cleanup would rewrite the paragraph under us.
 */
const commit = (dir: string, message: string, files: Record<string, string> = {}): string => {
  const written = Object.keys(files).length === 0 ? { 'notes.txt': message.slice(0, 40) } : files;
  for (const [path, contents] of Object.entries(written)) {
    const absolute = join(dir, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${contents}\n`);
  }

  clock += 60;
  const stamp = new Date(clock * 1000).toISOString();
  const previous = { author: process.env['GIT_AUTHOR_DATE'], committer: process.env['GIT_COMMITTER_DATE'] };
  process.env['GIT_AUTHOR_DATE'] = stamp;
  process.env['GIT_COMMITTER_DATE'] = stamp;
  try {
    execGitOrThrow([...GIT_CONFIG, 'add', '-A'], { cwd: dir });
    execGitOrThrow([...GIT_CONFIG, 'commit', '-q', '--no-verify', '--cleanup=verbatim', '-F', '-'], {
      cwd: dir,
      stdin: message,
    });
  } finally {
    if (previous.author === undefined) delete process.env['GIT_AUTHOR_DATE'];
    else process.env['GIT_AUTHOR_DATE'] = previous.author;
    if (previous.committer === undefined) delete process.env['GIT_COMMITTER_DATE'];
    else process.env['GIT_COMMITTER_DATE'] = previous.committer;
  }

  return execGitOrThrow(['rev-parse', 'HEAD'], { cwd: dir }).trim();
};

const record = (subject: string, trailers: string[]): string =>
  `${subject}\n\nSome body prose that is not a trailer block.\n\n${trailers.join('\n')}\n`;

/** A repository with enough variety that a query matrix means something. */
const seedRepo = (dir: string): void => {
  commit(dir, record('Add the auth guard', ['Limit: the vendor SSO ships no refresh token', 'Blast: system', 'Undo: costly', 'Certainty: firm', 'Record-Id: r-aa1111']), {
    'src/auth/guard.ts': 'guard',
    'src/auth/session.ts': 'session',
  });
  commit(dir, record('Split the cache key', ['Limit: Ärger mit dem Cache bleibt bestehen', 'Warn: the ordering here is load bearing', 'Blast: module', 'Record-Id: r-bb2222']), {
    'src/cache/key.ts': 'key',
  });
  commit(dir, record('Retire the batch writer', ['Ruled-out: a background worker | it moves the failure, not removes it', 'Warn: 인덱스는 파생물이다', 'Certainty: guess', 'Provenance: reconstructed', 'Record-Id: r-cc3333']), {
    'src/cache/writer.ts': 'writer',
    'docs/adr/ADR-0009.md': 'adr',
  });
  commit(dir, 'Formatting only\n\nNo record here, on purpose.\n', { 'src/auth/style.ts': 'style' });
  commit(dir, record('Pin the parser', ['X-Team: platform', 'Limit: git owns the trailer boundary', 'Record-Id: r-dd4444', 'CommitLore-Version: 2.0.0']), {
    'src/core/trailers.ts': 'parser',
  });
};

const QUERY_MATRIX: TrailerQuery[] = [
  {},
  { keys: ['Limit'] },
  { keys: ['Limit', 'Warn'] },
  { keys: ['Nonexistent'] },
  { keys: [] },
  { path: 'src/auth' },
  { path: 'src/auth/' },
  { path: 'src/auth/guard.ts' },
  { path: 'src' },
  { path: 'src/cache/key.ts' },
  { path: 'docs' },
  { path: 'nope/at/all' },
  { text: 'vendor' },
  { text: 'VENDOR' },
  { text: 'Ärger' },
  { text: 'ärger' },
  { text: '파생물' },
  { text: 'or' },
  { text: '%' },
  { text: 'a_b' },
  { text: 'nothing matches this' },
  { source: 'commit' },
  { source: 'notes' },
  { limit: 1 },
  { limit: 3 },
  { limit: 0 },
  { keys: ['Limit'], path: 'src', text: 'the', limit: 2 },
  { keys: ['Warn'], source: 'commit' },
];

const withShaQueries = (dir: string): TrailerQuery[] => {
  const head = execGitOrThrow(['rev-parse', 'HEAD'], { cwd: dir }).trim();
  return [{ sha: head }, { sha: head.slice(0, 7) }, { sha: 'deadbee' }];
};

const expectFallbackAgrees = (handle: IndexHandle, dir: string, queries: TrailerQuery[]): void => {
  for (const query of queries) {
    expect(
      queryTrailers(handle, query),
      `index and no-index disagreed on ${JSON.stringify(query)}`,
    ).toEqual(scanTrailers(query, { cwd: dir }));
  }
};

describe('index-db: rebuild identity', () => {
  it('produces the same index every time it is rebuilt', () => {
    const dir = makeRepo();
    seedRepo(dir);

    const handle = openIndex({ cwd: dir });
    try {
      rebuildIndex(handle);
      const first = dumpIndex(handle);
      rebuildIndex(handle);
      const second = dumpIndex(handle);

      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual(first);
    } finally {
      closeIndex(handle);
    }
  });

  it('keeps the previous index when commit reads fail, then replaces it on retry', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const handle = openIndex({ cwd: dir });

    try {
      updateIndex(handle);
      const before = dumpIndex(handle);
      commit(dir, record('Add the replacement', ['Limit: replacement row', 'Record-Id: r-rebuild1']));
      gitInjection.failure = {
        matches: (args) =>
          args.includes('log') &&
          args.includes('--stdin') &&
          !args.includes('--name-only') &&
          !args.includes('--notes=refs/notes/commitlore'),
        code: 70,
        stderr: 'injected commit read failure',
      };

      expect(() => rebuildIndex(handle)).toThrow(/injected commit read failure/);
      expect(dumpIndex(handle)).toEqual(before);

      gitInjection.failure = null;
      rebuildIndex(handle);
      expect(dumpIndex(handle)).toEqual(scanTrailers({}, { cwd: dir }));
      expect(dumpIndex(handle)).not.toEqual(before);
    } finally {
      closeIndex(handle);
    }
  });

  it.each([
    {
      command: 'rev-parse',
      matches: (args: readonly string[]) =>
        args.includes('rev-parse') && args.includes('HEAD^{commit}'),
    },
    {
      command: 'rev-list',
      matches: (args: readonly string[]) => args.includes('rev-list'),
    },
  ])('raises on a $command failure without replacing the previous index', ({ command, matches }) => {
    const dir = makeRepo();
    seedRepo(dir);
    const handle = openIndex({ cwd: dir });

    try {
      updateIndex(handle);
      const before = dumpIndex(handle);
      gitInjection.failure = {
        matches,
        code: 70,
        stderr: `injected ${command} failure`,
      };

      expect(() => rebuildIndex(handle)).toThrow(`injected ${command} failure`);
      expect(dumpIndex(handle)).toEqual(before);
    } finally {
      closeIndex(handle);
    }
  });

  it('rebuilds an empty repository to an empty index', () => {
    const dir = makeRepo();
    const handle = openIndex({ cwd: dir });
    try {
      expect(() => rebuildIndex(handle)).not.toThrow();
      expect(dumpIndex(handle)).toEqual([]);
      expect(indexInfo(handle).lastIndexedSha).toBeNull();
    } finally {
      closeIndex(handle);
    }
  });

  it('shows a concurrent reader the old rows while git is read for a rebuild', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const handle = openIndex({ cwd: dir });

    try {
      updateIndex(handle);
      const before = dumpIndex(handle);
      commit(dir, record('Advance the index', ['Warn: new row', 'Record-Id: r-rebuild2']));
      let observed: ReturnType<typeof dumpIndex> | undefined;
      gitInjection.failure = {
        matches: (args) => {
          if (!args.includes('rev-list')) return false;
          const reader = openIndex({ cwd: dir, readonly: true });
          try {
            observed = dumpIndex(reader);
          } finally {
            closeIndex(reader);
          }
          return false;
        },
        code: 70,
        stderr: 'not injected',
      };

      rebuildIndex(handle);
      expect(observed).toEqual(before);
      expect(dumpIndex(handle)).toEqual(scanTrailers({}, { cwd: dir }));
      expect(dumpIndex(handle)).not.toEqual(before);
    } finally {
      closeIndex(handle);
    }
  });
});

describe('index-db: incremental equals full', () => {
  it('reaches the same rows through six incremental steps as through one rebuild', () => {
    const dir = makeRepo();
    const handle = openIndex({ cwd: dir });

    try {
      seedRepo(dir);
      updateIndex(handle);

      /* Each step advances HEAD and updates only `last..HEAD`. */
      commit(dir, record('Widen the path scope', ['Limit: the runner has 2 GB', 'Record-Id: r-ee5555']), {
        'src/core/index-db.ts': 'index',
      });
      const afterFirst = updateIndex(handle);
      commit(dir, 'No record\n\nJust a change.\n', { 'src/core/noop.ts': 'noop' });
      updateIndex(handle);
      commit(dir, record('Guard the gate', ['Warn: two callers share this', 'Blast: local', 'Record-Id: r-ff6666']), {
        'src/auth/gate.ts': 'gate',
      });
      const afterThird = updateIndex(handle);

      expect(afterFirst.rebuilt).toBe(false);
      expect(afterThird.rebuilt).toBe(false);
      expect(afterThird.commitsScanned).toBe(1);

      const incremental = dumpIndex(handle);
      rebuildIndex(handle);
      const full = dumpIndex(handle);

      expect(incremental.length).toBeGreaterThan(0);
      expect(incremental).toEqual(full);
    } finally {
      closeIndex(handle);
    }
  });

  it('does nothing when HEAD has not moved', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      const before = dumpIndex(handle);
      const second = updateIndex(handle);
      expect(second.rebuilt).toBe(false);
      expect(second.commitsScanned).toBe(0);
      expect(dumpIndex(handle)).toEqual(before);
    } finally {
      closeIndex(handle);
    }
  });
});

describe('index-db: --no-index fallback returns identical rows', () => {
  it('agrees with the index across the query matrix', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      expect(handle.fts).toBe(true);
      expectFallbackAgrees(handle, dir, [...QUERY_MATRIX, ...withShaQueries(dir)]);
    } finally {
      closeIndex(handle);
    }
  });

  it('agrees when FTS5 is unavailable, so the LIKE path is not a different feature', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const handle = openIndex({ cwd: dir, fts: false });
    try {
      rebuildIndex(handle);
      expect(handle.fts).toBe(false);
      expectFallbackAgrees(handle, dir, [...QUERY_MATRIX, ...withShaQueries(dir)]);
    } finally {
      closeIndex(handle);
    }
  });

  it('gives the same answers with FTS5 reading an index built without it', () => {
    const dir = makeRepo();
    seedRepo(dir);

    const plain = openIndex({ cwd: dir, fts: false });
    rebuildIndex(plain);
    const withoutFts = dumpIndex(plain);
    closeIndex(plain);

    const indexed = openIndex({ cwd: dir });
    try {
      /* Opening with FTS5 creates the table; the rows already there stay authoritative. */
      expect(dumpIndex(indexed)).toEqual(withoutFts);
      expect(queryTrailers(indexed, { text: 'vendor' })).toEqual(
        scanTrailers({ text: 'vendor' }, { cwd: dir }),
      );
    } finally {
      closeIndex(indexed);
    }
  });

  it('agrees on an empty repository', () => {
    const dir = makeRepo();
    const handle = openIndex({ cwd: dir });
    try {
      const stats = updateIndex(handle);
      expect(stats.headSha).toBeNull();
      expect(queryTrailers(handle, {})).toEqual([]);
      expect(scanTrailers({}, { cwd: dir })).toEqual([]);
    } finally {
      closeIndex(handle);
    }
  });
});

describe('index-db: the file is disposable', () => {
  it('rebuilds when the schema version is not the one this build writes', () => {
    const dir = makeRepo();
    seedRepo(dir);

    const first = openIndex({ cwd: dir });
    updateIndex(first);
    const before = dumpIndex(first);
    first.db.prepare('UPDATE meta SET v = ? WHERE k = ?').run('999', 'schema_version');
    closeIndex(first);

    const second = openIndex({ cwd: dir });
    try {
      const stats = updateIndex(second);
      expect(stats.rebuilt).toBe(true);
      expect(stats.rebuildReason).toContain('v999');
      expect(dumpIndex(second)).toEqual(before);
      expect(indexInfo(second).schemaVersion).toBe(String(SCHEMA_VERSION));
    } finally {
      closeIndex(second);
    }
  });

  it('rebuilds when the file is not a database at all', () => {
    const dir = makeRepo();
    seedRepo(dir);

    const first = openIndex({ cwd: dir });
    updateIndex(first);
    const before = dumpIndex(first);
    closeIndex(first);

    const path = indexDbPath(dir);
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
    writeFileSync(path, 'this is not a sqlite database, it is a text file\n');

    const { handle, stats } = ensureIndex({ cwd: dir });
    try {
      expect(stats.rebuilt).toBe(true);
      expect(stats.rebuildReason).toContain('could not be opened');
      expect(dumpIndex(handle)).toEqual(before);
    } finally {
      closeIndex(handle);
    }
  });

  it('answers after the index file is deleted', () => {
    const dir = makeRepo();
    seedRepo(dir);

    const first = openIndex({ cwd: dir });
    updateIndex(first);
    const before = dumpIndex(first);
    closeIndex(first);

    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${indexDbPath(dir)}${suffix}`, { force: true });
    }

    const { handle, stats } = ensureIndex({ cwd: dir });
    try {
      expect(stats.rebuilt).toBe(true);
      expect(dumpIndex(handle)).toEqual(before);
      expect(dumpIndex(handle)).toEqual(scanTrailers({}, { cwd: dir }));
    } finally {
      closeIndex(handle);
    }
  });

  it('rebuilds when history is rewritten under it', () => {
    const dir = makeRepo();
    seedRepo(dir);

    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      execGitOrThrow(
        [...GIT_CONFIG, 'commit', '-q', '--amend', '--no-verify', '--cleanup=verbatim', '-F', '-'],
        { cwd: dir, stdin: record('Pin the parser, again', ['Limit: amended', 'Record-Id: r-dd4444']) },
      );

      const stats = updateIndex(handle);
      expect(stats.rebuilt).toBe(true);
      expect(stats.rebuildReason).toMatch(/rewritten|descends/);
      expect(dumpIndex(handle)).toEqual(scanTrailers({}, { cwd: dir }));
    } finally {
      closeIndex(handle);
    }
  });

  it('rebuilds when HEAD moves backwards', () => {
    const dir = makeRepo();
    seedRepo(dir);

    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      execGitOrThrow([...GIT_CONFIG, 'reset', '-q', '--hard', 'HEAD~2'], { cwd: dir });

      const stats = updateIndex(handle);
      expect(stats.rebuilt).toBe(true);
      expect(dumpIndex(handle)).toEqual(scanTrailers({}, { cwd: dir }));
    } finally {
      closeIndex(handle);
    }
  });
});

describe('index-db: B3 false positives', () => {
  it('indexes zero trailers for a paragraph that only looks like a trailer block', () => {
    const dir = makeRepo();
    const b3 = loadFixtures('boundary').find((entry) => entry.name === 'b3-prose-with-colon-line');
    expect(b3).toBeDefined();
    expect(b3?.expected.trailers).toEqual([]);

    const proseSha = commit(dir, b3?.message ?? '', { 'src/retry.ts': 'retry' });
    commit(dir, record('A real record', ['Limit: this one is genuine', 'Record-Id: r-991111']), {
      'src/real.ts': 'real',
    });

    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      expect(queryTrailers(handle, { sha: proseSha })).toEqual([]);
      expect(scanTrailers({ sha: proseSha }, { cwd: dir })).toEqual([]);
      expect(queryTrailers(handle, { keys: ['Note'] })).toEqual([]);
      expect(queryTrailers(handle, {})).toHaveLength(2);
    } finally {
      closeIndex(handle);
    }
  });

  it('indexes every boundary fixture to exactly the trailers git reports', () => {
    const dir = makeRepo();
    const fixtures = loadFixtures('boundary');
    const expectations = fixtures.map((fixture) => ({
      sha: commit(dir, fixture.message, { [`src/${fixture.name}.ts`]: fixture.name }),
      trailers: fixture.expected.trailers,
    }));

    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      for (const expectation of expectations) {
        const indexed = queryTrailers(handle, { sha: expectation.sha });
        expect(indexed.map(({ key, value }) => ({ key, value }))).toEqual(expectation.trailers);
      }
      expect(dumpIndex(handle)).toEqual(scanTrailers({}, { cwd: dir }));
    } finally {
      closeIndex(handle);
    }
  });
});

describe('index-db: notes as a second source', () => {
  it('indexes refs/notes/commitlore as source=notes and the fallback agrees', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const target = execGitOrThrow(['rev-parse', 'HEAD~1'], { cwd: dir }).trim();

    execGitOrThrow(
      [...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-F', '-', target],
      {
        cwd: dir,
        stdin: 'Reconstructed record\n\nLimit: recovered from a squash merge\nProvenance: reconstructed\nRecord-Id: r-note01\n',
      },
    );

    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      const fromNotes = queryTrailers(handle, { source: 'notes' });
      expect(fromNotes.map((trailer) => trailer.key)).toEqual([
        'Limit',
        'Provenance',
        'Record-Id',
      ]);
      expect(fromNotes[0]?.sha).toBe(target);
      expect(fromNotes[0]?.provenance).toBe('reconstructed');
      expect(fromNotes[0]?.paths.length).toBeGreaterThan(0);
      expect(fromNotes).toEqual(scanTrailers({ source: 'notes' }, { cwd: dir }));
      expect(dumpIndex(handle)).toEqual(scanTrailers({}, { cwd: dir }));
    } finally {
      closeIndex(handle);
    }
  });

  it('re-reads notes when the ref moves and drops them when it is deleted', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const target = execGitOrThrow(['rev-parse', 'HEAD'], { cwd: dir }).trim();

    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      expect(queryTrailers(handle, { source: 'notes' })).toEqual([]);

      execGitOrThrow(
        [...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-F', '-', target],
        { cwd: dir, stdin: 'Inherited record\n\nWarn: this arrived through a squash\nRecord-Id: r-note02\n' },
      );
      updateIndex(handle);
      expect(queryTrailers(handle, { source: 'notes' })).toHaveLength(2);

      execGitOrThrow([...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'remove', target], {
        cwd: dir,
      });
      updateIndex(handle);
      expect(queryTrailers(handle, { source: 'notes' })).toEqual([]);
      expect(dumpIndex(handle)).toEqual(scanTrailers({}, { cwd: dir }));
    } finally {
      closeIndex(handle);
    }
  });

  it('keeps indexed notes and their ref stamp when a replacement read fails', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const target = execGitOrThrow(['rev-parse', 'HEAD'], { cwd: dir }).trim();
    execGitOrThrow(
      [...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-F', '-', target],
      { cwd: dir, stdin: 'Warn: keep the last good note\nRecord-Id: r-note04\n' },
    );

    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      const before = queryTrailers(handle, { source: 'notes' });
      const indexedRef = execGitOrThrow(
        ['rev-parse', '--verify', 'refs/notes/commitlore'],
        { cwd: dir },
      ).trim();

      execGitOrThrow(
        [...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-f', '-F', '-', target],
        { cwd: dir, stdin: 'Warn: replacement must wait\nRecord-Id: r-note05\n' },
      );
      expect(execGitOrThrow(['rev-parse', 'refs/notes/commitlore'], { cwd: dir }).trim()).not.toBe(
        indexedRef,
      );
      gitInjection.failure = {
        matches: (args) =>
          args.includes('log') && args.includes('--notes=refs/notes/commitlore'),
        code: 70,
        stderr: 'injected note read failure',
      };

      expect(() => updateIndex(handle)).toThrow(/injected note read failure/);
      expect(queryTrailers(handle, { source: 'notes' })).toEqual(before);
      // `node:sqlite` has no `.pluck()` (ADR-0012); read the row and pick the column.
      expect(
        (
          handle.db.prepare("SELECT v FROM meta WHERE k = 'notes_ref_sha'").get() as
            | { v: string }
            | undefined
        )?.v,
      ).toBe(indexedRef);
    } finally {
      closeIndex(handle);
    }
  });

  it('indexes the replacement on the next update after a failed note read', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const target = execGitOrThrow(['rev-parse', 'HEAD'], { cwd: dir }).trim();
    execGitOrThrow(
      [...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-F', '-', target],
      { cwd: dir, stdin: 'Warn: original note\nRecord-Id: r-note06\n' },
    );

    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      execGitOrThrow(
        [...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-f', '-F', '-', target],
        { cwd: dir, stdin: 'Warn: recovered replacement\nRecord-Id: r-note07\n' },
      );
      gitInjection.failure = {
        matches: (args) =>
          args.includes('log') && args.includes('--notes=refs/notes/commitlore'),
        code: 70,
        stderr: 'injected note read failure',
      };
      expect(() => updateIndex(handle)).toThrow(/injected note read failure/);

      gitInjection.failure = null;
      expect(updateIndex(handle).noteTrailersIndexed).toBe(2);
      expect(queryTrailers(handle, { source: 'notes' }).map((row) => row.value)).toEqual([
        'recovered replacement',
        'r-note07',
      ]);
    } finally {
      closeIndex(handle);
    }
  });

  it('closes the lazy-update handle when note indexing throws', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const target = execGitOrThrow(['rev-parse', 'HEAD'], { cwd: dir }).trim();
    execGitOrThrow(
      [...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-F', '-', target],
      { cwd: dir, stdin: 'Warn: force ensureIndex to fail\nRecord-Id: r-note08\n' },
    );
    gitInjection.failure = {
      matches: (args) => args.includes('notes') && args.includes('list'),
      code: 70,
      stderr: 'injected notes list failure',
    };
    const close = vi.spyOn(DatabaseSync.prototype, 'close');

    expect(() => ensureIndex({ cwd: dir })).toThrow(/injected notes list failure/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('treats an absent notes ref as an empty source', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const handle = openIndex({ cwd: dir });
    try {
      expect(() => updateIndex(handle)).not.toThrow();
      expect(queryTrailers(handle, { source: 'notes' })).toEqual([]);
    } finally {
      closeIndex(handle);
    }
  });

  it('raises when git cannot list an existing notes ref', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const target = execGitOrThrow(['rev-parse', 'HEAD'], { cwd: dir }).trim();
    execGitOrThrow(
      [...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-F', '-', target],
      { cwd: dir, stdin: 'Warn: listing must be checked\nRecord-Id: r-note09\n' },
    );
    gitInjection.failure = {
      matches: (args) => args.includes('notes') && args.includes('list'),
      code: 70,
      stderr: 'injected notes list failure',
    };

    const handle = openIndex({ cwd: dir });
    try {
      expect(() => updateIndex(handle)).toThrow(/injected notes list failure/);
    } finally {
      closeIndex(handle);
    }
  });

  it('raises when git cannot inspect an annotated object', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const target = execGitOrThrow(['rev-parse', 'HEAD'], { cwd: dir }).trim();
    execGitOrThrow(
      [...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-F', '-', target],
      { cwd: dir, stdin: 'Warn: object typing must be checked\nRecord-Id: r-note10\n' },
    );
    gitInjection.failure = {
      matches: (args) => args.includes('cat-file') && args.includes('--batch-check'),
      code: 70,
      stderr: 'injected cat-file failure',
    };

    const handle = openIndex({ cwd: dir });
    try {
      expect(() => updateIndex(handle)).toThrow(/injected cat-file failure/);
    } finally {
      closeIndex(handle);
    }
  });

  it('raises when git cannot resolve the notes ref for an update', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const target = execGitOrThrow(['rev-parse', 'HEAD'], { cwd: dir }).trim();
    execGitOrThrow(
      [...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-F', '-', target],
      { cwd: dir, stdin: 'Warn: original ref state\nRecord-Id: r-note11\n' },
    );

    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      execGitOrThrow(
        [...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-f', '-F', '-', target],
        { cwd: dir, stdin: 'Warn: moved ref state\nRecord-Id: r-note12\n' },
      );
      gitInjection.failure = {
        matches: (args) =>
          args.includes('rev-parse') && args.includes('refs/notes/commitlore'),
        code: 70,
        stderr: 'injected ref resolution failure',
      };

      expect(() => updateIndex(handle)).toThrow(/injected ref resolution failure/);
    } finally {
      closeIndex(handle);
    }
  });

  it('indexes a bare trailer block, which is the shape the mirror is written in', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const target = execGitOrThrow(['rev-parse', 'HEAD'], { cwd: dir }).trim();

    /* T-301 writes the canonical block and nothing else. git reads a lone
       paragraph as a subject, so a reader that parses the note text as-is
       finds zero trailers — every reader of the mirror has to supply the
       missing subject. This test is what catches that regression. */
    execGitOrThrow([...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-F', '-', target], {
      cwd: dir,
      stdin: 'Limit: written as a bare canonical block\nBlast: local\nRecord-Id: r-note03\n',
    });

    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      const fromNotes = queryTrailers(handle, { source: 'notes' });
      expect(fromNotes.map((trailer) => trailer.key)).toEqual(['Limit', 'Blast', 'Record-Id']);
      expect(fromNotes).toEqual(scanTrailers({ source: 'notes' }, { cwd: dir }));
    } finally {
      closeIndex(handle);
    }
  });

  it('does not manufacture trailers from a note that is prose (SPEC §2.1 B3)', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const target = execGitOrThrow(['rev-parse', 'HEAD'], { cwd: dir }).trim();

    execGitOrThrow([...GIT_CONFIG, 'notes', '--ref=refs/notes/commitlore', 'add', '-F', '-', target], {
      cwd: dir,
      stdin: 'Note: this looks like a trailer\nbut this line is prose, so the paragraph is not a block.\n',
    });

    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      expect(queryTrailers(handle, { source: 'notes' })).toEqual([]);
      expect(scanTrailers({ source: 'notes' }, { cwd: dir })).toEqual([]);
    } finally {
      closeIndex(handle);
    }
  });
});

describe('index-db: repository shapes', () => {
  it('records a merge commit against its first parent, so it is path-reachable', () => {
    const dir = makeRepo();
    commit(dir, 'Base\n\nStarting point.\n', { 'src/base.ts': 'base' });
    execGitOrThrow([...GIT_CONFIG, 'checkout', '-q', '-b', 'side'], { cwd: dir });
    commit(dir, 'Side work\n\nOn the branch.\n', { 'src/side/feature.ts': 'feature' });
    execGitOrThrow([...GIT_CONFIG, 'checkout', '-q', 'main'], { cwd: dir });

    /* `git merge` reads -F from a file, not from stdin the way `git commit` does. */
    const messageFile = join(mkdtempSync(join(tmpdir(), 'commitlore-msg-')), 'merge.txt');
    temporaries.push(dirname(messageFile));
    writeFileSync(
      messageFile,
      record('Merge the side branch', [
        'Warn: the record lives on the merge',
        'Blast: module',
        'Record-Id: r-mm7777',
      ]),
    );

    clock += 60;
    const stamp = new Date(clock * 1000).toISOString();
    process.env['GIT_AUTHOR_DATE'] = stamp;
    process.env['GIT_COMMITTER_DATE'] = stamp;
    execGitOrThrow(
      [...GIT_CONFIG, 'merge', '-q', '--no-ff', '--no-verify', '-F', messageFile, 'side'],
      { cwd: dir },
    );
    delete process.env['GIT_AUTHOR_DATE'];
    delete process.env['GIT_COMMITTER_DATE'];

    const handle = openIndex({ cwd: dir });
    try {
      updateIndex(handle);
      const scoped = queryTrailers(handle, { path: 'src/side' });
      expect(scoped.map((trailer) => trailer.key)).toContain('Warn');
      expect(scoped).toEqual(scanTrailers({ path: 'src/side' }, { cwd: dir }));
    } finally {
      closeIndex(handle);
    }
  });

  it('puts the index inside a linked worktree own git dir', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const linked = mkdtempSync(join(tmpdir(), 'commitlore-worktree-'));
    temporaries.push(linked);
    rmSync(linked, { recursive: true, force: true });
    execGitOrThrow([...GIT_CONFIG, 'worktree', 'add', '-q', linked, 'HEAD~1'], { cwd: dir });

    const path = indexDbPath(linked);
    expect(path).toContain('worktrees');

    const { handle } = ensureIndex({ cwd: linked });
    try {
      expect(indexInfo(handle).path).toBe(path);
      expect(dumpIndex(handle)).toEqual(scanTrailers({}, { cwd: linked }));
    } finally {
      closeIndex(handle);
    }
  });
});

describe('index-db: reporting', () => {
  it('reports what it holds and why it rebuilt', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const { handle, stats } = ensureIndex({ cwd: dir });
    try {
      expect(stats.rebuilt).toBe(true);
      expect(stats.rebuildReason).toBe('the index has no baseline commit');
      expect(stats.commitsScanned).toBe(5);
      expect(stats.trailersIndexed).toBeGreaterThan(0);
      expect(stats.headSha).toHaveLength(40);

      const info = indexInfo(handle);
      expect(info.schemaVersion).toBe(String(SCHEMA_VERSION));
      expect(info.commits).toBe(4);
      expect(info.trailers).toBe(dumpIndex(handle).length);
      expect(info.paths).toBeGreaterThan(0);
      expect(info.lastIndexedSha).toBe(stats.headSha);
    } finally {
      closeIndex(handle);
    }
  });

  it('refuses to write through a read-only handle', () => {
    const dir = makeRepo();
    seedRepo(dir);
    const writer = openIndex({ cwd: dir });
    updateIndex(writer);
    closeIndex(writer);

    const reader = openIndex({ cwd: dir, readonly: true });
    try {
      expect(dumpIndex(reader)).toEqual(scanTrailers({}, { cwd: dir }));
      expect(() => updateIndex(reader)).toThrow(/read-only/);
    } finally {
      closeIndex(reader);
    }
  });
});
