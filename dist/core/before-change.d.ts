/**
 * T-1024 — `commitlore_before_change`: unified context + guard in one call.
 *
 * Returns path-scoped context (active decisions, verification gaps) alongside
 * an optional experimental guard result, with the two confidence levels kept
 * structurally separate per ADR-0020's confidence-separation constraint.
 *
 * ## Confidence separation
 *
 * `guard_confidence` qualifies `possible_revival_matches` and nothing else.
 * `active_decisions` and `verification_gaps` are path-scoped context — they
 * never inherit the guard's experimental grade. The schema is the asymmetry:
 * there is no `context_confidence` field, and the response carries exactly five
 * fields.
 *
 * ## Fail-closed
 *
 * When the repository cannot be read or notes are unfetched, the tool reports
 * the gap in `verification_gaps` rather than returning an empty context that
 * reads as "no constraints". This is the project's oldest defect class.
 */
import { type RenderedGuardMatch } from './guard.js';
/** The three verification gaps this codebase checks for, in canonical order. */
export type VerificationGap = 'history-unavailable' | 'shallow-history' | 'notes-unfetched';
/** Guard confidence enum — qualifies `possible_revival_matches` only. */
export type GuardConfidence = 'not-run' | 'experimental' | 'timed-out';
/** One active decision record, as surfaced to the caller. */
export interface ActiveDecision {
    recordId: string | null;
    sha: string;
    trust: string | null;
    paths: string[];
    trailers: Array<{
        key: string;
        value: string;
    }>;
}
/** The response shape — exactly five fields, no more, no less. */
export interface BeforeChangeResult {
    active_decisions: ActiveDecision[];
    verification_gaps: VerificationGap[];
    possible_revival_matches: RenderedGuardMatch[];
    guard_confidence: GuardConfidence;
    cache_key: string;
}
export interface BeforeChangeOptions {
    path: string;
    proposal?: string;
    cwd?: string;
    /** Authors whose active records may direct the caller. */
    trustedAuthors?: readonly string[];
}
/**
 * The unified before-change query. Returns exactly five fields.
 *
 * When `proposal` is omitted: context only, `guard_confidence: "not-run"`.
 * When `proposal` is supplied: context + experimental guard result.
 */
export declare const beforeChange: (opts: BeforeChangeOptions) => BeforeChangeResult;
