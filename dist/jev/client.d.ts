/**
 * One bounded request to TypeSafe — #1046, ADR #1045 D4.
 *
 * Built-in `fetch`, one POST, one deadline, no retries, no SDK, no provider
 * abstraction and no initialization ping. The whole surface is `askJev`, and the
 * only caller is the optional producer.
 *
 * ## Shape of the call
 *
 * `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer` and
 * `{model, state, questions}`. `questions` is a map of id → Choice, where a
 * Choice is `{type: 'choice', instructions, criteria}` and `criteria` maps each
 * option to a description. The response is `{model, answers, usage}`, where each
 * answer is `{type: 'choice', choice, probabilities, confidence}`.
 *
 * ## Why every field is checked and nothing is coerced
 *
 * The answer authorizes a record that lands in git history. A `"0.95"` quietly
 * read as a number, a `probabilities` map renormalized because it summed to
 * 1.04, or a `choice` that is not the argmax are each a decision made by this
 * code rather than by the model — and a decision this code cannot defend. So an
 * answer that does not arrive in the declared shape authorizes nothing. There is
 * no numeric-string coercion and no renormalization anywhere below.
 *
 * A tie is its own case. Two options within `TIE_EPSILON` mean the model did not
 * choose, whatever `choice` says, so the answer cannot act.
 *
 * ## Why not-sent, unavailable and answered are three outcomes
 *
 * "No record was created" has three causes and they are not interchangeable.
 * Nothing was dispatched; something was dispatched and did not come back usable;
 * or answers arrived. Collapsing the first two into "no useful decision found"
 * is the reporting failure the PRD names — and the second cannot claim delivery
 * to the provider either, because a socket that closes mid-flight may or may not
 * have been read.
 *
 * `usage` is parsed independently of the answers. A response whose answers are
 * malformed may still have consumed tokens, and reporting that as zero spend
 * would understate a bill. Absent usage after a dispatch is unknown, not zero.
 */
export declare const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Pinned, not `jev-latest`: an alias that moves changes behaviour silently. */
export declare const JEV_MODEL = "jev-1.13.0";
/** Resource bounds from ADR D4. Byte counts, UTF-8, not character counts. */
export declare const STATE_BYTE_LIMIT: number;
export declare const REQUEST_BYTE_LIMIT: number;
export declare const RESPONSE_BYTE_LIMIT: number;
/**
 * One deadline, covering headers and the body read.
 *
 * A timeout on headers alone leaves a response that trickles forever, which is
 * the same hang with more steps. This is a resource bound on the HTTP call and
 * not a promise about the commit: local git work, verification and validation
 * all happen outside it.
 */
export declare const HTTP_DEADLINE_MS = 3000;
/** Two options this close mean the model did not choose (ADR D4). */
export declare const TIE_EPSILON = 0.000001;
/** How far `probabilities` may be from summing to 1 (ADR D4). */
export declare const SUM_TOLERANCE = 0.001;
/** Input price per token for the checked model, docs read 2026-09-18. */
export declare const INPUT_TOKEN_USD: number;
export interface JevChoiceQuestion {
    /** Map key in the request. Never sent as inference context. */
    readonly id: string;
    /** What the model is asked. Names the candidate; see #1047. */
    readonly instructions: string;
    /** Option label → what it means. The label set is the answer's domain. */
    readonly criteria: Readonly<Record<string, string>>;
}
export interface JevAnswer {
    readonly choice: string;
    readonly probabilities: Readonly<Record<string, number>>;
    readonly confidence: number;
}
export interface JevUsage {
    /** Null means the response did not report it — unknown, never zero. */
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    /** Estimated from `inputTokens`. An estimate, never an invoice. */
    readonly estimatedUsd: number | null;
}
/**
 * Why nothing was dispatched, or why a dispatch produced nothing usable.
 *
 * A closed set: these strings reach a diagnostic file, and a provider's error
 * prose reaching one is how a response body ends up in an issue report.
 */
export type JevFailure = 'state-too-large' | 'request-too-large' | 'no-questions' | 'timeout' | 'aborted' | 'network' | 'redirect' | 'http-error' | 'response-too-large' | 'malformed-response' | 'unexpected-model';
export interface JevNotSent {
    readonly status: 'not-sent';
    readonly failure: JevFailure;
    /** Nothing left the machine, so there is no usage to report. */
    readonly usage: null;
}
export interface JevUnavailable {
    readonly status: 'unavailable';
    readonly failure: JevFailure;
    /** A dispatch may have been billed even when its answers were unusable. */
    readonly usage: JevUsage | null;
    /** Present for `http-error`. The status only — never the body. */
    readonly httpStatus?: number;
}
export interface JevAnswered {
    readonly status: 'answered';
    /** Keyed by question id. Only answers that passed every check appear. */
    readonly answers: ReadonlyMap<string, JevAnswer>;
    /** Ids that were asked and came back unusable. Not the same as unanswered. */
    readonly unusable: readonly string[];
    readonly usage: JevUsage | null;
}
export type JevOutcome = JevNotSent | JevUnavailable | JevAnswered;
export interface AskJevOptions {
    readonly key: string;
    readonly state: string;
    readonly questions: readonly JevChoiceQuestion[];
    /** Caller cancellation. Aborts the socket and the body read. */
    readonly signal?: AbortSignal;
    /** Injected by tests. Defaults to the runtime's own `fetch`. */
    readonly fetchImpl?: typeof fetch;
    /** Injected by tests so a deadline can be exercised without waiting. */
    readonly deadlineMs?: number;
}
/**
 * The one request.
 *
 * Never throws. Every failure is an outcome, because the caller is a git hook:
 * an exception escaping here would have to be caught by the hook anyway, and a
 * catch around the whole optional path is exactly the construct ADR D1 forbids
 * near native validation.
 */
export declare const askJev: (opts: AskJevOptions) => Promise<JevOutcome>;
/** A sentence for a diagnostic. Carries no provider prose and no key. */
export declare const describeOutcome: (outcome: JevOutcome) => string;
