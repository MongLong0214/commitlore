/**
 * Backfill — reconstructing records for commits made before CommitLore existed
 * (T-801, PRD-F8, ADR-0006).
 *
 * Every other write path in this codebase records a decision while somebody
 * still remembers making it. Backfill does not have that. It works from what
 * survived — a commit message, maybe a pull request body, the diff — and asks a
 * session to say what the change was for. That is reconstruction, and
 * reconstruction is the one place in the protocol where a model is being invited
 * to fill a gap it cannot see into.
 *
 * So the gap is closed from three sides, and none of them is optional:
 *
 * 1. **`Provenance: reconstructed`, always.** Forced onto every record before it
 *    is verified, overwriting whatever the draft claimed. A backfilled record
 *    that presented itself as `authored` would be graded as an instruction by
 *    SPEC §7 — a sentence a model wrote about a commit it never saw, delivered
 *    to the next agent as a directive.
 * 2. **`verifyDraft` is a gate, not a lint.** Nothing reaches the notes mirror
 *    without passing T-404, which re-reads the exact same transcript and diff
 *    and keeps only quotes it can find there character for character.
 * 3. **Failure is a skip.** There is no repair round here. `harvest` repairs
 *    because a live session can go back and read the transcript again; backfill
 *    cannot, because the source really is that thin. A second attempt against
 *    thin sources is not a better reading of the evidence, it is a stronger
 *    incentive to invent. Discarded records are logged and left discarded.
 *
 * What this module will not do is rewrite history. Records go to
 * `refs/notes/commitlore` and nowhere else: rewriting a commit message to add a
 * trailer changes every downstream sha, and no cold-start convenience is worth
 * an irreversible operation on somebody's history.
 *
 * ## The CLI still holds no key
 *
 * As everywhere else (ADR-0006), the model is the user's. `--prompt-only` emits
 * the reconstruction contract; the session answers it; `--draft` takes the
 * answer back. With neither flag there is nothing to reconstruct *with*, so the
 * command does the one useful thing that needs no model at all — it indexes the
 * past commits that already carry trailers — and exits 0.
 *
 * ## Why target selection walks git rather than reading the index
 *
 * `scanTrailers` answers "which commits already carry a record" by walking git
 * directly, which is slower than the SQLite index on a large repository. It is
 * used anyway: it never writes (so `--dry-run` is genuinely read-only), it needs
 * no database (so a fresh clone works), and it is one code path rather than two
 * that have to agree. Backfill is a one-shot cold-start command, and paying a
 * full walk once is the cheap side of that trade.
 */
import { type RejectionReason, type Sources } from './harvest-verify.js';
import { type Trailer } from './types.js';
/** Target commits considered when `--limit` is not given. */
export declare const DEFAULT_LIMIT = 50;
/**
 * Commits per batch. Batches exist only so that "nothing came back" can be
 * observed before the whole list has been walked (PRD-F8 요구 3), so the size
 * trades responsiveness against how much work a converged run wastes.
 */
export declare const DEFAULT_BATCH_SIZE = 10;
/**
 * Consecutive batches producing nothing before the run is declared converged.
 * Two rather than one: a single empty batch is normal — most commits record
 * nothing (SPEC §4) — and stopping on it would make backfill quit at the first
 * uneventful stretch of history.
 */
export declare const EMPTY_BATCH_LIMIT = 2;
export type BackfillMode = 'index-only' | 'prompt-only' | 'apply';
/** Which of the two caps, or which of the two natural ends, stopped the run. */
export type StopReason = 'exhausted' | 'limit' | 'budget-tokens' | 'converged';
export interface BackfillTarget {
    sha: string;
    subject: string;
}
export interface BackfillPrompt {
    sha: string;
    subject: string;
    prompt: string;
    estimatedTokens: number;
}
/**
 * Why a commit produced no record for a reason other than verification. Every
 * one of these is a commit left exactly as it was found.
 */
export type SkipReason = 
/** The commit already carries a record; backfill never overwrites one. */
'already-recorded'
/** The draft names a sha this repository does not have. */
 | 'unknown-commit'
/** The draft names a commit outside the selected targets. */
 | 'not-a-target'
/** The draft names the same commit twice. */
 | 'duplicate-sha'
/** Empty message, no pull request, empty diff — nothing to reconstruct from. */
 | 'no-source'
/** `parseDraft` rejected the record's shape (T-403). */
 | 'draft-format'
/** The assembled record is not a valid record, or carries no decision context. */
 | 'invalid-record'
/** The notes mirror refused the write. */
 | 'write-failed';
export interface BackfillSkip {
    sha: string;
    reason: SkipReason;
    detail: string;
}
/** A record the verifier threw out. The detail is T-404's, unedited. */
export interface BackfillDiscard {
    sha: string;
    reason: RejectionReason;
    detail: string;
}
export interface PullRequestStatus {
    requested: boolean;
    available: boolean;
    /** Why `gh` could not be used, when it could not. */
    reason: string | null;
    collected: number;
}
export interface IndexOutcome {
    updated: boolean;
    commitsScanned: number;
    trailersIndexed: number;
    noteTrailersIndexed: number;
    /** Why the index was not updated, when it was not. */
    reason: string | null;
}
export interface BackfillReport {
    mode: BackfillMode;
    dryRun: boolean;
    /** Commits examined while selecting targets. */
    commitsWalked: number;
    /** Commits already carrying a record, across the whole history. */
    recorded: number;
    targets: number;
    batches: number;
    prompts: number;
    /** Records attached to the mirror — or that would be, under `--dry-run`. */
    attached: number;
    discarded: BackfillDiscard[];
    skipped: BackfillSkip[];
    estimatedTokens: number;
    stoppedBy: StopReason;
    limit: number;
    budgetTokens: number | null;
    pullRequests: PullRequestStatus;
    index: IndexOutcome | null;
}
export interface BackfillResult {
    report: BackfillReport;
    prompts: BackfillPrompt[];
}
export interface BackfillOptions {
    cwd?: string | undefined;
    /** Target commits to consider. Defaults to {@link DEFAULT_LIMIT}. */
    limit?: number | undefined;
    /** Collect linked pull request bodies through the `gh` CLI. Opt-in. */
    withPrs?: boolean | undefined;
    /** Estimated-token ceiling on generated prompts. Prompt mode only. */
    budgetTokens?: number | undefined;
    /** Path to a draft a session produced. */
    draft?: string | undefined;
    promptOnly?: boolean | undefined;
    /** Compute everything, write nothing. */
    dryRun?: boolean | undefined;
    /** Commits per batch. Defaults to {@link DEFAULT_BATCH_SIZE}. */
    batchSize?: number | undefined;
}
export interface PullRequest {
    number: number;
    title: string;
    body: string;
}
/**
 * The text a commit is reconstructed from, and the text the verifier will check
 * every quote against. Built by one function so the two are the same bytes: if
 * prompt generation and verification ever assembled sources differently, a
 * session's honest quote would be discarded and a verifier's judgement would be
 * about a document nobody read.
 *
 * That symmetry is why `--with-prs` has to be passed to both invocations. It is
 * also why a mismatch is safe rather than dangerous: the failure mode is a
 * discarded record, never an accepted one.
 */
export declare const collectSources: (cwd: string | undefined, sha: string, prs: readonly PullRequest[]) => Sources;
export declare const estimateTokens: (text: string) => number;
/**
 * Commits that already carry a record, from the message or the mirror.
 *
 * A commit whose only trailer is something like `Signed-off-by:` has no
 * CommitLore record and is a legitimate target — the question is whether this
 * protocol has anything on the commit, not whether git found a trailer.
 */
export declare const recordedShas: (cwd: string | undefined) => Set<string>;
export interface TargetSelection {
    targets: BackfillTarget[];
    /** Commits walked before the limit was reached or history ran out. */
    walked: number;
    /** Every commit that already carries a record. Reused rather than re-walked. */
    recorded: ReadonlySet<string>;
    /** The limit stopped the walk with commits still unexamined. */
    truncated: boolean;
}
/**
 * The most recent commits with no record, newest first. Commits that already
 * carry one are skipped rather than revisited: a record is a claim somebody
 * made, and a reconstruction has no business replacing it.
 */
export declare const selectTargets: (options?: BackfillOptions) => TargetSelection;
/**
 * The instruction that wraps the per-commit contracts. Each contract tells the
 * session to emit one bare JSON object; several of them in one prompt would be
 * several answers with nothing tying them to a commit, so the envelope names the
 * shape that does.
 */
export declare const buildEnvelope: (count: number, withPrs: boolean) => string;
export declare const buildBackfillPrompt: (target: BackfillTarget, sources: Sources) => string;
/**
 * Strips whatever the draft said about provenance and states the truth.
 *
 * Applied before verification, not after, so that the record T-404 passes is the
 * record that reaches the mirror byte for byte — there is no window between "was
 * verified" and "was written" for a value to change in.
 */
export declare const forceReconstructed: (trailers: readonly Trailer[]) => Trailer[];
export interface DraftCommitEntry {
    sha: string;
    records: unknown;
}
/**
 * Reads the envelope a session produced. Throws only for a document that cannot
 * be read as one — anything wrong with an individual commit's records is a skip
 * with a reason, because one bad entry must not cost the others.
 */
export declare const parseDraftDocument: (raw: string) => DraftCommitEntry[];
/**
 * Runs a backfill.
 *
 * Throws only for what the user got wrong — mutually exclusive flags, a draft
 * that is not a draft. Everything a repository can be found to be is a reported
 * outcome, because a cold-start command that fails on a repository's actual
 * shape is a command nobody runs twice.
 */
export declare const backfill: (options?: BackfillOptions) => BackfillResult;
