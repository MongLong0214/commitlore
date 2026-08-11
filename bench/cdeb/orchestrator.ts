/**
 * CDEB-07 run lifecycle coordinator (PRD §§10–11, §18.2/§18.4, §§19–20).
 *
 * The important policy is represented by control flow, not a comment:
 *
 * - an agent launch gets a durable checkpoint before the process can start;
 * - only a typed pre-first-turn result reaches the agent retry loop;
 * - a frozen tree routes directly to evaluation on resume;
 * - evaluator calls receive only the persisted archive and its claimed OID;
 * - progress values have no outcome-shaped field.
 *
 * CDEB-08 deliberately does not appear here.  This module creates immutable
 * rows; analysis receives the completed matrix later and is a separate ticket.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  executeAgentRun,
  type AgentRunOutcome,
  type ContainerRuntimeCommands,
  type RuntimePin,
} from "./runtime/agent-container.ts";
import type { CapabilityGatePassed } from "./runtime/isolation.ts";
import { readExposureEvents, exposureLogSha256 } from "./runtime/exposure.ts";
import { readPersistedRawNdjson, readProviderLedger, type ProviderLedger } from "./runtime/provider-ledger.ts";
import {
  assertCaptureSurfaceAbsent,
  assertFrozenShippingProxy,
  writeCdebArmConfig,
} from "./runtime/arm-settings.ts";
import { materializeBundle, type RepositoryBundleIdentity } from "./freeze/repository-bundle.ts";
import { freezeFinalTree, frozenTreeProvenance } from "./evaluator/freeze-tree.ts";
import { runEvaluatorOci } from "./evaluator/runner-oci.ts";
import type { EvaluatorOutput } from "./evaluator/types.ts";
import {
  DurableStudyStorage,
  type AgentLaunchCheckpoint,
  type AgentStartedCheckpoint,
  type FinalTreeArtifact,
  type StoredAttempt,
} from "./storage.ts";

export type CdebCondition = "commitlore-on" | "commitlore-off";
export type LifecycleState =
  | "PLANNED"
  | "PREFLIGHT"
  | "AGENT_STARTING"
  | "AGENT_STARTED"
  | "FINAL_TREE_FROZEN"
  | "EVALUATING"
  | "MEASURED"
  | "PRE_AGENT_INFRA_FAILURE"
  | "MEASURED_AGENT_FAILURE"
  | "EVALUATOR_INFRA_FAILURE"
  | "MEASUREMENT_INTEGRITY_FAILURE";

export const MAX_PRE_AGENT_ATTEMPTS = 3;
export const MAX_EVALUATOR_ATTEMPTS = 3;

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIPPING_PROXY_PATH = join(HERE, "runtime", "shipping-proxy.ts");
const EXPOSURE_PARSER_PATH = join(HERE, "runtime", "exposure.ts");

const conditionSuffix = (condition: CdebCondition): "on" | "off" =>
  condition === "commitlore-on" ? "on" : "off";

const sha256 = (input: string): string => createHash("sha256").update(input, "utf8").digest("hex");

/** One sealed task/repeat pair.  `sealed_key` never enters public JSON. */
export interface SealedPairBlock<T> {
  readonly sealed_key: string;
  readonly value: T;
}

export interface OpaqueRandomizationBlock {
  readonly block_index: string;
  readonly conditions: readonly [CdebCondition, CdebCondition];
}

/** Safe for the public freeze: opaque indices and arm order only. */
export interface OpaqueRandomizationManifest {
  readonly schema_version: 1;
  readonly algorithm: "sha256-key-sort-v1";
  readonly block_count: number;
  readonly blocks: readonly OpaqueRandomizationBlock[];
}

export interface ScheduledSealedBlock<T> {
  readonly block_index: string;
  readonly value: T;
  readonly conditions: readonly [CdebCondition, CdebCondition];
}

export interface BlockedRandomization<T> {
  readonly public_manifest: OpaqueRandomizationManifest;
  /** Kept in the sealed plan, never serialized into public-freeze artifacts. */
  readonly sealed_schedule: readonly ScheduledSealedBlock<T>[];
}

/**
 * Deterministic blocked randomization.  Sort-by-hash avoids a stateful PRNG
 * implementation and makes the chosen order reproducible from the frozen
 * seed, while the public side contains no task/repository identifier.
 */
export const blockedRandomization = <T>(
  pairs: readonly SealedPairBlock<T>[],
  freezeSeed: string,
): BlockedRandomization<T> => {
  if (freezeSeed === "") throw new Error("CDEB randomization seed must not be empty");
  const keys = new Set<string>();
  for (const pair of pairs) {
    if (pair.sealed_key === "") throw new Error("CDEB sealed block key must not be empty");
    if (keys.has(pair.sealed_key)) throw new Error(`CDEB sealed block key is duplicated: ${pair.sealed_key}`);
    keys.add(pair.sealed_key);
  }
  const sorted = [...pairs].sort((left, right) => {
    const leftHash = sha256(`${freezeSeed}\u0000block\u0000${left.sealed_key}`);
    const rightHash = sha256(`${freezeSeed}\u0000block\u0000${right.sealed_key}`);
    return leftHash === rightHash ? (left.sealed_key < right.sealed_key ? -1 : 1) : (leftHash < rightHash ? -1 : 1);
  });
  const sealed_schedule = sorted.map((pair, index): ScheduledSealedBlock<T> => {
    const onFirst = sha256(`${freezeSeed}\u0000arm\u0000${pair.sealed_key}`) < "8".repeat(64);
    const conditions: [CdebCondition, CdebCondition] = onFirst
      ? ["commitlore-on", "commitlore-off"]
      : ["commitlore-off", "commitlore-on"];
    return {
      block_index: `block-${String(index).padStart(3, "0")}`,
      value: pair.value,
      conditions,
    };
  });
  return {
    public_manifest: {
      schema_version: 1,
      algorithm: "sha256-key-sort-v1",
      block_count: sealed_schedule.length,
      blocks: sealed_schedule.map(({ block_index, conditions }) => ({ block_index, conditions })),
    },
    sealed_schedule,
  };
};

/**
 * The only values a progress consumer can receive.  There is deliberately no
 * result, evaluator, usage, condition aggregate, or outcome field in this
 * type.  `Readonly` plus construction inside `emitProgress` keep an adapter
 * from receiving the mutable row object by accident.
 */
export interface OutcomeFreeProgress {
  readonly logical_run_id: string;
  readonly state: LifecycleState;
  readonly attempt_count: number;
  readonly completed: number;
  readonly remaining: number;
}

export type ProgressReporter = (progress: Readonly<OutcomeFreeProgress>) => void;

export const formatOutcomeFreeProgress = (progress: OutcomeFreeProgress): string =>
  `cdeb: ${progress.logical_run_id} ${progress.state} attempt ${String(progress.attempt_count)} ${String(progress.completed)} completed ${String(progress.remaining)} remaining`;

const emitProgress = (
  report: ProgressReporter | undefined,
  logicalRunId: string,
  state: LifecycleState,
  attemptCount: number,
  completed: number,
  total: number,
): void => {
  if (report === undefined) return;
  report(Object.freeze({
    logical_run_id: logicalRunId,
    state,
    attempt_count: attemptCount,
    completed,
    remaining: total - completed,
  }));
};

export interface ExposureSummary {
  readonly instrumentation_complete: true;
  readonly hook_opportunities: number;
  readonly proxy_executions: number;
  readonly expected_record_delivered: boolean;
  readonly delivered_before_first_mutation: boolean;
  readonly delivered_record_ids: readonly string[];
  readonly payload_sha256s: readonly string[];
  readonly product_failures: number;
  readonly exposure_log_sha256: string;
}

export interface PreparedWorkspace {
  readonly workdir: string;
  /** An empty file must exist for OFF too: zero is observed, never inferred. */
  readonly exposure_path: string;
  /** Directory that contains the isolated settings/MCP files for CDEB-03. */
  readonly config_dir: string;
  readonly cleanup: () => void;
}

export interface AgentTerminalObservation {
  readonly kind: "after-first-model-turn";
  readonly started_at: string;
  readonly finished_at: string;
  readonly stop_reason: "completed" | "timeout" | "agent_error" | "provider_error_after_start";
  readonly provider_ledger: ProviderLedger;
  /** Exact uncompressed CDEB-05 source bytes. */
  readonly raw_provider_ndjson: Buffer;
}

export interface AgentPreTurnFailure {
  readonly kind: "before-first-model-turn";
  readonly failure_detail: string;
}

/** A post-turn parse/identity failure is evidence of an incomplete study, not a retry. */
export interface AgentMeasurementIntegrityFailure {
  readonly kind: "measurement-integrity-failure";
  readonly failure_detail: string;
}

export type AgentExecution =
  | AgentTerminalObservation
  | AgentPreTurnFailure
  | AgentMeasurementIntegrityFailure;

export interface AgentRunnerInput {
  readonly plan: LogicalRunPlan;
  readonly workspace: PreparedWorkspace;
  /** Called at the byte-level first-turn boundary; must be invoked exactly once. */
  readonly on_first_model_turn: () => void;
}

export interface AgentRunner {
  readonly run: (input: AgentRunnerInput) => Promise<AgentExecution>;
}

export interface FrozenTreeObservation {
  readonly archive: Buffer;
  readonly metadata: FinalTreeArtifact;
}

export interface FinalTreeFreezer {
  readonly freeze: (workspace: PreparedWorkspace) => FrozenTreeObservation;
}

export interface EvaluatorInput {
  readonly plan: LogicalRunPlan;
  readonly archive_path: string;
  readonly final_tree: FinalTreeArtifact;
}

export type EvaluatorExecution =
  | { readonly kind: "verdict"; readonly verdict: EvaluatorOutput }
  | { readonly kind: "infrastructure-failure"; readonly failure_detail: string };

export interface EvaluatorRunner {
  readonly evaluate: (input: EvaluatorInput) => Promise<EvaluatorExecution>;
}

export interface LogicalRunPlan {
  readonly logical_run_id: string;
  readonly repository_id: string;
  readonly task_id: string;
  readonly category: string;
  readonly condition: CdebCondition;
  readonly repeat: 1 | 2 | 3;
  readonly order: number;
  /** Opaque analyzer input path committed by public-freeze.json. */
  readonly analysis_row_file: string;
  /** Required to re-parse retained CDEB-05 bytes during evaluator-only resume. */
  readonly requested_model: string;
  readonly prompt: string;
  readonly expected_record_ids: readonly string[];
  /** Builds the closed §19.2 row from immutable observations only. */
  readonly make_row: (input: {
    readonly agent: AgentTerminalObservation;
    readonly exposure: ExposureSummary;
    readonly final_tree: FinalTreeArtifact;
    readonly evaluator: EvaluatorOutput;
    readonly evaluator_attempts: number;
  }) => Record<string, unknown>;
}

export interface CdebStudyPlan {
  /** Exact public commitment that must not change on resume. */
  readonly public_freeze: unknown;
  readonly randomization: OpaqueRandomizationManifest;
  /** Sealed mapping from opaque blocks to the actual task/repeat cells. */
  readonly logical_runs: readonly LogicalRunPlan[];
}

export interface OrchestratorDependencies {
  readonly prepare_workspace: (plan: LogicalRunPlan) => Promise<PreparedWorkspace>;
  readonly agent: AgentRunner;
  readonly freeze_tree: FinalTreeFreezer;
  readonly collect_exposure: (workspace: PreparedWorkspace, plan: LogicalRunPlan) => ExposureSummary;
  readonly evaluator: EvaluatorRunner;
}

/** Frozen bundle source for one repository named by the sealed run plan. */
export interface MaterializedRepositorySource {
  readonly bundle_path: string;
  readonly identity: RepositoryBundleIdentity;
}

export interface MaterializedWorkspacePreparerOptions {
  readonly repositories: Readonly<Record<string, MaterializedRepositorySource>>;
  /** Defaults to the OS scratch directory; never used as authoritative storage. */
  readonly scratch_parent?: string;
}

/**
 * Production workspace preparation, composing CDEB-02 materialization with
 * CDEB-04's frozen delivery-only arm config.  The output belongs only to one
 * agent attempt; all authoritative evidence is copied into DurableStudyStorage.
 */
export const materializedWorkspacePreparer = (
  options: MaterializedWorkspacePreparerOptions,
): OrchestratorDependencies["prepare_workspace"] => async (plan): Promise<PreparedWorkspace> => {
  const source = options.repositories[plan.repository_id];
  if (source === undefined) throw new Error(`CDEB run ${plan.logical_run_id} has no frozen bundle for ${plan.repository_id}`);
  const root = mkdtempSync(join(options.scratch_parent ?? tmpdir(), "cdeb-workspace-"));
  const workdir = join(root, "repository");
  const configDir = join(root, "config");
  try {
    materializeBundle(source.identity, source.bundle_path, workdir);
    const arm = plan.condition === "commitlore-on" ? "on" : "off";
    const config = writeCdebArmConfig(workdir, configDir, arm);
    // `writeCdebArmConfig` already checks this; make it explicit at the
    // orchestration boundary so a later config construction cannot bypass it.
    assertCaptureSurfaceAbsent(workdir, config);
    return {
      workdir,
      exposure_path: config.exposurePath,
      config_dir: config.configDir,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
};

export interface RunStudyOptions {
  readonly storage: DurableStudyStorage;
  readonly progress?: ProgressReporter;
  /** Test-only path override for a copied, byte-mutated proxy fixture. */
  readonly shipping_proxy_paths?: {
    readonly proxy_path: string;
    readonly parser_path: string;
  };
}

export interface StudyRunResult {
  readonly completed_logical_run_ids: readonly string[];
  readonly missing_logical_run_ids: readonly string[];
}

export class InterruptedAgentAttemptError extends Error {
  public constructor(logicalRunId: string, attempts: readonly string[]) {
    super(
      `CDEB ${logicalRunId}: agent launch ${attempts.join(", ")} has no terminal pre-turn record or frozen tree; refusing an agent rerun`,
    );
    this.name = "InterruptedAgentAttemptError";
  }
}

export class MeasurementIntegrityError extends Error {
  public constructor(logicalRunId: string, detail: string) {
    super(`CDEB ${logicalRunId}: measurement integrity failure: ${detail}`);
    this.name = "MeasurementIntegrityError";
  }
}

export class RetryExhaustedError extends Error {
  public constructor(logicalRunId: string, stage: "agent" | "evaluator", count: number) {
    super(`CDEB ${logicalRunId}: ${stage} retry limit reached after ${String(count)} attempt(s)`);
    this.name = "RetryExhaustedError";
  }
}

const attemptId = (plan: LogicalRunPlan, ordinal: number): string => `${plan.logical_run_id}__a${String(ordinal)}`;

const requiredRunId = (plan: LogicalRunPlan): void => {
  const expected = `${plan.repository_id}__${plan.task_id}__${conditionSuffix(plan.condition)}__r${String(plan.repeat)}`;
  if (plan.logical_run_id !== expected) {
    throw new Error(`logical run id ${plan.logical_run_id} does not name its repository/task/condition/repeat cell`);
  }
};

interface FreezeWiring {
  readonly hook_proxy_sha256: string;
  readonly analysis_row_files: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads the two freeze commitments this coordinator must enforce itself.
 * Keeping this narrow avoids turning the runner into a second freeze schema
 * parser while making it impossible to omit either seam at execution time.
 */
const frozenWiring = (freeze: unknown): FreezeWiring => {
  if (!isRecord(freeze)) throw new Error("CDEB public freeze is not an object with execution wiring");
  const proxy = freeze["hook_proxy_sha256"];
  if (typeof proxy !== "string" || !/^[0-9a-f]{64}$/u.test(proxy)) {
    throw new Error("CDEB public freeze has no valid hook_proxy_sha256");
  }
  const analysis = freeze["analysis_inputs"];
  if (!isRecord(analysis) || !Array.isArray(analysis["row_files"])) {
    throw new Error("CDEB public freeze has no analysis_inputs.row_files");
  }
  const rowFiles = analysis["row_files"];
  if (rowFiles.some((path) => typeof path !== "string" || !/^rows\/[a-z0-9][a-z0-9._-]*\.json$/u.test(path))) {
    throw new Error("CDEB public freeze names an unsafe analysis row path");
  }
  if (new Set(rowFiles).size !== rowFiles.length) {
    throw new Error("CDEB public freeze names an analysis row path more than once");
  }
  return { hook_proxy_sha256: proxy, analysis_row_files: rowFiles as readonly string[] };
};

/** The sealed schedule maps every logical observation to one frozen row path. */
const analysisRowsForPlan = (plan: CdebStudyPlan, wiring: FreezeWiring): ReadonlyMap<string, string> => {
  const named = new Map<string, string>();
  for (const logicalRun of plan.logical_runs) {
    if (named.has(logicalRun.logical_run_id)) {
      throw new Error(`CDEB logical run schedule has duplicate id ${logicalRun.logical_run_id}`);
    }
    if (!wiring.analysis_row_files.includes(logicalRun.analysis_row_file)) {
      throw new Error(
        `CDEB ${logicalRun.logical_run_id} writes ${logicalRun.analysis_row_file}, which public-freeze.json does not name`,
      );
    }
    named.set(logicalRun.logical_run_id, logicalRun.analysis_row_file);
  }
  if (new Set(named.values()).size !== named.size || named.size !== wiring.analysis_row_files.length) {
    throw new Error("CDEB sealed schedule and public freeze do not name the same one-to-one analysis row set");
  }
  return named;
};

/** Binds the sealed task mapping to the committed opaque block order. */
const assertBlockedSchedule = (plan: CdebStudyPlan): void => {
  if (plan.randomization.algorithm !== "sha256-key-sort-v1" || plan.randomization.schema_version !== 1) {
    throw new Error("CDEB randomization manifest is not the frozen blocked-randomization format");
  }
  if (plan.randomization.blocks.length !== plan.randomization.block_count) {
    throw new Error("CDEB randomization block list length differs from its committed count");
  }
  for (const [blockNumber, block] of plan.randomization.blocks.entries()) {
    const expectedIndex = `block-${String(blockNumber).padStart(3, "0")}`;
    if (block.block_index !== expectedIndex) {
      throw new Error(`CDEB randomization block ${String(blockNumber)} is not the expected opaque index ${expectedIndex}`);
    }
    const first = plan.logical_runs[blockNumber * 2];
    const second = plan.logical_runs[blockNumber * 2 + 1];
    if (first === undefined || second === undefined) throw new Error(`CDEB block ${block.block_index} has no sealed pair`);
    if (first.order !== blockNumber * 2 + 1 || second.order !== blockNumber * 2 + 2) {
      throw new Error(`CDEB block ${block.block_index} does not occupy its committed consecutive order slots`);
    }
    if (first.condition !== block.conditions[0] || second.condition !== block.conditions[1]) {
      throw new Error(`CDEB block ${block.block_index} condition order differs from randomization.json`);
    }
    if (first.repository_id !== second.repository_id || first.task_id !== second.task_id || first.repeat !== second.repeat) {
      throw new Error(`CDEB block ${block.block_index} does not contain one task/repeat ON/OFF pair`);
    }
  }
};

const agentAttemptRecord = (
  plan: LogicalRunPlan,
  id: string,
  observation: AgentTerminalObservation | AgentMeasurementIntegrityFailure,
  startedAt: string,
): StoredAttempt => {
  if (observation.kind === "measurement-integrity-failure") {
    return {
      schema_version: 1,
      benchmark: "cdeb-v1",
      attempt_id: id,
      logical_run_id: plan.logical_run_id,
      terminal_state: "MEASUREMENT_INTEGRITY_FAILURE",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      first_model_turn_observed: true,
      failure_detail: observation.failure_detail,
    };
  }
  return {
    schema_version: 1,
    benchmark: "cdeb-v1",
    attempt_id: id,
    logical_run_id: plan.logical_run_id,
    terminal_state: observation.stop_reason === "completed" ? "MEASURED" : "MEASURED_AGENT_FAILURE",
    started_at: observation.started_at,
    finished_at: observation.finished_at,
    first_model_turn_observed: true,
    ...(observation.stop_reason === "completed" ? {} : { failure_detail: observation.stop_reason }),
  };
};

const preAgentAttemptRecord = (plan: LogicalRunPlan, id: string, startedAt: string, detail: string): StoredAttempt => ({
  schema_version: 1,
  benchmark: "cdeb-v1",
  attempt_id: id,
  logical_run_id: plan.logical_run_id,
  terminal_state: "PRE_AGENT_INFRA_FAILURE",
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  first_model_turn_observed: false,
  failure_detail: detail,
});

const evaluatorAttemptRecord = (
  finalTree: FinalTreeArtifact,
  attempt: number,
  result: EvaluatorExecution,
): Record<string, unknown> => result.kind === "verdict"
  ? {
      schema_version: 1,
      attempt: attempt,
      terminal_state: "VERDICT",
      candidate_tree_oid: finalTree.final_tree_oid,
      evaluator_tree_oid: result.verdict.candidate_tree_oid,
    }
  : {
      schema_version: 1,
      attempt: attempt,
      terminal_state: "EVALUATOR_INFRA_FAILURE",
      candidate_tree_oid: finalTree.final_tree_oid,
      failure_detail: result.failure_detail,
    };

const assertEvaluatorBinding = (
  plan: LogicalRunPlan,
  finalTree: FinalTreeArtifact,
  verdict: EvaluatorOutput,
): void => {
  if (verdict.candidate_tree_oid !== finalTree.final_tree_oid) {
    throw new MeasurementIntegrityError(
      plan.logical_run_id,
      `evaluator tree ${verdict.candidate_tree_oid} differs from frozen tree ${finalTree.final_tree_oid}`,
    );
  }
  if (verdict.task_id !== plan.task_id) {
    throw new MeasurementIntegrityError(
      plan.logical_run_id,
      `evaluator task ${verdict.task_id} differs from frozen task ${plan.task_id}`,
    );
  }
};

const finalizeMeasuredRow = (
  plan: LogicalRunPlan,
  storage: DurableStudyStorage,
  agent: AgentTerminalObservation,
  exposure: ExposureSummary,
  finalTree: FinalTreeArtifact,
  evaluator: EvaluatorOutput,
  evaluatorAttempts: number,
): void => {
  const row = plan.make_row({
    agent,
    exposure,
    final_tree: finalTree,
    evaluator,
    evaluator_attempts: evaluatorAttempts,
  });
  storage.writeRow(plan.logical_run_id, plan.analysis_row_file, row);
};

const evaluateFrozenTree = async (
  plan: LogicalRunPlan,
  storage: DurableStudyStorage,
  dependencies: OrchestratorDependencies,
  finalTree: FinalTreeArtifact,
  agent: AgentTerminalObservation,
  exposure: ExposureSummary,
  initialEvaluatorAttemptCount: number,
  maxEvaluatorAttempts: number,
  report: ProgressReporter | undefined,
  completed: number,
  total: number,
): Promise<void> => {
  let evaluatorAttempts = initialEvaluatorAttemptCount;
  while (evaluatorAttempts < maxEvaluatorAttempts) {
    evaluatorAttempts += 1;
    emitProgress(report, plan.logical_run_id, "EVALUATING", evaluatorAttempts, completed, total);
    let evaluation: EvaluatorExecution;
    try {
      evaluation = await dependencies.evaluator.evaluate({
        plan,
        archive_path: storage.runArtifactPath(plan.logical_run_id, "final-tree.tar.zst"),
        final_tree: finalTree,
      });
    } catch (error) {
      evaluation = {
        kind: "infrastructure-failure",
        failure_detail: error instanceof Error ? error.message : String(error),
      };
    }
    storage.writeEvaluatorAttempt(plan.logical_run_id, `e${String(evaluatorAttempts)}`, evaluatorAttemptRecord(finalTree, evaluatorAttempts, evaluation));
    if (evaluation.kind === "infrastructure-failure") {
      emitProgress(report, plan.logical_run_id, "EVALUATOR_INFRA_FAILURE", evaluatorAttempts, completed, total);
      continue;
    }
    assertEvaluatorBinding(plan, finalTree, evaluation.verdict);
    storage.writeEvaluatorResult(plan.logical_run_id, evaluation.verdict);
    finalizeMeasuredRow(plan, storage, agent, exposure, finalTree, evaluation.verdict, evaluatorAttempts);
    return;
  }
  throw new RetryExhaustedError(plan.logical_run_id, "evaluator", evaluatorAttempts);
};

const runLogical = async (
  plan: LogicalRunPlan,
  storage: DurableStudyStorage,
  dependencies: OrchestratorDependencies,
  maxPreAgentAttempts: number,
  maxEvaluatorAttempts: number,
  report: ProgressReporter | undefined,
  completed: number,
  total: number,
): Promise<void> => {
  const initial = storage.readRunState(plan.logical_run_id);
  if (initial.row !== null) return;
  if (initial.final_tree !== null) {
    // The agent is structurally unreachable on this branch.  The durable
    // observation sidecar is written before final-tree.json below.
    const terminalAttempt = initial.agent_attempts.find((attempt) => attempt.first_model_turn_observed);
    if (terminalAttempt === undefined) {
      throw new MeasurementIntegrityError(plan.logical_run_id, "frozen tree has no terminal first-turn agent attempt");
    }
    const observation = storage.readAgentObservation<DurableAgentObservation>(plan.logical_run_id, terminalAttempt.attempt_id);
    if (observation === null) {
      throw new MeasurementIntegrityError(plan.logical_run_id, "frozen tree has no durable agent observation sidecar");
    }
    const restored = restoreAgentObservation(plan, storage, observation);
    const existingVerdict = storage.readJson<EvaluatorOutput>(join("runs", plan.logical_run_id, "evaluator.json"));
    if (existingVerdict !== null) {
      // A crash after evaluator.json but before row.json must not turn into a
      // new evaluation, much less a new agent.  The persisted verdict is the
      // evaluation attempt; finish only its missing row commit record.
      assertEvaluatorBinding(plan, initial.final_tree, existingVerdict);
      finalizeMeasuredRow(
        plan,
        storage,
        restored,
        observation.exposure,
        initial.final_tree,
        existingVerdict,
        initial.evaluator_attempt_count,
      );
      return;
    }
    await evaluateFrozenTree(
      plan,
      storage,
      dependencies,
      initial.final_tree,
      restored,
      observation.exposure,
      initial.evaluator_attempt_count,
      maxEvaluatorAttempts,
      report,
      completed,
      total,
    );
    return;
  }

  const preAttempts = storage.preAgentAttempts(plan.logical_run_id);
  const terminalPreAttemptIds = new Set(preAttempts.map((attempt) => attempt.attempt_id));
  const uncertainLaunches = initial.launched_attempt_ids.filter((id) => !terminalPreAttemptIds.has(id));
  if (uncertainLaunches.length > 0) {
    // Between launch and a terminal pre-turn record the durable state cannot
    // distinguish a killed process before its first turn from one after it.
    // The safe answer is incomplete, never an agent rerun.
    throw new InterruptedAgentAttemptError(plan.logical_run_id, uncertainLaunches);
  }
  if (preAttempts.length >= maxPreAgentAttempts) {
    throw new RetryExhaustedError(plan.logical_run_id, "agent", preAttempts.length);
  }

  for (let ordinal = preAttempts.length + 1; ordinal <= maxPreAgentAttempts; ordinal += 1) {
    const id = attemptId(plan, ordinal);
    emitProgress(report, plan.logical_run_id, "PREFLIGHT", ordinal, completed, total);
    const workspace = await dependencies.prepare_workspace(plan);
    const launchedAt = new Date().toISOString();
    const launch: AgentLaunchCheckpoint = {
      schema_version: 1,
      logical_run_id: plan.logical_run_id,
      attempt_id: id,
      launched_at: launchedAt,
    };
    storage.beginAgentAttempt(launch);
    let firstTurnMarked = false;
    const markFirstTurn = (): void => {
      if (firstTurnMarked) return;
      const marker: AgentStartedCheckpoint = {
        ...launch,
        first_model_turn_observed: true,
      };
      storage.markFirstModelTurn(marker);
      firstTurnMarked = true;
    };

    emitProgress(report, plan.logical_run_id, "AGENT_STARTING", ordinal, completed, total);
    let execution: AgentExecution;
    try {
      execution = await dependencies.agent.run({ plan, workspace, on_first_model_turn: markFirstTurn });
    } catch (error) {
      // A thrown adapter error is deliberately not reclassified as retryable:
      // a process may have produced a model turn before its host reported it.
      workspace.cleanup();
      throw new InterruptedAgentAttemptError(plan.logical_run_id, [id]);
    }

    if (execution.kind === "before-first-model-turn") {
      if (firstTurnMarked) {
        workspace.cleanup();
        throw new MeasurementIntegrityError(
          plan.logical_run_id,
          "agent adapter reported a pre-turn failure after the durable first-turn marker",
        );
      }
      storage.writePreAgentAttempt(preAgentAttemptRecord(plan, id, launchedAt, execution.failure_detail));
      workspace.cleanup();
      emitProgress(report, plan.logical_run_id, "PRE_AGENT_INFRA_FAILURE", ordinal, completed, total);
      continue;
    }
    if (!firstTurnMarked) {
      workspace.cleanup();
      throw new MeasurementIntegrityError(plan.logical_run_id, "post-turn agent result arrived without the durable first-turn marker");
    }
    if (execution.kind === "measurement-integrity-failure") {
      storage.writeAgentAttempt(agentAttemptRecord(plan, id, execution, launchedAt));
      workspace.cleanup();
      emitProgress(report, plan.logical_run_id, "MEASUREMENT_INTEGRITY_FAILURE", ordinal, completed, total);
      throw new MeasurementIntegrityError(plan.logical_run_id, execution.failure_detail);
    }

    storage.writeAgentAttempt(agentAttemptRecord(plan, id, execution, launchedAt));
    emitProgress(report, plan.logical_run_id, "AGENT_STARTED", ordinal, completed, total);
    storage.writeProviderNdjson(plan.logical_run_id, execution.raw_provider_ndjson);
    const exposure = dependencies.collect_exposure(workspace, plan);
    const exposureBytes = readFileSync(workspace.exposure_path);
    storage.writeExposure(plan.logical_run_id, exposureBytes);
    const frozen = dependencies.freeze_tree.freeze(workspace);
    const observation: DurableAgentObservation = {
      schema_version: 1,
      agent: serializableAgentObservation(execution),
      exposure,
    };
    // This sidecar precedes final-tree.json.  A resume can therefore evaluate
    // the frozen observation without ever revisiting the agent workspace.
    storage.writeAgentObservation(plan.logical_run_id, id, observation);
    storage.writeFinalTree(plan.logical_run_id, frozen.archive, frozen.metadata);
    workspace.cleanup();
    emitProgress(report, plan.logical_run_id, "FINAL_TREE_FROZEN", ordinal, completed, total);
    await evaluateFrozenTree(
      plan,
      storage,
      dependencies,
      frozen.metadata,
      execution,
      exposure,
      0,
      maxEvaluatorAttempts,
      report,
      completed,
      total,
    );
    return;
  }
  throw new RetryExhaustedError(plan.logical_run_id, "agent", maxPreAgentAttempts);
};

interface SerializedAgentObservation {
  readonly started_at: string;
  readonly finished_at: string;
  readonly stop_reason: AgentTerminalObservation["stop_reason"];
  readonly raw_provider_ndjson_sha256: string;
  readonly provider_ledger: ProviderLedger;
}

interface DurableAgentObservation {
  readonly schema_version: 1;
  readonly agent: SerializedAgentObservation;
  readonly exposure: ExposureSummary;
}

const serializableAgentObservation = (agent: AgentTerminalObservation): SerializedAgentObservation => ({
  started_at: agent.started_at,
  finished_at: agent.finished_at,
  stop_reason: agent.stop_reason,
  raw_provider_ndjson_sha256: agent.provider_ledger.usage.raw_stream_sha256,
  provider_ledger: agent.provider_ledger,
});

const restoreAgentObservation = (
  plan: LogicalRunPlan,
  storage: DurableStudyStorage,
  observation: DurableAgentObservation,
): AgentTerminalObservation => {
  const raw = readPersistedRawNdjson(storage.runDirectoryPath(plan.logical_run_id));
  const provider_ledger = readProviderLedger({ requested_model: plan.requested_model, raw_ndjson: raw });
  if (provider_ledger.usage.raw_stream_sha256 !== observation.agent.raw_provider_ndjson_sha256) {
    throw new MeasurementIntegrityError(plan.logical_run_id, "retained provider stream differs from agent observation sidecar");
  }
  if (JSON.stringify(provider_ledger) !== JSON.stringify(observation.agent.provider_ledger)) {
    throw new MeasurementIntegrityError(plan.logical_run_id, "retained provider ledger differs from agent observation sidecar");
  }
  return {
    kind: "after-first-model-turn",
    started_at: observation.agent.started_at,
    finished_at: observation.agent.finished_at,
    stop_reason: observation.agent.stop_reason,
    provider_ledger,
    raw_provider_ndjson: raw,
  };
};

/**
 * Public entrypoint for new runs and resumes.  Missing-set computation uses
 * the sealed schedule and immutable per-run `row.json` records — never a glob
 * of prior outputs and never a row overwrite.
 */
export const runStudy = async (
  plan: CdebStudyPlan,
  dependencies: OrchestratorDependencies,
  options: RunStudyOptions,
): Promise<StudyRunResult> => {
  const wiring = frozenWiring(plan.public_freeze);
  const analysisRows = analysisRowsForPlan(plan, wiring);
  const shippingPaths = options.shipping_proxy_paths ?? {
    proxy_path: SHIPPING_PROXY_PATH,
    parser_path: EXPOSURE_PARSER_PATH,
  };
  // The bytes the arm would execute are checked before an attempt checkpoint
  // exists. A modified observer is a changed experiment, never a row.
  assertFrozenShippingProxy(wiring.hook_proxy_sha256, shippingPaths.proxy_path, shippingPaths.parser_path);
  if (plan.logical_runs.length === 0) throw new Error("CDEB study has no logical runs");
  if (plan.randomization.block_count * 2 !== plan.logical_runs.length) {
    throw new Error("CDEB randomization block count does not match its logical run schedule");
  }
  assertBlockedSchedule(plan);
  const maxPreAgentAttempts = MAX_PRE_AGENT_ATTEMPTS;
  const maxEvaluatorAttempts = MAX_EVALUATOR_ATTEMPTS;
  for (const logicalRun of plan.logical_runs) requiredRunId(logicalRun);
  const expectedIds = plan.logical_runs.map((run) => run.logical_run_id);
  if (new Set(expectedIds).size !== expectedIds.length) throw new Error("CDEB logical run schedule has duplicate ids");

  options.storage.recoverUnpublishedPartials();
  options.storage.repairBackupMirrors();
  options.storage.ensureCommittedJson("public-freeze.json", plan.public_freeze);
  options.storage.ensureCommittedJson("randomization.json", plan.randomization);
  options.storage.reconcileNamedRows(analysisRows);
  const completedBefore = options.storage.completedRows(expectedIds);
  let completed = completedBefore.size;
  for (const logicalRun of plan.logical_runs) {
    if (completedBefore.has(logicalRun.logical_run_id)) continue;
    emitProgress(options.progress, logicalRun.logical_run_id, "PLANNED", 0, completed, expectedIds.length);
    await runLogical(
      logicalRun,
      options.storage,
      dependencies,
      maxPreAgentAttempts,
      maxEvaluatorAttempts,
      options.progress,
      completed,
      expectedIds.length,
    );
    completed += 1;
    emitProgress(options.progress, logicalRun.logical_run_id, "MEASURED", 0, completed, expectedIds.length);
  }
  const missing = options.storage.missingLogicalIds(expectedIds);
  return {
    completed_logical_run_ids: expectedIds.filter((id) => !missing.includes(id)),
    missing_logical_run_ids: missing,
  };
};

/** The production bridge from the CDEB-03 runtime to this state machine. */
export interface RuntimeAgentRunnerOptions {
  readonly docker: ContainerRuntimeCommands;
  readonly pin: RuntimePin;
  readonly gate: CapabilityGatePassed;
  readonly provider_env: Readonly<Record<string, string>>;
}

const stopReasonOf = (outcome: AgentRunOutcome): AgentTerminalObservation["stop_reason"] =>
  outcome.timed_out ? "timeout" : outcome.exit_code === 0 ? "completed" : "agent_error";

export const runtimeAgentRunner = (options: RuntimeAgentRunnerOptions): AgentRunner => ({
  run: async ({ plan, workspace, on_first_model_turn }): Promise<AgentExecution> => {
    const startedAt = new Date().toISOString();
    const outDir = mkdtempSync(join(tmpdir(), "cdeb-agent-stream-"));
    let firstTurnObserved = false;
    try {
      const outcome = await executeAgentRun(options.docker, options.pin, options.gate, {
        repositoryPath: workspace.workdir,
        configDir: workspace.config_dir,
        prompt: plan.prompt,
        outDir,
        providerEnv: options.provider_env,
        onFirstModelTurn: () => {
          firstTurnObserved = true;
          on_first_model_turn();
        },
      });
      if (!firstTurnObserved) {
        return { kind: "before-first-model-turn", failure_detail: "agent process ended without a provider model turn" };
      }
      return {
        kind: "after-first-model-turn",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        stop_reason: stopReasonOf(outcome),
        provider_ledger: outcome.ledger,
        raw_provider_ndjson: readPersistedRawNdjson(outDir),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return firstTurnObserved
        ? { kind: "measurement-integrity-failure", failure_detail: detail }
        : { kind: "before-first-model-turn", failure_detail: detail };
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  },
});

/** CDEB-06 freezer plus the PRD §11.1 provenance that CDEB-07 persists. */
export const canonicalFinalTreeFreezer: FinalTreeFreezer = {
  freeze: (workspace): FrozenTreeObservation => {
    const scratch = mkdtempSync(join(tmpdir(), "cdeb-final-tree-"));
    try {
      const frozen = freezeFinalTree(workspace.workdir, scratch);
      const provenance = frozenTreeProvenance(workspace.workdir, scratch, frozen);
      return {
        archive: frozen.archive_zst,
        metadata: {
          schema_version: 1,
          ...provenance,
          final_tree_oid: frozen.final_tree_oid,
          archive_sha256: frozen.archive_zst_sha256,
        },
      };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
};

/**
 * Derives the non-outcome exposure facts from the CDEB-04 append-only log.
 * Callers supply the first-mutation fact because it belongs to the frozen
 * runtime observation, not to the shipping-output parser.
 */
export const summarizeExposure = (
  exposurePath: string,
  expectedRecordIds: readonly string[],
  deliveredBeforeFirstMutation: boolean,
): ExposureSummary => {
  const events = readExposureEvents(exposurePath);
  const delivered = [...new Set(events.flatMap((event) => event.parsed_record_ids ?? []))].sort();
  const payloads = [...new Set(events.flatMap((event) => event.payload_sha256 === null ? [] : [event.payload_sha256]))].sort();
  return {
    instrumentation_complete: true,
    hook_opportunities: events.length,
    proxy_executions: events.length,
    expected_record_delivered: expectedRecordIds.every((id) => delivered.includes(id)),
    delivered_before_first_mutation: deliveredBeforeFirstMutation,
    delivered_record_ids: delivered,
    payload_sha256s: payloads,
    product_failures: events.filter((event) => event.product_error !== null || event.child_exit_code !== 0).length,
    exposure_log_sha256: exposureLogSha256(exposurePath),
  };
};

export interface OciEvaluatorRunnerOptions {
  readonly image_ref: string;
  readonly sealed_tasks_dir: string;
  readonly image_digest: string;
}

export const ociEvaluatorRunner = (options: OciEvaluatorRunnerOptions): EvaluatorRunner => ({
  evaluate: async ({ plan, archive_path, final_tree }): Promise<EvaluatorExecution> => {
    try {
      const result = runEvaluatorOci({
        imageRef: options.image_ref,
        archivePath: archive_path,
        tasksDir: options.sealed_tasks_dir,
        taskId: plan.task_id,
        claimedOid: final_tree.final_tree_oid,
        imageDigest: options.image_digest,
      });
      if (result.exitCode !== 0) {
        return { kind: "infrastructure-failure", failure_detail: result.stderr || `evaluator exited ${String(result.exitCode)}` };
      }
      const text = result.stdout.toString("utf8");
      let verdict: unknown;
      try {
        verdict = JSON.parse(text);
      } catch {
        return { kind: "infrastructure-failure", failure_detail: "evaluator stdout was not JSON" };
      }
      if (typeof verdict !== "object" || verdict === null || Array.isArray(verdict)) {
        return { kind: "infrastructure-failure", failure_detail: "evaluator stdout was not an object" };
      }
      return { kind: "verdict", verdict: verdict as EvaluatorOutput };
    } catch (error) {
      return { kind: "infrastructure-failure", failure_detail: error instanceof Error ? error.message : String(error) };
    }
  },
});
