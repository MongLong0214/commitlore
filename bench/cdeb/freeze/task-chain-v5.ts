/**
 * The record-blind half of SSOT §6.2's task-author chain.
 *
 * NEED-SCOUT is handed a sandbox with no git metadata and a path scope, and
 * returns realistic maintenance needs derived from the tree. FUNCTIONAL-AUTHOR
 * turns one of them into acceptance criteria. Both run before anything
 * record-aware happens, and the manifest records the exact bytes each was given
 * so the ordering can be checked afterwards rather than asserted.
 *
 * This module builds the request and validates the answer. It does not choose
 * the agent: the caller supplies a `runner`, so the chain can be exercised by a
 * test with a stub and by the study with a real isolated agent, and the
 * validation is the same in both cases.
 */

import { createHash } from "node:crypto";

import type { InputProducer, TaskAuthorManifest } from "./firewall-v5.ts";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Everything NEED-SCOUT is given. There is deliberately no field for a record. */
export interface NeedScoutRequest {
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly sandbox_dir: string;
  readonly tree_digest: string;
  /** The decision's paths, which name where to look without saying what was decided. */
  readonly path_scope: readonly string[];
  readonly prompt: string;
}

export interface MaintenanceNeed {
  readonly need_id: string;
  readonly summary: string;
  /** Files in the tree the scout read to justify the need. */
  readonly tree_evidence: readonly string[];
  readonly rationale: string;
}

export interface NeedScoutAnswer {
  readonly candidate_id: string;
  readonly needs: readonly MaintenanceNeed[];
}

export const MIN_NEEDS = 2;
export const MAX_NEEDS = 3;

/**
 * The prompt. It names the scope and asks for maintenance work, and it never
 * mentions that a decision exists -- a scout told "there is a ruling here you
 * must not see" would write around the shape of the thing it was told about.
 */
export const needScoutPrompt = (pathScope: readonly string[]): string =>
  [
    "You are maintaining this repository. The working tree in your current directory is the whole of it.",
    "",
    "Propose 2 to 3 realistic maintenance needs that a maintainer could plausibly file today,",
    "each one touching at least one of these paths:",
    "",
    ...pathScope.map((path) => `  ${path}`),
    "",
    "A need is a problem statement, not a solution: say what is wrong or missing and how a",
    "maintainer would know, without prescribing an implementation. Ground each one in files you",
    "actually opened, and list them.",
    "",
    "Prefer needs whose completion could be checked by running the repository's own tests.",
  ].join("\n");

/** Refuses an answer that does not meet §6.2's shape before it can enter a manifest. */
export const assertNeedScoutAnswer = (request: NeedScoutRequest, answer: NeedScoutAnswer): void => {
  if (answer.candidate_id !== request.candidate_id) {
    throw new Error(`need-scout: answer is for ${answer.candidate_id}, not ${request.candidate_id}`);
  }
  if (answer.needs.length < MIN_NEEDS || answer.needs.length > MAX_NEEDS) {
    throw new Error(
      `need-scout: ${request.candidate_id} produced ${String(answer.needs.length)} needs, not ` +
        `${String(MIN_NEEDS)} to ${String(MAX_NEEDS)}`,
    );
  }
  const ids = new Set(answer.needs.map((need) => need.need_id));
  if (ids.size !== answer.needs.length) throw new Error(`need-scout: ${request.candidate_id} repeats a need_id`);

  for (const need of answer.needs) {
    if (need.tree_evidence.length === 0) {
      throw new Error(
        `need-scout: need ${need.need_id} cites no file. A need with no tree evidence is a need the scout ` +
          `did not get from the tree, and the tree is the only thing it was given`,
      );
    }
    if (need.summary.trim().length < 20) {
      throw new Error(`need-scout: need ${need.need_id} has no substantive summary`);
    }
  }
};

/**
 * The deterministic choice among valid needs, from an external seed.
 *
 * SSOT §6.2 requires TASK-FREEZER to select without discretion, because the
 * selector at this point has read the record and could otherwise pick the need
 * that happens to run closest to the ruled-out approach.
 */
export const selectNeed = (seed: string, answer: NeedScoutAnswer): MaintenanceNeed => {
  const ranked = [...answer.needs]
    .map((need) => ({ need, rank: sha256(`${seed}${answer.candidate_id}${need.need_id}`) }))
    .sort((left, right) => left.rank.localeCompare(right.rank));
  const chosen = ranked[0]?.need;
  if (chosen === undefined) throw new Error(`need-scout: ${answer.candidate_id} has no need to select`);
  return chosen;
};

export interface FrozenTask {
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly need: MaintenanceNeed;
  readonly task_text: string;
  readonly acceptance_text: string;
}

/**
 * Builds the manifest for the record-blind half. Every input is hashed, and the
 * two prose inputs carry the producer that made them, so
 * `assertTaskAuthorInputsAllowed` can refuse a maintenance need written by
 * someone who had read the record.
 */
export const taskAuthorManifest = (input: {
  readonly request: NeedScoutRequest;
  readonly task: FrozenTask;
  readonly sequence: number;
  readonly frozen_at: string;
  readonly need_producer: InputProducer;
  readonly acceptance_producer: InputProducer;
}): TaskAuthorManifest => ({
  schema_version: 1,
  study_id: "cdeb-fresh-v5",
  stage: "stage1-r1",
  candidate_id: input.request.candidate_id,
  repository_id: input.request.repository_id,
  phase: "record-blind-task",
  sequence: input.sequence,
  inputs: {
    base_tree_oid: input.request.tree_digest,
    repository_id: sha256(input.request.repository_id),
    allowed_scope: sha256([...input.request.path_scope].sort().join("\n")),
    maintenance_need: sha256(input.task.need.summary),
    functional_acceptance: sha256(input.task.acceptance_text),
  },
  input_producers: {
    maintenance_need: input.need_producer,
    functional_acceptance: input.acceptance_producer,
  },
  task_digest: sha256(input.task.task_text),
  acceptance_digest: sha256(input.task.acceptance_text),
  frozen_at: input.frozen_at,
});
