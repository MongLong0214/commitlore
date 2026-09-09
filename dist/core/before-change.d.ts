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
export type VerificationGap = 'history-unavailable' | 'shallow-history' | 'notes-unfetched' | 'unread-commits';
/**
 * Guard confidence enum — qualifies `possible_revival_matches` only.
 *
 * - `not-run`      no `proposal` was supplied, so nothing was asked.
 * - `experimental` the guard ran; the matches carry ADR-0020's grade.
 * - `unavailable`  a proposal was supplied and the guard could not run. Today
 *                  the only cause is unreadable history, which
 *                  `verification_gaps` names (#889).
 * - `timed-out`    the guard leg was cut short by its own bound.
 *
 * **Nothing emits `timed-out`.** F11 specifies a bounded guard leg that returns
 * it on expiry, and that bound was never implemented — the value's only emitter
 * was the unreadable-history branch below, which is not a timeout and never
 * measured one. It stays in the enum because it is the specified name for a
 * real expiry, and it stays unreachable until something actually bounds the
 * guard and can say so from a measured elapsed time.
 */
export type GuardConfidence = 'not-run' | 'experimental' | 'unavailable' | 'timed-out';
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
    /** Lifecycle instant resolved by the MCP edge. */
    at: Date;
    /** Authors whose active records may direct the caller. */
    trustedAuthors?: readonly string[];
    /** Opt-in: an otherwise eligible directive must have Git's verified `G` status. */
    requireSignedDirective?: boolean;
    /** Git `%GF` signing-key fingerprints authorized by repository policy. */
    trustedSignerFingerprints?: readonly string[];
}
/**
 * The unified before-change query. Returns exactly five fields.
 *
 * When `proposal` is omitted: context only, `guard_confidence: "not-run"`.
 * When `proposal` is supplied: context + experimental guard result.
 */
export declare const beforeChange: (opts: BeforeChangeOptions) => BeforeChangeResult;
