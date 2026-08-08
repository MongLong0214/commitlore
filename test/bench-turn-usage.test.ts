/**
 * Per-turn token usage from `claude --output-format stream-json`.
 *
 * `bench/TOKEN-LEDGER.md` §5 blocker B named the missing instrument: the
 * driver read one session-total `usage` object, so a drafting turn's output
 * could not be attributed to that turn even if a model were called. This suite
 * covers the instrument that closes the attribution half of it.
 *
 * Every assertion about the event shape is checked against
 * `test/fixtures/claude-stream/*.jsonl`, which are captures of real
 * invocations of CLI 2.1.220 with local paths redacted — not hand-written
 * examples of what the format was expected to be. Two captures, because the
 * difference between them is the finding:
 *
 *   - `assistant-only.jsonl`  — `stream-json` alone.
 *   - `partial-messages.jsonl` — the same, plus `--include-partial-messages`.
 *
 * The first reconciles on input and cache and is wrong on output by two orders
 * of magnitude. Only the second can price a drafting turn.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { StreamJsonReader, readUsage, usageEquals, ZERO_USAGE } from "../bench/drivers/stream-json.ts";
import type { RunRecord } from "../bench/types.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const FIXTURES = join(REPO_ROOT, "test", "fixtures", "claude-stream");
const SCHEMA = join(REPO_ROOT, "bench", "schema", "result.schema.json");

const capture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const read = (name: string): StreamJsonReader => {
  const reader = new StreamJsonReader();
  reader.pushAll(capture(name));
  return reader;
};

/** The lines of a capture whose `type` is `t`, or whose inner `event.type` is. */
const events = (name: string, predicate: (row: Record<string, unknown>) => boolean): unknown[] =>
  capture(name)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter(predicate);

describe("what the CLI event stream actually carries", () => {
  it("repeats one usage object per content block, so summing assistant events double-counts", () => {
    const assistants = events(
      "partial-messages.jsonl",
      (row) => row["type"] === "assistant",
    ) as { message: { id: string; usage: { input_tokens: number } } }[];

    // Six events, three API calls: each turn appears once per content block.
    expect(assistants).toHaveLength(6);
    expect(new Set(assistants.map((event) => event.message.id)).size).toBe(3);

    const naive = assistants.reduce((sum, event) => sum + event.message.usage.input_tokens, 0);
    const real = read("partial-messages.jsonl").ledger().session_total.input_tokens;
    expect(naive).toBe(real * 2);
  });

  it("reports a message_start snapshot for output_tokens on assistant events, not the turn's output", () => {
    const result = events("assistant-only.jsonl", (row) => row["type"] === "result")[0] as {
      usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
    };

    // Deduplicated by message id — the only reading that could be correct —
    // the input and cache figures on those events are already final and do
    // reconcile. That is exactly what makes the output figure dangerous:
    // nothing about the event marks it as provisional while its neighbours
    // are not.
    const seen = new Map<
      string,
      { input_tokens: number; output_tokens: number; cache_read_input_tokens: number }
    >();
    for (const event of events("assistant-only.jsonl", (row) => row["type"] === "assistant") as {
      message: {
        id: string;
        usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
      };
    }[]) {
      seen.set(event.message.id, event.message.usage);
    }
    const total = (field: "input_tokens" | "output_tokens" | "cache_read_input_tokens"): number =>
      [...seen.values()].reduce((sum, usage) => sum + usage[field], 0);

    expect(total("input_tokens")).toBe(result.usage.input_tokens);
    expect(total("cache_read_input_tokens")).toBe(result.usage.cache_read_input_tokens);

    // The output term — the one W4 needs — is off by 397 of 403.
    expect(total("output_tokens")).toBe(6);
    expect(result.usage.output_tokens).toBe(403);
  });

  it("carries the turn's real output only on message_delta, under --include-partial-messages", () => {
    expect(events("assistant-only.jsonl", (row) => {
      const inner = row["event"] as { type?: unknown } | undefined;
      return inner?.type === "message_delta";
    })).toHaveLength(0);

    const deltas = events("partial-messages.jsonl", (row) => {
      const inner = row["event"] as { type?: unknown } | undefined;
      return inner?.type === "message_delta";
    }) as { event: { usage: { output_tokens: number } } }[];
    expect(deltas.map((event) => event.event.usage.output_tokens)).toEqual([157, 193, 36]);
  });
});

describe("StreamJsonReader", () => {
  it("reconciles the per-turn ledger against the session total the CLI states", () => {
    const ledger = read("partial-messages.jsonl").ledger();

    expect(ledger.turns).toHaveLength(3);
    expect(ledger.unparsed_lines).toBe(0);
    expect(ledger.reconciled).toBe(true);
    expect(ledger.turn_total).toEqual(ledger.session_total);
    expect(ledger.session_total).toEqual({
      input_tokens: 26,
      output_tokens: 386,
      cache_creation_input_tokens: 307,
      cache_read_input_tokens: 72845,
    });
  });

  it("attributes each turn to its own message, model and content blocks", () => {
    const [first, , last] = read("partial-messages.jsonl").ledger().turns;

    expect(first?.index).toBe(0);
    expect(first?.message_id).toMatch(/^msg_/);
    expect(first?.model).toBe("claude-haiku-4-5-20251001");
    expect(first?.parent_tool_use_id).toBeNull();
    expect(first?.output_tokens).toBe(157);
    expect(first?.thinking_tokens).toBe(48);
    expect(first?.stop_reason).toBe("tool_use");
    expect(first?.content_blocks).toEqual(["thinking", "tool_use"]);

    // The answering turn: it writes prose and stops, which is the shape the
    // drafting turn of a harvest has.
    expect(last?.content_blocks).toEqual(["thinking", "text"]);
    expect(last?.stop_reason).toBe("end_turn");
    expect(last?.output_tokens).toBe(36);
  });

  it("reports no ledger rather than a false one when the stream carries no message_delta", () => {
    const ledger = read("assistant-only.jsonl").ledger();

    // The `stream-json` format without `--include-partial-messages` is exactly
    // the case where a lenient parser would invent numbers. It returns none,
    // and says so by failing to reconcile against a session total that is not
    // zero.
    expect(ledger.turns).toEqual([]);
    expect(ledger.turn_total).toEqual(ZERO_USAGE);
    expect(ledger.session_total.output_tokens).toBe(403);
    expect(ledger.reconciled).toBe(false);
  });

  it("counts unparsable lines instead of discarding them silently", () => {
    const reader = new StreamJsonReader();
    reader.pushAll('{"type":"result","usage":{"output_tokens":1}}\nnot json\n[1,2,3]\n');

    const ledger = reader.ledger();
    expect(ledger.unparsed_lines).toBe(2);
    expect(ledger.reconciled).toBe(false);
  });

  it("keeps a subagent's turns separate from the parent stream they interleave with", () => {
    const reader = new StreamJsonReader();
    const event = (parent: string | null, inner: unknown): string =>
      JSON.stringify({ type: "stream_event", parent_tool_use_id: parent, event: inner });
    const start = (id: string): unknown => ({
      type: "message_start",
      message: { id, model: "m" },
    });
    const delta = (out: number): unknown => ({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { input_tokens: 1, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    // Parent opens, subagent opens and closes inside it, then the parent closes.
    reader.pushAll(
      [
        event(null, start("msg_parent")),
        event("toolu_1", start("msg_child")),
        event("toolu_1", delta(20)),
        event(null, delta(10)),
        JSON.stringify({
          type: "result",
          usage: {
            input_tokens: 2,
            output_tokens: 30,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      ].join("\n"),
    );

    const ledger = reader.ledger();
    expect(ledger.turns.map((turn) => [turn.message_id, turn.parent_tool_use_id, turn.output_tokens])).toEqual([
      ["msg_child", "toolu_1", 20],
      ["msg_parent", null, 10],
    ]);
    expect(ledger.reconciled).toBe(true);
  });

  it("treats an absent usage field as zero rather than as a missing measurement", () => {
    expect(readUsage(undefined)).toEqual(ZERO_USAGE);
    expect(readUsage({ output_tokens: "many" })).toEqual(ZERO_USAGE);
    expect(usageEquals(ZERO_USAGE, ZERO_USAGE)).toBe(true);
  });
});

describe("the row shape", () => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA, "utf8")) as object);

  const row = (overrides: Partial<RunRecord> = {}): RunRecord => ({
    run_id: "turn-usage-test",
    harness_commit: "1".repeat(40),
    dist_digest: "2".repeat(64),
    task: "reproposal-redis-cache",
    cond: "commitlore-on",
    seed: 1,
    reproposed: false,
    violations: 0,
    turns: 3,
    tokens: 7444,
    stopped_by: "completed",
    duration_ms: 1,
    driver: "claude-headless",
    started_at: "2026-08-02T00:00:00.000Z",
    simulated: false,
    ...overrides,
  });

  it("accepts a real ledger, and accepts a row without one as not instrumented", () => {
    const ledger = read("partial-messages.jsonl").ledger();
    expect(validate(row({ turn_usage: ledger })), ajv.errorsText(validate.errors)).toBe(true);
    expect(validate(row())).toBe(true);
  });

  it("rejects a ledger that omits its own audit", () => {
    const ledger = read("partial-messages.jsonl").ledger();
    const { reconciled: _dropped, ...withoutAudit } = ledger;
    expect(validate(row({ turn_usage: withoutAudit as typeof ledger }))).toBe(false);
  });

  it("accepts the runner's current row shape, which the gate used to reject", () => {
    // Every field the runner writes today. `reproposal_matches` and the four
    // `rejected_path_*` counts reached the rows before they reached the
    // schema, so `verify.mjs` failed all 80 rows of the most recent matrix.
    expect(
      validate(
        row({
          model: "claude-haiku-4-5-20251001",
          reproposal_matches: 0,
          matched: [],
          accepted_records: 3,
          rejected_path_edit_hunks: 0,
          rejected_path_lines_changed: 0,
          rejected_path_dependency_additions: 0,
          rejected_path_first_edit: 0,
        }),
      ),
      ajv.errorsText(validate.errors),
    ).toBe(true);
  });
});
