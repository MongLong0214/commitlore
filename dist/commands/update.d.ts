/**
 * `commitlore upgrade` (T-1603, #742). This ticket ships the read-only half.
 *
 * The file is `update.ts` and the command is `upgrade`; F16 owns both names
 * and they deliberately differ. The verb changed from `update` after a review
 * round: `brew update` fetches an index, `npm update` updates a project's
 * dependencies, and `rustup update` updates toolchains -- two of the three
 * precedents for calling this `update` do not replace the tool that runs them.
 * `deno upgrade` and `bun upgrade` do, and they are called upgrade.
 *
 * **The acting form is T-1606's and is not reachable from here.** The
 * read-only half ships first so the reporting is trustworthy before anything
 * acts on it, and a test asserts this command starts no process other than
 * the `git ls-remote` the check owns. ADR-0037 is enforced rather than
 * described: a comment saying the CLI does not replace itself is not a guard.
 *
 * **Exit 0 whether or not an update exists.** A version query has no violation
 * to report -- `commitlore auto` settled the shape ("the answer is not a
 * finding") and `stale` exits 0 even when it finds something. Scripts branch
 * on `--json`. Non-zero stays reserved for a check that could not run at all.
 *
 * **It answers inside CI and off a terminal.** That is not an oversight in the
 * suppression rules: the notice has context gates and this command must not
 * share them, or the one scriptable form would be silent in the one place
 * scripts run.
 */
import type { Command } from 'commander';
/**
 * The install command, read from the README rather than restated.
 *
 * The two drifting apart is a known shape here (#727), and a literal copy in
 * this file is exactly how that starts. The README pins a version; an upgrade
 * names the tag it is upgrading to, so the shape is taken and the tag
 * replaced.
 */
export declare const installCommand: (tag: string, platform?: string) => string;
export interface UpgradeReport {
    readonly current: string;
    readonly latest: string | null;
    readonly updateAvailable: boolean;
    readonly command: string;
    readonly source: string;
    readonly checkedAt: string;
    /** Present when there is no answer, so "unknown" never reads as "current". */
    readonly unknown?: string;
}
export declare const buildReport: (env?: NodeJS.ProcessEnv) => Promise<UpgradeReport>;
export declare const register: (program: Command) => void;
/** Matches `install.sh:448`. */
export declare const dataRoot: (env?: NodeJS.ProcessEnv) => string;
/**
 * What `current` points at, or `null`.
 *
 * On Windows `install.ps1` writes no `current` symlink at all -- activation is
 * a `.cmd` shim whose last line names the versioned `dist\commitlore.mjs`. So
 * the same question is asked of the shim's contents there. ADR-0038 calls this
 * "expressed the way that platform allows"; reading a link that is never
 * created would report every Windows upgrade as failed.
 */
export declare const resolvedCurrent: (root: string, platform?: string) => string | null;
/** Step 2 and step 4: *is it the target*, not *did it move*. */
export declare const pointsAtTarget: (root: string, tag: string, platform?: string) => boolean;
export interface UpgradeOutcome {
    readonly code: 0 | 1 | 2;
    readonly lines: readonly string[];
    /** Which installers were invoked, in order. Asserted by a test. */
    readonly invoked: readonly string[];
}
export interface UpgradeDeps {
    readonly env: NodeJS.ProcessEnv;
    readonly platform: string;
    /** Runs one installer. Injected so a test can supply a #735 fixture. */
    readonly runInstaller: (script: string, tag: string) => {
        status: number | null;
    };
}
/**
 * ADR-0038's four steps.
 *
 * Step 1 runs the installer already on disk, which may be old. Its clone is
 * sound regardless: `install.sh` takes a version argument and clones that tag
 * directly, never reading `current`. Step 3 exists for exactly one named
 * defect -- the #735 move that reported success while leaving `current`
 * behind -- and reruns the installer the first step just downloaded, which
 * carries the fix.
 *
 * This is a retry across one defect, not a general recovery. A release whose
 * *own* move is broken is not saved by anything here, which is why step 4
 * fails loudly with a command that comes from neither failed installer.
 */
export declare const performUpgrade: (tag: string, deps: UpgradeDeps) => UpgradeOutcome;
