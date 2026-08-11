/** Host-side setup for the Hermes coding agent.
 *
 * Repository wiring remains `commitlore init`; this command owns only the
 * active Hermes profile. Keeping that boundary explicit prevents an installer
 * from unexpectedly touching whichever repository happened to be current.
 */
import type { Command } from 'commander';
export interface HermesInstallOptions {
    readonly configPath?: string;
    readonly home?: string;
    readonly dataHome?: string;
    readonly dataRoot?: string;
    readonly wrapperPath?: string;
    /** Test seam; ordinary calls detect Hermes from its executable or profile. */
    readonly detected?: boolean;
    /** The deployed bundle location is injectable so this can be tested without a release checkout. */
    readonly skillsDir?: string;
    readonly verify?: boolean;
}
export interface HermesInstallResult {
    readonly exitCode: 0 | 1 | 2;
    readonly report: readonly string[];
    readonly changed: readonly ('mcp' | 'skills')[];
    readonly verified: readonly string[];
}
export declare const runHermesInstall: (options?: HermesInstallOptions) => HermesInstallResult;
export declare const register: (program: Command) => void;
