/**
 * The consideration binding: evidence that the capture flow ran against the
 * tree that is about to be committed, and what came out of it.
 *
 * The product enforces that the flow *ran*, never that a record exists. Those
 * are different claims and only the first one can be enforced honestly: an
 * agent that must produce a record will produce one, and a false record is
 * permanent. So the question a gate may ask is "was this tree considered", and
 * `records: []` is a complete, first-class answer to it.
 *
 * **Why this is not the pending transaction.** The three keys below are exactly
 * the ones `stageCaptureRecord` compares, and the obvious move is to let a
 * capture that found nothing settle the transaction and read that instead. It
 * was tried, shipped and reported (#1021): a verification accepting nothing
 * used to reach `verified`, and `pending ls` is the only way a host can ask
 * "is a capture staged for the commit about to happen". `verified` reads as
 * yes, so a host that built that check had every commit after the first empty
 * capture read as covered. The fix was to leave such a transaction `prepared`,
 * and that decision is load-bearing — this file exists because "a capture is
 * waiting" and "this tree was considered" are separate facts that must not
 * share one artifact.
 *
 * **What it is keyed to.** `head`, the staged diff's hash, and the effective
 * policy's identity hash — the same triple the staging gates already compare,
 * rather than a fourth identity of its own. The PRD this implements also asked
 * for `git write-tree`; that is left out deliberately, because it writes
 * objects into the database to answer a question these three already answer,
 * and a read that mutates is a poor thing to put on a hook's hot path.
 *
 * Every commit moves `head`, so no binding outlives the commit it was made
 * for. Staging anything changes the diff hash; editing policy changes the
 * policy hash. A stale file, a copied file, or one from another worktree fails
 * the comparison. The expiry is hygiene on top of that, not the mechanism.
 *
 * **What it does not defend against, stated plainly.** Anything running as this
 * user can write this file by hand. No secret can be hidden from such a
 * process, so the binding is not unforgeable against a deliberate agent — and
 * one of those could equally pass `--no-verify` or delete the hook. The threat
 * model is *inadvertence*: the agent that forgets. Against that, the legitimate
 * path is one tool call and the forge is three hashes and a JSON file.
 */
/** Under the git directory, so a linked worktree keeps its own and none is committed. */
export declare const CONSIDERATION_GIT_PATH = "commitlore/considered.json";
/**
 * The same five minutes a staged transaction gets, for the same reason: it is
 * the window in which the tree the flow examined is still the tree being
 * committed. A second number here would be a second answer to one question.
 */
export declare const CONSIDERATION_EXPIRY_MINUTES = 5;
/** What a consideration is bound to. Null `head` is an unborn branch. */
export interface ConsiderationBinding {
    readonly head: string | null;
    readonly staged_diff_hash: string;
    readonly policy_identity_hash: string;
}
export interface Consideration extends ConsiderationBinding {
    readonly version: number;
    /** `empty` is a complete answer, not a failure to find one. */
    readonly outcome: 'empty' | 'recorded';
    readonly records: number;
    readonly created_at: string;
    /** Which build wrote it, so a mixed-runtime machine can be told apart. */
    readonly tool: string;
}
/** Why a binding does not cover the tree in front of us. */
export type ConsiderationGap = 'none' | 'unreadable' | 'head-moved' | 'staged-diff-changed' | 'policy-changed' | 'expired';
export type ConsiderationVerdict = {
    covered: true;
    consideration: Consideration;
} | {
    covered: false;
    gap: ConsiderationGap;
    consideration: Consideration | null;
};
/**
 * Absolute path, resolved through `git rev-parse --git-path` so a linked
 * worktree gets its own rather than the main checkout's (ADR-0021, the same
 * route pending files take).
 */
export declare const considerationPath: (cwd: string) => string | null;
export declare const currentBinding: (cwd: string) => ConsiderationBinding;
export interface WriteConsiderationOptions {
    readonly cwd: string;
    readonly outcome: 'empty' | 'recorded';
    readonly records: number;
    /** Injected so a test can pin the window rather than race a real clock. */
    readonly now?: Date;
    readonly tool?: string;
}
/**
 * Record that this tree was considered. Returns what was written, or null when
 * `cwd` is not inside a repository.
 */
export declare const writeConsideration: (opts: WriteConsiderationOptions) => Consideration | null;
/** Remove the binding. Absent is success: the post-state is what matters. */
export declare const clearConsideration: (cwd: string) => void;
/** The stored binding, or null when there is none this build understands. */
export declare const readConsideration: (cwd: string) => Consideration | null;
/**
 * Whether the stored binding covers the tree in front of us.
 *
 * The gap is named rather than folded into a boolean, because the three ways a
 * binding can fail to apply are three different things to tell somebody: HEAD
 * moved (the commit already happened), the staged diff changed (stage first,
 * then consider), and the policy changed (the rules the flow ran under are not
 * the rules in force).
 */
export declare const considerationVerdict: (cwd: string, now?: Date) => ConsiderationVerdict;
