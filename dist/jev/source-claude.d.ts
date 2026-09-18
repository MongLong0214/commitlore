/**
 * The one supported conversation source: a Claude Code root session — #1049.
 *
 * Two halves. `registerClaudeSession` runs from a `SessionStart` hook and writes
 * a small descriptor beside the repository's other capture state.
 * `readClaudeSource` runs from the commit-msg producer, finds the descriptor for
 * *this* session, and decodes a bounded window of the transcript.
 *
 * ## What was measured, and what that changed
 *
 * The plan was `CLAUDE_ENV_FILE`. It is not in the hooks reference, and it is
 * unset in the host this was built against — so the descriptor could not have
 * been propagated that way, and claiming it would have been claiming a path
 * nobody ran. What *is* observably propagated to a Bash tool command, and
 * therefore to a `git commit` and its hooks, is `CLAUDE_CODE_SESSION_ID`:
 * measured equal to the session's own id, in this repository, on
 * claude-code with a 47 MB transcript at
 * `~/.claude/projects/<slug>/<session-id>.jsonl`.
 *
 * So the environment carries the *key* and the descriptor carries the *binding*.
 * That is one representation, not two: there is no env-encoded descriptor and no
 * second lookup path.
 *
 * `CLAUDE_CODE_CHILD_SESSION` was observed set in a child session. It is the
 * host identity signal #1049 asks for: an inherited session id does not prove
 * the actor is the registered root, and where the host says it is a child, this
 * reports unavailable rather than guessing. Subagent records also carry
 * `isSidechain`, and those are dropped inside the reader.
 *
 * ## Lookup is exact
 *
 * Session id from the environment, worktree from git, descriptor at a path
 * derived from both. No global "latest session" pointer, no newest-mtime scan,
 * no walk of `~/.claude`. Each of those answers when it should not: two sessions
 * in two worktrees are the ordinary case, and a wrong answer there records one
 * branch's decisions onto another's commit.
 */
import { type ConversationSource, type SourceResult } from './source.js';
/** Where the environment carries this session's identity. Measured, not documented. */
export declare const SESSION_ENV = "CLAUDE_CODE_SESSION_ID";
/** Set by the host in a child session. Its presence denies root-actor status. */
export declare const CHILD_ENV = "CLAUDE_CODE_CHILD_SESSION";
/** Descriptor format. Bumped only for a shape a reader cannot accept. */
export declare const DESCRIPTOR_VERSION = 1;
/**
 * Bytes of the container read, from the end.
 *
 * The transcript this was measured against is 47 MB, so reading it whole is not
 * a window at all. The tail is the right end: a decision made ten thousand
 * messages ago is not the decision this commit records, and the newest complete
 * blocks are what #1047 prefers anyway.
 */
export declare const WINDOW_BYTES: number;
/** A hard record ceiling on top of the byte window, so a file of tiny lines is bounded too. */
export declare const WINDOW_RECORDS = 600;
export interface SessionDescriptor {
    readonly version: number;
    readonly host: 'claude-code';
    readonly sessionId: string;
    readonly worktree: string;
    readonly gitdir: string;
    readonly transcript: string;
    readonly format: 'claude-jsonl-v1';
    readonly registeredAt: string;
}
/**
 * Where descriptors live: beside `pending`, in the worktree's own git directory.
 *
 * `--git-path` is what makes this per-worktree. A single directory at the
 * repository root would let two worktrees read each other's descriptor, which is
 * the mix-up this binding exists to prevent.
 */
export declare const descriptorDir: (cwd: string) => string | null;
export interface RegisterInput {
    readonly cwd: string;
    readonly sessionId: string;
    readonly transcriptPath: string;
    readonly now?: () => Date;
}
export type RegisterResult = {
    readonly status: 'registered';
    readonly path: string;
    readonly descriptor: SessionDescriptor;
} | {
    readonly status: 'skipped';
    readonly reason: string;
};
/**
 * Writes the descriptor for one session in one worktree.
 *
 * Carries identity and nothing else: no key, no transcript content, no
 * conversation archive. The transcript is referenced by path, so removing the
 * key or deleting this file leaves no copy of anybody's session behind.
 *
 * Refuses rather than guessing when git cannot answer — a descriptor naming a
 * worktree that was inferred is a descriptor that can bind the wrong tree.
 */
export declare const registerClaudeSession: (input: RegisterInput) => RegisterResult;
/** Removes one descriptor. Used by `uninstall`; never removes another session's. */
export declare const forgetClaudeSession: (cwd: string, sessionId: string) => boolean;
export interface ReadSourceInput {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
}
/**
 * The producer's entry point. Never throws; every failure is an `unavailable`.
 *
 * Order matters: the environment is checked before the filesystem, and the
 * filesystem before anything is decoded. A default installation with no host
 * session leaves here having touched no files at all.
 */
export declare const readClaudeSource: (input: ReadSourceInput) => SourceResult;
/**
 * The post-request recheck (#1049, ADR D5).
 *
 * Re-reads **the same absolute byte range** and compares its digest — not the
 * tail again. A transcript is appended to on every turn, including by the very
 * session that is committing, so "read the tail again" would find different
 * bytes on essentially every commit and reject all of them. The question is
 * narrower and answerable: does the region that was assessed still say what it
 * said?
 *
 * Truncation and replacement are caught by the size check before the digest:
 * a file that shrank below the assessed region no longer contains it, and a
 * rewritten file at the same length fails the digest.
 */
export declare const sourceStillCurrent: (source: ConversationSource) => boolean;
