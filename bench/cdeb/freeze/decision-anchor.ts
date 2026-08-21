import { createHash } from "node:crypto";

/**
 * A benchmark-internal identity for a historical repository decision.
 *
 * It exists because the v4 estimand is delivery of a prior decision rather than
 * delivery of a product `Record-Id`, and legacy-era decisions predate that
 * field entirely. Something still has to bind a source decision to its gold and
 * to its delivery evidence, so the benchmark computes its own key from what the
 * frozen history already contains.
 *
 * What it is not: it is not a product identifier, it is never written back to
 * any repository, it never appears in a payload the coding agent can read, and
 * it is not a backfill -- nothing here is added to history, only read from it.
 */

export const STORAGE_KINDS = ["commit-trailer", "git-note", "ordinary-source"] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];

export const DECISION_LIFECYCLES = ["active", "superseded", "withdrawn"] as const;
export type DecisionLifecycle = (typeof DECISION_LIFECYCLES)[number];

export interface DecisionAnchorInput {
  readonly repository_id: string;
  readonly snapshot_sha: string;
  readonly source_commit_sha: string;
  readonly storage_kind: StorageKind;
  readonly storage_locator: string;
  readonly decision_ordinal: number;
  readonly normalized_decision_sha256: string;
  readonly normalized_reason_sha256: string;
  readonly path_scope: readonly string[];
  readonly lifecycle: DecisionLifecycle;
}

/**
 * Every field is load-bearing, so the order is fixed here rather than derived
 * from whatever object a caller happens to pass. Adding a field to the type
 * without adding it here would leave it out of the hash silently.
 */
export const DECISION_ANCHOR_FIELDS = [
  "decision_ordinal",
  "lifecycle",
  "normalized_decision_sha256",
  "normalized_reason_sha256",
  "path_scope",
  "repository_id",
  "snapshot_sha",
  "source_commit_sha",
  "storage_kind",
  "storage_locator",
] as const;

const GIT_OID = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const refuse = (message: string): never => {
  throw new Error(`decision anchor: ${message}`);
};

/**
 * Whitespace normalization, and nothing more. The same decision text reflowed
 * by a different renderer must anchor identically; different words must not.
 * Case, punctuation and word order all survive, because all three carry the
 * judgment this benchmark is about.
 */
export const normalizeDecisionText = (text: string): string =>
  text.normalize("NFC").replace(/\s+/gu, " ").trim();

export const decisionTextSha256 = (text: string): string =>
  createHash("sha256").update(normalizeDecisionText(text), "utf8").digest("hex");

export const assertDecisionAnchorInput = (value: unknown): DecisionAnchorInput => {
  if (!isRecord(value)) refuse("input must be an object");
  const input = value as Record<string, unknown>;
  const extra = Object.keys(input).filter((key) => !(DECISION_ANCHOR_FIELDS as readonly string[]).includes(key));
  if (extra.length > 0) {
    // An unknown key is either a field that should be in the hash or a field
    // that should not exist. Both are the caller's mistake, and ignoring it
    // would produce an anchor that omits something a reader assumes it covers.
    refuse(`unknown field(s) ${extra.sort().join(", ")}`);
  }
  for (const field of DECISION_ANCHOR_FIELDS) {
    if (!(field in input)) refuse(`missing field ${field}`);
  }
  if (typeof input.repository_id !== "string" || input.repository_id.trim() === "") refuse("repository_id must be a non-empty string");
  if (typeof input.snapshot_sha !== "string" || !GIT_OID.test(input.snapshot_sha)) refuse("snapshot_sha must be a 40-character git object id");
  if (typeof input.source_commit_sha !== "string" || !GIT_OID.test(input.source_commit_sha)) refuse("source_commit_sha must be a 40-character git object id");
  if (typeof input.storage_kind !== "string" || !(STORAGE_KINDS as readonly string[]).includes(input.storage_kind)) refuse(`storage_kind must be one of ${STORAGE_KINDS.join(", ")}`);
  if (typeof input.storage_locator !== "string" || input.storage_locator.trim() === "") refuse("storage_locator must be a non-empty string");
  if (typeof input.decision_ordinal !== "number" || !Number.isInteger(input.decision_ordinal) || input.decision_ordinal < 0) refuse("decision_ordinal must be a non-negative integer");
  if (typeof input.normalized_decision_sha256 !== "string" || !SHA256.test(input.normalized_decision_sha256)) refuse("normalized_decision_sha256 must be a sha256 hex digest");
  if (typeof input.normalized_reason_sha256 !== "string" || !SHA256.test(input.normalized_reason_sha256)) refuse("normalized_reason_sha256 must be a sha256 hex digest");
  if (!Array.isArray(input.path_scope) || input.path_scope.length === 0) refuse("path_scope must be a non-empty array");
  const scope = input.path_scope as unknown[];
  for (const entry of scope) {
    if (typeof entry !== "string" || entry.trim() === "") refuse("path_scope entries must be non-empty strings");
  }
  if (new Set(scope as string[]).size !== scope.length) refuse("path_scope must not repeat a path");
  if (typeof input.lifecycle !== "string" || !(DECISION_LIFECYCLES as readonly string[]).includes(input.lifecycle)) refuse(`lifecycle must be one of ${DECISION_LIFECYCLES.join(", ")}`);
  return input as unknown as DecisionAnchorInput;
};

/**
 * Deterministic serialization: fixed key order, sorted scope, no whitespace.
 * `path_scope` is a set of paths -- listing the same two paths in the other
 * order describes the same scope, so it must anchor the same. Adding or
 * removing one does not.
 */
export const canonicalDecisionAnchorJson = (value: unknown): string => {
  const input = assertDecisionAnchorInput(value);
  const parts = DECISION_ANCHOR_FIELDS.map((field) => {
    const raw = field === "path_scope" ? [...input.path_scope].sort() : input[field];
    return `${JSON.stringify(field)}:${JSON.stringify(raw)}`;
  });
  return `{${parts.join(",")}}`;
};

export const computeDecisionAnchor = (value: unknown): string =>
  createHash("sha256").update(canonicalDecisionAnchorJson(value), "utf8").digest("hex");

/**
 * The exposure check. The anchor is benchmark-side evidence; a payload the
 * coding agent can read must not contain it, because an agent that can see the
 * anchor can tell which decisions the benchmark is watching.
 */
export const assertNoDecisionAnchorExposure = (
  payload: string,
  anchors: readonly string[],
  where: string,
): void => {
  for (const anchor of anchors) {
    if (!SHA256.test(anchor)) refuse(`exposure check received a value that is not an anchor: ${anchor}`);
    if (payload.includes(anchor)) {
      throw new Error(`decision anchor exposure: anchor ${anchor.slice(0, 12)} appears in ${where}`);
    }
  }
};
