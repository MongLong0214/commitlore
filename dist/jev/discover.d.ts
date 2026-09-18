/**
 * Candidates out of code, judgements out of one request — #1047, ADR D3/D4.
 *
 * This module never touches git, never writes anything, and is never reached on
 * the keyless path. It takes an immutable conversation source, enumerates what
 * *could* be a decision, asks once, and copies literal passages into ordinary
 * `DraftRecord`s for native verification to accept or refuse.
 *
 * ## No draft is an input
 *
 * There is no "remember this", no user nomination, no trailer the caller
 * supplies. The enumeration is mechanical: complete visible blocks, and
 * complete sentences inside a block that is too long to be one candidate. No
 * English keyword is required, because a keyword gate would silently exclude
 * every conversation held in another language — the tests cover Korean and mixed
 * text for exactly that reason.
 *
 * ## The model chooses; it never writes
 *
 * Every trailer value is a slice of the source string. `Limit` and `Warn` copy
 * the whole candidate passage. `Ruled-out` copies two spans the code already
 * enumerated, into `alternative | reason`. Nothing is paraphrased, translated,
 * re-punctuated, or stripped of a qualifier — and a `Ruled-out` whose reason
 * span is missing is rejected rather than downgraded to a `Warn`, because
 * changing the key to avoid a rejection is the rejection being evaded.
 *
 * What survives that rule is thin. Literal extraction cannot record a decision
 * nobody stated in one passage, and the ceiling it imposes on recall is real —
 * it is the trade the ADR takes on purpose, because the alternative is a model
 * authoring history.
 *
 * ## The .90 floor is a policy, not a probability
 *
 * `CONFIDENCE_FLOOR` is uncalibrated. It is the initial bar for acting, chosen
 * before any measurement, and it must not be read as "90% of these are right".
 * A missing, invalid, tied or uncertain answer produces no draft for that
 * candidate — and is never recorded as a confident "there was nothing here".
 */
import type { DraftRecord } from '../core/harvest.js';
import type { ConversationSource } from './source.js';
import type { JevChoiceQuestion, JevOutcome } from './client.js';
/** The most candidates one request may carry (ADR D4). */
export declare const MAX_CANDIDATES = 16;
/** The bar for acting on an answer. Uncalibrated policy, not a truth rate. */
export declare const CONFIDENCE_FLOOR = 0.9;
export type CandidateKind = 'limit' | 'warn' | 'ruled_out' | 'none' | 'uncertain';
/** A span of the canonical source, addressed so `source.slice` reproduces it. */
export interface Span {
    readonly id: string;
    readonly blockId: string;
    readonly start: number;
    readonly end: number;
    readonly text: string;
}
export interface Candidate {
    readonly id: string;
    readonly blockId: string;
    readonly role: 'user' | 'assistant';
    readonly start: number;
    readonly end: number;
    readonly startLine: number;
    readonly endLine: number;
    readonly text: string;
    /** Clause and quoted fragments inside the same block, for `Ruled-out`. */
    readonly spans: readonly Span[];
}
export interface ChangeContext {
    /** Repository-relative paths in the staged change. Bounded by the caller. */
    readonly paths: readonly string[];
    /** A bounded slice of the staged diff. Relevance only, never a reason. */
    readonly diffExcerpt: string;
}
export interface DiscoveryCoverage {
    readonly blocksAvailable: number;
    readonly candidatesEnumerated: number;
    readonly candidatesAsked: number;
    /** Blocks in the window that were not enumerated — uninspected, not empty. */
    readonly blocksNotEnumerated: number;
    /** Candidates withheld by credential screening. */
    readonly candidatesWithheld: number;
    /** What screening reported, by rule id. Never a value. */
    readonly withheldRules: readonly string[];
    /** The source window itself was bounded. Carried through from the adapter. */
    readonly sourceComplete: boolean;
}
/** Why a candidate produced no draft. Closed; reaches diagnostics. */
export type SkipReason = 'no-answer' | 'low-confidence' | 'kind-none' | 'kind-uncertain' | 'not-applicable' | 'relevance-uncertain' | 'no-span-options' | 'span-invalid' | 'reason-missing' | 'alternative-has-pipe' | 'over-record-cap';
export interface CandidateOutcome {
    readonly candidateId: string;
    readonly kept: boolean;
    readonly reason?: SkipReason;
}
export interface DiscoveryPlan {
    readonly candidates: readonly Candidate[];
    readonly questions: readonly JevChoiceQuestion[];
    /** The exact bytes to send as `state`. */
    readonly state: string;
    readonly coverage: DiscoveryCoverage;
}
export interface DiscoveryResult {
    readonly records: readonly DraftRecord[];
    readonly outcomes: readonly CandidateOutcome[];
    readonly coverage: DiscoveryCoverage;
}
/**
 * The candidates, newest first.
 *
 * Only complete blocks. A block at the truncated edge of the window may begin
 * mid-word, and a `Limit:` copied out of it would state a constraint nobody
 * finished saying.
 */
export declare const enumerateCandidates: (source: ConversationSource) => Candidate[];
export declare const kindQuestionId: (candidateId: string) => string;
export declare const relevanceQuestionId: (candidateId: string) => string;
export declare const alternativeQuestionId: (candidateId: string) => string;
export declare const reasonQuestionId: (candidateId: string) => string;
/**
 * Plans one request.
 *
 * Screening runs here, before anything is assembled, and a candidate that
 * carries a credential is dropped rather than masked. Its span options go with
 * it: a span is a slice of the candidate, so assessing the spans of a withheld
 * passage would send the same bytes through a different field.
 */
export declare const planDiscovery: (source: ConversationSource, change: ChangeContext) => DiscoveryPlan;
export interface AssembleInput {
    readonly plan: DiscoveryPlan;
    readonly outcome: JevOutcome;
    /** The native `max_records_per_commit`. Never exceeded, never filled to. */
    readonly recordCap: number;
}
/**
 * Turns answers into ordinary drafts.
 *
 * Nothing here decides whether a record is *true* or whether it may be
 * committed. Native verification checks every quote against the same source
 * string, applies the vocabulary, refuses a `Ruled-out` with no rejection
 * language near it, mints the `Record-Id` and stamps the provenance. A refusal
 * there is a legitimate outcome and an omission worth measuring — not a signal
 * to soften the draft and ask again.
 */
export declare const assembleDrafts: (input: AssembleInput) => DiscoveryResult;
/** A sentence for a diagnostic. Counts and reasons; never source text. */
export declare const describeDiscovery: (result: DiscoveryResult) => string;
