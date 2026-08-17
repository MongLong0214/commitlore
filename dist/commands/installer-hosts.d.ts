/**
 * The host-wiring half of the platform installers.
 *
 * install.sh and install.ps1 deliberately do not inspect registrations.  They
 * activate a verified wrapper, invoke this command, print its JSON summary,
 * and return its exit status.  Keeping the test, write, and outcome in one
 * process is what makes an installer success claim useful on both platforms.
 */
import type { Command } from 'commander';
import { type RuntimeIdentity } from '../core/runtime-identity.js';
export declare const INSTALLER_HOSTS_SCHEMA = "commitlore_installer_hosts.v1";
type HostOutcome = 'installed' | 'owned' | 'custom-preserved' | 'failed';
export interface HostResult {
    host: string;
    requested: true;
    outcome: HostOutcome;
    healthy: boolean;
    detail: string;
}
export interface HostSummary {
    schema: typeof INSTALLER_HOSTS_SCHEMA;
    /** Identity of the installer process that performed this live probe. */
    runtimeIdentity: RuntimeIdentity;
    ok: boolean;
    hosts: HostResult[];
    notDetected: string[];
}
interface Options {
    wrapper: string;
    dataRoot: string;
    home: string;
}
/**
 * The name of the temporary sibling an atomic write goes through.
 *
 * A name, never a path. This used to be `path.split('/').pop()`, which returns
 * the *whole string* when there is no `/` in it — so on Windows the temporary
 * became `…\\.gemini\\.C:\\Users\\u\\.gemini\\settings.json.commitlore-….tmp`.
 * A drive letter cannot appear inside a filename, so every host that reached
 * its write failed with ENOENT and nothing was wired: what a real Windows run
 * of v1.0.2 showed (#716, observed in #714).
 *
 * Both separators are stripped here rather than deferring to `basename`.
 * `basename` is correct on Windows and not provable off it, and CI has no
 * Windows agent — the `install-ps1` job detects no hosts, so it never reaches
 * this line. A defect that appears only on Windows has to be one a POSIX
 * runner can fail on, or nothing in this repository can hold it.
 */
export declare const atomicTemporaryName: (target: string, unique: string) => string;
/**
 * The Codex plugin layer, which the MCP registration does not cover (#697).
 *
 * `install.ps1` ran `plugin install-codex`; `install.sh` carried the same step
 * behind a function nothing called, so Windows installed the plugin and macOS
 * and Linux did not. The shell's dead copy was what made them look alike, and a
 * test asserting the string was present in both files passed on presence rather
 * than reachability.
 *
 * Putting it here rather than back in either shell is what makes the two agree
 * by construction: both installers delegate host wiring to this command, which
 * is why the shell block was dead in the first place. The Claude plugin is
 * handled the same way, for the same reason.
 *
 * Reported beside the MCP result rather than folded into it — the registration
 * can be healthy while the plugin is not, and saying so is the difference
 * between a host that works and one that was asked to.
 */
/** One requested step's outcome, kept apart from the sentence describing it. */
export interface StepOutcome {
    ok: boolean;
    detail: string;
}
/**
 * Codex is two requested integrations, and the host is healthy only if both
 * are.
 *
 * The first version of this appended the plugin outcome to `detail` and left
 * `healthy` alone, so a run could say "plugin step failed" and report
 * `healthy: true` — and `ok` is computed from the field, not the sentence, so
 * the installer exited 0 on a failed integration.
 *
 * Exported for the regression: the composition is the thing that was wrong, and
 * a test that had to spawn a real `codex` to reach it would not have been
 * written.
 */
export declare const codexResultWithPlugin: (mcp: HostResult, plugin: StepOutcome) => HostResult;
export declare const inspectAndApplyHosts: (options: Options) => Promise<HostSummary>;
export declare const register: (program: Command) => void;
export {};
