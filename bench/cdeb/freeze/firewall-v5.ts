/**
 * CDEB-Fresh v5 Stage 1-r1 gate G3: the task-author firewall.
 *
 * The whole anti-circularity argument rests on one claim: the maintenance task
 * was written by someone who had not read the decision. If that is false the
 * study measures whether a task built around a record is easier with the record
 * -- a tautology dressed as an effect.
 *
 * A promise cannot carry that claim, so this module makes it an artifact. The
 * task author's input set is enumerated and hashed; the manifest records what
 * went in, not what the author says they looked at. Two things then become
 * checkable after the fact:
 *
 *   allowed inputs   a forbidden key in the input set is a throw, so a manifest
 *                    naming the record is refused at write time
 *   ordering         the oracle is built from the record, so it must be built
 *                    *after* the task is frozen. The oracle manifest carries the
 *                    task manifest's digest; a task edited afterwards no longer
 *                    matches it
 *
 * What this cannot do is prove the author did not know the record from
 * somewhere else. That is why the input digest is over bytes and the leakage
 * check reads the finished task text as well: the second catches a record that
 * arrived by memory rather than by input.
 */

import { createHash } from "node:crypto";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Everything a record-blind task author is permitted to see (FINAL-PRD §4 G3). */
export const ALLOWED_TASK_AUTHOR_INPUTS = [
  "base_tree_oid",
  "repository_id",
  "snapshot_commit",
  "allowed_scope",
  "maintenance_need",
  "functional_acceptance",
] as const;

/**
 * Everything that would make the task a description of the record. These are
 * checked by key name because a manifest is written by the harness, and the
 * harness is the thing being audited.
 */
export const FORBIDDEN_TASK_AUTHOR_INPUTS = [
  "record",
  "record_text",
  "record_id",
  "decision",
  "decision_text",
  "ruled_out",
  "ruled_out_behavior",
  "reason",
  "decision_audit_anchor",
  "anchor",
  "gold",
  "gold_boundary",
  "bad_patch",
  "violation_patch",
  "reviewer_interpretation",
  "interpretation",
  "oracle",
] as const;

export interface TaskAuthorManifest {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v5";
  readonly stage: "stage1-r1";
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly phase: "record-blind-task";
  /** Ordinal within the candidate's build, so ordering is checkable without clocks. */
  readonly sequence: number;
  /** sha256 of each input's bytes, keyed by name. Keys must be allowed. */
  readonly inputs: Readonly<Record<string, string>>;
  /** sha256 of the frozen task text and acceptance criteria. */
  readonly task_digest: string;
  readonly acceptance_digest: string;
  readonly frozen_at: string;
}

export interface OracleBuildManifest {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v5";
  readonly stage: "stage1-r1";
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly phase: "record-aware-oracle";
  readonly sequence: number;
  /** The task manifest this oracle was built against, by digest. */
  readonly task_manifest_digest: string;
  readonly task_digest: string;
  readonly acceptance_digest: string;
  readonly oracle_digest: string;
  readonly frozen_at: string;
}

export type FirewallManifest = TaskAuthorManifest | OracleBuildManifest;

const FORBIDDEN_SET: ReadonlySet<string> = new Set(FORBIDDEN_TASK_AUTHOR_INPUTS);
const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_TASK_AUTHOR_INPUTS);

/** The digest a later oracle manifest must reproduce to prove the task was frozen first. */
export const taskManifestDigest = (manifest: TaskAuthorManifest): string =>
  sha256(
    [
      manifest.candidate_id,
      manifest.repository_id,
      manifest.sequence.toString(),
      Object.keys(manifest.inputs)
        .sort()
        .map((key) => `${key}=${manifest.inputs[key] ?? ""}`)
        .join("\n"),
      manifest.task_digest,
      manifest.acceptance_digest,
    ].join("|"),
  );

/**
 * Refuses a task-author input set that names anything record-derived, and
 * refuses one that names something not on the allow list -- an unregistered key
 * is an unaudited channel, which is the same defect as a forbidden one.
 */
export const assertTaskAuthorInputsAllowed = (manifest: TaskAuthorManifest): void => {
  for (const key of Object.keys(manifest.inputs)) {
    if (FORBIDDEN_SET.has(key)) {
      throw new Error(
        `firewall: ${manifest.candidate_id}'s task author was given "${key}". A task written from the record ` +
          `is a description of the record, and the study would measure its own setup`,
      );
    }
    if (!ALLOWED_SET.has(key)) {
      throw new Error(
        `firewall: ${manifest.candidate_id}'s task author was given the unregistered input "${key}". ` +
          `Allowed inputs are ${ALLOWED_TASK_AUTHOR_INPUTS.join(", ")}`,
      );
    }
  }
  if (!("base_tree_oid" in manifest.inputs)) {
    throw new Error(`firewall: ${manifest.candidate_id}'s task manifest does not pin a base tree`);
  }
};

/**
 * The record-aware half must come second, and must be tied to the exact task it
 * came second to. An oracle built against a task that was later edited is an
 * oracle built against nothing.
 */
export const assertTaskFrozenBeforeOracle = (
  task: TaskAuthorManifest,
  oracle: OracleBuildManifest,
): void => {
  if (task.candidate_id !== oracle.candidate_id) {
    throw new Error(`firewall: manifests are for different candidates (${task.candidate_id} vs ${oracle.candidate_id})`);
  }
  if (oracle.sequence <= task.sequence) {
    throw new Error(
      `firewall: ${oracle.candidate_id}'s oracle was built at sequence ${String(oracle.sequence)}, ` +
        `not after the task at ${String(task.sequence)}. Record-aware construction may not precede the task freeze`,
    );
  }
  const expected = taskManifestDigest(task);
  if (oracle.task_manifest_digest !== expected) {
    throw new Error(
      `firewall: ${oracle.candidate_id}'s oracle references task manifest ${oracle.task_manifest_digest.slice(0, 12)} ` +
        `but the frozen task hashes to ${expected.slice(0, 12)}. The task changed after the oracle was built`,
    );
  }
  if (oracle.task_digest !== task.task_digest || oracle.acceptance_digest !== task.acceptance_digest) {
    throw new Error(`firewall: ${oracle.candidate_id}'s task or acceptance text differs between the two manifests`);
  }
};

/** Every candidate that has a task must also have an oracle manifest, and both must pair. */
export const assertManifestsPair = (manifests: readonly FirewallManifest[]): void => {
  const tasks = new Map<string, TaskAuthorManifest>();
  const oracles = new Map<string, OracleBuildManifest>();
  for (const manifest of manifests) {
    if (manifest.phase === "record-blind-task") {
      if (tasks.has(manifest.candidate_id)) {
        throw new Error(`firewall: ${manifest.candidate_id} has two record-blind task manifests`);
      }
      tasks.set(manifest.candidate_id, manifest);
    } else {
      if (oracles.has(manifest.candidate_id)) {
        throw new Error(`firewall: ${manifest.candidate_id} has two oracle manifests`);
      }
      oracles.set(manifest.candidate_id, manifest);
    }
  }
  for (const [candidateId, task] of tasks) {
    const oracle = oracles.get(candidateId);
    if (oracle === undefined) throw new Error(`firewall: ${candidateId} has a task but no oracle manifest`);
    assertTaskAuthorInputsAllowed(task);
    assertTaskFrozenBeforeOracle(task, oracle);
  }
  for (const candidateId of oracles.keys()) {
    if (!tasks.has(candidateId)) {
      throw new Error(
        `firewall: ${candidateId} has an oracle manifest but no record-blind task manifest. ` +
          `Without the first half there is nothing showing the task was authored off the record`,
      );
    }
  }
};

/**
 * `assertManifestsPair` passes vacuously on an empty manifest set, which is
 * correct -- nothing built, nothing broken -- and useless as a gate. This is the
 * gate: every candidate the census calls BUILDABLE must have both halves of the
 * firewall on record. A missing manifest is a candidate whose task provenance
 * nobody can check, and BUILDABLE claims otherwise.
 */
export const assertFirewallCoversBuildable = (
  buildableCandidateIds: readonly string[],
  manifests: readonly FirewallManifest[],
): void => {
  const withTask = new Set(manifests.filter((row) => row.phase === "record-blind-task").map((row) => row.candidate_id));
  const withOracle = new Set(
    manifests.filter((row) => row.phase === "record-aware-oracle").map((row) => row.candidate_id),
  );
  const uncovered = buildableCandidateIds.filter((id) => !withTask.has(id) || !withOracle.has(id));
  if (uncovered.length > 0) {
    throw new Error(
      `firewall: ${String(uncovered.length)} BUILDABLE candidate(s) have no firewall manifest pair: ` +
        `${uncovered.slice(0, 5).join(", ")}${uncovered.length > 5 ? " ..." : ""}. ` +
        `Without both halves there is no evidence the task was authored off the record`,
    );
  }
};

/** Normalizes text for the leakage comparison: lowercase word tokens, order kept. */
const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token !== "");

const shingles = (tokens: readonly string[], size: number): Set<string> => {
  const out = new Set<string>();
  for (let index = 0; index + size <= tokens.length; index += 1) {
    out.add(tokens.slice(index, index + size).join(" "));
  }
  return out;
};

export interface LeakageFinding {
  readonly candidate_id: string;
  readonly shared_shingles: readonly string[];
  readonly shared_count: number;
  readonly record_shingle_count: number;
  readonly overlap: number;
  readonly leaked: boolean;
}

/** Any 4-word run shared between the task text and the record is a positive. */
export const LEAKAGE_SHINGLE_SIZE = 4;

/**
 * Reads the finished task for the record's own phrasing. This catches the case
 * the input manifest cannot: an author who had the record in their head rather
 * than in their inputs.
 *
 * The threshold is zero shared 4-grams, and that is deliberate. A softer
 * threshold would need a story about how much of a decision may appear in a
 * task that is supposed to be independent of it, and there is no such amount.
 * Common English runs are short enough that four content-bearing words in the
 * same order is not coincidence; where it is, the finding is visible and can be
 * dismissed in writing rather than by a constant nobody revisits.
 */
export const detectRecordLeakage = (
  candidateId: string,
  taskText: string,
  recordText: string,
): LeakageFinding => {
  const recordShingles = shingles(tokenize(recordText), LEAKAGE_SHINGLE_SIZE);
  const taskShingles = shingles(tokenize(taskText), LEAKAGE_SHINGLE_SIZE);
  const shared = [...recordShingles].filter((shingle) => taskShingles.has(shingle));
  return {
    candidate_id: candidateId,
    shared_shingles: shared.slice(0, 10),
    shared_count: shared.length,
    record_shingle_count: recordShingles.size,
    overlap: recordShingles.size === 0 ? 0 : shared.length / recordShingles.size,
    leaked: shared.length > 0,
  };
};

export const assertNoRecordLeakage = (findings: readonly LeakageFinding[]): void => {
  const leaked = findings.filter((finding) => finding.leaked);
  if (leaked.length > 0) {
    throw new Error(
      `firewall: ${String(leaked.length)} task(s) repeat the record's own phrasing: ` +
        leaked
          .map((finding) => `${finding.candidate_id} (${String(finding.shared_count)} shared runs, e.g. "${finding.shared_shingles[0] ?? ""}")`)
          .join("; "),
    );
  }
};
