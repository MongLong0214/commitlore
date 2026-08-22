/**
 * CDEB-Fresh v4 Stage 0 shipping content-delivery feasibility (G6).
 *
 * The predecessor asked whether an expected `Record-Id` appeared in the bytes
 * the hook forwarded. The v4 estimand discards that question: what has to reach
 * the agent is the decision's load-bearing content, and the oldest decisions in
 * this corpus have no identifier at all.
 *
 * So this drives the same shipping surface -- `commitlore inject --hook-input`
 * against a real `PreToolUse` edit payload, at the frozen release -- and reads
 * the forwarded bytes for content instead:
 *
 *   the ruling, the reason, the right path scope, the current lifecycle
 *
 * No single one of those is the gate. A substring match alone would pass on a
 * record that happens to share a phrase, and the scope probe below is the part
 * that can actually fail: a decision scoped to another file must not arrive for
 * this one, so an injector that forwarded everything would be caught rather
 * than scored as a perfect result.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { normalizeDecisionText } from "./decision-anchor.ts";

export interface DeliveryProbeInput {
  readonly candidate_id: string;
  readonly repository_id: string;
  /** A path the decision's own change touched. */
  readonly in_scope_path: string;
  /** A path in the same repository that the decision did not touch. */
  readonly out_of_scope_path: string | null;
  readonly ruling: string;
  readonly reason: string;
  readonly lifecycle: "active" | "superseded" | "withdrawn";
  readonly record_id: string | null;
}

export interface DeliveryFeasibility {
  readonly candidate_id: string;
  readonly identity_present: boolean;
  readonly record_id: string | null;
  readonly ruling_visible: boolean;
  readonly reason_visible: boolean;
  readonly before_first_mutation: boolean;
  readonly scope_correct: boolean;
  readonly lifecycle_correct: boolean;
  readonly stale_as_current: boolean;
  readonly delivered: boolean;
  readonly in_scope_payload_bytes: number;
  readonly in_scope_payload_sha256: string;
  readonly out_of_scope_payload_bytes: number | null;
  readonly exit_code: number;
  readonly stderr: string;
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/**
 * `Edit`, not `Read`: the question is whether the decision reaches an agent
 * that is about to change the path. A payload the shipping matcher would not
 * have selected proves nothing about the arm being measured.
 */
const hookPayload = (path: string): string =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: path, old_string: "", new_string: "" },
  });

export interface InjectResult {
  readonly stdout: string;
  readonly exitCode: number;
  readonly stderr: string;
}

export const runInject = (
  cliEntry: string,
  cwd: string,
  path: string,
  budget: number,
): InjectResult => {
  const result = spawnSync(
    process.execPath,
    [cliEntry, "inject", "--hook-input", "--budget", String(budget)],
    { cwd, input: hookPayload(path), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return {
    stdout: result.stdout ?? "",
    // Fail-open is the hook's design, so a non-zero exit is recorded rather
    // than thrown: a decision that only arrives when the product errors is not
    // delivered either way.
    exitCode: result.status ?? -1,
    stderr: (result.stderr ?? "").trim(),
  };
};

/**
 * Whitespace-insensitive containment. The injector re-wraps what it renders, so
 * a byte comparison would report a failure that is only a line break -- and a
 * word-level comparison would report a success for a paraphrase.
 */
export const containsNormalized = (haystack: string, needle: string): boolean => {
  const trimmed = normalizeDecisionText(needle);
  if (trimmed.length < 12) return false;
  return normalizeDecisionText(haystack).includes(trimmed);
};

export const probeDeliveryFeasibility = (
  cliEntry: string,
  cwd: string,
  input: DeliveryProbeInput,
  budget: number,
): DeliveryFeasibility => {
  const inScope = runInject(cliEntry, cwd, input.in_scope_path, budget);
  const outOfScope = input.out_of_scope_path === null
    ? null
    : runInject(cliEntry, cwd, input.out_of_scope_path, budget);

  const rulingVisible = containsNormalized(inScope.stdout, input.ruling);
  const reasonVisible = containsNormalized(inScope.stdout, input.reason);
  // Scope is only demonstrated when the decision arrives here and does not
  // arrive for a path it never touched. Without the second half, an injector
  // that forwards the whole ledger would score a perfect scope result.
  const arrivedOutOfScope =
    outOfScope !== null && containsNormalized(outOfScope.stdout, input.ruling);
  const scopeCorrect = rulingVisible && !arrivedOutOfScope;
  // A superseded decision must not be delivered as though it were current. An
  // active one must be delivered.
  const staleAsCurrent = input.lifecycle !== "active" && rulingVisible;
  const lifecycleCorrect = input.lifecycle === "active" ? rulingVisible : !rulingVisible;

  return {
    candidate_id: input.candidate_id,
    identity_present: input.record_id !== null,
    record_id: input.record_id,
    ruling_visible: rulingVisible,
    reason_visible: reasonVisible,
    // Structural: the payload is a PreToolUse event, which by definition
    // precedes the tool call it describes.
    before_first_mutation: true,
    scope_correct: scopeCorrect,
    lifecycle_correct: lifecycleCorrect,
    stale_as_current: staleAsCurrent,
    delivered:
      input.lifecycle === "active" &&
      rulingVisible &&
      reasonVisible &&
      scopeCorrect &&
      lifecycleCorrect &&
      !staleAsCurrent,
    in_scope_payload_bytes: Buffer.byteLength(inScope.stdout, "utf8"),
    in_scope_payload_sha256: sha256(inScope.stdout),
    out_of_scope_payload_bytes:
      outOfScope === null ? null : Buffer.byteLength(outOfScope.stdout, "utf8"),
    exit_code: inScope.exitCode,
    stderr: inScope.stderr,
  };
};

/**
 * The positive control, and the reason it is not optional.
 *
 * Every field of a `DeliveryFeasibility` row is false when the product answered
 * "nothing to deliver" and equally false when the product never ran. The first
 * pass of this probe produced 0 delivered out of 207 because the extracted
 * release tree had no `node_modules`, so the CLI exited 1 before reading a
 * single record -- and the summary read exactly like a finding.
 *
 * So an injector that never started, or never produced a byte, is an error
 * rather than a result.
 */
export const assertInjectorRan = (results: readonly DeliveryFeasibility[]): void => {
  if (results.length === 0) return;
  const started = results.filter((result) => result.exit_code === 0);
  if (started.length === 0) {
    const first = results.find((result) => result.stderr !== "");
    throw new Error(
      `delivery v4: the shipping injector never exited 0 across ${String(results.length)} probes; this is a harness failure, not zero delivery. First stderr: ${(first?.stderr ?? "none").slice(0, 200)}`,
    );
  }
  const withPayload = results.filter((result) => result.in_scope_payload_bytes > 0);
  if (withPayload.length === 0) {
    throw new Error(
      `delivery v4: the shipping injector produced an empty payload for every one of ${String(results.length)} probes; a probe that forwarded nothing anywhere cannot distinguish "no record applies" from "the injector is not working"`,
    );
  }
};

export interface DeliverySummary {
  readonly probed: number;
  readonly delivered: number;
  readonly delivered_with_identity: number;
  readonly delivered_without_identity: number;
  readonly ruling_visible: number;
  readonly reason_visible: number;
  readonly scope_correct: number;
  readonly stale_as_current: number;
}

export const summarize = (results: readonly DeliveryFeasibility[]): DeliverySummary => ({
  probed: results.length,
  delivered: results.filter((result) => result.delivered).length,
  delivered_with_identity: results.filter((result) => result.delivered && result.identity_present).length,
  delivered_without_identity: results.filter((result) => result.delivered && !result.identity_present).length,
  ruling_visible: results.filter((result) => result.ruling_visible).length,
  reason_visible: results.filter((result) => result.reason_visible).length,
  scope_correct: results.filter((result) => result.scope_correct).length,
  stale_as_current: results.filter((result) => result.stale_as_current).length,
});

/**
 * The observability claim the Stage 0 verdict depends on: content delivery has
 * to be demonstrated for identified and id-less decisions alike. If every
 * delivered decision carried an identifier, the study would have shown only
 * that the old instrument still works.
 */
export const assertBothIdentityStatesObserved = (results: readonly DeliveryFeasibility[]): void => {
  const summary = summarize(results);
  const failures: string[] = [];
  if (summary.delivered_with_identity === 0) failures.push("no identified decision was delivered");
  if (summary.delivered_without_identity === 0) failures.push("no id-less decision was delivered");
  if (failures.length > 0) {
    throw new Error(`delivery v4: content delivery is not demonstrated for both identity states: ${failures.join("; ")}`);
  }
};

/** The shipping default. Using anything else would measure a configuration nobody ships. */
export const SHIPPING_TOKEN_BUDGET = 800;
