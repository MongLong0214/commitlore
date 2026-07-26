import type { StopReason } from "../types.ts";

/** Simulation input for the dry-run driver. Real drivers MUST ignore it. */
export interface SimulationHints {
  /** Alternatives read back out of the seeded `Ruled-out:` trailers. */
  readonly ruledOutAlternatives: readonly string[];
  /** Literal clauses of `detect.violation_if`, so the violation path is exercised. */
  readonly violationTokens: readonly string[];
}

export interface DriverRequest {
  readonly taskId: string;
  readonly condition: string;
  readonly prompt: string;
  /** Assembled CommitLore records, or null when the condition withholds them. */
  readonly injectedContext: string | null;
  readonly workspace: string;
  readonly seed: number;
  readonly maxTurns: number;
  /** Already clamped to whatever is left of the global token cap. */
  readonly maxTokens: number;
  readonly timeoutMs: number;
  /**
   * A settings file the harness wrote for this run, or undefined for none.
   *
   * This is how an arm gets hooks. The shipped injector is a PreToolUse hook
   * that runs per edit and is path-scoped; `injectedContext` above can only
   * deliver one block of text at session start. An arm that wants to measure
   * what the product actually does has to go through here (#36, #37).
   */
  readonly settingsPath?: string;
  readonly simulation: SimulationHints;
}

export interface DriverResult {
  readonly transcript: string;
  readonly turns: number;
  readonly tokens: number;
  readonly stoppedBy: StopReason;
  readonly error?: string;
}

export interface AgentDriver {
  readonly name: string;
  /** True when the transcript is fabricated. Propagated to every result row. */
  readonly simulated: boolean;
  readonly run: (request: DriverRequest) => Promise<DriverResult>;
}

export interface DriverOptions {
  readonly model?: string;
  readonly permissionMode?: string;
  readonly executable?: string;
}

/** Both arms receive the same task text; only the record block differs. */
export const composePrompt = (request: DriverRequest): string =>
  request.injectedContext === null
    ? request.prompt
    : `${request.injectedContext}\n---\n\n${request.prompt}`;
