/**
 * Harvest verification — the checker half of maker–checker (ADR-0006 §5, T-404).
 *
 * T-403 hands the session a prompt and format-checks whatever comes back.
 * Format is not truth. A draft can name every field correctly, cite every claim
 * it makes, and still quote a sentence nobody ever said. This module asks the
 * one question that separates a record from a plausible sentence: is it *there*,
 * in the transcript or the diff the session was actually given?
 *
 * Everything here is deterministic — no model, no network, no clock. Asking a
 * model whether a model told the truth is the same failure mode with an extra
 * invoice, which is why ADR-0006 ruled out self-checking harvest agents.
 *
 * The bias is fixed and it is not neutral: when this module is unsure, it
 * discards. A true record wrongly dropped costs a reader nothing — they are
 * exactly where they were before CommitLore existed. A fabricated one that gets
 * through is read by an agent that cannot check it, and it misdirects every
 * agent after that. Hence the rule this file exists to enforce: no record is
 * better than a false record.
 *
 * What it will not do is block. Verification runs next to somebody's commit,
 * and a commit that fails because an optional enrichment step found nothing is
 * a feature people switch off (ADR-0006: 전량 실패 시 비차단).
 */
import { type DraftRecord } from './harvest.js';
/** Why a drafted record was discarded. */
export type RejectionReason = 
/** The quote is not in the source it names. */
'evidence-not-found'
/** A claim the record makes has nothing behind it. */
 | 'evidence-missing'
/** A value outside a closed vocabulary (SPEC §3.1). */
 | 'enum'
/** A value that does not match its grammar, or a cardinality breach (SPEC §6). */
 | 'format'
/** A key SPEC §3 does not define. */
 | 'unknown-key'
/** `Ruled-out:` with nothing in the source showing the alternative turned down. */
 | 'ruled-out-no-rejection'
/** `Verified:` cannot be established by harvesting prose. */
 | 'verified-unsupported';
export interface VerifiedRecord {
    record: DraftRecord;
}
export interface RejectedRecord {
    record: DraftRecord;
    reason: RejectionReason;
    detail: string;
}
export interface VerifyResult {
    accepted: VerifiedRecord[];
    rejected: RejectedRecord[];
}
/** The originals a citation is checked against — the same two the session saw. */
export interface Sources {
    transcript: string;
    diff: string;
}
/**
 * Phrases that mark a transcript *turning something down* rather than merely
 * mentioning it. `Ruled-out:` is the one key whose truth condition is not
 * visible in a quote alone: "we could use a queue worker" and "we ruled out the
 * queue worker" quote equally well, and only the second is a record.
 *
 * The table is deliberately short. Every phrase added here is a phrase that can
 * launder a mention into a rejection. Missing *refusal* language is still a
 * cost the protocol pays; missing a *measured outcome* is not — that was #585,
 * and those forms live in the outcome layer below rather than in this list.
 *
 * Matched case-insensitively against the whitespace-collapsed neighbourhood of
 * the quote, with curly apostrophes folded to straight ones so that `won’t` and
 * `won't` are one phrase rather than two.
 */
export declare const REJECTION_MARKERS: readonly string[];
/**
 * Verifies a draft against the transcript and diff it was harvested from.
 *
 * Checks run in order of severity and stop at the first failure: a record that
 * quotes something nobody said is told that before it is told about an enum,
 * because the enum is not the problem with it.
 *
 * Total, deterministic, and side-effect free. The same draft and the same
 * sources always produce the same result, which is what lets a repair round be
 * something other than a coin flip.
 */
export declare const verifyDraft: (draft: DraftRecord[], sources: Sources) => VerifyResult;
/** One line of summary, then one line per discarded record. For terminals and logs. */
export declare const formatResult: (result: VerifyResult) => string;
/**
 * Builds the text handed back to the draft generator for another attempt.
 *
 * This function generates a prompt; it does not run one. The CLI holds no key
 * and calls no model (ADR-0006) — regeneration happens inside the user's own
 * session, which is the only place a model was ever going to be free.
 *
 * Returns the empty string when nothing was rejected: there is nothing to
 * repair, and a repair prompt with no failures in it is an invitation to invent.
 */
export declare const buildRepairFeedback: (rejected: readonly RejectedRecord[]) => string;
/** One iteration of the bounded repair loop (ADR-0006 §5, PRD-F4 요구 4). */
export interface RepairRound {
    round: number;
    rejected: RejectedRecord[];
    feedbackPrompt: string;
}
/**
 * The ceiling on repair attempts. Two, and then the commit proceeds with
 * whatever passed. An unbounded loop against a model that keeps producing the
 * same unfindable quote is a hang, and a hang at commit time is worse than an
 * empty record.
 */
export declare const MAX_REPAIR_ROUNDS = 2;
/**
 * The next repair round, or `null` when there is not one — either everything
 * passed or the budget is spent. Termination is structural rather than
 * conventional: a caller that loops until this returns `null` cannot spin,
 * whatever the model does.
 *
 * `attempted` is the number of rounds already run, so the first call passes 0.
 */
export declare const planRepair: (attempted: number, rejected: readonly RejectedRecord[]) => RepairRound | null;
