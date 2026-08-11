/**
 * CDEB-03 fail-closed capability gate (PRD §7.5) and identity checks (PRD §8).
 *
 * A benchmark whose isolation silently degrades measures a different thing than
 * it reports — that is the defect `docs/SELF-AUDIT.md` keeps the receipt for,
 * and it is why nothing in this module can warn. Every capability §7.5 names
 * is checked at run time, and any capability that cannot be verified refuses:
 * the measured run does not start. The gate has two states — passed, or
 * thrown — and the type system does not contain a third.
 *
 * The checks split in two:
 *
 *   - `assertRuntimeCapabilities` is the preflight gate. It consumes a probe
 *     report — one observation per capability — and refuses when a probe
 *     failed OR when a capability was never probed at all. Absence of
 *     evidence is refusal, not optimism: a report that simply omits the
 *     network policy has not shown the network policy.
 *   - `verifyStreamIdentity` is the in-run identity check. The model that
 *     answered must be the model that was pinned, on every main-session turn,
 *     and the CLI that ran must be the CLI that was pinned. Drift is a hard
 *     stop (§8: preflight observed model mismatch stops the study), not a
 *     flag on the row.
 *
 * Both are pure: probes and streams are data, so the failure paths are
 * testable without a container runtime. `agent-container.ts` owns producing
 * the data on a real machine.
 */

import { createHash } from "node:crypto";

import { StreamJsonReader } from "../../drivers/stream-json.ts";

// ---------------------------------------------------------------------------
// Capabilities (§7.5, plus the §7.2 container/HOME guarantees the list rests on)
// ---------------------------------------------------------------------------

export const CAPABILITY_IDS = [
  /** Container runtime binary present and its daemon answering. */
  "oci-runtime",
  /** The image exists locally at exactly the pinned digest (§7.1). */
  "image-pin",
  /** Agent CLI and node binaries/versions match the pinned hashes (§8). */
  "executable-identity",
  /** Fresh isolated HOME; no host HOME content; only the expected mounts (§7.2). */
  "home-isolation",
  /** Host/user/project/local settings sources dropped; harness file is the only one (§7.2). */
  "settings-isolation",
  /** Strict MCP config active and zero servers observable (§7.2, §7.5). */
  "mcp-isolation",
  /** No session or memory state survives a run (§7.2, §7.5). */
  "session-isolation",
  /** The session's tool set is exactly the frozen policy (§7.3). */
  "tool-policy",
  /** Provider-only egress enforced and verified (§7.4). */
  "network-policy",
  /** Observed model id present, matches the pin, identical across turns (§8). */
  "model-observation",
  /** The raw stream carries the authoritative per-turn usage events CDEB-05 parses (§7.5). */
  "raw-usage-stream",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** One probe observation. `detail` names what was seen, or what is missing. */
export interface CapabilityProbe {
  readonly capability: CapabilityId;
  readonly ok: boolean;
  readonly detail: string;
}

export class RuntimeCapabilityError extends Error {
  /** Capabilities whose probe reported a failure. */
  readonly failed: readonly CapabilityId[];
  /** Capabilities with no probe at all — never verified, so refused. */
  readonly untested: readonly CapabilityId[];

  constructor(failedProbes: readonly CapabilityProbe[], untested: readonly CapabilityId[]) {
    const failedNames = failedProbes.map((probe) => probe.capability);
    const parts: string[] = [];
    if (failedNames.length > 0) {
      parts.push(
        `failed: ${failedProbes
          .map((probe) => `${probe.capability} (${probe.detail})`)
          .join("; ")}`,
      );
    }
    if (untested.length > 0) parts.push(`never probed: ${untested.join(", ")}`);
    super(`runtime capability gate refused — ${parts.join(" | ")}`);
    this.name = "RuntimeCapabilityError";
    this.failed = failedNames;
    this.untested = untested;
  }
}

/**
 * Proof that the gate passed for one specific pin. `executeAgentRun` requires
 * this token and refuses a token minted for any other pin, so "start a run
 * without the capability check" is not expressible — the only way to obtain a
 * token is a complete, all-green probe report.
 */
export interface CapabilityGatePassed {
  readonly gate: "cdeb-runtime-capabilities";
  readonly pin_digest: string;
  readonly verified: readonly CapabilityId[];
}

/**
 * §7.5: hard refusal, never warn-and-continue. A duplicate probe is a
 * malformed report and refuses too — two observations for one capability is
 * not something the gate silently picks between.
 */
export const assertRuntimeCapabilities = (
  probes: readonly CapabilityProbe[],
  pinDigest: string,
): CapabilityGatePassed => {
  const seen = new Set<CapabilityId>();
  const duplicates: CapabilityId[] = [];
  for (const probe of probes) {
    if (seen.has(probe.capability)) duplicates.push(probe.capability);
    seen.add(probe.capability);
  }
  const failed = probes.filter((probe) => !probe.ok);
  const untested = CAPABILITY_IDS.filter((id) => !seen.has(id));
  if (duplicates.length > 0 || failed.length > 0 || untested.length > 0) {
    const withDuplicates: CapabilityProbe[] = [
      ...failed,
      ...duplicates.map((capability) => ({
        capability,
        ok: false,
        detail: "probe reported more than once; the gate does not pick between observations",
      })),
    ];
    throw new RuntimeCapabilityError(withDuplicates, untested);
  }
  return { gate: "cdeb-runtime-capabilities", pin_digest: pinDigest, verified: [...CAPABILITY_IDS] };
};

// ---------------------------------------------------------------------------
// Frozen policies and their digests (§7.3, §7.4, §8)
// ---------------------------------------------------------------------------

const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

/** Deterministic JSON: object keys sorted recursively, no whitespace variance. */
export const canonicalJson = (value: unknown): string => {
  const sort = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sort);
    if (typeof node === "object" && node !== null) {
      const source = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) out[key] = sort(source[key]);
      return out;
    }
    return node;
  };
  return JSON.stringify(sort(value));
};

export interface ToolPolicy {
  readonly allowed: readonly string[];
  readonly disallowed: readonly string[];
}

/**
 * §7.3 frozen tool set: the minimum for source read/search/edit/test, and
 * nothing else. Web search/fetch, subagent delegation, scheduling, messaging
 * and skill surfaces are named in `disallowed` so a CLI that grows a new
 * spelling of one still trips the init-event equality check against
 * `allowed` — the gate is exact-set equality, and this list documents what an
 * appearance in `allowed` would mean.
 */
export const FROZEN_TOOL_POLICY: ToolPolicy = {
  allowed: ["Bash", "Edit", "Glob", "Grep", "Read", "Write"],
  disallowed: [
    "WebSearch",
    "WebFetch",
    "Task",
    "TaskCreate",
    "TaskGet",
    "TaskList",
    "TaskOutput",
    "TaskStop",
    "TaskUpdate",
    "Agent",
    "Skill",
    "SendMessage",
    "Workflow",
    "ToolSearch",
    "Monitor",
    "RemoteTrigger",
    "PushNotification",
    "ReportFindings",
    "CronCreate",
    "CronDelete",
    "CronList",
    "ScheduleWakeup",
    "EnterWorktree",
    "ExitWorktree",
    "DesignSync",
  ],
};

/** sha256 over the canonical policy; recorded on every row (§8). */
export const toolPolicyDigest = (policy: ToolPolicy): string =>
  sha256Hex(canonicalJson({ allowed: [...policy.allowed], disallowed: [...policy.disallowed] }));

export interface NetworkPolicy {
  /** The only egress shape the study accepts. */
  readonly egress: "provider-only";
  /**
   * The agent container sits on an internal docker network with no external
   * route; the only way out is the allowlist proxy. Named in the digest so a
   * future enforcement change is a policy change, visible in every row.
   */
  readonly enforcement: "internal-network+allowlist-proxy";
  readonly allowed_hosts: readonly string[];
  readonly allowed_port: number;
}

export const networkPolicyDigest = (policy: NetworkPolicy): string =>
  sha256Hex(canonicalJson(policy));

/** Digests of the exact bytes the harness writes — never of inherited files. */
export const settingsDigest = (settingsJson: string): string => sha256Hex(settingsJson);
export const mcpConfigDigest = (mcpJson: string): string => sha256Hex(mcpJson);

/** The empty MCP config both arms receive (§7.2). */
export const EMPTY_MCP_CONFIG = JSON.stringify({ mcpServers: {} });

// ---------------------------------------------------------------------------
// Stream identity: the model that answered is the model that was pinned (§8)
// ---------------------------------------------------------------------------

export class ModelDriftError extends Error {
  constructor(detail: string) {
    super(`model identity hard stop — ${detail}`);
    this.name = "ModelDriftError";
  }
}

export class CliDriftError extends Error {
  constructor(detail: string) {
    super(`CLI identity hard stop — ${detail}`);
    this.name = "CliDriftError";
  }
}

export class ToolPolicyViolationError extends Error {
  constructor(detail: string) {
    super(`tool policy hard stop — ${detail}`);
    this.name = "ToolPolicyViolationError";
  }
}

/** The subset of the init event the identity checks read. */
export interface InitObservation {
  readonly model: string | null;
  readonly tools: readonly string[] | null;
  readonly mcp_servers: readonly string[] | null;
  readonly cli_version: string | null;
  readonly permission_mode: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Extracts the init event from a raw stream; null when the stream has none. */
export const readInitEvent = (ndjson: string): InitObservation | null => {
  for (const line of ndjson.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const envelope = asRecord(event);
    if (envelope === null) continue;
    if (envelope["type"] !== "system" || envelope["subtype"] !== "init") continue;
    const toolsRaw = envelope["tools"];
    const mcpRaw = envelope["mcp_servers"];
    // Any entry counts as a server: a non-string entry is named "(unknown)"
    // rather than filtered away, because isolation fails closed on presence,
    // not on whether the entry parsed cleanly.
    const mcpNames = Array.isArray(mcpRaw)
      ? mcpRaw.map((entry) => {
          if (typeof entry === "string") return entry;
          const record = asRecord(entry);
          return record !== null && typeof record["name"] === "string"
            ? (record["name"] as string)
            : "(unknown)";
        })
      : null;
    return {
      model: typeof envelope["model"] === "string" ? envelope["model"] : null,
      tools: Array.isArray(toolsRaw) ? toolsRaw.filter((t): t is string => typeof t === "string") : null,
      mcp_servers: mcpNames,
      cli_version:
        typeof envelope["claude_code_version"] === "string" ? envelope["claude_code_version"] : null,
      permission_mode:
        typeof envelope["permissionMode"] === "string" ? envelope["permissionMode"] : null,
    };
  }
  return null;
};

export interface StreamPin {
  /** Exact model id every main-session turn must carry (§8). */
  readonly expected_observed_model: string;
  /** Exact CLI version the init event must report (§8). */
  readonly agent_cli_version: string;
  readonly permission_mode: string;
  readonly tool_policy: ToolPolicy;
}

export interface StreamIdentity {
  /** Unique observed model ids in first-seen order — one element when valid. */
  readonly observed_model_ids: readonly string[];
  readonly agent_cli_version: string;
  readonly turn_count: number;
}

/**
 * §8 rules, enforced as hard stops:
 *
 *   - observed model id identical on every main-session turn, never empty;
 *   - no subagent turn anywhere (`parent_tool_use_id != null` rejects, §7.3);
 *   - init model and CLI version equal the pin (CLI drift stops the study);
 *   - init tool set exactly the frozen policy, and no MCP server present;
 *   - permission mode equal the pin.
 *
 * Returns the identity the row records when every rule holds.
 */
export const verifyStreamIdentity = (ndjson: string, pin: StreamPin): StreamIdentity => {
  const init = readInitEvent(ndjson);
  if (init === null) {
    throw new ModelDriftError("stream carries no init event; the session cannot be identified");
  }
  if (init.cli_version !== pin.agent_cli_version) {
    throw new CliDriftError(
      `init reports CLI ${init.cli_version === null ? "(none)" : init.cli_version} ` +
        `but the study is pinned to ${pin.agent_cli_version}`,
    );
  }
  if (init.model !== pin.expected_observed_model) {
    throw new ModelDriftError(
      `init reports model ${init.model === null ? "(none)" : init.model} ` +
        `but the study is pinned to ${pin.expected_observed_model}`,
    );
  }
  if (init.permission_mode !== pin.permission_mode) {
    throw new ToolPolicyViolationError(
      `init reports permission mode ${init.permission_mode === null ? "(none)" : init.permission_mode} ` +
        `but the pin freezes ${pin.permission_mode}`,
    );
  }
  if (init.mcp_servers === null || init.mcp_servers.length > 0) {
    throw new ToolPolicyViolationError(
      `init reports MCP servers ${JSON.stringify(init.mcp_servers ?? "absent")} — strict isolation requires exactly none`,
    );
  }
  if (init.tools === null) {
    throw new ToolPolicyViolationError("init reports no tool list; the tool policy cannot be verified");
  }
  const allowed = new Set(pin.tool_policy.allowed);
  const observed = new Set(init.tools);
  const extra = init.tools.filter((tool) => !allowed.has(tool));
  const missing = [...allowed].filter((tool) => !observed.has(tool));
  if (extra.length > 0 || missing.length > 0) {
    throw new ToolPolicyViolationError(
      `session tools diverge from the frozen policy — extra: [${extra.join(", ")}] missing: [${missing.join(", ")}]`,
    );
  }

  const reader = new StreamJsonReader();
  reader.pushAll(ndjson);
  const ledger = reader.ledger();

  const subagentTurn = ledger.turns.find((turn) => turn.parent_tool_use_id !== null);
  if (subagentTurn !== undefined) {
    throw new ModelDriftError(
      `turn ${String(subagentTurn.index)} was produced by a subagent (parent_tool_use_id ` +
        `${subagentTurn.parent_tool_use_id}) — §7.3 forbids delegation and §8 forbids the row`,
    );
  }
  if (ledger.turns.length === 0) {
    throw new ModelDriftError("stream carries no model turn; the model that answered is unknown");
  }

  const observedIds: string[] = [];
  for (const turn of ledger.turns) {
    if (turn.model === "") {
      throw new ModelDriftError(`turn ${String(turn.index)} reports an empty model id — §8 forbids the row`);
    }
    if (turn.model !== pin.expected_observed_model) {
      throw new ModelDriftError(
        `turn ${String(turn.index)} was answered by ${turn.model} but the study is pinned to ` +
          `${pin.expected_observed_model} — model drift stops the study`,
      );
    }
    if (!observedIds.includes(turn.model)) observedIds.push(turn.model);
  }

  return {
    observed_model_ids: observedIds,
    agent_cli_version: init.cli_version,
    turn_count: ledger.turns.length,
  };
};

/**
 * §7.5 raw usage stream: CDEB-05's ledger reads final per-turn usage from
 * `message_delta` events, which exist only under `--include-partial-messages`.
 * A stream without them cannot produce a reconciled ledger, so the capability
 * fails before any run is measured on it.
 */
export const streamHasAuthoritativeUsage = (ndjson: string): boolean => {
  for (const line of ndjson.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const envelope = asRecord(event);
    if (envelope === null || envelope["type"] !== "stream_event") continue;
    const inner = asRecord(envelope["event"]);
    if (inner === null || inner["type"] !== "message_delta") continue;
    if (asRecord(inner["usage"]) !== null) return true;
  }
  return false;
};
