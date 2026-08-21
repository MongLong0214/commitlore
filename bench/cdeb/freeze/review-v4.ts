/**
 * CDEB-Fresh v4 Stage 0 adjudicated review.
 *
 * Three of the qualification gates are readings, not computations, and the
 * preregistration answers them with paired reviewers who are blind to each
 * other and, where possible, from different model families. This module builds
 * what those reviewers see, checks what they return, and merges two verdicts
 * into one with the disagreement preserved rather than averaged away.
 *
 * Two evidence sets, because two questions cannot share one:
 *
 *   Stage A asks whether the ruling is recoverable from ordinary source. The
 *   reviewer must therefore never see the ruling, or the question answers
 *   itself.
 *
 *   Stage B asks whether the rejected path is hidden, viable and bounded. That
 *   cannot be judged without the ruling, so Stage B sees it.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { V4CandidateEntry } from "./census-v4.ts";
import type { ProvenanceAuditEntry } from "./provenance-v4.ts";

export const REVIEW_STAGES = ["A", "B"] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

export interface StageAItem {
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly changed_paths: readonly string[];
  readonly files_changed: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly ordinary_source: string;
}

export interface StageBItem extends StageAItem {
  readonly ruling: string;
  readonly reason: string;
}

export interface StageAVerdict {
  readonly candidate_id: string;
  readonly states_rejected_alternative: boolean;
  readonly quoted_alternative: string;
  readonly quoted_reason: string;
  readonly note: string;
}

export interface StageBVerdict {
  readonly candidate_id: string;
  readonly g3_reason_hidden_from_code: boolean;
  readonly g4_wrong_path_functionally_viable: boolean;
  readonly g5_oracle_deterministic: boolean;
  readonly g7_bounded_task_feasible: boolean;
  readonly note: string;
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);

/**
 * Stage A evidence. The ruling, the reason, the record and the anchor are all
 * absent by construction: this builds from the redacted packet only, so there
 * is no field a future edit could accidentally populate with the answer.
 */
export const buildStageA = (audit: readonly ProvenanceAuditEntry[]): StageAItem[] =>
  audit
    .filter((entry) => entry.mechanical_exclusion === null)
    .map((entry) => ({
      candidate_id: entry.candidate_id,
      repository_id: entry.repository_id,
      changed_paths: entry.changed_paths.slice(0, 40),
      files_changed: entry.files_changed,
      insertions: entry.insertions,
      deletions: entry.deletions,
      ordinary_source: entry.ordinary_source,
    }));

export const buildStageB = (
  audit: readonly ProvenanceAuditEntry[],
  candidates: readonly V4CandidateEntry[],
  rulings: ReadonlyMap<string, { ruling: string; reason: string }>,
): StageBItem[] => {
  const byId = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  return buildStageA(audit).map((item) => {
    const candidate = byId.get(item.candidate_id);
    const ruling = rulings.get(item.candidate_id);
    if (candidate === undefined || ruling === undefined) {
      throw new Error(`review v4: no ruling text for candidate ${item.candidate_id}`);
    }
    // The reviewer is given the ruling but never the anchor: a reviewer who can
    // see the anchor could tell which decisions the benchmark is tracking.
    return { ...item, ruling: ruling.ruling, reason: ruling.reason };
  });
};

export const batch = <T>(items: readonly T[], size: number): T[][] => {
  if (size <= 0) throw new Error("review v4: batch size must be positive");
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
};

/**
 * Silence is not coverage.
 *
 * A reviewer that answers three of ten and says nothing about the rest looks
 * identical, at the response level, to one that answered all ten and found
 * seven unremarkable. So every response must account for its whole batch: the
 * judged set plus the declined set has to equal what was handed over, and an
 * id that was never handed over is a fabrication rather than extra diligence.
 */
export const assertCoversBatch = (
  batchIds: readonly string[],
  judged: readonly string[],
  declined: readonly string[],
  where: string,
): void => {
  const expected = new Set(batchIds);
  const seen = new Set([...judged, ...declined]);
  const invented = [...seen].filter((id) => !expected.has(id)).sort();
  if (invented.length > 0) {
    throw new Error(`review v4: ${where} returned ids that were not in the batch: ${invented.join(", ")}`);
  }
  const missing = [...expected].filter((id) => !seen.has(id)).sort();
  if (missing.length > 0) {
    throw new Error(`review v4: ${where} left ${String(missing.length)} candidate(s) unaccounted for: ${missing.join(", ")}`);
  }
  const duplicated = judged.filter((id) => declined.includes(id));
  if (duplicated.length > 0) {
    throw new Error(`review v4: ${where} both judged and declined ${duplicated.join(", ")}`);
  }
};

export const parseStageAResponse = (text: string, batchIds: readonly string[], where: string): StageAVerdict[] => {
  const parsed = parseJsonPayload(text, where);
  const verdicts = asArray(parsed.verdicts, `${where} verdicts`).map((raw) => {
    if (!isRecord(raw)) throw new Error(`review v4: ${where} verdict is not an object`);
    return {
      candidate_id: requireString(raw.candidate_id, `${where} candidate_id`),
      states_rejected_alternative: requireBoolean(raw.states_rejected_alternative, `${where} states_rejected_alternative`),
      quoted_alternative: String(raw.quoted_alternative ?? ""),
      quoted_reason: String(raw.quoted_reason ?? ""),
      note: String(raw.note ?? ""),
    };
  });
  const declined = asArray(parsed.declined ?? [], `${where} declined`).map((raw) => requireString(raw, `${where} declined id`));
  assertCoversBatch(batchIds, verdicts.map((verdict) => verdict.candidate_id), declined, where);
  return verdicts;
};

export const parseStageBResponse = (text: string, batchIds: readonly string[], where: string): StageBVerdict[] => {
  const parsed = parseJsonPayload(text, where);
  const verdicts = asArray(parsed.verdicts, `${where} verdicts`).map((raw) => {
    if (!isRecord(raw)) throw new Error(`review v4: ${where} verdict is not an object`);
    return {
      candidate_id: requireString(raw.candidate_id, `${where} candidate_id`),
      g3_reason_hidden_from_code: requireBoolean(raw.g3_reason_hidden_from_code, `${where} g3`),
      g4_wrong_path_functionally_viable: requireBoolean(raw.g4_wrong_path_functionally_viable, `${where} g4`),
      g5_oracle_deterministic: requireBoolean(raw.g5_oracle_deterministic, `${where} g5`),
      g7_bounded_task_feasible: requireBoolean(raw.g7_bounded_task_feasible, `${where} g7`),
      note: String(raw.note ?? ""),
    };
  });
  const declined = asArray(parsed.declined ?? [], `${where} declined`).map((raw) => requireString(raw, `${where} declined id`));
  assertCoversBatch(batchIds, verdicts.map((verdict) => verdict.candidate_id), declined, where);
  return verdicts;
};

const requireString = (value: unknown, where: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`review v4: ${where} must be a non-empty string`);
  return value;
};

const requireBoolean = (value: unknown, where: string): boolean => {
  // A reviewer that returns "unknown" has not answered. Coercing it to false
  // would record a decision nobody made, so it is refused.
  if (typeof value !== "boolean") throw new Error(`review v4: ${where} must be true or false, received ${JSON.stringify(value)}`);
  return value;
};

const asArray = (value: unknown, where: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`review v4: ${where} must be an array`);
  return value;
};

/** Tolerates a fenced block around the JSON; refuses anything else. */
export const parseJsonPayload = (text: string, where: string): Record<string, unknown> => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`review v4: ${where} returned no JSON object`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch (error) {
    throw new Error(`review v4: ${where} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error(`review v4: ${where} returned JSON that is not an object`);
  return parsed;
};

export interface MergedGateVerdict {
  readonly candidate_id: string;
  readonly gate: string;
  readonly reviewer_a: boolean;
  readonly reviewer_b: boolean;
  readonly agreed: boolean;
  readonly resolved: boolean | null;
  readonly resolution: "agreement" | "adjudicated" | "unresolved";
}

/**
 * Merge without averaging. Agreement resolves; disagreement stays a
 * disagreement until an adjudicator supplies a value, and an unresolved
 * disagreement fails closed at the qualification step rather than being
 * rounded into a pass.
 */
export const mergeGate = (
  candidateId: string,
  gate: string,
  reviewerA: boolean,
  reviewerB: boolean,
  adjudicated?: boolean,
): MergedGateVerdict => {
  if (reviewerA === reviewerB) {
    return { candidate_id: candidateId, gate, reviewer_a: reviewerA, reviewer_b: reviewerB, agreed: true, resolved: reviewerA, resolution: "agreement" };
  }
  if (adjudicated === undefined) {
    return { candidate_id: candidateId, gate, reviewer_a: reviewerA, reviewer_b: reviewerB, agreed: false, resolved: null, resolution: "unresolved" };
  }
  return { candidate_id: candidateId, gate, reviewer_a: reviewerA, reviewer_b: reviewerB, agreed: false, resolved: adjudicated, resolution: "adjudicated" };
};

export const agreementRate = (merged: readonly MergedGateVerdict[]): number =>
  merged.length === 0 ? 1 : merged.filter((verdict) => verdict.agreed).length / merged.length;

export const packetDigest = (items: readonly unknown[]): string => sha256(JSON.stringify(items));
