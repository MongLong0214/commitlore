/**
 * The derived SQLite index (ADR-0003).
 *
 * git is the truth: the records live in commit trailers and in
 * `refs/notes/commitlore`. Everything here is a cache of what those two
 * sources already say, and it is designed to be thrown away — a corrupt file,
 * an unknown schema version, or a rewritten history are all rebuild reasons,
 * never failures. `scanTrailers` answers the same questions with no database
 * at all, and the two MUST agree; that equivalence is the reason the fallback
 * exists.
 *
 * ## Where the trailers come from
 *
 * Trailer boundaries are decided by git, never here (SPEC §2.1 B3). The batch
 * reader uses `%(trailers:only,unfold)` in a `git log` format, which is the
 * same `trailer_info` parser that backs `git interpret-trailers --parse` — the
 * B3 prose paragraph yields zero trailers through both. One `git log` per
 * batch of commits replaces one process per commit, which is the difference
 * between indexing 100k commits and not finishing.
 *
 * `trailer.separators` is pinned for the same reason `trailers.ts` pins it: it
 * is repo-configurable and rewrites what git accepts as a separator.
 *
 * ## Trailer x path cardinality
 *
 * A record belongs to a commit; a commit touches many paths. Writing one row
 * per (trailer, path) multiplies a 10-trailer record across a 200-file commit
 * into 2000 rows, and a merge commit makes that far worse. Paths are therefore
 * normalized into `commit_paths(commit_sha, path)` and joined at query time,
 * and the `trailers.path` column of the original T-203 sketch does not exist.
 * Paths are stored only for commits that actually carry a trailer: a path on a
 * record-less commit answers no question this index is asked.
 *
 * ## Ordering
 *
 * `(committed_ts DESC, commit_sha ASC, source ASC, seq ASC)` — a total order,
 * since `(commit_sha, source, seq)` is unique. Committer date is stored twice:
 * `committed_at` (`%cI`, what a human reads) and `committed_ts` (`%ct`, what
 * sorts). ISO-8601 strings carry a UTC offset and do not sort correctly across
 * timezones, so the integer is the ordering key.
 *
 * ## Text search
 *
 * The one text predicate is a case-insensitive substring over `value`, and it
 * is defined by JavaScript's `toLowerCase()` on both sides: values are stored
 * pre-folded in `value_lc`, and SQLite's own `lower()` (ASCII-only) is never
 * called. Otherwise `Ä` would fold in the scan path and not in the SQL path.
 * FTS5 (trigram) is a candidate prefilter for that same predicate and can only
 * make the query faster, never different — the authoritative `instr` test is
 * applied on top of it, and it is used only where trigram LIKE is exactly
 * substring matching (printable ASCII, >= 3 characters, no LIKE wildcards).
 */

import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import type * as BetterSqlite3 from 'better-sqlite3';

import { execGit, execGitOrThrow } from './git.js';
import { parseCommitMessage } from './trailers.js';
import type { Trailer } from './types.js';

/**
 * better-sqlite3 is CommonJS and this package compiles without
 * `esModuleInterop`, so the constructor is reached through `createRequire` —
 * the same approach `schema.ts` uses for ajv-formats. The construct signature
 * is declared locally because `@types/better-sqlite3` keeps
 * `DatabaseConstructor` inside a namespace it does not export.
 */
type DatabaseConstructor = new (
  path: string,
  options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number },
) => BetterSqlite3.Database;

/**
 * Resolved on first use, not at import.
 *
 * ADR-0003 makes the index a derived cache and ADR-0002 requires the CLI to
 * degrade to `--no-index` when better-sqlite3 is unavailable. Requiring it at
 * module scope broke both: importing this file threw before any caller could
 * choose the fallback, so a missing native module took down `validate`,
 * `guard` and `parse` — none of which touch the index at all.
 *
 * That is not hypothetical. It is what a distribution without node_modules
 * does, which is exactly the shape this project now ships (ADR-0011).
 */
let cachedCtor: DatabaseConstructor | null = null;

const loadDatabaseCtor = (): DatabaseConstructor => {
  if (cachedCtor !== null) return cachedCtor;
  try {
    cachedCtor = createRequire(import.meta.url)('better-sqlite3') as DatabaseConstructor;
    return cachedCtor;
  } catch (cause) {
    throw new Error(
      'the SQLite index needs better-sqlite3, which is not installed here — rerun with --no-index, ' +
        `or install it to get the index back (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
};

export type IndexDatabase = BetterSqlite3.Database;

/**
 * Bumped whenever the table shape changes. A mismatch is not an error: the
 * index is derived, so the old file is deleted and rebuilt (ADR-0003). Without
 * this, a user upgrading the CLI would silently read a table that no longer
 * means what the code thinks it means.
 */
export const SCHEMA_VERSION = 1;

export const NOTES_REF = 'refs/notes/commitlore';

/** Commits per `git log` invocation. Bounds peak output size, not correctness. */
const LOG_BATCH = 1024;

/** `git log` output can be large; 256 MiB leaves room for a wide merge commit. */
const LOG_MAX_BUFFER = 256 * 1024 * 1024;

const RECORD_SEP = '\x01';
const FIELD_SEP = '\0';
const TRAILER_SEP = '\x1e';
const KV_SEP = '\x1f';

/** Matches a record header: an object id (SHA-1 or SHA-256) then a field separator. */
const RECORD_HEADER_RE = /^[0-9a-f]{40,64}\0/;

/** Trailers only, unfolded (B4), with separators that cannot occur in a value. */
const TRAILERS_ATOM =
  '%(trailers:only=true,unfold=true,key_value_separator=%x1f,separator=%x1e)';

const SEPARATOR_PIN = ['-c', 'trailer.separators=:'];

/**
 * A note body is a bare trailer block, which git reads as a subject rather
 * than as trailers: a lone paragraph is the subject, and a message with only a
 * subject has no trailer block. Every reader of the mirror therefore parses the
 * note as the last paragraph of a synthetic message.
 *
 * Only the presence of a subject line matters, never its text, so this is a
 * shared convention rather than a shared constant — nothing breaks if
 * `notes.ts` (T-301) spells its own differently. Prepending is harmless for a
 * note that already carries a subject: the block is still the last paragraph.
 */
const NOTE_SUBJECT = 'commitlore note';

/**
 * A merge commit shows no diff by default, so a record inscribed on a merge
 * would be invisible to every path-scoped query. First-parent is the diff a
 * merge actually introduced to the branch it landed on.
 */
const DIFF_MERGES = '--diff-merges=first-parent';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS trailers (
  id           INTEGER PRIMARY KEY,
  commit_sha   TEXT    NOT NULL,
  seq          INTEGER NOT NULL,
  key          TEXT    NOT NULL,
  value        TEXT    NOT NULL,
  value_lc     TEXT    NOT NULL,
  committed_at TEXT    NOT NULL,
  committed_ts INTEGER NOT NULL,
  provenance   TEXT,
  source       TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS trailers_identity ON trailers (commit_sha, source, seq);
CREATE INDEX IF NOT EXISTS trailers_key ON trailers (key);
CREATE INDEX IF NOT EXISTS trailers_order ON trailers (committed_ts DESC, commit_sha, source, seq);

CREATE TABLE IF NOT EXISTS commit_paths (
  commit_sha TEXT NOT NULL,
  path       TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS commit_paths_identity ON commit_paths (commit_sha, path);
CREATE INDEX IF NOT EXISTS commit_paths_path ON commit_paths (path);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);
`;

const REQUIRED_TABLES = ['trailers', 'commit_paths', 'meta'];

export type RecordSource = 'commit' | 'notes';

/** One indexed trailer, with the commit context a consumer route needs. */
export interface IndexedTrailer extends Trailer {
  sha: string;
  /** Position within its record, preserving repeated-key order (SPEC §2.1 B5). */
  seq: number;
  committedAt: string;
  committedTs: number;
  provenance: string | null;
  source: RecordSource;
  /** Paths the commit touched, sorted. Empty for a commit with no diff. */
  paths: string[];
}

/**
 * A filter over indexed trailers. Every field is answered identically by
 * `queryTrailers` and `scanTrailers`; anything that cannot be is not a field.
 */
export interface TrailerQuery {
  /** Trailer keys to keep, e.g. `['Limit', 'Warn']`. Case-sensitive (SPEC §3). */
  keys?: readonly string[];
  /** Keep records whose commit touched this path or anything beneath it. */
  path?: string;
  /** Case-insensitive substring of the trailer value. */
  text?: string;
  /** Full or abbreviated commit id. */
  sha?: string;
  source?: RecordSource;
  /** Applied after ordering. */
  limit?: number;
}

export interface IndexStats {
  rebuilt: boolean;
  /** Why a rebuild happened, for the operator. `null` when none was needed. */
  rebuildReason: string | null;
  commitsScanned: number;
  trailersIndexed: number;
  pathsIndexed: number;
  notesScanned: number;
  noteTrailersIndexed: number;
  headSha: string | null;
  /** Whether FTS5 backs this index. `false` means the LIKE path is in use. */
  fts: boolean;
  elapsedMs: number;
}

export interface IndexHandle {
  /** Replaced when a rebuild has to recreate the file, hence not readonly. */
  db: IndexDatabase;
  readonly path: string;
  readonly cwd: string;
  readonly readonly: boolean;
  /** FTS5 is usable on this database. */
  fts: boolean;
  /** Caller asked for FTS5; `fts` is this AND the build actually having it. */
  readonly ftsRequested: boolean;
  /**
   * Set when opening had to throw the file away, so the rebuild that follows
   * can report what actually happened instead of "no baseline commit".
   */
  discardedReason: string | null;
}

export interface OpenIndexOptions {
  cwd?: string;
  readonly?: boolean;
  /**
   * Set `false` to force the LIKE path even where FTS5 exists. The
   * equivalence tests use it to prove the two paths agree.
   */
  fts?: boolean;
}

/** One record as git reports it, before it reaches SQLite. */
interface RawRecord {
  sha: string;
  committedAt: string;
  committedTs: number;
  source: RecordSource;
  trailers: Trailer[];
  paths: string[];
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Absolute path of the index file. `--git-path` is what makes this correct
 * inside a linked worktree or a submodule, where `.git` is a file pointing
 * elsewhere.
 */
export const indexDbPath = (cwd: string = process.cwd()): string => {
  const reported = execGitOrThrow(['rev-parse', '--git-path', 'commitlore/index.db'], {
    cwd,
  }).trim();
  return resolve(cwd, reported);
};

// ---------------------------------------------------------------------------
// Reading records out of git
// ---------------------------------------------------------------------------

/**
 * Splits a `%x01`-prefixed log stream into per-record chunks.
 *
 * A `\x01` inside a trailer value would otherwise split one record in two.
 * Chunks that do not open with an object id are stitched back onto the record
 * being built, which restores the byte the split consumed.
 */
const splitRecords = (stdout: string): string[] => {
  const records: string[] = [];
  for (const chunk of stdout.split(RECORD_SEP)) {
    if (RECORD_HEADER_RE.test(chunk)) {
      records.push(chunk);
      continue;
    }
    const previous = records.length - 1;
    const carried = records[previous];
    if (carried !== undefined) records[previous] = `${carried}${RECORD_SEP}${chunk}`;
  }
  return records;
};

/** `Key\x1fvalue\x1eKey\x1fvalue` -> trailers, in message order (B5). */
const parseTrailerField = (field: string): Trailer[] => {
  if (field === '') return [];
  return field.split(TRAILER_SEP).map((entry) => {
    const separator = entry.indexOf(KV_SEP);
    if (separator === -1) return { key: entry, value: '' };
    return { key: entry.slice(0, separator), value: entry.slice(separator + 1) };
  });
};

/**
 * `--name-only -z` emits a newline between the format output and the path
 * list. Paths themselves are raw (that is what `-z` buys), so only that
 * separator is stripped.
 */
const parsePathFields = (fields: string[]): string[] => {
  const paths: string[] = [];
  for (const field of fields) {
    const path = field.startsWith('\n') ? field.slice(1) : field;
    if (path !== '') paths.push(path);
  }
  return paths;
};

const chunked = <T>(items: readonly T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
};

const gitLogByShas = (cwd: string, shas: readonly string[], format: string, extra: string[]) =>
  execGit(
    [
      ...SEPARATOR_PIN,
      'log',
      '--no-walk=unsorted',
      '--stdin',
      '--no-notes',
      ...extra,
      `--format=${format}`,
    ],
    { cwd, stdin: `${shas.join('\n')}\n`, maxBuffer: LOG_MAX_BUFFER },
  );

/** sha -> sorted paths, for the commits that carry a record. */
const readPaths = (cwd: string, shas: readonly string[]): Map<string, string[]> => {
  const byCommit = new Map<string, string[]>();
  if (shas.length === 0) return byCommit;

  const result = gitLogByShas(cwd, shas, `%x01%H%x00`, ['-z', '--name-only', DIFF_MERGES]);
  if (result.code !== 0) {
    throw Object.assign(new Error(`git log --name-only failed: ${result.stderr.trim()}`), {
      code: result.code,
      stderr: result.stderr,
    });
  }

  for (const record of splitRecords(result.stdout)) {
    const fields = record.split(FIELD_SEP);
    const sha = fields[0];
    if (sha === undefined) continue;
    byCommit.set(sha, parsePathFields(fields.slice(1)).sort());
  }
  return byCommit;
};

/**
 * Reads the given commits, in one `git log` per batch, keeping only those that
 * carry at least one trailer. A second pass resolves paths for exactly those
 * commits — the pass that would dominate output size on a large repository is
 * the one restricted to the ~1% of commits that recorded anything.
 */
const readCommitRecords = (cwd: string, shas: readonly string[]): RawRecord[] => {
  const records: RawRecord[] = [];

  for (const batch of chunked(shas, LOG_BATCH)) {
    const result = gitLogByShas(cwd, batch, `%x01%H%x00%ct%x00%cI%x00${TRAILERS_ATOM}%x00`, []);
    if (result.code !== 0) {
      throw Object.assign(new Error(`git log failed: ${result.stderr.trim()}`), {
        code: result.code,
        stderr: result.stderr,
      });
    }

    const batchRecords: RawRecord[] = [];
    for (const record of splitRecords(result.stdout)) {
      const fields = record.split(FIELD_SEP);
      const [sha, rawTs, committedAt, trailerField] = fields;
      if (sha === undefined || rawTs === undefined || committedAt === undefined) continue;

      const trailers = parseTrailerField(trailerField ?? '');
      if (trailers.length === 0) continue;

      batchRecords.push({
        sha,
        committedAt,
        committedTs: Number.parseInt(rawTs, 10),
        source: 'commit',
        trailers,
        paths: [],
      });
    }

    const paths = readPaths(
      cwd,
      batchRecords.map((record) => record.sha),
    );
    for (const record of batchRecords) record.paths = paths.get(record.sha) ?? [];
    records.push(...batchRecords);
  }

  return records;
};

/**
 * Reads `refs/notes/commitlore` as a second record source (ADR-0003: notes are
 * truth, not cache).
 *
 * This is the T-301 wiring point. It deliberately does not import
 * `src/core/notes.ts`: that module is being written in parallel and owns
 * *writing* notes and the fetch refspec, while indexing only needs to read the
 * ref, so the two are coupled through git rather than through each other. When
 * T-301 lands a reader, the body of this function is the only thing that
 * changes — `indexNotes` and the `source = 'notes'` rows it produces stay.
 *
 * Note text goes through `parseCommitMessage` (T-201) under the synthetic
 * subject of `NOTE_SUBJECT`, which costs one process per note. Notes are
 * sparse by construction, and correctness here is worth more than the
 * batching: a note is a message, and only git decides where its trailer block
 * starts.
 */
const readNoteRecords = (cwd: string): RawRecord[] => {
  const listed = execGit(['notes', `--ref=${NOTES_REF}`, 'list'], { cwd });
  if (listed.code !== 0) return [];

  const annotated = listed.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split(' ')[1] ?? '')
    .filter((sha) => sha !== '');
  if (annotated.length === 0) return [];

  /* Notes may annotate any object. `git log` refuses a blob, so one bad note
     would otherwise take the whole index down. */
  const typed = execGit(['cat-file', '--batch-check'], {
    cwd,
    stdin: `${annotated.join('\n')}\n`,
  });
  const commits = typed.stdout
    .split('\n')
    .filter((line) => line.endsWith(' commit') || line.includes(' commit '))
    .map((line) => line.split(' ')[0] ?? '')
    .filter((sha) => sha !== '');
  if (commits.length === 0) return [];

  const records: RawRecord[] = [];
  for (const batch of chunked(commits, LOG_BATCH)) {
    const result = gitLogByShas(cwd, batch, '%x01%H%x00%ct%x00%cI%x00%N%x00', [
      `--notes=${NOTES_REF}`,
    ]);
    if (result.code !== 0) {
      throw Object.assign(new Error(`git log --notes failed: ${result.stderr.trim()}`), {
        code: result.code,
        stderr: result.stderr,
      });
    }

    const batchRecords: RawRecord[] = [];
    for (const record of splitRecords(result.stdout)) {
      const fields = record.split(FIELD_SEP);
      const [sha, rawTs, committedAt, noteText] = fields;
      if (sha === undefined || rawTs === undefined || committedAt === undefined) continue;
      if (noteText === undefined || noteText.trim() === '') continue;

      const trailers = parseCommitMessage(`${NOTE_SUBJECT}\n\n${noteText}`);
      if (trailers.length === 0) continue;

      batchRecords.push({
        sha,
        committedAt,
        committedTs: Number.parseInt(rawTs, 10),
        source: 'notes',
        trailers,
        paths: [],
      });
    }

    const paths = readPaths(
      cwd,
      batchRecords.map((record) => record.sha),
    );
    for (const record of batchRecords) record.paths = paths.get(record.sha) ?? [];
    records.push(...batchRecords);
  }

  return records;
};

const revParse = (cwd: string, rev: string): string | null => {
  const result = execGit(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd });
  if (result.code !== 0) return null;
  const sha = result.stdout.trim();
  return sha === '' ? null : sha;
};

/** Unlike `revParse`, does not peel to a commit — a notes ref points at a tree. */
const revParseRef = (cwd: string, ref: string): string | null => {
  const result = execGit(['rev-parse', '--verify', '--quiet', ref], { cwd });
  if (result.code !== 0) return null;
  const sha = result.stdout.trim();
  return sha === '' ? null : sha;
};

const revList = (cwd: string, range: string): string[] | null => {
  const result = execGit(['rev-list', range], { cwd, maxBuffer: LOG_MAX_BUFFER });
  if (result.code !== 0) return null;
  return result.stdout.split('\n').filter((line) => line !== '');
};

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

const tableExists = (db: IndexDatabase, name: string): boolean =>
  db
    .prepare<[string], { n: number }>(
      `SELECT count(*) AS n FROM sqlite_master WHERE type IN ('table','view') AND name = ?`,
    )
    .get(name)?.n === 1;

/**
 * FTS5 is a compile-time option and the trigram tokenizer is version-gated, so
 * availability is established by trying, not by asking. A build without either
 * gets the LIKE path and identical answers.
 */
const detectFts = (db: IndexDatabase): boolean => {
  try {
    db.prepare(`SELECT rowid FROM trailers_fts WHERE value_lc LIKE '%commitlore%' LIMIT 1`).all();
    return true;
  } catch {
    return false;
  }
};

const enableFts = (db: IndexDatabase): boolean => {
  try {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS trailers_fts USING fts5(value_lc, tokenize='trigram')`,
    );
  } catch {
    return false;
  }
  return detectFts(db);
};

const readMeta = (db: IndexDatabase, key: string): string | null =>
  db.prepare<[string], { v: string | null }>('SELECT v FROM meta WHERE k = ?').get(key)?.v ?? null;

const writeMeta = (db: IndexDatabase, key: string, value: string | null): void => {
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(
    key,
    value,
  );
};

/**
 * Opening a database must never overwrite what it says about itself. Stamping
 * the current version here unconditionally would erase the very mismatch the
 * health check exists to find, and the caller would then read another
 * release's tables as if they were ours.
 */
const initMeta = (db: IndexDatabase, key: string, value: string): void => {
  db.prepare('INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)').run(key, value);
};

const createSchema = (db: IndexDatabase): void => {
  db.exec(SCHEMA_SQL);
  initMeta(db, 'schema_version', String(SCHEMA_VERSION));
};

/**
 * Decides whether the FTS5 prefilter may be used, and keeps it truthful.
 *
 * `meta.fts` records whether the rows currently in `trailers` were mirrored
 * into `trailers_fts`. It is not the same question as "does this build have
 * FTS5": an index written by a build without FTS5 and then opened by one with
 * it has an empty virtual table, and prefiltering against it would silently
 * drop every match. Where the two disagree and the handle can write, the
 * mirror is rebuilt; where it cannot, the prefilter stays off and the plain
 * substring predicate answers alone.
 */
const syncFts = (db: IndexDatabase, requested: boolean, writable: boolean): boolean => {
  if (!writable) return requested && detectFts(db) && readMeta(db, 'fts') === '1';

  if (!requested || !enableFts(db)) {
    writeMeta(db, 'fts', '0');
    return false;
  }
  if (readMeta(db, 'fts') !== '1') {
    db.transaction(() => {
      db.exec('DELETE FROM trailers_fts');
      db.exec('INSERT INTO trailers_fts (rowid, value_lc) SELECT id, value_lc FROM trailers');
      writeMeta(db, 'fts', '1');
    })();
  }
  return true;
};

/**
 * Why this index cannot be trusted, or `null`. Every answer is a rebuild
 * reason — the index is derived, so there is no such thing as an unrecoverable
 * one (ADR-0003).
 */
const healthProblem = (db: IndexDatabase): string | null => {
  try {
    if (!tableExists(db, 'meta')) return 'index has no meta table';
    const version = readMeta(db, 'schema_version');
    if (version === null) return 'index has no schema version';
    if (version !== String(SCHEMA_VERSION)) {
      return `index was built by schema v${version}, this build expects v${SCHEMA_VERSION}`;
    }
    for (const table of REQUIRED_TABLES) {
      if (!tableExists(db, table)) return `index is missing the ${table} table`;
    }
    const check = db.pragma('quick_check(1)', { simple: true });
    if (check !== 'ok') return `sqlite quick_check reported: ${String(check)}`;
    return null;
  } catch (error) {
    return `index is unreadable: ${errorMessage(error)}`;
  }
};

const openDatabaseFile = (path: string, readonly: boolean): IndexDatabase => {
  const db = new (loadDatabaseCtor())(path, { readonly });
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  return db;
};

const removeDatabaseFile = (path: string): void => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
};

/**
 * Opens the index, creating it if absent. A file that SQLite refuses to open
 * at all is deleted and recreated rather than reported: the bytes are a cache.
 */
export const openIndex = (opts: OpenIndexOptions = {}): IndexHandle => {
  const cwd = opts.cwd ?? process.cwd();
  const readonly = opts.readonly ?? false;
  const ftsRequested = opts.fts ?? true;
  const path = indexDbPath(cwd);

  if (!readonly) mkdirSync(dirname(path), { recursive: true });

  let db: IndexDatabase;
  let discardedReason: string | null = null;
  try {
    db = openDatabaseFile(path, readonly);
  } catch (error) {
    if (readonly) {
      throw Object.assign(
        new Error(`cannot open the index at ${path}: ${errorMessage(error)}`),
        { path },
      );
    }
    discardedReason = `the index file could not be opened (${errorMessage(error)})`;
    removeDatabaseFile(path);
    db = openDatabaseFile(path, readonly);
  }

  if (!readonly) createSchema(db);

  const handle: IndexHandle = {
    db,
    path,
    cwd,
    readonly,
    ftsRequested,
    discardedReason,
    fts: syncFts(db, ftsRequested, !readonly),
  };
  return handle;
};

export const closeIndex = (handle: IndexHandle): void => {
  handle.db.close();
};

/**
 * Deletes the file and starts over. Used when the schema version moved or the
 * file is unreadable — dropping tables is not enough, because a file written
 * by a future version may hold objects this build has never heard of.
 */
const resetIndexFile = (handle: IndexHandle): void => {
  handle.db.close();
  removeDatabaseFile(handle.path);
  handle.db = openDatabaseFile(handle.path, false);
  createSchema(handle.db);
  handle.discardedReason = null;
  handle.fts = syncFts(handle.db, handle.ftsRequested, true);
};

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

interface InsertCounts {
  trailers: number;
  paths: number;
}

/**
 * Inserts records in one transaction.
 *
 * The unique index on `(commit_sha, source, seq)` is an assertion, not a merge
 * strategy: an incremental range never contains an already-indexed commit, so
 * a conflict means the baseline was wrong. The caller turns that throw into a
 * rebuild.
 */
const insertRecords = (handle: IndexHandle, records: readonly RawRecord[]): InsertCounts => {
  const insertTrailer = handle.db.prepare(
    `INSERT INTO trailers
       (commit_sha, seq, key, value, value_lc, committed_at, committed_ts, provenance, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFts = handle.fts
    ? handle.db.prepare('INSERT INTO trailers_fts (rowid, value_lc) VALUES (?, ?)')
    : null;
  const insertPath = handle.db.prepare(
    'INSERT OR IGNORE INTO commit_paths (commit_sha, path) VALUES (?, ?)',
  );

  const counts: InsertCounts = { trailers: 0, paths: 0 };

  const run = handle.db.transaction((batch: readonly RawRecord[]) => {
    for (const record of batch) {
      const provenance =
        record.trailers.find((trailer) => trailer.key === 'Provenance')?.value ?? null;

      record.trailers.forEach((trailer, seq) => {
        const valueLc = trailer.value.toLowerCase();
        const inserted = insertTrailer.run(
          record.sha,
          seq,
          trailer.key,
          trailer.value,
          valueLc,
          record.committedAt,
          record.committedTs,
          provenance,
          record.source,
        );
        insertFts?.run(inserted.lastInsertRowid, valueLc);
        counts.trailers += 1;
      });

      for (const path of record.paths) {
        counts.paths += insertPath.run(record.sha, path).changes;
      }
    }
  });

  run(records);
  return counts;
};

const deleteNoteRows = (handle: IndexHandle): void => {
  handle.db.transaction(() => {
    if (handle.fts) {
      handle.db.exec(
        `DELETE FROM trailers_fts WHERE rowid IN (SELECT id FROM trailers WHERE source = 'notes')`,
      );
    }
    handle.db.exec(`DELETE FROM trailers WHERE source = 'notes'`);
  })();
};

/**
 * Brings the `source = 'notes'` rows in line with `refs/notes/commitlore`.
 *
 * Notes are re-read whole whenever the ref moves. A note can be rewritten in
 * place, so there is no "new notes only" range the way there is for commits,
 * and notes are sparse enough that whole is cheap.
 */
export const indexNotes = (handle: IndexHandle, opts: { force?: boolean } = {}): number => {
  const refSha = revParseRef(handle.cwd, NOTES_REF);
  const indexed = readMeta(handle.db, 'notes_ref_sha');

  if (!(opts.force ?? false) && refSha === indexed) return 0;

  deleteNoteRows(handle);
  const records = refSha === null ? [] : readNoteRecords(handle.cwd);
  const counts = insertRecords(handle, records);
  writeMeta(handle.db, 'notes_ref_sha', refSha);
  return counts.trailers;
};

const emptyStats = (handle: IndexHandle, started: number): IndexStats => ({
  rebuilt: false,
  rebuildReason: null,
  commitsScanned: 0,
  trailersIndexed: 0,
  pathsIndexed: 0,
  notesScanned: 0,
  noteTrailersIndexed: 0,
  headSha: null,
  fts: handle.fts,
  elapsedMs: Date.now() - started,
});

const requireWritable = (handle: IndexHandle): void => {
  if (handle.readonly) throw new Error('the index was opened read-only');
};

/**
 * Rebuilds from scratch: every commit reachable from HEAD, plus every note.
 * This is always safe and always sufficient — it is what makes the index
 * disposable (ADR-0003).
 */
export const rebuildIndex = (
  handle: IndexHandle,
  opts: { reason?: string } = {},
): IndexStats => {
  requireWritable(handle);
  const started = Date.now();

  handle.db.transaction(() => {
    if (handle.fts) handle.db.exec('DELETE FROM trailers_fts');
    handle.db.exec('DELETE FROM trailers');
    handle.db.exec('DELETE FROM commit_paths');
    handle.db.exec(`DELETE FROM meta WHERE k <> 'schema_version'`);
  })();

  const head = revParse(handle.cwd, 'HEAD');
  const stats: IndexStats = {
    ...emptyStats(handle, started),
    rebuilt: true,
    rebuildReason: opts.reason ?? null,
    headSha: head,
  };

  if (head !== null) {
    const shas = revList(handle.cwd, 'HEAD') ?? [];
    stats.commitsScanned = shas.length;
    const records = readCommitRecords(handle.cwd, shas);
    const counts = insertRecords(handle, records);
    stats.trailersIndexed = counts.trailers;
    stats.pathsIndexed = counts.paths;
  }

  writeMeta(handle.db, 'last_indexed_sha', head);
  writeMeta(handle.db, 'notes_ref_sha', null);

  const noteRecords = readNoteRecords(handle.cwd);
  stats.notesScanned = noteRecords.length;
  const noteCounts = insertRecords(handle, noteRecords);
  stats.noteTrailersIndexed = noteCounts.trailers;
  stats.pathsIndexed += noteCounts.paths;
  writeMeta(handle.db, 'notes_ref_sha', revParseRef(handle.cwd, NOTES_REF));

  stats.elapsedMs = Date.now() - started;
  return stats;
};

/**
 * Why an incremental update cannot be trusted, or `null`. Each answer names a
 * condition under which `last..HEAD` would not describe the difference between
 * the index and the repository.
 */
const incrementalProblem = (handle: IndexHandle, head: string, last: string | null): string | null => {
  if (last === null) return 'the index has no baseline commit';
  if (last === head) return null;
  if (revParse(handle.cwd, last) === null) {
    return `the last indexed commit ${last.slice(0, 12)} is gone (history was rewritten)`;
  }
  const ancestor = execGit(['merge-base', '--is-ancestor', last, head], { cwd: handle.cwd });
  if (ancestor.code !== 0) {
    return `HEAD no longer descends from the last indexed commit ${last.slice(0, 12)}`;
  }
  return null;
};

/**
 * Incremental update: only `last_indexed_sha..HEAD` is read. Falls back to a
 * full rebuild whenever that range would not describe reality — a corrupt
 * file, a schema version this build does not know, a rewritten history. The
 * reason is reported in `IndexStats.rebuildReason` so the caller can say so.
 */
export const updateIndex = (handle: IndexHandle, opts: { force?: boolean } = {}): IndexStats => {
  requireWritable(handle);
  const started = Date.now();

  const discarded = handle.discardedReason;
  if (discarded !== null) {
    handle.discardedReason = null;
    return rebuildIndex(handle, { reason: discarded });
  }

  const problem = healthProblem(handle.db);
  if (problem !== null) {
    resetIndexFile(handle);
    return rebuildIndex(handle, { reason: problem });
  }
  if (opts.force ?? false) return rebuildIndex(handle, { reason: 'rebuild requested' });

  const head = revParse(handle.cwd, 'HEAD');
  if (head === null) {
    /* An empty repository is not an error; it is a repository with no records. */
    const stats = emptyStats(handle, started);
    writeMeta(handle.db, 'last_indexed_sha', null);
    stats.noteTrailersIndexed = indexNotes(handle);
    stats.elapsedMs = Date.now() - started;
    return stats;
  }

  const last = readMeta(handle.db, 'last_indexed_sha');
  const blocker = incrementalProblem(handle, head, last);
  if (blocker !== null) return rebuildIndex(handle, { reason: blocker });

  const stats: IndexStats = { ...emptyStats(handle, started), headSha: head };

  if (last !== null && last !== head) {
    const shas = revList(handle.cwd, `${last}..HEAD`);
    if (shas === null) {
      return rebuildIndex(handle, { reason: `git could not list ${last}..HEAD` });
    }
    stats.commitsScanned = shas.length;
    const records = readCommitRecords(handle.cwd, shas);
    try {
      const counts = insertRecords(handle, records);
      stats.trailersIndexed = counts.trailers;
      stats.pathsIndexed = counts.paths;
    } catch (error) {
      return rebuildIndex(handle, {
        reason: `incremental insert conflicted with existing rows (${errorMessage(error)})`,
      });
    }
    writeMeta(handle.db, 'last_indexed_sha', head);
  }

  stats.noteTrailersIndexed = indexNotes(handle);
  stats.elapsedMs = Date.now() - started;
  return stats;
};

/** Opens the index and brings it up to date. The one call a query command needs. */
export const ensureIndex = (
  opts: OpenIndexOptions = {},
): { handle: IndexHandle; stats: IndexStats } => {
  const handle = openIndex(opts);
  return { handle, stats: updateIndex(handle) };
};

// ---------------------------------------------------------------------------
// Querying — the index path and the no-index path, which must agree
// ---------------------------------------------------------------------------

/** Trailing slashes would make `src/` and `src` different prefixes. */
const normalizePath = (path: string): string => path.replace(/\/+$/, '');

const compareTrailers = (a: IndexedTrailer, b: IndexedTrailer): number => {
  if (a.committedTs !== b.committedTs) return b.committedTs - a.committedTs;
  if (a.sha !== b.sha) return a.sha < b.sha ? -1 : 1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  return a.seq - b.seq;
};

/**
 * FTS5 trigram is exactly substring matching only for a printable-ASCII term
 * of at least three characters, and `%`/`_`/`\` would turn the LIKE pattern
 * into a wildcard. Outside that envelope the plain `instr` predicate runs
 * alone — slower, never different.
 */
const ftsEligible = (term: string): boolean =>
  term.length >= 3 && /^[ -~]+$/.test(term) && !/[%_\\]/.test(term);

interface TrailerRow {
  id: number;
  commit_sha: string;
  seq: number;
  key: string;
  value: string;
  committed_at: string;
  committed_ts: number;
  provenance: string | null;
  source: string;
}

const attachPaths = (handle: IndexHandle, rows: readonly TrailerRow[]): Map<string, string[]> => {
  const shas = [...new Set(rows.map((row) => row.commit_sha))];
  const byCommit = new Map<string, string[]>();
  if (shas.length === 0) return byCommit;

  for (const batch of chunked(shas, 500)) {
    const placeholders = batch.map(() => '?').join(', ');
    const found = handle.db
      .prepare<unknown[], { commit_sha: string; path: string }>(
        `SELECT commit_sha, path FROM commit_paths WHERE commit_sha IN (${placeholders})`,
      )
      .all(...batch);
    for (const row of found) {
      const existing = byCommit.get(row.commit_sha);
      if (existing === undefined) byCommit.set(row.commit_sha, [row.path]);
      else existing.push(row.path);
    }
  }

  for (const paths of byCommit.values()) paths.sort();
  return byCommit;
};

/**
 * Reads the index. Answers exactly what `scanTrailers` answers for the same
 * query — the SQL below is the fast spelling of the predicate in
 * `matchesQuery`, and `test/index-db.test.ts` holds the two to it.
 */
export const queryTrailers = (handle: IndexHandle, query: TrailerQuery = {}): IndexedTrailer[] => {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const keys = query.keys;
  if (keys !== undefined && keys.length > 0) {
    conditions.push(`t.key IN (${keys.map(() => '?').join(', ')})`);
    params.push(...keys);
  }

  if (query.source !== undefined) {
    conditions.push('t.source = ?');
    params.push(query.source);
  }

  if (query.sha !== undefined && query.sha !== '') {
    conditions.push('substr(t.commit_sha, 1, ?) = ?');
    params.push(query.sha.length, query.sha);
  }

  if (query.text !== undefined && query.text !== '') {
    const term = query.text.toLowerCase();
    if (handle.fts && ftsEligible(term)) {
      conditions.push('t.id IN (SELECT rowid FROM trailers_fts WHERE value_lc LIKE ?)');
      params.push(`%${term}%`);
    }
    conditions.push('instr(t.value_lc, ?) > 0');
    params.push(term);
  }

  if (query.path !== undefined && query.path !== '') {
    const path = normalizePath(query.path);
    conditions.push(
      `EXISTS (SELECT 1 FROM commit_paths p
                WHERE p.commit_sha = t.commit_sha
                  AND (p.path = ? OR substr(p.path, 1, ?) = ?))`,
    );
    params.push(path, path.length + 1, `${path}/`);
  }

  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
  const limit = query.limit === undefined ? '' : 'LIMIT ?';
  if (query.limit !== undefined) params.push(query.limit);

  const rows = handle.db
    .prepare<unknown[], TrailerRow>(
      `SELECT t.id, t.commit_sha, t.seq, t.key, t.value, t.committed_at, t.committed_ts,
              t.provenance, t.source
         FROM trailers t
         ${where}
        ORDER BY t.committed_ts DESC, t.commit_sha ASC, t.source ASC, t.seq ASC
        ${limit}`,
    )
    .all(...params);

  const paths = attachPaths(handle, rows);
  return rows.map((row) => ({
    sha: row.commit_sha,
    seq: row.seq,
    key: row.key,
    value: row.value,
    committedAt: row.committed_at,
    committedTs: row.committed_ts,
    provenance: row.provenance,
    source: row.source === 'notes' ? 'notes' : 'commit',
    paths: paths.get(row.commit_sha) ?? [],
  }));
};

/** The predicate `queryTrailers` spells in SQL. Kept in one place on purpose. */
const matchesQuery = (trailer: IndexedTrailer, query: TrailerQuery): boolean => {
  const keys = query.keys;
  if (keys !== undefined && keys.length > 0 && !keys.includes(trailer.key)) return false;
  if (query.source !== undefined && trailer.source !== query.source) return false;
  if (query.sha !== undefined && query.sha !== '') {
    if (trailer.sha.slice(0, query.sha.length) !== query.sha) return false;
  }
  if (query.text !== undefined && query.text !== '') {
    if (!trailer.value.toLowerCase().includes(query.text.toLowerCase())) return false;
  }
  if (query.path !== undefined && query.path !== '') {
    const path = normalizePath(query.path);
    const touched = trailer.paths.some(
      (candidate) => candidate === path || candidate.startsWith(`${path}/`),
    );
    if (!touched) return false;
  }
  return true;
};

const toIndexedTrailers = (records: readonly RawRecord[]): IndexedTrailer[] =>
  records.flatMap((record) => {
    const provenance = record.trailers.find((t) => t.key === 'Provenance')?.value ?? null;
    return record.trailers.map((trailer, seq) => ({
      sha: record.sha,
      seq,
      key: trailer.key,
      value: trailer.value,
      committedAt: record.committedAt,
      committedTs: record.committedTs,
      provenance,
      source: record.source,
      paths: record.paths,
    }));
  });

/**
 * Answers a query with no database at all, by walking `git rev-list` and
 * reading the same batched `git log` the indexer reads. Slower on a large
 * repository, identical in what it returns — which is the whole point of a
 * derived index (ADR-0003, PRD-F2 AC 4).
 */
export const scanTrailers = (
  query: TrailerQuery = {},
  opts: { cwd?: string } = {},
): IndexedTrailer[] => {
  const cwd = opts.cwd ?? process.cwd();
  const head = revParse(cwd, 'HEAD');
  const shas = head === null ? [] : (revList(cwd, 'HEAD') ?? []);

  const records = [...readCommitRecords(cwd, shas), ...readNoteRecords(cwd)];
  const matched = toIndexedTrailers(records)
    .filter((trailer) => matchesQuery(trailer, query))
    .sort(compareTrailers);

  return query.limit === undefined ? matched : matched.slice(0, query.limit);
};

/** Every row, ordered, for the identity assertions the tests make. */
export const dumpIndex = (handle: IndexHandle): IndexedTrailer[] => queryTrailers(handle);

/** What the index believes about itself. Consumed by `commitlore index --stats`. */
export const indexInfo = (
  handle: IndexHandle,
): {
  path: string;
  fts: boolean;
  schemaVersion: string | null;
  lastIndexedSha: string | null;
  notesRefSha: string | null;
  trailers: number;
  commits: number;
  paths: number;
} => ({
  path: handle.path,
  fts: handle.fts,
  schemaVersion: readMeta(handle.db, 'schema_version'),
  lastIndexedSha: readMeta(handle.db, 'last_indexed_sha'),
  notesRefSha: readMeta(handle.db, 'notes_ref_sha'),
  trailers: handle.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM trailers').get()?.n ?? 0,
  commits:
    handle.db
      .prepare<[], { n: number }>('SELECT count(DISTINCT commit_sha) AS n FROM trailers')
      .get()?.n ?? 0,
  paths:
    handle.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM commit_paths').get()?.n ?? 0,
});
