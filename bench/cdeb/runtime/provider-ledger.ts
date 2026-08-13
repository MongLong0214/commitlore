/**
 * CDEB-05 provider usage ledger (PRD §14, §19.1).
 *
 * The raw provider stream is evidence, not a source from which a convenient
 * number may be inferred. This module therefore has only two token states:
 *
 *   - `measured`: every NDJSON segment parsed, every turn has final usage, the
 *     terminal usage object exists, and the two totals reconcile exactly.
 *   - `unavailable`: any one of those facts is missing, malformed, truncated,
 *     delegated, or inconsistent. It deliberately contains no token total.
 *
 * A caller cannot turn an unavailable run into a smaller aggregate by omitting
 * it: `aggregateTokenVolume` propagates the gap. The exact bytes are stored as
 * `provider.ndjson.zst` plus the raw-byte digest the canonical row records.
 */

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { zstdCompressSync, zstdDecompressSync } from "./zstd.ts";

export interface TokenUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens: number;
  readonly cache_read_input_tokens: number;
}

export const TOKEN_USAGE_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
] as const;

export type LedgerGap =
  | "invalid_utf8"
  | "unparsed_stream"
  | "malformed_turn"
  | "turn_usage_missing"
  | "incomplete_turn"
  | "terminal_usage_absent"
  | "terminal_usage_ambiguous"
  | "terminal_usage_invalid"
  | "turn_session_mismatch"
  | "token_total_overflow"
  | "model_observation_absent"
  | "subagent_turn";

export interface MeasuredUsage extends TokenUsage {
  readonly availability: "measured";
  readonly total_token_volume: number;
  readonly reconciled: true;
  readonly unparsed_lines: 0;
  readonly raw_stream_sha256: string;
}

/**
 * Numeric usage is purposefully absent here. A partial total is a tempting
 * thing for a future caller to sum, so the type makes that impossible.
 */
export interface UnavailableUsage {
  readonly availability: "unavailable";
  readonly reasons: readonly LedgerGap[];
  readonly unparsed_lines: number;
  readonly raw_stream_sha256: string;
}

export type ProviderUsage = MeasuredUsage | UnavailableUsage;

export type SingleAgentMeasurement =
  | { readonly status: "eligible" }
  | { readonly status: "excluded"; readonly reason: "subagent_turn"; readonly delegated_event_count: number };

export interface ProviderLedger {
  readonly requested_model: string;
  /** Exact IDs from `message_start`, never an alias copied from the request. */
  readonly observed_model_ids: readonly string[];
  readonly single_agent_measurement: SingleAgentMeasurement;
  readonly turn_count: number;
  readonly raw_byte_length: number;
  readonly usage: ProviderUsage;
}

export interface ProviderLedgerInput {
  readonly requested_model: string;
  /** The preserved stream bytes, or a UTF-8 string only for replay tests. */
  readonly raw_ndjson: Uint8Array | string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const rawBytes = (raw: Uint8Array | string): Buffer =>
  typeof raw === "string" ? Buffer.from(raw, "utf8") : Buffer.from(raw);

const isTokenCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const readUsage = (raw: unknown): TokenUsage | null => {
  const usage = asRecord(raw);
  if (usage === null) return null;
  const values = TOKEN_USAGE_FIELDS.map((field) => usage[field]);
  if (!values.every(isTokenCount)) return null;
  return {
    input_tokens: values[0] as number,
    output_tokens: values[1] as number,
    cache_creation_input_tokens: values[2] as number,
    cache_read_input_tokens: values[3] as number,
  };
};

const addUsage = (left: TokenUsage, right: TokenUsage): TokenUsage | null => {
  const sum = {
    input_tokens: left.input_tokens + right.input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    cache_creation_input_tokens: left.cache_creation_input_tokens + right.cache_creation_input_tokens,
    cache_read_input_tokens: left.cache_read_input_tokens + right.cache_read_input_tokens,
  };
  return Object.values(sum).every((value) => Number.isSafeInteger(value)) ? sum : null;
};

const usageEquals = (left: TokenUsage, right: TokenUsage): boolean =>
  TOKEN_USAGE_FIELDS.every((field) => left[field] === right[field]);

const totalUsage = (usage: TokenUsage): number | null => {
  const total =
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens;
  return Number.isSafeInteger(total) ? total : null;
};

interface OpenTurn {
  readonly model: string | null;
}

const streamKey = (parentToolUseId: string | null): string => parentToolUseId ?? "<main>";

/**
 * Parses every line before it permits a measured figure. Assistant content
 * blocks are intentionally ignored: they duplicate a message's usage, while
 * `message_delta` is the final per-turn usage event (§24.1).
 */
export const readProviderLedger = (input: ProviderLedgerInput): ProviderLedger => {
  if (input.requested_model === "") throw new Error("provider ledger: requested_model must not be empty");

  const bytes = rawBytes(input.raw_ndjson);
  const rawStreamSha256 = sha256(bytes);
  const gaps = new Set<LedgerGap>();
  const observedModelIds: string[] = [];
  const openTurns = new Map<string, OpenTurn>();
  let turnTotal: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let turnTotalOverflowed = false;
  let turnCount = 0;
  let unparsedLines = 0;
  let delegatedEventCount = 0;
  let terminalResultCount = 0;
  let terminalUsage: TokenUsage | null = null;

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    gaps.add("invalid_utf8");
    return unavailableLedger({
      requestedModel: input.requested_model,
      observedModelIds,
      delegatedEventCount,
      turnCount,
      rawByteLength: bytes.byteLength,
      rawStreamSha256,
      unparsedLines,
      gaps,
    });
  }

  for (const line of text.split("\n")) {
    // Blank separators do not carry an event; all nonblank segments must be
    // JSON objects, including status/progress events the ledger does not use.
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      unparsedLines += 1;
      gaps.add("unparsed_stream");
      continue;
    }
    const envelope = asRecord(parsed);
    if (envelope === null) {
      unparsedLines += 1;
      gaps.add("unparsed_stream");
      continue;
    }

    const parentRaw = envelope["parent_tool_use_id"];
    let parentToolUseId: string | null = null;
    if (parentRaw !== undefined && parentRaw !== null) {
      delegatedEventCount += 1;
      if (typeof parentRaw === "string") parentToolUseId = parentRaw;
      else {
        parentToolUseId = "<malformed-parent>";
        gaps.add("malformed_turn");
      }
    }

    if (envelope["type"] === "result") {
      terminalResultCount += 1;
      const usage = readUsage(envelope["usage"]);
      if (usage === null) gaps.add("terminal_usage_invalid");
      else terminalUsage = usage;
      continue;
    }
    if (envelope["type"] !== "stream_event") continue;

    const event = asRecord(envelope["event"]);
    if (event === null) {
      gaps.add("malformed_turn");
      continue;
    }
    const key = streamKey(parentToolUseId);

    if (event["type"] === "message_start") {
      const message = asRecord(event["message"]);
      const id = message?.["id"];
      const model = message?.["model"];
      if (typeof id !== "string" || id === "" || openTurns.has(key)) gaps.add("malformed_turn");
      if (typeof model !== "string" || model === "") gaps.add("model_observation_absent");
      else if (!observedModelIds.includes(model)) observedModelIds.push(model);
      openTurns.set(key, { model: typeof model === "string" && model !== "" ? model : null });
      continue;
    }

    if (event["type"] !== "message_delta") continue;

    const open = openTurns.get(key);
    if (open === undefined) gaps.add("malformed_turn");
    else openTurns.delete(key);
    if (open?.model === null) gaps.add("model_observation_absent");

    const usage = readUsage(event["usage"]);
    if (usage === null) {
      gaps.add("turn_usage_missing");
      continue;
    }
    const next = addUsage(turnTotal, usage);
    if (next === null) {
      turnTotalOverflowed = true;
      gaps.add("token_total_overflow");
      continue;
    }
    turnTotal = next;
    turnCount += 1;
  }

  if (unparsedLines > 0) gaps.add("unparsed_stream");
  if (openTurns.size > 0) gaps.add("incomplete_turn");
  if (terminalResultCount === 0) gaps.add("terminal_usage_absent");
  if (terminalResultCount > 1) gaps.add("terminal_usage_ambiguous");
  if (observedModelIds.length === 0) gaps.add("model_observation_absent");
  if (delegatedEventCount > 0) gaps.add("subagent_turn");
  if (!turnTotalOverflowed && terminalUsage !== null && !usageEquals(turnTotal, terminalUsage)) {
    gaps.add("turn_session_mismatch");
  }

  if (gaps.size > 0 || terminalUsage === null || turnTotalOverflowed) {
    return unavailableLedger({
      requestedModel: input.requested_model,
      observedModelIds,
      delegatedEventCount,
      turnCount,
      rawByteLength: bytes.byteLength,
      rawStreamSha256,
      unparsedLines,
      gaps,
    });
  }

  const total = totalUsage(turnTotal);
  if (total === null) {
    gaps.add("token_total_overflow");
    return unavailableLedger({
      requestedModel: input.requested_model,
      observedModelIds,
      delegatedEventCount,
      turnCount,
      rawByteLength: bytes.byteLength,
      rawStreamSha256,
      unparsedLines,
      gaps,
    });
  }

  return {
    requested_model: input.requested_model,
    observed_model_ids: observedModelIds,
    single_agent_measurement: { status: "eligible" },
    turn_count: turnCount,
    raw_byte_length: bytes.byteLength,
    usage: {
      availability: "measured",
      ...turnTotal,
      total_token_volume: total,
      reconciled: true,
      unparsed_lines: 0,
      raw_stream_sha256: rawStreamSha256,
    },
  };
};

const unavailableLedger = (params: {
  readonly requestedModel: string;
  readonly observedModelIds: readonly string[];
  readonly delegatedEventCount: number;
  readonly turnCount: number;
  readonly rawByteLength: number;
  readonly rawStreamSha256: string;
  readonly unparsedLines: number;
  readonly gaps: ReadonlySet<LedgerGap>;
}): ProviderLedger => ({
  requested_model: params.requestedModel,
  observed_model_ids: params.observedModelIds,
  single_agent_measurement:
    params.delegatedEventCount > 0
      ? { status: "excluded", reason: "subagent_turn", delegated_event_count: params.delegatedEventCount }
      : { status: "eligible" },
  turn_count: params.turnCount,
  raw_byte_length: params.rawByteLength,
  usage: {
    availability: "unavailable",
    reasons: [...params.gaps].sort(),
    unparsed_lines: params.unparsedLines,
    raw_stream_sha256: params.rawStreamSha256,
  },
});

// ---------------------------------------------------------------------------
// Raw artifact persistence (§14.1, §19.1)
// ---------------------------------------------------------------------------

export const PROVIDER_NDJSON_ARTIFACT = "provider.ndjson.zst";
export const PROVIDER_NDJSON_CHECKSUM = "provider.ndjson.sha256";

export interface RawNdjsonArtifact {
  readonly compressed_path: string;
  readonly checksum_path: string;
  readonly raw_stream_sha256: string;
  readonly raw_byte_length: number;
}

let temporaryFileSequence = 0;

const fsyncDirectory = (directory: string): void => {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

/** Write once: rerunning a completed logical run must not edit its evidence. */
const writeNewFileAtomically = (destination: string, bytes: Uint8Array): void => {
  if (existsSync(destination)) throw new Error(`provider ledger: refusing to overwrite ${destination}`);
  temporaryFileSequence += 1;
  const temporary = `${destination}.${String(process.pid)}.${String(temporaryFileSequence)}.partial`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, "wx");
    let offset = 0;
    while (offset < bytes.byteLength) {
      offset += writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    // The ordinary existence check above is enough for the single-writer run
    // directory CDEB-07 owns; repeat it before rename so an operator mistake
    // cannot silently replace an immutable artifact.
    if (existsSync(destination)) throw new Error(`provider ledger: refusing to overwrite ${destination}`);
    renameSync(temporary, destination);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
};

/**
 * Stores compressed raw bytes and a digest of the *uncompressed* stream.
 * Compression changes the container, never the NDJSON evidence: the reader
 * below must return the identical Buffer or rejects the artifact.
 */
export const persistRawNdjson = (runDirectory: string, rawNdjson: Uint8Array | string): RawNdjsonArtifact => {
  if (runDirectory === "") throw new Error("provider ledger: runDirectory must not be empty");
  const raw = rawBytes(rawNdjson);
  const digest = sha256(raw);
  const compressedPath = join(runDirectory, PROVIDER_NDJSON_ARTIFACT);
  const checksumPath = join(runDirectory, PROVIDER_NDJSON_CHECKSUM);
  writeNewFileAtomically(compressedPath, zstdCompressSync(raw));
  try {
    writeNewFileAtomically(checksumPath, Buffer.from(`${digest}  provider.ndjson\n`, "utf8"));
    fsyncDirectory(runDirectory);
  } catch (error) {
    // Do not claim a partial artifact is durable. The compressed evidence can
    // be removed safely because its checksum never became authoritative.
    if (existsSync(compressedPath)) unlinkSync(compressedPath);
    throw error;
  }
  return {
    compressed_path: compressedPath,
    checksum_path: checksumPath,
    raw_stream_sha256: digest,
    raw_byte_length: raw.byteLength,
  };
};

export const readPersistedRawNdjson = (runDirectory: string): Buffer => {
  const compressedPath = join(runDirectory, PROVIDER_NDJSON_ARTIFACT);
  const checksumPath = join(runDirectory, PROVIDER_NDJSON_CHECKSUM);
  const sidecar = readFileSync(checksumPath, "utf8");
  const match = sidecar.match(/^([0-9a-f]{64})  provider\.ndjson\n$/);
  if (match?.[1] === undefined) throw new Error("provider ledger: malformed provider.ndjson.sha256");
  const raw = zstdDecompressSync(readFileSync(compressedPath));
  if (sha256(raw) !== match[1]) throw new Error("provider ledger: raw NDJSON checksum mismatch");
  return raw;
};

// ---------------------------------------------------------------------------
// Aggregation (§14.6, §15.2, §16.4)
// ---------------------------------------------------------------------------

export interface TokenAggregateInput {
  readonly logical_run_id: string;
  readonly ledger: ProviderLedger;
}

export interface MeasuredTokenAggregate extends TokenUsage {
  readonly availability: "measured";
  readonly total_token_volume: number;
  readonly run_count: number;
}

export interface UnavailableTokenAggregate {
  readonly availability: "unavailable";
  /** Every row that prevented a total; no incomplete row is silently skipped. */
  readonly unavailable_runs: readonly {
    readonly logical_run_id: string;
    readonly reasons: readonly (LedgerGap | "duplicate_logical_run_id" | "no_runs" | "token_total_overflow")[];
  }[];
}

export type TokenAggregate = MeasuredTokenAggregate | UnavailableTokenAggregate;

/**
 * Sum only an all-complete set. This is intentionally not a filter: one
 * unavailable row changes the aggregate's type and removes every numeric
 * total, so a report cannot accidentally describe a partial numerator.
 */
export const aggregateTokenVolume = (runs: readonly TokenAggregateInput[]): TokenAggregate => {
  if (runs.length === 0) {
    return { availability: "unavailable", unavailable_runs: [{ logical_run_id: "(aggregate)", reasons: ["no_runs"] }] };
  }

  const seen = new Set<string>();
  const unavailable: {
    logical_run_id: string;
    reasons: readonly (LedgerGap | "duplicate_logical_run_id" | "no_runs" | "token_total_overflow")[];
  }[] = [];
  let totals: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  for (const run of runs) {
    if (seen.has(run.logical_run_id)) {
      unavailable.push({ logical_run_id: run.logical_run_id, reasons: ["duplicate_logical_run_id"] });
      continue;
    }
    seen.add(run.logical_run_id);
    if (run.ledger.usage.availability === "unavailable") {
      unavailable.push({ logical_run_id: run.logical_run_id, reasons: run.ledger.usage.reasons });
      continue;
    }
    const next = addUsage(totals, run.ledger.usage);
    if (next === null) {
      unavailable.push({ logical_run_id: run.logical_run_id, reasons: ["token_total_overflow"] });
      continue;
    }
    totals = next;
  }

  if (unavailable.length > 0) return { availability: "unavailable", unavailable_runs: unavailable };
  const total = totalUsage(totals);
  if (total === null) {
    return {
      availability: "unavailable",
      unavailable_runs: [{ logical_run_id: "(aggregate)", reasons: ["token_total_overflow"] }],
    };
  }
  return { availability: "measured", ...totals, total_token_volume: total, run_count: runs.length };
};
