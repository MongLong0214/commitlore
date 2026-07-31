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
 * absolute path into the repository. It carries the same `.js`/`.mjs`
 * allowlist as the recorded path below: an env var is reachable from CI
 * configuration, a sourced profile, or a compromised toolchain — places a
 * reviewer does not read as executable config, so it gets no more trust than
 * `commitlore.bin` does. A value that fails the check falls through to the
 * remaining resolution steps rather than being executed.
 *
 * The recorded `commitlore.bin` gets one more check `COMMITLORE_BIN` deliberately
 * does not: it must resolve inside `commitlore.root`, also recorded at install
 * time (#71). Naming a file `.js` costs a `.git/config` editor nothing, so the
 * extension check alone does not stop a post-install edit from pointing
 * `commitlore.bin` at an attacker's own script — only its location, which the
 * installer controls and a later config edit cannot rewrite without also
 * rewriting `commitlore.root`. `COMMITLORE_BIN` is exempt on purpose: its whole
 * reason to exist is aiming the hook at a build outside the install root.
 *
 * There is no `npx` fallback on purpose. `npx --no` still queries the registry
 * when the package is not installed locally, which would put a network call on
 * every commit and make offline commits fail. The local `node_modules/.bin`
 * walk covers the same case without leaving the machine.
 *
 * Only `.js`/`.mjs` is recognized. ADR-0026 removed the compiled
 * single-executable build, and with it the arm that would exec an extensionless
 * file named `commitlore` directly. That name now belongs to the installer's own
 * wrapper, which is a shell script that execs node — so the path worth trusting is
 * the bundle it runs, and an extensionless recorded path falls through to the
 * PATH search below rather than being exec'd on the strength of its name.
 */
export declare const commitMsgStub: () => string;
