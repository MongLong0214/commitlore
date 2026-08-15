/**
 * A small, shared CommitLore MCP identity probe.
 *
 * A registration proves only that a host has a command to try.  This probe
 * establishes the stronger fact that the command answers as CommitLore: it
 * completes initialize with a name and version, then reports whether the
 * advertised tools form the read-delivery or capture-initiation surface.
 */
export type McpProbeFailureKind = 'command-not-found' | 'command-is-directory' | 'command-not-executable' | 'command-could-not-start' | 'command-exited' | 'command-closed-input' | 'initialize-timed-out' | 'foreign-server' | 'missing-tools' | 'probe-unavailable';
export interface McpProbeFailure {
    kind: 'failure';
    reason: McpProbeFailureKind;
    detail: string;
    cleanup?: McpProbeCleanup;
}
export interface McpProbeSuccess {
    /** The server identifies as CommitLore; kind records its advertised tool set. */
    kind: 'read-delivery' | 'capture-initiator';
    detail: string;
    cleanup: McpProbeCleanup;
}
export type McpProbeResult = McpProbeFailure | McpProbeSuccess;
export type McpProbeCleanup = 'not-needed' | 'reclaimed' | 'could-not-reclaim';
export declare const MCP_READ_TOOLS: readonly ["commitlore_query", "commitlore_before_change"];
export declare const MCP_CAPTURE_TOOLS: readonly ["commitlore_prepare_capture", "commitlore_verify_capture", "commitlore_stage_capture"];
export declare const isMcpProbeFailure: (result: McpProbeResult) => result is McpProbeFailure;
/**
 * The filesystem identity of one process currently answering an MCP session.
 * `reportedVersion` is intentionally observation only: two different roots
 * may carry exactly the same package version.
 */
export interface LiveMcpRuntime {
    readonly pid: number;
    readonly entrypointRealpath: string;
    readonly packageRoot: string;
    readonly reportedVersion: string | null;
    readonly bundlePresent: boolean;
    readonly specPresent: boolean;
}
/** Process enumeration is an effect seam because `ps` is not universal. */
export interface LiveMcpRuntimeScan {
    readonly available: boolean;
    readonly runtimes: readonly LiveMcpRuntime[];
    readonly detail: string;
}
/**
 * Enumerate processes, not registrations: the former is the server that is
 * actually answering a session. The DoctorContext supplies this as an
 * injectable seam so platform-specific `ps` output never enters a fixture.
 */
export declare const discoverLiveMcpRuntimes: () => LiveMcpRuntimeScan;
/** Speak enough MCP to distinguish a launchable command from usable CommitLore. */
export declare const probeMcp: (command: string, args: string[]) => Promise<McpProbeResult>;
/**
 * Doctor's report API is synchronous. Run this same async probe through the
 * installation's declared runtime bundle rather than maintaining a second,
 * subtly different protocol entry point.
 */
export declare const probeMcpSync: (command: string, args: string[]) => McpProbeResult;
