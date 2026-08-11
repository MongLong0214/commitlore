/**
 * CDEB-05 acceptance: raw provider bytes are the evidence; no incomplete,
 * delegated, or guessed usage reaches a token number.
 *
 * The control fixture is a recorded stream from the existing CLI capture.
 * Fault cases mutate only that captured byte stream, so they exercise the
 * actual event shape without calling a provider.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  aggregateTokenVolume,
  persistRawNdjson,
  readPersistedRawNdjson,
  readProviderLedger,
} from "../bench/cdeb/runtime/provider-ledger.ts";

const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const directory = mkdtempSync(join(tmpdir(), `cdeb-ledger-${label}-`));
  scratch.push(directory);
  return directory;
};

const recordedBytes = (): Buffer => readFileSync("test/fixtures/claude-stream/partial-messages.jsonl");
const recordedText = (): string => recordedBytes().toString("utf8");

const withoutTerminalResult = (): string =>
  recordedText()
    .split("\n")
    .filter((line) => {
      try {
        return (JSON.parse(line) as { type?: unknown }).type !== "result";
      } catch {
        return true;
      }
    })
    .join("\n");

const withoutTerminalUsage = (): string =>
  recordedText()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const event = JSON.parse(line) as { type?: unknown; usage?: unknown };
      if (event.type === "result") delete event.usage;
      return JSON.stringify(event);
    })
    .join("\n");

describe("CDEB-05 strict provider usage ledger", () => {
  it("reconciles the recorded final per-turn usage and records the model actually observed", () => {
    const ledger = readProviderLedger({
      requested_model: "requested-alias",
      raw_ndjson: recordedBytes(),
    });

    expect(ledger.requested_model).toBe("requested-alias");
    expect(ledger.observed_model_ids).toEqual(["claude-haiku-4-5-20251001"]);
    expect(ledger.observed_model_ids[0]).not.toBe(ledger.requested_model);
    expect(ledger.single_agent_measurement).toEqual({ status: "eligible" });
    expect(ledger.usage.availability).toBe("measured");
    if (ledger.usage.availability !== "measured") throw new Error("recorded fixture must reconcile");
    expect(ledger.usage).toMatchObject({
      input_tokens: 26,
      output_tokens: 386,
      cache_creation_input_tokens: 307,
      cache_read_input_tokens: 72845,
      total_token_volume: 73564,
      reconciled: true,
      unparsed_lines: 0,
    });
  });

  it("does not produce a measured number when any stream segment is unparsed", () => {
    const ledger = readProviderLedger({
      requested_model: "requested-alias",
      raw_ndjson: recordedText().replace("\n", "\nthis-is-not-ndjson\n"),
    });

    expect(ledger.usage.availability).toBe("unavailable");
    if (ledger.usage.availability !== "unavailable") throw new Error("unparsed stream must be unavailable");
    expect(ledger.usage.reasons).toContain("unparsed_stream");
    expect(ledger.usage.unparsed_lines).toBe(1);
    expect("total_token_volume" in ledger.usage).toBe(false);
  });

  it("flags a delegated turn and excludes the run from single-agent token counts", () => {
    const delegated = recordedText().replaceAll(
      '"parent_tool_use_id":null',
      '"parent_tool_use_id":"toolu_delegated"',
    );
    const good = readProviderLedger({ requested_model: "requested-alias", raw_ndjson: recordedBytes() });
    const ledger = readProviderLedger({ requested_model: "requested-alias", raw_ndjson: delegated });

    expect(ledger.single_agent_measurement.status).toBe("excluded");
    expect(ledger.usage.availability).toBe("unavailable");
    if (ledger.usage.availability !== "unavailable") throw new Error("delegated stream must be unavailable");
    expect(ledger.usage.reasons).toContain("subagent_turn");

    const aggregate = aggregateTokenVolume([
      { logical_run_id: "repo-a__task-a__on__r1", ledger: good },
      { logical_run_id: "repo-a__task-a__on__r2", ledger },
    ]);
    expect(aggregate.availability).toBe("unavailable");
    expect("total_token_volume" in aggregate).toBe(false);
  });

  it("marks both truncated and terminal-usage-absent streams unavailable, and propagates either gap", () => {
    const complete = readProviderLedger({ requested_model: "requested-alias", raw_ndjson: recordedBytes() });
    const truncated = readProviderLedger({ requested_model: "requested-alias", raw_ndjson: withoutTerminalResult() });
    const absent = readProviderLedger({ requested_model: "requested-alias", raw_ndjson: withoutTerminalUsage() });

    for (const ledger of [truncated, absent]) {
      expect(ledger.usage.availability).toBe("unavailable");
      if (ledger.usage.availability !== "unavailable") throw new Error("missing terminal usage must be unavailable");
      expect("total_token_volume" in ledger.usage).toBe(false);
    }
    if (truncated.usage.availability !== "unavailable") throw new Error("truncated fixture must be unavailable");
    expect(truncated.usage.reasons).toContain("terminal_usage_absent");
    if (absent.usage.availability !== "unavailable") throw new Error("terminal usage fixture must be unavailable");
    expect(absent.usage.reasons).toContain("terminal_usage_invalid");

    const aggregate = aggregateTokenVolume([
      { logical_run_id: "repo-a__task-a__on__r1", ledger: complete },
      { logical_run_id: "repo-a__task-a__on__r2", ledger: truncated },
    ]);
    expect(aggregate).toMatchObject({ availability: "unavailable" });
    expect("total_token_volume" in aggregate).toBe(false);
  });

  it("round-trips recorded raw NDJSON byte-exactly through the persisted zstd artifact", () => {
    const raw = recordedBytes();
    const directory = temp("raw-roundtrip");
    const artifact = persistRawNdjson(directory, raw);
    const restored = readPersistedRawNdjson(directory);

    expect(restored).toEqual(raw);
    expect(artifact.raw_stream_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.raw_byte_length).toBe(raw.byteLength);
  });
});
