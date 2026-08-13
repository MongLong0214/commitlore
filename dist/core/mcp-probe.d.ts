/**
 * A small, shared CommitLore MCP identity probe.
 *
 * A registration proves only that a host has a command to try.  This probe
 * establishes the stronger fact that the command answers as CommitLore: it
 * completes initialize with a name and version, then exposes the minimum
 * capture tool surface.
 */
export type McpProbeFailureKind = 'command-not-found' | 'command-is-directory' | 'command-not-executable' | 'command-could-not-start' | 'command-exited' | 'command-closed-input' | 'initialize-timed-out' | 'foreign-server' | 'missing-tools' | 'probe-unavailable';
export interface McpProbeFailure {
    kind: McpProbeFailureKind;
    detail: string;
}
export type McpProbeResult = McpProbeFailure | null;
/** Speak enough MCP to distinguish a launchable command from usable CommitLore. */
export declare const probeMcp: (command: string, args: string[]) => Promise<McpProbeResult>;
/**
 * Doctor's report API is synchronous. Run this same async probe in its own
 * Node process rather than maintaining a second, subtly different protocol.
 */
export declare const probeMcpSync: (command: string, args: string[]) => McpProbeResult;
