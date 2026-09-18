/**
 * The commit gate's decision: may this `git commit` proceed?
 *
 * It asks one question — **was this tree considered?** — and never "does a
 * record exist". An agent that must produce a record produces a false one, and
 * a false record is permanent; so `records: []` satisfies this gate exactly as
 * completely as ten records do. What it refuses is a commit where the capture
 * flow never ran at all, which is the state nothing could previously detect.
 *
 * Everything here is pure. Git, the filesystem and the policy arrive through
 * {@link GuardWorld}, so each rule can be exercised against a world built to
 * trigger it rather than against a repository coaxed into the right shape —
 * and so the rules can be read without reading git.
 *
 * **It fails open, always.** Every unknown is an allow: a command it cannot
 * parse, a repository it cannot read, a policy it cannot resolve. A gate that
 * blocks on its own confusion trains people to disable it, and the thing it
 * protects is worth less than committing is.
 */
/** Why a commit was allowed or refused, in the vocabulary the reasons use. */
export type GuardReason = 'no-commit-in-command' | 'unparseable' | 'help-or-dry-run' | 'not-a-repository' | 'policy-not-auto' | 'merge-in-progress' | 'sequencer-in-progress' | 'index-mutated-in-the-same-call' | 'pathspec-limited' | 'trivial' | 'considered' | 'no-verify-would-drop-records' | 'not-considered';
export interface GuardVerdict {
    decision: 'allow' | 'deny';
    reason: GuardReason;
    /** What to say to the agent. Empty when allowing — nothing is said at all. */
    lines: readonly string[];
}
/** One pipeline stage: the words of a single command. */
export interface Segment {
    readonly argv: readonly string[];
}
/**
 * Splits a shell command into segments of words.
 *
 * Deliberately small, and allowed to give up. It understands single quotes,
 * double quotes, backslash escapes and the operators that separate commands;
 * it does not understand substitution, expansion, or heredocs, and returns
 * `null` the moment it meets something it cannot account for. `null` is an
 * allow at every call site, because a gate guessing at shell syntax it does not
 * implement would refuse correct commands, and one wrong refusal costs more
 * than one missed commit.
 */
export declare const shellSegments: (command: string) => Segment[] | null;
export interface CommitInvocation {
    /** Where in the pipeline it sits, so earlier segments can be judged. */
    readonly at: number;
    /** The value of `-C`, when the command named one. */
    readonly repository: string | null;
    readonly amend: boolean;
    readonly all: boolean;
    readonly noVerify: boolean;
    readonly helpOrDryRun: boolean;
    /** A pathspec, `--only` or `--include`: what is committed is not the index. */
    readonly pathspecLimited: boolean;
    readonly allowEmpty: boolean;
    readonly message: string | null;
}
/**
 * The `git commit` in a pipeline, if there is one.
 *
 * `git` is identified by the basename of argv[0] so `/usr/bin/git` counts, and
 * the subcommand is the first word that is not one of git's own options —
 * `git -C /x commit` is a commit, and `git commit-graph write` is not.
 */
export declare const findCommit: (segments: readonly Segment[]) => CommitInvocation | null;
/**
 * The directory a `cd` earlier in the same call moved to.
 *
 * `cd ../other && git commit` is a commit in another repository, and grading it
 * against the session's directory would ask about the wrong tree — which is the
 * whole failure this feature exists to remove, reintroduced one layer up. Only
 * a single-argument `cd` counts; anything cleverer returns null and the caller
 * falls back to the session's own directory.
 */
export declare const directoryChangedBefore: (segments: readonly Segment[], commitAt: number) => string | null;
export declare const mutatesIndexBefore: (segments: readonly Segment[], commitAt: number) => boolean;
/**
 * What a change has to be for the gate to step aside.
 *
 * Mechanical, and it only ever *removes* a refusal — it never suppresses a
 * record. The instructions still tell an agent to record whenever it has
 * something worth recording, however small the change.
 *
 * The numbers are chosen, not measured, and are stated here rather than hidden
 * so the next person can argue with them.
 */
export declare const TRIVIAL_MAX_FILES = 1;
export declare const TRIVIAL_MAX_LINES = 5;
/** What is about to be committed, as the guard needs to see it. */
export interface ChangeStat {
    readonly paths: readonly string[];
    readonly files: number;
    readonly lines: number;
    readonly binary: boolean;
    /** No change at all: `--allow-empty`, or a message-only amend. */
    readonly empty: boolean;
}
export declare const isTrivial: (stat: ChangeStat, message: string | null) => boolean;
/** Everything the rules need from outside, so every rule is testable without it. */
export interface GuardWorld {
    isRepository(cwd: string): boolean;
    /** Null when no policy could be resolved, which is an allow. */
    policyMode(cwd: string): 'auto' | 'suggest' | 'off' | null;
    /** A merge or a sequencer operation git is driving, not a commit somebody typed. */
    operationInProgress(cwd: string): 'merge' | 'sequencer' | null;
    consideration(cwd: string): {
        covered: boolean;
        outcome: 'empty' | 'recorded' | null;
    };
    changeStat(cwd: string, all: boolean, amend: boolean): ChangeStat;
}
export interface GuardInput {
    readonly command: string;
    readonly cwd: string;
}
export declare const guardVerdict: (input: GuardInput, world: GuardWorld) => GuardVerdict;
