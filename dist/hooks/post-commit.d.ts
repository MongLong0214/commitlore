/**
 * `post-commit` hook — T-1018 (#213): consumption finaliser.
 *
 * After a successful commit, this hook inspects applied pending transactions
 * and consumes exactly the one whose:
 *   1. base_head equals the new commit's first parent
 *   2. staged_tree_oid equals the new commit's tree
 *   3. applied_record_hash matches the canonical record block in the message
 *   4. every applied Record-Id is present in the commit message
 *
 * Consumption happens AFTER the commit succeeds, exactly once. If no candidate
 * matches, exit 0. If state is unreadable, print a diagnostic and exit 0.
 * Never retroactively fail a successful Git commit.
 */
import type { Command } from 'commander';
export declare const POST_COMMIT_HOOK_MARKER = "# commitlore:post-commit:v1";
export declare const POST_COMMIT_HOOK_NAME = "post-commit";
export declare const POST_COMMIT_CHAINED_HOOK_NAME = "post-commit.commitlore-chained";
export interface PostCommitHookResult {
    readonly code: 0 | 2;
    readonly stdout: string;
    readonly stderr: string;
}
/**
 * Generate the post-commit hook stub.
 *
 * The gate's resolution chain with the ending that does not refuse (#354). Git
 * ignores this hook's exit code, so this is not the change that unblocks a
 * commit — `prepare-commit-msg` is. It is here because a hook that runs after
 * the commit already exists has nothing left to refuse, and because whatever
 * does read a status from it — a wrapper, a hook runner, this project's own
 * tests — would otherwise read a refusal nobody made.
 */
export declare const postCommitStub: () => string;
/**
 * Install the post-commit hook. Follows the same containment rules as the
 * commit-msg hook: preserves a foreign hook by refusing to overwrite it.
 */
export declare const installPostCommitHook: (cwd?: string) => PostCommitHookResult;
export declare const register: (program: Command) => void;
