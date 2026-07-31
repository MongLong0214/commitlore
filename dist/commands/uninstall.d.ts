/**
 * `commitlore uninstall` — removes what `install.sh` and `install.ps1` wrote,
 * and nothing else.
 *
 * The restraint is the feature. Three rules shape every branch below:
 *
 * - **Never remove what this installer did not write.** The wrapper is checked
 *   for its marker; an MCP entry is matched on its shape and on the wrapper it
 *   points at, never on the key it sits under. A user may name their own server
 *   `commitlore`, and a machine may carry two installs.
 * - **Never reformat a config beyond the one entry removed.** A config that
 *   cannot be parsed is left exactly as it was and reported.
 * - **Never do another tool's job.** Per-repository state belongs to
 *   `hooks uninstall` and `inject uninstall-claude-hook`; the Claude Code plugin
 *   cache belongs to Claude Code. Both are named, neither is touched.
 */
import type { Command } from 'commander';
export interface UninstallOptions {
    readonly home?: string;
    /** `XDG_DATA_HOME`, when the installer honoured it. */
    readonly dataHome?: string;
    readonly dryRun?: boolean;
}
export interface UninstallResult {
    readonly exitCode: number;
    readonly report: readonly string[];
    readonly removed: readonly string[];
    readonly json: {
        readonly removed: readonly string[];
        readonly kept: readonly string[];
        readonly dryRun: boolean;
    };
}
export declare const runUninstall: (options?: UninstallOptions) => Promise<UninstallResult>;
export declare const registerUninstall: (program: Command) => void;
