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
export declare const installHook: (input?: HookInput) => HookResult;
export declare const uninstallHook: (input?: HookInput) => HookResult;
export declare const hookStatus: (input?: HookInput) => HookResult;
export declare const register: (program: Command) => void;
