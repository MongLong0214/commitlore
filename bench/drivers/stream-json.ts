/**
 * Per-turn token usage, parsed out of `claude --output-format stream-json`.
 *
 * Written against the event stream a real invocation emitted, not against a
 * documented shape. The capture that fixed every field here is committed as
 * `test/fixtures/claude-stream/*.jsonl`, so a future CLI that moves a field
 * fails a test rather than silently reporting zeros.
 *
 * What the stream actually carries, on CLI 2.1.220:
 *
 *   - `{"type":"assistant"}` events carry `message.usage`, and there is **one
 *     event per content block** — a turn that thinks and then calls a tool
 *     appears twice, with the same `message.id` and the same usage object. Any
 *     consumer that sums them double-counts.
 *   - Worse, the `output_tokens` on those events is the `message_start`
 *     snapshot (observed: 4, 1, 1) and not the turn's real output (157, 193,
 *     36). Input and cache fields on them are already final; output is not.
 *   - The authoritative per-turn figure arrives on
 *     `{"type":"stream_event","event":{"type":"message_delta"}}`, which is only
 *     emitted under `--include-partial-messages`. It carries the final
 *     `usage` for that turn plus `output_tokens_details.thinking_tokens`.
 *
 * So the output term — the one the token ledger needs, because the drafting
 * turn's output *is* W4 — is unreadable without `--include-partial-messages`.
 * That is why this parser keys off `message_delta` and why the driver passes
 * the flag.
 */

/** Raw usage fields, as the CLI names them. No field is dropped or combined. */
export interface UsageTotals {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens: number;
  readonly cache_read_input_tokens: number;
}

export const ZERO_USAGE: UsageTotals = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

/** One assistant API call: one `message_start` … `message_delta` pair. */
export interface TurnUsage extends UsageTotals {
  /** 0-based ordinal in emission order across the whole session. */
  readonly index: number;
  readonly message_id: string;
  readonly model: string;
  /**
   * The tool_use id of the parent turn when a subagent produced this one, null
   * for the main session. Subagent turns are recorded, never merged away: a
   * ledger that hid them would under-count the session it claims to total.
   */
  readonly parent_tool_use_id: string | null;
  /** From `output_tokens_details.thinking_tokens`; 0 when the field is absent. */
  readonly thinking_tokens: number;
  readonly stop_reason: string | null;
  /** Content block types in emission order, e.g. `["thinking","tool_use"]`. */
  readonly content_blocks: readonly string[];
}

/**
 * The per-turn ledger, with its own audit built in.
 *
 * `reconciled` is the whole point of publishing `session_total` beside
 * `turn_total`: the CLI's own `result` event states a session total, and if the
 * turns do not sum to it then this parser has missed or duplicated a turn and
 * no figure derived from it should be trusted. It is a measurement of the
 * parser, carried on the row rather than asserted in a comment.
 */
export interface TurnLedger {
  readonly turns: readonly TurnUsage[];
  readonly turn_total: UsageTotals;
  /** The session total the CLI reports in its final `result` event. */
  readonly session_total: UsageTotals;
  readonly reconciled: boolean;
  /** Lines of stdout that were not valid JSON. Non-zero means a truncated stream. */
  readonly unparsed_lines: number;
}

/** The subset of the final `result` event the driver reads. Shared with the JSON format. */
export interface HeadlessResult {
  readonly result?: unknown;
  readonly num_turns?: unknown;
  readonly usage?: unknown;
  readonly is_error?: unknown;
  readonly subtype?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const numberAt = (source: Record<string, unknown> | null, key: string): number => {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const stringAt = (source: Record<string, unknown> | null, key: string): string | null => {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
};

export const readUsage = (raw: unknown): UsageTotals => {
  const usage = asRecord(raw);
  return {
    input_tokens: numberAt(usage, "input_tokens"),
    output_tokens: numberAt(usage, "output_tokens"),
    cache_creation_input_tokens: numberAt(usage, "cache_creation_input_tokens"),
    cache_read_input_tokens: numberAt(usage, "cache_read_input_tokens"),
  };
};

const addUsage = (left: UsageTotals, right: UsageTotals): UsageTotals => ({
  input_tokens: left.input_tokens + right.input_tokens,
  output_tokens: left.output_tokens + right.output_tokens,
  cache_creation_input_tokens:
    left.cache_creation_input_tokens + right.cache_creation_input_tokens,
  cache_read_input_tokens: left.cache_read_input_tokens + right.cache_read_input_tokens,
});

export const usageEquals = (left: UsageTotals, right: UsageTotals): boolean =>
  left.input_tokens === right.input_tokens &&
  left.output_tokens === right.output_tokens &&
  left.cache_creation_input_tokens === right.cache_creation_input_tokens &&
  left.cache_read_input_tokens === right.cache_read_input_tokens;

/** An open `message_start` awaiting its `message_delta`, per parent stream. */
interface OpenTurn {
  messageId: string;
  model: string;
  contentBlocks: string[];
}

/**
 * Consumes the NDJSON stream one line at a time.
 *
 * Line-at-a-time rather than parse-the-whole-buffer because
 * `--include-partial-messages` emits one event per streamed chunk: retaining
 * the whole of a long run's stdout to parse it once would hold tens of
 * megabytes for the sake of a few hundred numbers.
 */
export class StreamJsonReader {
  #turns: TurnUsage[] = [];
  #open = new Map<string, OpenTurn>();
  #result: HeadlessResult | null = null;
  #unparsed = 0;

  /** The final `result` event, or null if the stream ended before one arrived. */
  get result(): HeadlessResult | null {
    return this.#result;
  }

  push(line: string): void {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      this.#unparsed += 1;
      return;
    }
    const envelope = asRecord(event);
    if (envelope === null) {
      this.#unparsed += 1;
      return;
    }

    if (envelope["type"] === "result") {
      this.#result = envelope as HeadlessResult;
      return;
    }
    if (envelope["type"] !== "stream_event") return;

    const inner = asRecord(envelope["event"]);
    if (inner === null) return;
    // `parent_tool_use_id` scopes the stream: a subagent's message_start and
    // message_delta interleave with the main session's, so one open slot per
    // stream is what keeps them from being paired across.
    const parent = stringAt(envelope, "parent_tool_use_id");
    const key = parent ?? "";

    if (inner["type"] === "message_start") {
      const message = asRecord(inner["message"]);
      this.#open.set(key, {
        messageId: stringAt(message, "id") ?? "",
        model: stringAt(message, "model") ?? "",
        contentBlocks: [],
      });
      return;
    }
    if (inner["type"] === "content_block_start") {
      const block = stringAt(asRecord(inner["content_block"]), "type");
      const open = this.#open.get(key);
      if (open !== undefined && block !== null) open.contentBlocks.push(block);
      return;
    }
    if (inner["type"] !== "message_delta") return;

    const open = this.#open.get(key);
    this.#open.delete(key);
    const usage = readUsage(inner["usage"]);
    const details = asRecord(asRecord(inner["usage"])?.["output_tokens_details"]);
    this.#turns.push({
      index: this.#turns.length,
      message_id: open?.messageId ?? "",
      model: open?.model ?? "",
      parent_tool_use_id: parent,
      ...usage,
      thinking_tokens: numberAt(details, "thinking_tokens"),
      stop_reason: stringAt(asRecord(inner["delta"]), "stop_reason"),
      content_blocks: open?.contentBlocks ?? [],
    });
  }

  /** Feeds a whole stdout buffer. Convenience for tests and for replaying a saved capture. */
  pushAll(text: string): void {
    for (const line of text.split("\n")) this.push(line);
  }

  ledger(): TurnLedger {
    const turnTotal = this.#turns.reduce<UsageTotals>(addUsage, ZERO_USAGE);
    const sessionTotal = readUsage(this.#result?.usage);
    return {
      turns: this.#turns,
      turn_total: turnTotal,
      session_total: sessionTotal,
      reconciled: usageEquals(turnTotal, sessionTotal),
      unparsed_lines: this.#unparsed,
    };
  }
}
