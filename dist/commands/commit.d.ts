/**
 * `commitlore commit` — consider, then commit, in one call.
 *
 * The five-step flow (`prepare` → draft → `verify` → `stage` → `git commit`)
 * works and is not the problem. The problem is that it runs only when the agent
 * remembers all five, and measured on this repository's own history that is
 * 204 of 249 substantive commits. The remaining 18% is not a capability gap; it
 * is a product that requires five things to be remembered in order.
 *
 * So this is one call. What it does not do is decide whether there is anything
 * to record: `records: []` is a complete, first-class answer, and the flow
 * having *run* is the only thing anything downstream is allowed to require. An
 * agent that must produce a record will produce one, and a false record is
 * permanent — which is why nothing here, and nothing in the gate this feeds,
 * ever asks for a non-empty result.
 *
 * **It composes no commit message.** The records reach the commit through the
 * installed `prepare-commit-msg` hook, exactly as they do when a person runs
 * `git commit` after `stage_capture`. Building a second application path here
 * would mean two places that know how a record becomes a trailer block, and the
 * first divergence between them would be silent — a record applied one way in
 * one route and another way in the other.
 *
 * **All or nothing.** A draft with any refused record commits nothing and binds
 * nothing. A caller whose quotes were wrong gets told which, and has two legal
 * moves: fix them, or say `records: []`. Committing the survivors would make
 * the refusal invisible at exactly the moment it matters.
 */
import type { Command } from 'commander';
export type CommitOutcome = 
/** Committed, and every verified record is in the message. */
'recorded'
/** Committed with nothing to record. A complete answer, not a failure. */
 | 'empty'
/** A record did not verify. Nothing committed, nothing bound. */
 | 'refused'
/** Verified and bound; the caller asked to run `git commit` itself. */
 | 'staged'
/** Git refused the commit — a hook of the user's own, or a bad message. */
 | 'commit_failed'
/** Committed, and the records are not in the message that landed. */
 | 'stripped'
/** Nothing was committed: not a repository, nothing staged, no hook, or the capture failed. */
 | 'error';
export interface CommitResult {
    outcome: CommitOutcome;
    /** The commit that was created, when one was. */
    commit: string | null;
    /** How many records the commit carries. */
    records: number;
    /** Everything refused, with the reason the verifier gave. */
    rejected: readonly {
        index: number;
        rule: string;
        detail?: string;
    }[];
    /** One line per thing the caller needs to know, in the order it matters. */
    lines: readonly string[];
}
export interface CommitOptions {
    cwd: string;
    message: string;
    /** The session transcript. Not required when the caller records nothing. */
    transcript?: string;
    transcriptPath?: string;
    /** The draft, as bytes or a path. Absent means "nothing to record". */
    draft?: string;
    draftPath?: string;
    amend?: boolean;
    /** `git commit -a`: stage tracked changes first. */
    all?: boolean;
    /** False verifies and binds without committing, for a caller that wants git's own flags. */
    commit?: boolean;
    now?: Date;
}
/**
 * Whether a commit message carries a record.
 *
 * Asked of the message that landed rather than of the transaction that was
 * staged, because those are the same thing only until something else rewrites
 * it — and a caller told "recorded" about a commit carrying nothing is the
 * silence this product exists to remove.
 *
 * Exported because the branch it feeds cannot be reached through the hooks this
 * product installs: the chained `prepare-commit-msg` runs *before* ours, so
 * nothing in the supported layout writes after we do. It is insurance against a
 * layout somebody else builds, and this is the seam that lets the decision be
 * tested without one.
 */
export declare const recordLanded: (message: string) => boolean;
export declare const runCommit: (opts: CommitOptions) => CommitResult;
export declare const register: (program: Command) => void;
