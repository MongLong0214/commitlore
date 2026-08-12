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
import { type Trailer } from './types.js';
export type IndexDatabase = DatabaseSync;
/**
 * Bumped whenever a stored row stops meaning what it meant — a changed table
 * shape, **or** a changed rule about which rows belong here at all. A mismatch
 * is not an error: the index is derived, so the old file is deleted and rebuilt
 * (ADR-0003). Without it, a user upgrading the CLI silently reads a table that
 * no longer means what the code thinks it means.
 *
 * "Shape only" was the earlier reading, and it is what caused #406. #335 added
 * the `isCommitLoreKey` gate and changed no column, so the version stayed at 2
 * and every v0.5.0 index was accepted as current. The other rebuild trigger is
 * `lastIndexedSha !== head`, which cannot see a classifier change, so the
 * commits were never re-read: ordinary conventional-commit trailers kept being
 * served as records under the exact rule #335 was closed to enforce. `doctor`
 * compares the cache against HEAD and never against the classifier, so the one
 * check a user would run reported the stale index `ok`.
 *
 * v2 adds `trailers.block`: a message MAY now carry several record blocks
 * (SPEC §2.4, bug-issue-60), and rows from different blocks on the same
 * commit need a column of their own to stay apart — `seq` alone repeats
 * across blocks.
 *
 * v3 changes no column. It retires every index built before #335's classifier
 * gate, which is the only way those rows can be re-read.
 *
 * v4 adds `trailers.signature_status`, Git's `%G?` result for the commit read
 * in the same batched pass as its trailers. Signature verification is an
 * opt-in grading condition, so serving a v3 row without this fact could
 * incorrectly promote a record after a repository enables that mode.
 */
export declare const SCHEMA_VERSION = 4;
export declare const NOTES_REF = "refs/notes/commitlore";
export type RecordSource = 'commit' | 'notes';
/** One indexed trailer, with the commit context a consumer route needs. */
export interface IndexedTrailer extends Trailer {
    sha: string;
    /**
     * Which record block within `(sha, source)` this trailer belongs to
     * (SPEC §2.4), 0-indexed in the order the blocks appear. Almost always `0`
     * — a message carries more than one block only when it inherited several
     * records across a squash (`core/squash.ts`) or was pasted together from
     * several commits' messages (bug-issue-60).
     */
    block: number;
    /** Position within its block, preserving repeated-key order (SPEC §2.1 B5). */
    seq: number;
    committedAt: string;
    committedTs: number;
    provenance: string | null;
    /** Git's `%G?` output captured alongside the trailer batch. */
    signatureStatus: string;
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
    /**
     * Trailer values dropped because they matched `CONVENTIONAL_TRAILER_KEYS`
     * (bug-issue-150) — attribution and process trailers like `Co-authored-by:`
     * that are never counted toward `trailersIndexed`/`noteTrailersIndexed`
     * because they were never indexed at all. This is the discoverability half
     * of the fix: `commitlore index --stats` reports it so a user who wonders
     * why an attribution line does not appear in `commitlore context` has
     * somewhere to look, rather than the exclusion being silent.
     */
    trailersExcluded: number;
    /** Canonical spellings of the reserved keys actually seen, sorted. Empty when `trailersExcluded` is 0. */
    excludedKeys: readonly string[];
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
 * Canonical key -> occurrences dropped during one read. Optional everywhere it
 * is threaded: a caller that does not report stats (`scanTrailers`) passes
 * nothing, and filtering still happens — the count is a reporting side
 * channel, never a condition the filter itself depends on.
 */
type ExclusionCounts = Map<string, number>;
/**
 * A wall-clock ceiling on a no-index scan, and what it cost.
 *
 * The scan reads the whole history because the lifecycle fold is
 * repository-wide, and on the pre-edit hook path that is a per-edit cost the
 * agent waits through: 35s on an 823-commit repository, repeated on every edit,
 * because the scan deliberately builds no index (ADR-0003 gives that work to
 * `index` and `init`).
 *
 * `deadline` stops the batch loop; `unreadCommits` says how many commits that
 * left unread. The count is the point. A scan that quietly returned less would
 * be indistinguishable from a repository with fewer records, which is the one
 * answer this codebase refuses to produce — so nothing consults the budget
 * without also reporting what it cost.
 */
export interface ScanBudget {
    /** `Date.now()` value after which no further batch is read. */
    deadline: number;
    /**
     * The clock the deadline is read against. Defaults to `Date.now`.
     *
     * Injectable because the case worth testing — a budget that expires *partway*
     * through, rather than one already spent when the scan starts — is otherwise
     * a race against the machine. Asserting it with a real millisecond budget
     * passed on a slow laptop and failed on a fast CI runner, where the scan
     * finished inside the budget and nothing was truncated.
     */
    now?: () => number;
}
/** Filled in by a budgeted scan: 0 means every commit was read. */
export interface ScanCost {
    unreadCommits: number;
}
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
}, excluded?: ExclusionCounts) => number;
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
    allowRebuild?: boolean;
}) => IndexStats;
/** Opens the index and brings it up to date. The one call a query command needs. */
export declare const ensureIndex: (opts?: OpenIndexOptions) => {
    handle: IndexHandle;
    stats: IndexStats;
};
/**
 * Opens an index for a consumer query, catching it up but never rebuilding it.
 *
 * The distinction is the whole point of #522. An incremental update reads
 * `last_indexed_sha..HEAD`, so its cost is the commits made since the last
 * query — on a repository being worked in, a handful. A full rebuild reads the
 * entire history: 186 seconds on a 21,000-commit repository, which a
 * before-change hook cannot wait for and which a caller's timeout will kill,
 * leaving the next edit to start cold again.
 *
 * So this refuses exactly the unbounded case and keeps the bounded one. Not
 * catching up at all would be the same defect wearing different clothes: an
 * index one commit behind would be unusable, and every query after every commit
 * would fall back to reading the whole history — worse, in steady state, than
 * what this set out to fix. The incremental range is always a subset of that
 * history, so taking it is never the slower choice.
 *
 * Refusing is an error rather than a stale read. The caller falls back to git,
 * which remains the authority, and no answer ever comes from a cache that
 * missed a commit or a notes update.
 */
export declare const openCurrentIndex: (opts?: OpenIndexOptions) => IndexHandle;
/**
 * Reads the index. Answers exactly what `scanTrailers` answers for the same
 * query — the SQL below is the fast spelling of the predicate in
 * `matchesQuery`, and `test/index-db.test.ts` holds the two to it.
 */
export declare const queryTrailers: (handle: IndexHandle, query?: TrailerQuery) => IndexedTrailer[];
/** Applies the scan path's predicate to already-materialized trailer rows. */
export declare const filterTrailers: (trailers: readonly IndexedTrailer[], query?: TrailerQuery) => IndexedTrailer[];
/**
 * Answers a query with no database at all, by walking `git rev-list` and
 * reading the same batched `git log` the indexer reads. Slower on a large
 * repository, identical in what it returns — which is the whole point of a
 * derived index (ADR-0003, PRD-F2 AC 4).
 */
export declare const scanTrailers: (query?: TrailerQuery, opts?: {
    cwd?: string;
    budget?: ScanBudget;
    cost?: ScanCost;
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
export {};
