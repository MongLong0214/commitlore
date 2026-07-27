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
import type { Violation } from '../core/types.js';
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
}
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
    idCollisions: Violation[];
}
export declare const buildReport: (scan: Scan, at: Date) => StaleReport;
export declare const formatReport: (report: StaleReport) => string;
/**
 * Exit status stays 0 even with findings: `stale` reports, it does not gate.
 * The non-zero exit of SPEC §6 belongs to `commitlore validate`; a caller that
 * wants CI to fail on a dangling reference reads `danglingRefs` from `--json`.
 */
export declare const register: (program: Command) => void;
export {};
