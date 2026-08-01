import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HeadlessResult, TurnLedger } from "./stream-json.ts";
import { StreamJsonReader } from "./stream-json.ts";
import type { AgentDriver, DriverOptions, DriverRequest, DriverResult } from "./types.ts";
import { composePrompt } from "./types.ts";

const DEFAULT_EXECUTABLE = "claude";
const DEFAULT_PERMISSION_MODE = "acceptEdits";
const KILL_GRACE_MS = 5_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/**
 * How much stdout the streaming path keeps for a failure message.
 *
 * The non-streaming path retains all of stdout because it has to parse it at
 * the end; the streaming path parses as it goes and would otherwise hold a
 * long run's entire chunk-by-chunk transcript to print at most 500 characters
 * of it on error. `--include-partial-messages` emits an event per streamed
 * chunk, so "all of it" is tens of megabytes for a run whose numbers are a few
 * hundred integers.
 *
 * The cost is on the failure path only: when no `result` event arrives, the
 * transcript falls back to this tail rather than to the whole of stdout. A run
 * that produced no result produced no measurement either way.
 */
const STREAM_TAIL_BYTES = 64 * 1024;

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
  onStdoutLine?: (line: string) => void,
): Promise<SpawnOutcome> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let pending = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // A headless agent that ignores SIGTERM would hold the whole run hostage.
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (onStdoutLine === undefined) {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += text;
        return;
      }
      pending += text;
      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        onStdoutLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
      stdout = (stdout + text).slice(-STREAM_TAIL_BYTES);
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
      // A killed process can leave a last line without its newline. Dropping it
      // would lose the `result` event of a run that was cut off mid-write.
      if (onStdoutLine !== undefined && pending !== "") onStdoutLine(pending);
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

/**
 * An empty MCP configuration, written once per driver. Paired with
 * `--strict-mcp-config` it is what makes the measured agent a *clean* agent.
 */
const EMPTY_MCP_CONFIG = JSON.stringify({ mcpServers: {} });

/**
 * Flags that take the operator's machine out of the measurement.
 *
 * Without them the agent under test inherits whatever the person running the
 * benchmark happens to have configured. Observed on the first attempt at this
 * matrix: every run loaded eight MCP servers from the operator's global config
 * -- a code-search server, a docs server, a web-search server, and a *memory*
 * server among them. Three consequences, in increasing order of seriousness:
 *
 *   1. Startup cost. Runs took ~3 minutes each instead of ~9 seconds.
 *   2. Generalisability. The numbers would describe one laptop's toolset, and
 *      nobody else could reproduce them.
 *   3. Independence. A memory server persists across invocations, which is a
 *      channel between runs that the experiment assumes does not exist.
 *
 * The third is the one that would have invalidated the result rather than
 * merely explaining it.
 *
 * Each flag is probed before use, so an older CLI degrades to an uncontrolled
 * -- but reported -- environment rather than failing to spawn.
 */
const ISOLATION_FLAGS = [
  "--strict-mcp-config",
  "--setting-sources",
  "--no-session-persistence",
] as const;

/**
 * What a per-turn ledger costs on the command line, and why each flag is there.
 *
 * `--verbose` is not a preference: the CLI refuses `--output-format stream-json`
 * under `--print` without it ("requires --verbose"), so it is part of the format
 * rather than an addition to it.
 *
 * `--include-partial-messages` is the one that matters. Without it the stream
 * still carries an assistant event per content block with a `usage` object
 * attached, but that object's `output_tokens` is the value from `message_start`
 * — a snapshot taken before the model wrote anything. Measured on one probe:
 * the assistant events reported 4, 1 and 1 output tokens for three turns whose
 * real outputs were 157, 193 and 36. Input and cache figures on those events
 * are already final and do reconcile; output does not, and output is the term
 * the write side is missing.
 */
const STREAM_FLAGS = ["--verbose", "--include-partial-messages"] as const;

export const createClaudeHeadlessDriver = (options: DriverOptions = {}): AgentDriver => {
  const executable = options.executable ?? DEFAULT_EXECUTABLE;
  let maxTurnsFlag: boolean | null = null;
  let isolation: string[] | null = null;
  let perTurn: boolean | null = options.perTurnUsage === true ? null : false;

  const run = async (request: DriverRequest): Promise<DriverResult> => {
    if (maxTurnsFlag === null) maxTurnsFlag = supportsFlag(executable, "--max-turns");
    if (perTurn === null) {
      const missing = STREAM_FLAGS.filter((flag) => !supportsFlag(executable, flag));
      perTurn = missing.length === 0;
      if (!perTurn) {
        process.stderr.write(
          `!! ${executable} does not support ${missing.join(", ")} — per-turn usage was asked\n` +
            `!! for and cannot be produced. Rows will carry no turn ledger, which reads as\n` +
            `!! "not instrumented" rather than as zero.\n`,
        );
      }
    }
    if (isolation === null) {
      const missing = ISOLATION_FLAGS.filter((flag) => !supportsFlag(executable, flag));
      if (missing.length > 0) {
        process.stderr.write(
          `!! ${executable} does not support ${missing.join(", ")} — the agent under test will
` +
            `!! inherit this machine's MCP servers and settings. The run is not environment-controlled.
`,
        );
        isolation = [];
      } else {
        const mcpPath = join(mkdtempSync(join(tmpdir(), "commitlore-bench-mcp-")), "mcp.json");
        writeFileSync(mcpPath, EMPTY_MCP_CONFIG);
        // `--setting-sources ""` drops user, project and local settings: no
        // CLAUDE.md, no skills, no plugins, no hooks.
        isolation = [
          "--strict-mcp-config",
          "--mcp-config",
          mcpPath,
          "--setting-sources",
          "",
          "--no-session-persistence",
        ];
      }
    }

    // A settings file the harness wrote, carrying the arm's hooks.
    //
    // `--setting-sources ""` drops the operator's settings, which is what makes
    // the run reproducible; `--settings` then adds back exactly one file that
    // the harness controls. Without this the bench could only hand the agent a
    // block of text at session start, while the shipped product delivers
    // records per edit through a PreToolUse hook — two different delivery
    // shapes, and only one of them is the product (#36).
    const settings =
      request.settingsPath === undefined ? [] : ["--settings", request.settingsPath];

    const args = [
      "-p",
      composePrompt(request),
      "--output-format",
      perTurn ? "stream-json" : "json",
      ...(perTurn ? STREAM_FLAGS : []),
      "--permission-mode",
      options.permissionMode ?? DEFAULT_PERMISSION_MODE,
      ...isolation,
      ...settings,
      ...(options.model === undefined ? [] : ["--model", options.model]),
      ...(maxTurnsFlag ? ["--max-turns", String(request.maxTurns)] : []),
    ];

    const reader = perTurn ? new StreamJsonReader() : null;
    let outcome: SpawnOutcome;
    try {
      outcome = await spawnWithTimeout(
        executable,
        args,
        request.workspace,
        request.timeoutMs,
        reader === null ? undefined : (line) => reader.push(line),
      );
    } catch (error) {
      return {
        transcript: "",
        turns: 0,
        tokens: 0,
        stoppedBy: "error",
        error: `failed to spawn ${executable}: ${(error as Error).message}`,
      };
    }

    // Both formats end in the same `result` object, carrying the same
    // `result`, `num_turns` and `usage` fields. That is what keeps `transcript`,
    // `turns` and `tokens` identical either way: the ledger is read from events
    // the JSON format never printed, and nothing already measured is re-derived
    // from them.
    const parsed = reader === null ? parseHeadlessJson(outcome.stdout) : reader.result;
    const ledger: TurnLedger | null = reader === null ? null : reader.ledger();
    const carry = ledger === null ? {} : { turnLedger: ledger };
    const transcript = typeof parsed?.result === "string" ? parsed.result : outcome.stdout;
    const turns = typeof parsed?.num_turns === "number" ? parsed.num_turns : 0;
    const tokens = sumTokens(parsed?.usage);

    if (outcome.timedOut) {
      return {
        transcript,
        turns,
        tokens,
        ...carry,
        stoppedBy: "timeout",
        error: `timed out after ${request.timeoutMs}ms`,
      };
    }
    if (outcome.code !== 0 || parsed === null || parsed.is_error === true) {
      const detail = parsed === null ? outcome.stderr.trim().slice(0, 500) : String(parsed.subtype ?? "is_error");
      return {
        transcript,
        turns,
        tokens,
        ...carry,
        stoppedBy: "error",
        error: `claude exited ${outcome.code}: ${detail === "" ? "no output" : detail}`,
      };
    }

    // The installed CLI has no --max-turns (probed above), so the turn budget
    // cannot be applied in flight. The run ends on its own and the overrun is
    // observed here -- hence `over-turns`, not `turns`: nothing stopped it.
    const stoppedBy =
      turns >= request.maxTurns ? "over-turns" : tokens >= request.maxTokens ? "over-tokens" : "completed";
    return { transcript, turns, tokens, ...carry, stoppedBy };
  };

  return { name: "claude-headless", simulated: false, run };
};
