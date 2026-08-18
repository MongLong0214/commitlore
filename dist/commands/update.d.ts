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
