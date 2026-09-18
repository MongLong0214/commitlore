/**
 * #1030: a caller says which tree it means, and a mismatch refuses rather than
 * preparing a transaction bound to the wrong HEAD.
 *
 * The MCP server is registered against one checkout and answers from it. A
 * session whose working directory is a *linked worktree* of the same repository
 * — an ordinary way to work on a branch — called `prepare_capture` and received
 * a transaction bound to the other tree's HEAD. Nothing in the response said so:
 * `staged_diff_hash` was the SHA-256 of the empty string and `staged_diff_empty`
 * was `true`, which is also exactly what you get when you have staged nothing.
 * The harvest prompt then said `(no diff — nothing is staged)` and its rule 8
 * told the agent to proceed on the transcript alone, so the flow continued and
 * a record would have been bound to a tree its author never touched.
 *
 * ## Why an assertion rather than detection
 *
 * The server cannot discover the caller's working directory. MCP carries no such
 * field, and inferring one from the process tree would be a guess that is wrong
 * in exactly the multi-worktree case this exists for. So the caller states the
 * tree it means and the server *verifies the statement* — the shape `--diff`
 * already has on `capture` (#877/#1023): the argument cannot change the binding,
 * only assert it, and a wrong assertion is a refusal rather than a silent
 * rebinding.
 *
 * Omitting it keeps the old behaviour, because a caller in the server's own
 * checkout is the common case and must not be made to say so.
 */
/**
 * Throws unless `asserted` names the same working tree as `root`.
 *
 * Runs before anything is prepared, so a refusal leaves no pending transaction
 * behind for `capture gc` to collect — the placement #877 settled for `--diff`.
 */
export declare const assertRepositoryBinding: (asserted: string, root: string) => void;
/**
 * A sentence for the response when nothing is staged, naming the tree that was
 * inspected (#1030).
 *
 * `staged_diff_empty: true` is a normal state, so it cannot by itself
 * distinguish "you staged nothing" from "I looked somewhere else". The reporter
 * found the mismatch by reading `repository`, which is one field among sixteen —
 * this puts the same fact where an empty diff is already being explained.
 */
export declare const emptyStagedDiffNote: (root: string) => string;
