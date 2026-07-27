/**
 * `commitlore guard` — the consumer route SPEC §5 assigns to `Ruled-out:`.
 *
 * This is the claim the whole project rests on: an alternative that was
 * evaluated and dropped stays dropped, and the agent that proposes it again
 * three weeks later is told so *before* it executes. Every other route surfaces
 * knowledge; this one refuses a repeat.
 *
 * ## Why the matcher is deterministic
 *
 * No LLM call, no embedding, no network. Three reasons, in order of weight:
 *
 * 1. It runs on the hot path. The design intent (ADR-0006) is a PreToolUse
 *    hook — every Edit an agent proposes. A matcher with a per-call cost, a
 *    latency floor, or an API key is a matcher that gets uninstalled.
 * 2. A guard that answers differently on the second run cannot be argued with.
 *    A maintainer who thinks a flag is wrong must be able to see *which token
 *    hit*, which is why `GuardMatch.signals` exists and why a bare score would
 *    not be enough.
 * 3. A stochastic matcher would make any benchmark of this route measure the
 *    matcher rather than the protocol.
 *
 * That third reason described a measurement that has not happened. T-702 ran
 * the re-proposal matrix with `Ruled-out:` delivered as *injected context* —
 * the route SPEC §5 assigns to `Limit:` and `Warn:` — and never invoked guard
 * at all. This route, the one §5 actually assigns to `Ruled-out:`, is still
 * unmeasured end to end. `bench/ROUTE-GAP.md` records what replaying the
 * recorded runs through it showed, and #37 is the experiment that would close
 * it.
 *
 * The cost is recall: this finds lexical revivals, not semantic ones. See
 * "What this cannot see" at the bottom of this comment.
 *
 * ## The three signals
 *
 * `Ruled-out: <alternative> | <reason>` (SPEC §3.1). Only the alternative half
 * is matched against — the reason is prose about *why not*, and matching it
 * would flag every proposal that shares the objection's vocabulary.
 *
 * - **Token Jaccard** (`JACCARD_WEIGHT`) — overall similarity between the
 *   proposal and the alternative, over normalized, stopworded, lightly stemmed
 *   token sets. Symmetric, so it rewards a short focused proposal and decays on
 *   a long one.
 * - **Distinctive-keyword mass** (`KEYWORD_WEIGHT`) — how much of the
 *   alternative's *identity* the proposal names: its distinctive tokens (see
 *   `GENERIC_TERMS`), weighted by how rare each one is across the rejection
 *   corpus (see `Corpus`). Containment rather than similarity, which is what
 *   survives a proposal the size of a diff: "redis" is still in there.
 * - **`Record-Id:` hit** (`RECORD_ID_WEIGHT`) — the proposal names the record
 *   itself. Not similarity at all; an explicit reference.
 *
 * Jaccard alone answers "is this the same sentence"; mass alone answers "is the
 * rejected thing named in here". Either question answered wrongly on its own is
 * a bad guard, which is why both are weighted.
 *
 * ## Why the score is not the whole decision
 *
 * A weighted sum is an average, and an average cannot tell "one common word
 * matched hard" from "this is the same idea". Measured on this repository's own
 * history, a flat keyword rule flagged four of ten ordinary proposals — `rename
 * a variable`, `document the exit codes` — each on a single word that recurs
 * across dozens of rejections. Raising the threshold does not fix that; it
 * trades a discrimination problem for a sensitivity one, since real matches sat
 * in the same band. So a flag needs two things: a score at or above
 * `DEFAULT_THRESHOLD`, and corroboration (see `corroborated`).
 *
 * ## What this cannot see
 *
 * A revival phrased without any of the rejected alternative's words — "let's
 * put the sessions in a service both boxes can reach", for a ruled-out
 * `shared Redis cache` — scores zero here. So does a rename: an alternative
 * written `SessionStore` is one token, and a proposal saying "session store" is
 * two. And corroboration costs recall of its own: a proposal that names one
 * word of a long rejected alternative, and nothing else, is now let through.
 * All three are the honest limit of lexical matching, and the reason `guard`
 * warns rather than blocks.
 */
import type { HistoryAvailability } from './git.js';
import type { NotesAvailability } from './notes.js';
import { type TrustGrade } from './query.js';
export interface GuardMatch {
    recordId?: string;
    sha: string;
    trust: TrustGrade;
    /** The alternative half of the `Ruled-out:` value — everything before the `|`. */
    alternative: string;
    /**
     * Why it was rejected — everything after the `|`. Empty only when the record
     * is malformed (SPEC §3.1 requires the separator), which `signals` reports.
     */
    reason: string;
    /** 0..1, rounded to four places. Only scores at or above the threshold are returned. */
    score: number;
    /** What hit, in a fixed order: the record id, then keywords, then the Jaccard value. */
    signals: string[];
}
export interface GuardResult {
    matches: GuardMatch[];
    /** Whether the check could actually be performed. */
    history: HistoryAvailability;
    notes: NotesAvailability;
    /** True when history is 'unavailable' or notes is 'unfetched'. */
    incomplete: boolean;
}
interface RenderedGuardMatchIdentity {
    recordId: string | null;
    sha: string;
    score: number;
    signals: string[];
}
export type RenderedGuardMatch = (RenderedGuardMatchIdentity & {
    trust: 'blocked';
    withheld: string;
}) | (RenderedGuardMatchIdentity & {
    trust: 'directive' | 'claim';
    alternative: string;
    reason: string;
});
/**
 * The raw blocked content remains available to trusted program logic, while
 * every output surface receives a shape that cannot quote it accidentally.
 */
export declare const renderGuardMatch: (match: GuardMatch) => RenderedGuardMatch;
export interface GuardOptions {
    proposal: string;
    paths?: readonly string[];
    threshold?: number;
    at?: Date;
    cwd?: string;
    noIndex?: boolean;
    /**
     * Refuse to flag on a `Record-Id:` reference alone.
     *
     * The informational default is deliberate (see `RECORD_ID_WEIGHT`): naming a
     * record is a good reason to print what it ruled out. A blocking hook needs
     * the opposite, because citing a record is what compliance looks like.
     */
    requireContent?: boolean;
}
/**
 * Weight on token Jaccard. Equal to `KEYWORD_WEIGHT` because the two signals
 * fail in opposite directions: Jaccard collapses when the proposal is long
 * (a diff shares few tokens with a three-word alternative), coverage fires on a
 * single word when the alternative has only one distinctive token. Weighting
 * either above the other picks a favourite failure mode.
 */
export declare const JACCARD_WEIGHT = 0.5;
/** Weight on distinctive-keyword coverage. See `JACCARD_WEIGHT`. */
export declare const KEYWORD_WEIGHT = 0.5;
/**
 * Distinct distinctive tokens that corroborate a flag on count alone.
 *
 * Two is the smallest number that cannot be reached by one common word, and
 * every false positive measured on this repository's history was one word:
 * `rename`, `document`, `readme`, `regex`.
 */
export declare const MIN_KEYWORD_HITS = 2;
/**
 * The share of an alternative's IDF-weighted identity that corroborates a flag
 * on its own, so that a *single* word can still be enough when the alternative
 * is essentially that word.
 *
 * The line sits at half because the two populations separate there, measured:
 * across the ten unrelated proposals in `spec/fixtures/guard/proposals.json`,
 * the highest mass any of them reaches against any rejection in this
 * repository's history is **0.37** (`regex` against "regex trailer parsing");
 * `fixture` reaches 0.25 and `documents` 0.27. Across the re-proposals that
 * must fire, one word carries **1.00** — `redis` is the whole of "shared Redis
 * cache". `rabbitmq` at 0.50 of "a RabbitMQ broker" is the intended boundary
 * case: naming half of a two-word alternative is a re-proposal.
 */
export declare const STRONG_KEYWORD_MASS = 0.5;
/**
 * The token overlap that corroborates a flag with no keyword evidence at all —
 * the two texts are restatements of each other. Measured, the highest Jaccard
 * any of the ten unrelated proposals reaches against any rejection in this
 * repository is 0.29 ("document the exit codes in the README" against "rename
 * code and spec first, documents later"), so 0.4 clears the whole population.
 */
export declare const MIN_JACCARD = 0.4;
/**
 * Weight on a `Record-Id:` hit. Above `DEFAULT_THRESHOLD` on its own: a
 * proposal that names `r-7c1a45` is discussing that record, and printing what
 * it ruled out and why is the correct response whether the proposal is reviving
 * the alternative or merely citing it. Below 1.0 so the id is a strong signal
 * rather than a verdict — the reported score still separates "named the record"
 * from "named the record and restated the alternative".
 */
export declare const RECORD_ID_WEIGHT = 0.6;
/**
 * The score at which a proposal is flagged. Comparison is `>=`: this is the
 * minimum score that fires, not a value that must be exceeded.
 *
 * The threshold is the *second* of two conditions. `corroborated` runs first,
 * and it is what separates a re-proposal from a proposal that happens to share
 * a word; the threshold only decides how strong a corroborated match must be.
 * Raising the threshold alone was tried and rejected — the four false positives
 * measured on this repository sat at 0.44–0.54, and a threshold above them also
 * excludes real matches at 0.54.
 *
 * At 0.35 the corroborated cases land like this:
 *
 * - **0.58** — `shared Redis cache` against "use a redis instance to store
 *   sessions". One word shared out of six, but that word is the whole identity
 *   of the alternative (`STRONG_KEYWORD_MASS`), so it fires and must.
 * - **0.60** — a `Record-Id:` reference alone.
 * - **0.83, 1.00** — the two re-proposals measured against this repository's
 *   own history (`hardcode the adoption commit sha`, `print the matched
 *   credential…`), which are what the ceiling looks like.
 *
 * Measured against the thirteen unrelated proposals in
 * `spec/fixtures/guard/proposals.json` — ten against this repository's real
 * rejection corpus, three against the seeded fixtures — none is corroborated
 * at all, so the noise floor is not a low score but no match (`test/guard.test.ts`
 * prints the table). The threshold was not tuned down to that measurement:
 * room above the noise is what keeps a hook that runs on every Edit from being
 * switched off.
 */
export declare const DEFAULT_THRESHOLD = 0.35;
/**
 * Every active `Ruled-out:` alternative in scope that this proposal revives,
 * strongest first.
 *
 * The record set comes from `core/query.ts`, which already applies the path
 * scope (following renames), the lifecycle fold — a `Supersedes:` retires the
 * rejection, and a rejection that no longer holds must not block anything — and
 * the `--at` replay. Guard adds matching and nothing else.
 *
 * Availability now travels with the matches because an empty result is only
 * actionable when git history was readable and the notes mirror was fetched.
 * The command still owns path-scope caveats because they derive from its input.
 */
export declare const guard: (opts: GuardOptions) => GuardResult;
export {};
