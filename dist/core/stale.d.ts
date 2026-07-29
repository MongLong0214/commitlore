/**
 * The stale engine (SPEC §5): the lifecycle fold that `Record-Id:`,
 * `Supersedes:` and `Expires:` resolve against, plus the `dangling-ref`
 * violation class of SPEC §6 — the one class `validateRecord` structurally
 * cannot see, because it asks whether a reference resolves somewhere in
 * *history*, not whether a single record is well-formed.
 *
 * The fold never reads the system clock. Every judgement is made against
 * `FoldOptions.at`, injected by the caller, and every date comparison is done
 * in UTC (`Date.parse` of an explicit `Z` instant — never `new Date(y, m, d)`
 * or any `getFullYear`-family call, which would consult the local zone). A CI
 * runner in UTC and a laptop in KST therefore fold the same stream to the same
 * states, and a test pinned to a fixed instant cannot rot as the date changes.
 *
 * `spec/contract-cases/stale-*.yaml` is the authority for every rule below;
 * this module is the implementation of those cases, not the definition.
 */
import { type Lifecycle, type Record, type Trailer, type Violation } from './types.js';
/** The only flag the core raises today. `flags` stays open for later routes. */
export declare const REVIEW_FLAG = "review";
/**
 * Exported so `commands/validate.ts` can report the exact same wording for
 * the same `duplicate-id` rule when it detects a same-message collision
 * directly from `core/trailers.ts`'s `labelRecordBlocks` (bug-issue-145) — one
 * rule should read the same regardless of which check found it.
 */
export declare const UNIQUE_ID_WANT = "exactly one record per Record-Id";
/**
 * A record plus the instant its commit was made — the axis the fold orders by.
 *
 * `committedAt` is optional so a plain `Record[]` (SPEC's knowledge unit, which
 * carries no time) is still a legal input: records without an instant keep
 * their input order, which is what a caller streaming straight out of
 * `git log` already has.
 */
export interface StaleRecord extends Record {
    /** ISO 8601 commit instant, e.g. `2026-01-10T00:00:00Z`. */
    committedAt?: string;
}
/** One record's folded state at the evaluation instant. */
export interface RecordState {
    recordId: string;
    /** The latest commit that declared this `Record-Id` ('' if the caller gave none). */
    sha: string;
    lifecycle: Lifecycle;
    /** Open set; today only `review` (a condition-form `Expires:`). */
    flags: string[];
    /**
     * What the record resolves to across every commit that declared it:
     * non-repeatable keys take the latest commit's value in place, repeatable
     * keys accumulate in first-seen order. `Record-Id` is omitted — identity is
     * `recordId`, not payload.
     */
    resolvedTrailers: Trailer[];
    /** The commit that retired this record, when one did. */
    supersededBy?: string;
    /** The resolved `Expires:` value verbatim — a date or a free-text condition. */
    expiresAt?: string;
}
export interface FoldOptions {
    /** The instant to evaluate against. Callers inject it; the fold never invents one. */
    at: Date;
}
/**
 * Folds a record stream into one state per `Record-Id`, as history stood at
 * `opts.at`.
 *
 * "As history stood" is the whole contract of `at`: a commit made after that
 * instant has not happened yet, so it neither declares a record nor retires
 * one (SPEC §5 — a supersession applies "from this commit forward"). Replaying
 * the same stream at an earlier instant therefore shows the record still
 * active, which is what makes `--at` a time machine rather than a filter.
 *
 * Commits carrying no `Record-Id:` produce no state — they are still read for
 * their `Supersedes:` trailers, which is how a retiring commit that declares
 * nothing of its own still retires its target. States come back in order of
 * first declaration.
 *
 * `superseded` outranks `expired` when both apply: retiring a record is a
 * deliberate act, and naming the commit that did it says more than the date
 * that would have caught up with it anyway. No contract case pins this yet.
 */
export declare const foldLifecycle: (records: StaleRecord[], opts: FoldOptions) => RecordState[];
/**
 * Reports every `Supersedes:`/`Follows:` that points at a `Record-Id` no record
 * in the stream declares (SPEC §6 `dangling-ref`).
 *
 * This is the cross-record half of validation: `validateRecord` sees one record
 * and cannot answer it, so a syntactically valid reference to nothing passes
 * there by design and is caught here instead. Scope is the stream it is handed
 * — a partial history yields partial answers, and the caller owns the window.
 *
 * References that are not syntactically valid `Record-Id` values are left
 * alone: those are `format` violations, already reported by `validateRecord`,
 * and reporting them twice under two rules makes the repair loop chase one
 * line with two fixes.
 */
export declare const findDanglingRefs: (records: StaleRecord[], referencedBy?: StaleRecord[]) => Violation[];
/**
 * A Record-Id belongs to exactly one record unless a later commit declares
 * `Supersedes:` for it. Same-message duplicates and divergent notes are still
 * collisions: neither is a later authored succession.
 */
export declare const findIdCollisions: (records: StaleRecord[]) => Violation[];
/** Whether a state belongs in a stale report: retired, expired, or flagged. */
export declare const isStale: (state: RecordState) => boolean;
