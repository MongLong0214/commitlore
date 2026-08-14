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
/** Speak enough MCP to distinguish an executable from a usable CommitLore server. */
export declare const probeMcp: (command: string, args: string[]) => Promise<string | null>;
export declare const inspectAndApplyHosts: (options: Options) => Promise<HostSummary>;
export declare const register: (program: Command) => void;
export {};
