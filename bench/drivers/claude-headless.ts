import { spawn, spawnSync } from "node:child_process";

import type { AgentDriver, DriverOptions, DriverRequest, DriverResult } from "./types.ts";
import { composePrompt } from "./types.ts";

const DEFAULT_EXECUTABLE = "claude";
const DEFAULT_PERMISSION_MODE = "acceptEdits";
const KILL_GRACE_MS = 5_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

interface SpawnOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly timedOut: boolean;
}

const spawnWithTimeout = (
  executable: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<SpawnOutcome> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // A headless agent that ignores SIGTERM would hold the whole run hostage.
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
  });

/**
 * The installed CLI decides which limit flags exist; probing once beats guessing
 * and silently running an unbounded session.
 */
const supportsFlag = (executable: string, flag: string): boolean => {
  const help = spawnSync(executable, ["--help"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (help.status !== 0 || typeof help.stdout !== "string") return false;
  return help.stdout.includes(flag);
};

/**
 * `cache_read_input_tokens` is deliberately excluded: a cached prefix is re-read
 * on every turn, so counting it made a single observed run report 719k tokens
 * and swallow the whole global cap. The cap is meant to bound work, not cache
 * hits. T-703's CPAA can price cache reads separately.
 */
const COUNTED_USAGE_FIELDS = ["input_tokens", "output_tokens", "cache_creation_input_tokens"] as const;

const sumTokens = (usage: unknown): number => {
  if (typeof usage !== "object" || usage === null) return 0;
  const fields = usage as Record<string, unknown>;
  let total = 0;
  for (const field of COUNTED_USAGE_FIELDS) {
    const value = fields[field];
    if (typeof value === "number" && Number.isFinite(value)) total += value;
  }
  return total;
};

interface HeadlessResult {
  readonly result?: unknown;
  readonly num_turns?: unknown;
  readonly usage?: unknown;
  readonly is_error?: unknown;
  readonly subtype?: unknown;
}

const parseHeadlessJson = (stdout: string): HeadlessResult | null => {
  const trimmed = stdout.trim();
  if (trimmed === "") return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? (parsed as HeadlessResult) : null;
  } catch {
    return null;
  }
};

export const createClaudeHeadlessDriver = (options: DriverOptions = {}): AgentDriver => {
  const executable = options.executable ?? DEFAULT_EXECUTABLE;
  let maxTurnsFlag: boolean | null = null;

  const run = async (request: DriverRequest): Promise<DriverResult> => {
    if (maxTurnsFlag === null) maxTurnsFlag = supportsFlag(executable, "--max-turns");

    const args = [
      "-p",
      composePrompt(request),
      "--output-format",
      "json",
      "--permission-mode",
      options.permissionMode ?? DEFAULT_PERMISSION_MODE,
      ...(options.model === undefined ? [] : ["--model", options.model]),
      ...(maxTurnsFlag ? ["--max-turns", String(request.maxTurns)] : []),
    ];

    let outcome: SpawnOutcome;
    try {
      outcome = await spawnWithTimeout(executable, args, request.workspace, request.timeoutMs);
    } catch (error) {
      return {
        transcript: "",
        turns: 0,
        tokens: 0,
        stoppedBy: "error",
        error: `failed to spawn ${executable}: ${(error as Error).message}`,
      };
    }

    const parsed = parseHeadlessJson(outcome.stdout);
    const transcript = typeof parsed?.result === "string" ? parsed.result : outcome.stdout;
    const turns = typeof parsed?.num_turns === "number" ? parsed.num_turns : 0;
    const tokens = sumTokens(parsed?.usage);

    if (outcome.timedOut) {
      return { transcript, turns, tokens, stoppedBy: "timeout", error: `timed out after ${request.timeoutMs}ms` };
    }
    if (outcome.code !== 0 || parsed === null || parsed.is_error === true) {
      const detail = parsed === null ? outcome.stderr.trim().slice(0, 500) : String(parsed.subtype ?? "is_error");
      return {
        transcript,
        turns,
        tokens,
        stoppedBy: "error",
        error: `claude exited ${outcome.code}: ${detail === "" ? "no output" : detail}`,
      };
    }

    // The installed CLI has no --max-turns (probed above), so the turn budget
    // cannot be applied in flight. The run ends on its own and the overrun is
    // observed here -- hence `over-turns`, not `turns`: nothing stopped it.
    const stoppedBy =
      turns >= request.maxTurns ? "over-turns" : tokens >= request.maxTokens ? "over-tokens" : "completed";
    return { transcript, turns, tokens, stoppedBy };
  };

  return { name: "claude-headless", simulated: false, run };
};
