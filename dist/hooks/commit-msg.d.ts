/**
 * The `commit-msg` hook stub installed by `commitlore hooks install`.
 *
 * Two constraints shape it:
 *
 * - **No repository path may be baked in.** The same `.git/hooks` directory is
 *   shared by every linked worktree, and a repository gets cloned, moved, and
 *   re-checked-out. The stub therefore locates its neighbours relative to `$0`
 *   and finds the CLI on `PATH` at run time.
 * - **It must be byte-identical on every install.** Idempotence is checked by
 *   comparing the file on disk to this text, so nothing here may vary per
 *   machine, per install, or per version of the repository it lands in.
 */
/**
 * Identifies a stub as ours. Never change it in place — a new marker makes
 * `hooks uninstall` treat previously installed stubs as somebody else's hook.
 */
export declare const HOOK_MARKER = "# commitlore:commit-msg:v1";
/** A pre-existing foreign hook is moved here and called first. */
export declare const CHAINED_SUFFIX = ".commitlore-chained";
export declare const HOOK_NAME = "commit-msg";
export declare const CHAINED_HOOK_NAME = "commit-msg.commitlore-chained";
export declare const HOOK_MODE = 493;
/** The validation gate: it refuses when it cannot run. */
export declare const commitMsgStub: () => string;
/**
 * The body the capture hooks derive from — identical to the gate's except for
 * the ending, which lets the commit through. `prepare-commit-msg` and
 * `post-commit` rename it (marker, chained hook, invocation) from here.
 */
export declare const captureHookStub: () => string;
