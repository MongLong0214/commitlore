/**
 * Harvest — the two deterministic ends of the draft pipeline (ADR-0006 §5).
 *
 * CommitLore is free forever, so the CLI carries no model and no API key. The
 * judgement in the middle of a harvest belongs to the user's own agent session.
 * This module owns everything on either side of that session, and everything on
 * either side is deterministic: the prompt contract handed *to* it, and the
 * format check applied to whatever comes *back*.
 *
 * `parseDraft` never repairs. A draft that omits a citation, names a key outside
 * SPEC §3, or carries a value the vocabulary rejects is discarded with a reason.
 * Repairing it would manufacture the one thing this protocol exists to prevent:
 * a record nobody actually made. A missing record costs a reader nothing; a
 * fabricated one costs every reader after it (ADR-0006).
 *
 * Checking that a quote is *true* — that it really appears in the transcript or
 * the diff it names — is deliberately not here. That is the verifier's job
 * (T-404): maker and checker stay separate (ADR-0006 ruled out self-checking
 * harvest agents).
 */
import { type Trailer, type Violation } from './types.js';
/** The transcript and diff a session is asked to harvest from. */
export interface HarvestInput {
    transcript: string;
    diff: string;
}
export type EvidenceSource = 'transcript' | 'diff';
/** One citation: the proof that a trailer was not invented. */
export interface DraftEvidence {
    /** Which trailer this supports — must be one of the record's own keys. */
    key: string;
    source: EvidenceSource;
    /** Copied verbatim from the source. T-404 checks it against the original. */
    quote: string;
    /** `L<start>-L<end>` for a transcript quote, or the `@@` hunk header for a diff. */
    locator: string;
}
/** A record as a session proposes it, before any verifier has seen it. */
export interface DraftRecord {
    trailers: Trailer[];
    evidence: DraftEvidence[];
}
/**
 * Why a draft record was discarded. Every rule is a *format* judgement that can
 * be made without reading the transcript — nothing here is a matter of taste.
 */
export type RejectionRule = 'not-an-object' | 'unknown-field' | 'malformed-trailers' | 'missing-evidence' | 'malformed-evidence' | 'evidence-orphan' | 'evidence-gap' | 'vocabulary';
export interface DraftRejection {
    /** Position in the draft's `records` array. */
    index: number;
    rule: RejectionRule;
    detail: string;
    /** Populated for `vocabulary`; empty otherwise. Consumed by the repair loop (SPEC §6). */
    violations: Violation[];
}
export interface DraftReview {
    records: DraftRecord[];
    rejected: DraftRejection[];
}
/** One row of the SPEC §3 vocabulary tables. */
export interface VocabularyEntry {
    /** The key without its colon, e.g. `Ruled-out`. */
    key: string;
    /** Value grammar as the prompt states it. */
    grammar: string;
    repeatable: boolean;
    meaning: string;
    /** The `§3.x Title` heading this row came from. */
    section: string;
    /** True for SPEC §3.1 keys — the claims a citation must back. */
    claim: boolean;
}
/**
 * Reads the vocabulary out of SPEC §3 and checks it against `types.ts`,
 * throwing on any disagreement. Both are required: SPEC carries the grammar and
 * the meaning that a prompt needs, `types.ts` carries the values the validator
 * enforces, and a prompt built from only one of them can teach a session to
 * write records the other half rejects.
 */
export declare const parseVocabulary: (specText: string) => VocabularyEntry[];
/** The vocabulary of SPEC §3, read once per process. */
export declare const loadVocabulary: () => VocabularyEntry[];
/**
 * The shape a session must emit, kept as a typed value rather than as prose in
 * the prompt: it cannot drift from `DraftRecord`, and `parseDraft` accepting it
 * is a test, not a hope.
 */
export declare const EXAMPLE_DRAFT: {
    records: DraftRecord[];
};
/**
 * Builds the prompt contract handed to the user's agent session. Deterministic
 * by construction — no clock, no randomness, no model — so the same transcript
 * and diff always produce the same bytes.
 */
export declare const buildHarvestPrompt: (input: HarvestInput) => string;
/**
 * Parses and format-checks a draft produced by an agent session.
 *
 * Throws only when the document itself cannot be read as a draft — malformed
 * JSON, a missing `records` array. Anything wrong with an individual record is
 * a rejection, not a throw: one bad record must not cost the good ones, and the
 * reason is data the repair loop (T-404) reads.
 */
export declare const parseDraft: (raw: string) => DraftReview;
