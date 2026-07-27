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
import type { DatabaseSync } from 'node:sqlite';
import type { Trailer } from './types.js';
export type IndexDatabase = DatabaseSync;
/**
 * Bumped whenever the table shape changes. A mismatch is not an error: the
 * index is derived, so the old file is deleted and rebuilt (ADR-0003). Without
 * this, a user upgrading the CLI would silently read a table that no longer
 * means what the code thinks it means.
 */
export declare const SCHEMA_VERSION = 1;
export declare const NOTES_REF = "refs/notes/commitlore";
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
/**
 * Absolute path of the index file. `--git-path` is what makes this correct
 * inside a linked worktree or a submodule, where `.git` is a file pointing
 * elsewhere.
 */
export declare const indexDbPath: (cwd?: string) => string;
/**
 * Opens the index, creating it if absent. A file that SQLite refuses to open
 * at all is deleted and recreated rather than reported: the bytes are a cache.
 */
export declare const openIndex: (opts?: OpenIndexOptions) => IndexHandle;
export declare const closeIndex: (handle: IndexHandle) => void;
/**
 * Brings the `source = 'notes'` rows in line with `refs/notes/commitlore`.
 *
 * Notes are re-read whole whenever the ref moves. A note can be rewritten in
 * place, so there is no "new notes only" range the way there is for commits,
 * and notes are sparse enough that whole is cheap.
 */
export declare const indexNotes: (handle: IndexHandle, opts?: {
    force?: boolean;
}) => number;
/**
 * Rebuilds from scratch: every commit reachable from HEAD, plus every note.
 * This is always safe and always sufficient — it is what makes the index
 * disposable (ADR-0003).
 */
export declare const rebuildIndex: (handle: IndexHandle, opts?: {
    reason?: string;
}) => IndexStats;
/**
 * Incremental update: only `last_indexed_sha..HEAD` is read. Falls back to a
 * full rebuild whenever that range would not describe reality — a corrupt
 * file, a schema version this build does not know, a rewritten history. The
 * reason is reported in `IndexStats.rebuildReason` so the caller can say so.
 */
export declare const updateIndex: (handle: IndexHandle, opts?: {
    force?: boolean;
}) => IndexStats;
/** Opens the index and brings it up to date. The one call a query command needs. */
export declare const ensureIndex: (opts?: OpenIndexOptions) => {
    handle: IndexHandle;
    stats: IndexStats;
};
/**
 * Reads the index. Answers exactly what `scanTrailers` answers for the same
 * query — the SQL below is the fast spelling of the predicate in
 * `matchesQuery`, and `test/index-db.test.ts` holds the two to it.
 */
export declare const queryTrailers: (handle: IndexHandle, query?: TrailerQuery) => IndexedTrailer[];
/**
 * Answers a query with no database at all, by walking `git rev-list` and
 * reading the same batched `git log` the indexer reads. Slower on a large
 * repository, identical in what it returns — which is the whole point of a
 * derived index (ADR-0003, PRD-F2 AC 4).
 */
export declare const scanTrailers: (query?: TrailerQuery, opts?: {
    cwd?: string;
}) => IndexedTrailer[];
/** Every row, ordered, for the identity assertions the tests make. */
export declare const dumpIndex: (handle: IndexHandle) => IndexedTrailer[];
/** What the index believes about itself. Consumed by `commitlore index --stats`. */
export declare const indexInfo: (handle: IndexHandle) => {
    path: string;
    fts: boolean;
    schemaVersion: string | null;
    lastIndexedSha: string | null;
    notesRefSha: string | null;
    trailers: number;
    commits: number;
    paths: number;
};
