/**
 * `commitlore hooks install | uninstall | status` (PRD-F2 requirement 3).
 *
 * Installing a hook means writing into somebody's repository, so this command
 * only ever destroys something it can name:
 *
 * - A hook that is not ours is moved aside, not overwritten, and the stub calls
 *   it first — installing commitlore never silently disables another check.
 * - Installing twice writes the same bytes; the stub carries a fixed marker, so
 *   "ours" is a fact about the file, not a guess.
 * - `uninstall` restores exactly what was moved aside, and refuses to touch a
 *   hook it did not install.
 *
 * The hooks directory comes from `git rev-parse --git-path hooks`, never from a
 * hardcoded `.git/hooks`: with a linked worktree `.git` is a file, and
 * `core.hooksPath` can move the directory out of the repository entirely.
 */
import type { Command } from 'commander';
import { type RecordedHookTarget } from '../core/hook-target.js';
/**
 * `installed` — our stub, current. `outdated` — our stub from an older build.
 * `foreign` — a hook somebody else installed.
 */
export type HookState = 'absent' | 'installed' | 'outdated' | 'foreign';
export interface HookStatus {
    hooksDir: string;
    hookPath: string;
    state: HookState;
    chainedPath: string;
    /** A foreign hook preserved by a previous install. */
    chained: boolean;
    /** git skips a non-executable hook, so a preserved hook without the bit never runs. */
    chainedExecutable: boolean;
    recordedTarget: RecordedHookTarget;
}
export interface HookResult {
    code: 0 | 2;
    stdout: string;
    stderr: string;
    status?: HookStatus;
}
export interface HookInput {
    cwd?: string;
    force?: boolean;
}
export declare const readHookStatus: (cwd?: string) => HookStatus;
/**
 * Records the entry point this install ran from, in local git config.
 *
 * The hook's other three lookups — `COMMITLORE_BIN`, `PATH`, a `node_modules`
 * walk — all assume the CLI arrived through a package manager. Since ADR-0011
 * a clone is a complete installation, so the ordinary case is a checkout that
 * satisfies none of them, and the first commit in a fresh repository fails with
 * the hook unable to find the tool that had just written it.
 *
 * Local config rather than the stub's text so that `hooks status` keeps
 * comparing bytes: a hook installed from another path stays `installed`, not
 * `outdated`. Failure here is not fatal — the hook still has three other ways
 * to resolve, and refusing to install because a config write failed would be
 * worse than installing something slightly less able to find itself.
 */
/**
 * The entry point to record, or `null` when none can be established.
 *
 * `resolve(process.argv[1])` alone was the cause of #296. When the CLI is invoked
 * by bare name, `argv[1]` can be the string as typed rather than a path, and
 * `resolve` then produces `<cwd>/commitlore` — a file that has never existed. The
 * hook reads that value, cannot use it, and reports a failure whose prescribed fix
 * re-records the same wrong value, so following the instruction changes nothing.
 *
 * Three steps, in order: an absolute or relative path is resolved and must exist
 * as a file; a bare name is looked up on `PATH` the way a shell would; and if
 * neither yields an existing file, nothing is recorded. Recording nothing is
 * strictly better than recording a fiction, because the stub still has three other
 * ways to resolve, while a stale value stops it at the first.
 *
 * Exported for the test that drives it directly: reproducing the reported
 * `argv[1]` needs a compiled binary, which ADR-0026 removed from the product.
 */
export declare const resolveEntryForRecord: (entry: string | undefined, cwd: string) => string | null;
export declare const installHook: (input?: HookInput) => HookResult;
export declare const uninstallHook: (input?: HookInput) => HookResult;
export declare const hookStatus: (input?: HookInput) => HookResult;
export declare const register: (program: Command) => void;
