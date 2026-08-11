/**
 * Historical, read-only capture measurement.
 *
 * A historical commit cannot carry the transcript an agent had before it was
 * made. Shadow therefore substitutes the surviving commit message and the
 * first-parent patch, then runs the ordinary prepare and verify phases entirely
 * in memory. It is deliberately a measurement aid, not a new way to publish a
 * record.
 */
import { type SecretFinding } from './secret-guard.js';
/** Text displayed in every report, so the number is not mistaken for a replay. */
export declare const SHADOW_APPROXIMATION: string;
/** The writes the runner explicitly routes around. */
export declare const SHADOW_READ_ONLY_GUARANTEE: string;
export interface ShadowCommitResult {
    sha: string;
    subject: string;
    /** True when prepare and verify accepted a record, before secret-guard blocks publication. */
    would_record: boolean;
    /** `blocked` records are intentionally withheld from this result's `record` field. */
    secret_guard: 'clear' | 'blocked' | 'not-run';
    /** Canonical trailer block, present only for an unblocked accepted record. */
    record?: string;
    /** Why no record survived, in the draft adapter's or verifier's own words. */
    silence_reason?: string;
    /** Redacted secret-guard findings for a withheld record. */
    secret_findings?: SecretFinding[];
}
export interface ShadowSummary {
    commits_examined: number;
    would_record: number;
    blocked: number;
    silence: number;
    silence_rate: number;
    approximation: string;
    read_only: string;
}
export interface CaptureShadowResult {
    commits: ShadowCommitResult[];
    summary: ShadowSummary;
}
export interface CaptureShadowOptions {
    cwd: string;
    /** The exclusive lower bound, exactly as `git rev-list <rev>..HEAD` reads it. */
    since: string;
}
/**
 * Run a historical capture measurement. This function never stages, commits,
 * writes a pending file, updates an index, or modifies the inspected repository.
 */
export declare const runCaptureShadow: (opts: CaptureShadowOptions) => CaptureShadowResult;
