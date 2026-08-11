/**
 * CDEB-04's observation contract (PRD §9.3, §9.5).
 *
 * The proxy records facts about the shipping hook after it has forwarded the
 * hook's bytes.  This module intentionally knows the *published hook output*
 * grammar, not how an injection is assembled.  It is the one frozen parser
 * used both by the proxy and by the reader that admits an exposure artifact.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const EXPOSURE_EVENT_VERSION = 1 as const;

export type OutputParseState = "empty" | "parsed" | "unknown";

export interface ParsedShippingOutput {
  readonly state: Exclude<OutputParseState, "unknown">;
  readonly recordIds: readonly string[];
}

export interface ExposureEvent {
  readonly version: typeof EXPOSURE_EVENT_VERSION;
  readonly event_index: number;
  readonly tool_name: string | null;
  readonly repository_relative_path: string | null;
  readonly input_sha256: string;
  readonly child_command_sha256: string;
  readonly child_exit_code: number;
  readonly stdout_sha256: string;
  readonly stdout_bytes: number;
  /**
   * The digest of the bytes the agent was actually handed, and `null` when it
   * was handed nothing.
   *
   * Not merged into `stdout_sha256`, and not present on an empty delivery. A
   * hook that fired on a path with no records still produces stdout — zero
   * bytes of it — and `sha256("")` is a perfectly valid digest of that. An
   * event carrying one would let a summariser count an empty delivery as a
   * payload, which is exactly the opportunity-versus-delivery conflation §9.5
   * exists to prevent, one layer above where CDEB-P hit it.
   */
  readonly payload_sha256: string | null;
  readonly parsed_record_ids: readonly string[] | null;
  readonly parse_state: OutputParseState;
  readonly product_error: string | null;
  readonly started_monotonic_ns: number;
  readonly finished_monotonic_ns: number;
}

export class FrozenOutputParseError extends Error {
  public constructor(message: string) {
    super(`shipping hook output is not the frozen grammar: ${message}`);
    this.name = "FrozenOutputParseError";
  }
}

export class ExposureIntegrityError extends Error {
  public constructor(message: string) {
    super(`CDEB exposure is incomplete: ${message}`);
    this.name = "ExposureIntegrityError";
  }
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export const sha256Bytes = (bytes: Uint8Array): string => sha256(bytes);

const asUtf8 = (bytes: Buffer): string => {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new FrozenOutputParseError("stdout is not UTF-8");
  }
  return text;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
};

/**
 * Parse the only non-empty stdout shape the shipping `--hook-input` command
 * emits.  The row expression is deliberately anchored to injection rows: an
 * incidental Record-Id in a decision's prose must not become an exposure.
 */
export const parseShippingHookOutput = (stdout: Buffer): ParsedShippingOutput => {
  if (stdout.length === 0) return { state: "empty", recordIds: [] };

  const text = asUtf8(stdout);
  if (!text.endsWith("\n")) throw new FrozenOutputParseError("hook JSON is missing its terminal newline");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new FrozenOutputParseError("stdout is not one JSON object");
  }
  if (!isPlainObject(parsed) || !exactKeys(parsed, ["hookSpecificOutput"])) {
    throw new FrozenOutputParseError("top-level hook object changed");
  }
  const hook = parsed["hookSpecificOutput"];
  if (!isPlainObject(hook) || !exactKeys(hook, ["additionalContext", "hookEventName"])) {
    throw new FrozenOutputParseError("hookSpecificOutput shape changed");
  }
  if (hook["hookEventName"] !== "PreToolUse" || typeof hook["additionalContext"] !== "string") {
    throw new FrozenOutputParseError("hook event or context type changed");
  }

  const context = hook["additionalContext"];
  if (!context.startsWith("commitlore: active records for ") || !context.endsWith("\n")) {
    throw new FrozenOutputParseError("context is not the shipping injection projection");
  }

  const ids: string[] = [];
  const row = /^  \[(?:directive|claim)\]\s{2,}(r-[a-z0-9]{6,})\s{2,}[0-9a-f]{8}\s{2,}/gmu;
  for (const match of context.matchAll(row)) {
    const id = match[1];
    if (id === undefined) throw new FrozenOutputParseError("record row has no id");
    if (ids.includes(id)) throw new FrozenOutputParseError(`record id ${id} appears more than once`);
    ids.push(id);
  }
  return { state: "parsed", recordIds: ids };
};

const isSha256 = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);

const isIntegerAtLeast = (value: unknown, minimum: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= minimum;

const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

const readEvent = (line: string, lineNumber: number): ExposureEvent => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new ExposureIntegrityError(`line ${String(lineNumber)} is not JSON`);
  }
  if (!isPlainObject(value)) throw new ExposureIntegrityError(`line ${String(lineNumber)} is not an object`);

  const expected = [
    "child_command_sha256",
    "child_exit_code",
    "event_index",
    "finished_monotonic_ns",
    "input_sha256",
    "parse_state",
    "parsed_record_ids",
    "payload_sha256",
    "product_error",
    "repository_relative_path",
    "started_monotonic_ns",
    "stdout_bytes",
    "stdout_sha256",
    "tool_name",
    "version",
  ];
  if (!exactKeys(value, expected)) {
    throw new ExposureIntegrityError(`line ${String(lineNumber)} has an unexpected event shape`);
  }
  if (value["version"] !== EXPOSURE_EVENT_VERSION) {
    throw new ExposureIntegrityError(`line ${String(lineNumber)} has an unsupported event version`);
  }
  for (const key of ["input_sha256", "child_command_sha256", "stdout_sha256"] as const) {
    if (!isSha256(value[key])) throw new ExposureIntegrityError(`line ${String(lineNumber)} has an invalid ${key}`);
  }
  if (value["payload_sha256"] !== null && !isSha256(value["payload_sha256"])) {
    throw new ExposureIntegrityError(`line ${String(lineNumber)} has an invalid payload_sha256`);
  }
  for (const key of ["event_index", "stdout_bytes", "started_monotonic_ns", "finished_monotonic_ns"] as const) {
    if (!isIntegerAtLeast(value[key], key === "event_index" ? 1 : 0)) {
      throw new ExposureIntegrityError(`line ${String(lineNumber)} has an invalid ${key}`);
    }
  }
  if (!Number.isInteger(value["child_exit_code"])) {
    throw new ExposureIntegrityError(`line ${String(lineNumber)} has an invalid child_exit_code`);
  }
  if (!isStringOrNull(value["tool_name"]) || !isStringOrNull(value["repository_relative_path"]) || !isStringOrNull(value["product_error"])) {
    throw new ExposureIntegrityError(`line ${String(lineNumber)} has an invalid nullable field`);
  }
  const state = value["parse_state"];
  if (state !== "empty" && state !== "parsed" && state !== "unknown") {
    throw new ExposureIntegrityError(`line ${String(lineNumber)} has an invalid parse_state`);
  }
  const ids = value["parsed_record_ids"];
  if (state === "unknown") {
    if (ids !== null) throw new ExposureIntegrityError(`line ${String(lineNumber)} marks an unknown parse as known`);
  } else {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !/^r-[a-z0-9]{6,}$/u.test(id))) {
      throw new ExposureIntegrityError(`line ${String(lineNumber)} has invalid parsed_record_ids`);
    }
    if (state === "empty" && ids.length !== 0) {
      throw new ExposureIntegrityError(`line ${String(lineNumber)} says empty stdout delivered records`);
    }
  }
  // A payload exists exactly when the frozen parser read one out of stdout.
  if (state === "parsed") {
    if (value["payload_sha256"] !== value["stdout_sha256"]) {
      throw new ExposureIntegrityError(`line ${String(lineNumber)} payload digest differs from stdout digest`);
    }
  } else if (value["payload_sha256"] !== null) {
    throw new ExposureIntegrityError(`line ${String(lineNumber)} reports a payload for a ${String(state)} delivery`);
  }
  const started = value["started_monotonic_ns"] as number;
  const finished = value["finished_monotonic_ns"] as number;
  if (finished < started) {
    throw new ExposureIntegrityError(`line ${String(lineNumber)} ends before it starts`);
  }
  return value as unknown as ExposureEvent;
};

/**
 * Opens an append-only exposure artifact.  An unreadable or ambiguous event is
 * a hard refusal: treating it as zero delivery would recreate the pilot's
 * "hook did not fire" versus "hook delivered nothing" blind spot.
 */
export const readExposureEvents = (path: string): readonly ExposureEvent[] => {
  if (!existsSync(path)) throw new ExposureIntegrityError(`side channel is missing: ${path}`);
  const bytes = readFileSync(path);
  const text = asUtf8(bytes);
  if (text === "") return [];
  if (!text.endsWith("\n")) throw new ExposureIntegrityError("side channel ends with a partial event");
  const lines = text.slice(0, -1).split("\n");
  const events = lines.map((line, index) => readEvent(line, index + 1));
  for (const [index, event] of events.entries()) {
    if (event.event_index !== index + 1) {
      throw new ExposureIntegrityError(`line ${String(index + 1)} has event_index ${String(event.event_index)}, expected ${String(index + 1)}`);
    }
    if (event.parse_state === "unknown") {
      throw new ExposureIntegrityError(`line ${String(index + 1)} could not parse shipping output`);
    }
  }
  return events;
};

export const exposureLogSha256 = (path: string): string => {
  if (!existsSync(path)) throw new ExposureIntegrityError(`side channel is missing: ${path}`);
  return sha256(readFileSync(path));
};
