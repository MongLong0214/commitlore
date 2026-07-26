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
/**
 * The stub's text.
 *
 * `set -e` plus the explicit `|| exit $?` makes a chained hook's failure the
 * stub's failure, with its own exit code, before commitlore runs at all: a hook
 * that was already rejecting commits keeps rejecting them.
 *
 * `COMMITLORE_BIN` exists so a checkout can point the hook at a specific build
 * (a test harness, a monorepo's local bin) without the installer writing an
 * absolute path into the repository.
 *
 * There is no `npx` fallback on purpose. `npx --no` still queries the registry
 * when the package is not installed locally, which would put a network call on
 * every commit and make offline commits fail. The local `node_modules/.bin`
 * walk covers the same case without leaving the machine.
 */
export declare const commitMsgStub: () => string;
