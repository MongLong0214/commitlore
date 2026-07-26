/**
 * The query engine behind `context`, `limits`, `ruled-out` and `warnings`
 * (SPEC §5 — the consumer routes for `Limit:`, `Ruled-out:` and `Warn:`).
 *
 * Three things make this more than a filter over `index-db.ts`.
 *
 * ## Path scope follows renames
 *
 * `--follow` is the default, because a decision recorded against `a.ts` is
 * still about the file after it becomes `c/d.ts` — a path query that stops at
 * the rename silently reports "no constraints" for a file that has them, which
 * is the one wrong answer that looks like a healthy repository (D4).
 *
 * git does the following, not this module: `git log --follow --name-only`
 * reports the name the file carried at each commit, and that set of names is
 * what the index is then asked about. Resolving *names* rather than a set of
 * commits keeps the index's own path predicate in play, so a record on a merge
 * commit (indexed by its first-parent diff) is still found even where
 * `--follow`'s history simplification would not have walked it.
 *
 * `--follow` accepts exactly one pathspec — `git log --follow -- a b` exits
 * 128. Several paths therefore run without it, and say so: quietly answering a
 * different question than the flag advertises is worse than a rename that was
 * not followed.
 *
 * ## The lifecycle fold is global, the path scope is not
 *
 * A record about `src/auth/` can be retired by a `Supersedes:` on a commit that
 * touched only `docs/`. Folding just the path-scoped stream would therefore
 * report a retired record as active. The fold (`core/stale.ts`) runs over the
 * whole repository and only the *display* set is path-scoped.
 *
 * That global pass fetches `Record-Id`, `Supersedes` and `Expires` and nothing
 * else — every key the fold reads — so it stays an indexed key lookup rather
 * than a full table scan. Records carrying none of the three cannot be
 * superseded or expire, and default to `active`.
 *
 * ## Identity, not commits
 *
 * `Record-Id:` is the unit (SPEC §3.2): the same record re-declared across
 * commits, or mirrored into `refs/notes/commitlore`, is one record. Records
 * without one are keyed by their commit and source instead, so nothing can
 * `Supersedes:` them (correct — they have no identity to name) while a
 * date-form `Expires:` still retires them through the same fold.
 */
import { type RecordSource } from './index-db.js';
import { type Lifecycle, type Record } from './types.js';
export declare const LIMIT_KEY = "Limit";
export declare const RULED_OUT_KEY = "Ruled-out";
export declare const WARN_KEY = "Warn";
/**
 * Trust grade, the output half of SPEC §7. `blocked` is reserved: the minimal
 * rule below never produces it.
 */
export type TrustGrade = 'directive' | 'claim' | 'blocked';
export interface QueryOptions {
    /** A single path to scope to. Sugar for `paths: [path]`. */
    path?: string;
    /** Several paths. Renames are followed only for one (see `QueryResult.follow`). */
    paths?: readonly string[];
    /** Trailer keys the caller wants; a record carrying none of them is dropped. */
    keys?: readonly string[];
    /** Keep superseded and expired records too, each with its lifecycle attached. */
    allHistory?: boolean;
    /** Answer from git alone, with no SQLite index. Same answers, slower. */
    noIndex?: boolean;
    /** The instant to evaluate against. Defaults to now. */
    at?: Date;
    /** Maximum records returned, applied after ordering. */
    limit?: number;
    /**
     * Authors trusted for this repository (SPEC §7), as `inject` takes them.
     *
     * Omitting it is the fail-closed answer, not the permissive one: a `Warn:`
     * from an author the caller cannot vouch for grades `claim`, never
     * `directive`. That is the same default `commitlore inject` has always had,
     * and the two routes disagreeing was the defect this option closes.
     */
    trustedAuthors?: readonly string[];
    cwd?: string;
}
/**
 * A record as a consumer route sees it: the protocol's `Record`, resolved
 * across every commit and source that declared it, with the lifecycle and
 * trust axes of SPEC §7 attached.
 */
export interface GradedRecord extends Record {
    /** The latest commit that declared this record. */
    sha: string;
    /** Every commit that declared it, oldest first. */
    shas: string[];
    source: RecordSource;
    /** Every source that contributed — a mirrored record has both. */
    sources: RecordSource[];
    paths: string[];
    lifecycle: Lifecycle;
    committedAt: string;
    committedTs: number;
    /** Open set from the stale engine; today only `review`. */
    flags: string[];
    /** The `Provenance:` value verbatim, when the record carried one. */
    provenanceValue?: string;
    trust?: TrustGrade;
    supersededBy?: string;
    expiresAt?: string;
}
export interface QueryResult {
    records: GradedRecord[];
    /** Whether the SQLite index answered. `false` means the scan fallback did. */
    fromIndex: boolean;
    /** Commit records read before filtering — what the answer was drawn from. */
    scanned: number;
    /** The instant everything was evaluated against. */
    at: Date;
    /** The paths the caller asked for, normalized. */
    paths: string[];
    /** The names actually queried: `paths` plus whatever renames resolved to. */
    aliases: string[];
    /** Whether renames were followed. `false` when several paths were given. */
    follow: boolean;
    /** Anything the caller should be told about how the answer was produced. */
    diagnostics: string[];
}
/**
 * Answers one path-scoped, lifecycle-filtered query.
 *
 * The evaluation instant defaults to now here and nowhere deeper, so that no
 * test of the fold depends on the day it runs. A commit dated after that
 * instant has not happened yet and is invisible to both the fold and the
 * display set — `--at` is a time machine, and a stream where the two disagreed
 * would report records whose supersessions had not been read.
 */
export declare const runQuery: (opts?: QueryOptions) => QueryResult;
/** The values a record carries under one key, in order (SPEC §2.1 B5). */
export declare const valuesOf: (record: GradedRecord, key: string) => string[];
