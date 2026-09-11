/**
 * `commitlore stale` — the records that are no longer carrying their weight:
 * retired by a `Supersedes:`, past a date-form `Expires:`, or flagged for
 * review by a condition-form one (SPEC §5).
 *
 * The engine lives in `core/stale.ts` and is pure. This file is the two
 * impure halves around it: reading the record stream out of git, and choosing
 * the evaluation instant — the one place `new Date()` is legitimate, and only
 * as the default for `--at`.
 */
import type { Command } from 'commander';
import { type NotesAvailability } from '../core/notes.js';
import { type RecordState, type StaleRecord } from '../core/stale.js';
import type { Trailer, Violation } from '../core/types.js';
/**
 * How many commits a scan reads when `--all-history` is not given. A bounded
 * default keeps `stale` fast on a deep repository; the cost is that anything
 * older than the window is invisible, which the report says out loud rather
 * than letting a truncated answer pass for a complete one.
 */
export declare const DEFAULT_SCAN_LIMIT = 1000;
export interface CollectOptions {
    cwd?: string;
    /** Read the whole reachable history instead of the most recent commits. */
    allHistory?: boolean;
    revision?: string;
    /**
     * What one invocation has already read, reused across its own walks.
     *
     * `validate --range` collects the whole reachable history once per commit in
     * the range (`commands/validate.ts` `recordsFor`), so this repository's own
     * CI step walked ~1500 commits 1486 times and re-read everything on every
     * walk. Measured on run 34576438460: 2833s and 3578s for that one step, on
     * each matrix leg, of every release.
     *
     * Both halves are cached because both were repeated. Commit messages are
     * keyed by sha; the notes mirror is keyed by nothing at all, because its
     * content is a function of the repository rather than of the revision being
     * walked -- listing it and reading each note once per walk was 1980 of the
     * 7887 spawns a 164-commit range still cost after only the commit half was
     * cached.
     *
     * Safe because every cached value is a pure function of bytes that cannot
     * change underneath one invocation: a sha's message, and a ref read once.
     * The caller owns the cache and it dies with the invocation -- module-level
     * state would outlive a `git replace` or a fetch in a long-lived MCP server,
     * which is the one way these answers do change.
     *
     * Absent means no reuse, which is the right default for a single walk.
     */
    cache?: CollectCache;
}
/** Per-invocation scratch for `collectRecords`. Never share one across calls. */
export interface CollectCache {
    readonly commits: Map<string, CollectedRecord[]>;
    /** Every record block of the note on a sha, as `readRecordBlocks` returns them. */
    readonly notes: Map<string, Trailer[][]>;
    /** The mirror, read once: its shas and whether it could be read at all. */
    repository?: {
        shas: string[];
        availability: NotesAvailability;
    };
}
export declare const newCollectCache: () => CollectCache;
type RecordSource = NonNullable<StaleRecord['source']>;
type CollectedRecord = StaleRecord & {
    sha: string;
    committedAt: string;
    source: RecordSource;
};
export interface Scan {
    records: CollectedRecord[];
    /** Commits read, including those that recorded nothing. */
    commits: number;
    /** The scan stopped at the window, so older records were not seen. */
    truncated: boolean;
    notes: NotesAvailability;
}
/**
 * Reads the record stream from git, newest commit first (the fold reorders it).
 */
export declare const collectRecords: (opts?: CollectOptions) => Scan;
export interface StaleReportRecord extends RecordState {
    source: RecordSource;
}
export interface StaleReport {
    /** The evaluation instant, normalized to UTC. */
    at: string;
    commits: number;
    truncated: boolean;
    notes: NotesAvailability;
    /** Every record the scan saw, stale or not. */
    totalRecords: number;
    /** The stale ones: superseded, expired, or flagged for review. */
    records: StaleReportRecord[];
    danglingRefs: Violation[];
    /**
     * #914: references whose target was not in the scanned window and could not be
     * shown absent from history either. Separate from `danglingRefs` because that
     * field is what a CI job fails on, and a truncated window cannot support the
     * assertion `dangling-ref` makes. Always empty for `--all-history`.
     */
    unresolvedRefs: Violation[];
    idCollisions: Violation[];
}
export declare const buildReport: (scan: Scan, at: Date, 
/**
 * Where to resolve a reference the window did not cover. Omitted by callers
 * that hold no repository — they get `unresolvedRefs` rather than an assertion
 * neither of us can support.
 */
resolveIn?: {
    cwd?: string;
}) => StaleReport;
export declare const formatReport: (report: StaleReport) => string;
/**
 * Exit status stays 0 even with findings: `stale` reports, it does not gate.
 * The non-zero exit of SPEC §6 belongs to `commitlore validate`; a caller that
 * wants CI to fail on a dangling reference reads `danglingRefs` from `--json`.
 * The only non-zero code `stale` uses is 2, for a usage error -- an
 * unparseable `--at`, or git unable to answer at all (SPEC §10: neither is a
 * finding).
 */
export declare const register: (program: Command) => void;
export {};
