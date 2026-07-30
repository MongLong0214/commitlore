/**
 * `commitlore uninstall` — removes what `install.sh` wrote to the machine:
 * the installed binary and the agent MCP configuration entries.
 *
 * It never removes per-repository state (hooks, index, notes) — that is the
 * job of `commitlore hooks uninstall` and `commitlore inject uninstall-claude-hook`.
 *
 * Privacy: agent config files may contain API tokens for other MCP servers.
 * This command reads them only to remove the `commitlore` entry, and NEVER
 * echoes any other entry's contents into its report or JSON output.
 */
import type { Command } from 'commander';
export type BinaryOutcome = 'removed' | 'left' | 'not-found' | 'would-remove';
export type AgentOutcome = 'removed' | 'left' | 'not-found' | 'would-remove';
export interface BinaryReport {
    path: string;
    outcome: BinaryOutcome;
    reason?: string;
}
export interface AgentReport {
    agent: string;
    outcome: AgentOutcome;
    reason?: string;
}
export interface UninstallResult {
    binary: BinaryReport;
    agents: AgentReport[];
    hint: string;
}
export interface UninstallOptions {
    home?: string;
    dryRun?: boolean;
    json?: boolean;
}
export declare const runUninstall: (options: UninstallOptions) => UninstallResult;
export declare const register: (program: Command) => void;
