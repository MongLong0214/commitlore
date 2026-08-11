/**
 * CDEB-04's transparent wrapper around the shipping hook command (PRD §9.3).
 *
 * It does not interpret, render, or edit the hook result.  The product command
 * receives the original stdin bytes and its stdout, stderr, and status are
 * forwarded after capture without a text conversion.  Observation is written
 * only to the separate append-only artifact.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { parseShippingHookOutput, sha256Bytes, type ExposureEvent } from "./exposure.ts";

/** Path in the pinned runtime image; Dockerfile copies the committed shipping dist here. */
export const CONTAINER_SHIPPING_CLI = "/opt/commitlore/dist/cli.js";
export const CONTAINER_NODE_EXECUTABLE = "/usr/local/bin/node";

/** The product subcommand and options.  No CDEB option changes budget, trust, or index behaviour. */
export const SHIPPING_HOOK_ARGS = ["inject", "--hook-input"] as const;

export interface ProxyInvocation {
  readonly cwd: string;
  readonly input: Buffer;
  readonly exposurePath: string;
  readonly nodeExecutable: string;
  readonly shippingCli: string;
}

export interface ProxyResult {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly exitCode: number;
  readonly event: ExposureEvent;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const childCommand = (nodeExecutable: string, shippingCli: string): readonly string[] => [
  nodeExecutable,
  shippingCli,
  ...SHIPPING_HOOK_ARGS,
];

const readInput = (): Promise<Buffer> =>
  new Promise((resolveInput, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    process.stdin.on("end", () => resolveInput(Buffer.concat(chunks)));
    process.stdin.on("error", reject);
  });

const commandDigest = (command: readonly string[]): string => sha256(Buffer.from(JSON.stringify(command), "utf8"));

const inputMetadata = (input: Buffer, cwd: string): { toolName: string | null; relativePath: string | null } => {
  let payload: unknown;
  try {
    payload = JSON.parse(input.toString("utf8"));
  } catch {
    return { toolName: null, relativePath: null };
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { toolName: null, relativePath: null };
  }
  const record = payload as Record<string, unknown>;
  const toolName = typeof record["tool_name"] === "string" ? record["tool_name"] : null;
  const payloadCwd = typeof record["cwd"] === "string" && record["cwd"] !== "" ? record["cwd"] : cwd;
  const toolInput = record["tool_input"];
  if (typeof toolInput !== "object" || toolInput === null || Array.isArray(toolInput)) {
    return { toolName, relativePath: null };
  }
  const tool = toolInput as Record<string, unknown>;
  const path = ["file_path", "notebook_path", "path"]
    .map((key) => tool[key])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate !== "");
  if (path === undefined) return { toolName, relativePath: null };
  const target = resolve(isAbsolute(path) ? path : resolve(payloadCwd, path));
  const scoped = relative(resolve(payloadCwd), target);
  if (scoped === "" || scoped === ".." || scoped.startsWith(`..${sep}`) || isAbsolute(scoped)) {
    return { toolName, relativePath: null };
  }
  return { toolName, relativePath: scoped.split(sep).join("/") };
};

const nextEventIndex = (exposurePath: string): number => {
  if (!existsSync(exposurePath)) return 1;
  const previous = readFileSync(exposurePath, "utf8");
  if (previous === "") return 1;
  return previous.split("\n").filter((line) => line !== "").length + 1;
};

const appendExposure = (path: string, event: ExposureEvent): void => {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
};

/** Runs the product command once and produces the side-channel event. */
export const runTransparentShippingProxy = async (invocation: ProxyInvocation): Promise<ProxyResult> => {
  const started = Number(process.hrtime.bigint());
  const command = childCommand(invocation.nodeExecutable, invocation.shippingCli);
  const metadata = inputMetadata(invocation.input, invocation.cwd);
  const child = spawn(command[0] ?? process.execPath, command.slice(1), {
    cwd: invocation.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
  child.stdin.end(invocation.input);

  const exitCode = await new Promise<number>((resolveExit) => {
    let spawnError = false;
    child.once("error", () => {
      spawnError = true;
    });
    child.once("close", (code) => resolveExit(code ?? (spawnError ? 127 : 1)));
  });

  const stdout = Buffer.concat(stdoutChunks);
  const stderr = Buffer.concat(stderrChunks);
  let parsedRecordIds: readonly string[] | null = null;
  let parseState: ExposureEvent["parse_state"] = "unknown";
  try {
    const parsed = parseShippingHookOutput(stdout);
    parsedRecordIds = parsed.recordIds;
    parseState = parsed.state;
  } catch {
    // The caller later refuses an `unknown` exposure event.  The product's
    // bytes and status still take precedence over an observer-side failure.
  }

  const finished = Number(process.hrtime.bigint());
  const event: ExposureEvent = {
    version: 1,
    event_index: nextEventIndex(invocation.exposurePath),
    tool_name: metadata.toolName,
    repository_relative_path: metadata.relativePath,
    input_sha256: sha256(invocation.input),
    child_command_sha256: commandDigest(command),
    child_exit_code: exitCode,
    stdout_sha256: sha256Bytes(stdout),
    stdout_bytes: stdout.length,
    // Null unless the hook actually handed the agent a projection: see the
    // field's note in exposure.ts.
    payload_sha256: parseState === "parsed" ? sha256Bytes(stdout) : null,
    parsed_record_ids: parsedRecordIds,
    parse_state: parseState,
    product_error: stderr.length === 0 ? null : stderr.toString("utf8"),
    started_monotonic_ns: started,
    finished_monotonic_ns: finished,
  };

  // Do not add an observer diagnostic to stderr or alter the child status:
  // either would make a successful product hook observably different.  A
  // missing side channel is detected as a hard refusal before measurement.
  try {
    appendExposure(invocation.exposurePath, event);
  } catch {
    // See the invariant above.
  }
  return { stdout, stderr, exitCode, event };
};

interface ProxyCliOptions {
  readonly exposurePath: string;
  readonly nodeExecutable: string;
  readonly shippingCli: string;
}

const cliOptions = (argv: readonly string[]): ProxyCliOptions => {
  let exposurePath: string | undefined;
  let nodeExecutable = process.execPath;
  let shippingCli = CONTAINER_SHIPPING_CLI;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--exposure") {
      exposurePath = argv[index + 1];
      index += 1;
    } else if (token === "--node") {
      nodeExecutable = argv[index + 1] ?? "";
      index += 1;
    } else if (token === "--shipping-cli") {
      shippingCli = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`unknown proxy option ${JSON.stringify(token)}`);
    }
  }
  if (exposurePath === undefined || exposurePath === "") throw new Error("--exposure is required");
  if (nodeExecutable === "") throw new Error("--node must not be empty");
  if (shippingCli === "") throw new Error("--shipping-cli must not be empty");
  return { exposurePath, nodeExecutable, shippingCli };
};

const main = async (): Promise<void> => {
  let options: ProxyCliOptions;
  try {
    options = cliOptions(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`cdeb shipping proxy: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }
  const result = await runTransparentShippingProxy({
    cwd: process.cwd(),
    input: await readInput(),
    exposurePath: options.exposurePath,
    nodeExecutable: options.nodeExecutable,
    shippingCli: options.shippingCli,
  });
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  void main();
}
