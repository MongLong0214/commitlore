/**
 * CDEB-08 registered analyzer (PRD §§14–17, §22.6, §23).
 *
 * Its first job is refusal.  The public freeze names the row files that form
 * the matrix; this module reads that list and nothing discovered from disk.
 * Files which happen to sit beside the matrix are findings, never data.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * How many repositories a freeze must name (PRD §3.3).
 *
 * Four since 2026-08-19. The census of every local repository that carries
 * records found six, and four with the density to supply the six tasks each
 * that §3.3 also requires; the other two hold three records and one. A fifth
 * is adoption rather than code.
 *
 * Named once here because the number is a corpus decision, and it was
 * previously written out twice as the word "five" in two failure messages --
 * so the document could be amended while the gate went on refusing.
 */
const CORPUS_REPOSITORIES = 4;

/**
 * The per-repository floor, and the corpus total it has to add up to.
 *
 * Thirty does not divide by four, and the 2026-08-19 amendment kept the total
 * rather than the equal share: shrinking to twenty-four would have invalidated
 * §16.3's preregistered power simulation, which is computed on thirty tasks.
 * So six is a floor and the total is checked separately -- an equality check
 * per repository would refuse the very shape the amendment describes.
 */
const MIN_TASKS_PER_REPOSITORY = 6;
const CORPUS_TASKS = 30;

export const BOOTSTRAP_REPLICATES = 10_000;
export const MIN_FINITE_TOKEN_REPLICATES = 9_900;
export const TOKEN_VOLUME_REDUCTION_THRESHOLD = 0.15;
export const SAFE_SUCCESS_LIFT_THRESHOLD = 0.10;
export const REVIVAL_REDUCTION_THRESHOLD = 0.30;
export const MIN_SAFE_SUCCESSES_PER_ARM = 10;
export const MIN_OFF_REVIVALS = 10;

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RESULTS_ROOT = join(HERE, "..", "results", "cdeb");
const ANALYSIS_SOURCE = fileURLToPath(import.meta.url);

const ARMS = ["commitlore-on", "commitlore-off"] as const;
type Arm = (typeof ARMS)[number];

const STOP_REASONS = ["completed", "timeout", "agent_error", "provider_error_after_start"] as const;
const CATEGORIES = [
  "rejected-architecture",
  "rejected-workaround",
  "compatibility-constraint",
  "security-operational",
  "superseded-lifecycle",
] as const;

const CATEGORY_QUOTAS: Readonly<Record<(typeof CATEGORIES)[number], number>> = {
  "rejected-architecture": 12,
  "rejected-workaround": 8,
  "compatibility-constraint": 5,
  "security-operational": 3,
  "superseded-lifecycle": 2,
};

type GateStatus = "PASS" | "FAIL" | "NOT MEASURABLE" | "OPPORTUNITY FAILURE";

interface MeasuredUsage {
  readonly availability: "measured";
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens: number;
  readonly cache_read_input_tokens: number;
  readonly total_token_volume: number;
}

interface UnavailableUsage {
  readonly availability: "unavailable";
  readonly reasons: readonly string[];
}

type Usage = MeasuredUsage | UnavailableUsage;

interface Row {
  readonly benchmark: "cdeb-v1";
  readonly protocol_version: string;
  readonly study_id: string;
  readonly logical_run_id: string;
  readonly repository_id: string;
  readonly task_id: string;
  readonly category: (typeof CATEGORIES)[number];
  readonly condition: Arm;
  readonly repeat: number;
  readonly freeze_manifest_sha256: string;
  readonly sealed_task_bundle_sha256: string;
  readonly repository_bundle_sha256: string;
  readonly repository_snapshot: string;
  readonly base_tree_oid: string;
  readonly requested_model: string;
  readonly observed_model_ids: readonly string[];
  readonly agent_cli_version: string;
  readonly agent_runtime_image_digest: string;
  readonly product_commit: string;
  readonly dist_digest: string;
  readonly usage: Usage;
  readonly stop_reason: (typeof STOP_REASONS)[number];
  readonly evaluation: {
    readonly evaluator_image_digest: string;
    readonly evaluator_attempts: number;
    readonly functional_pass: boolean;
    /** Null when the evaluator could not judge the tree at all. */
    readonly rejected_decision_revived: boolean | null;
  };
  readonly exposure: {
    readonly hook_opportunities: number;
    readonly proxy_executions: number;
    readonly product_failures: number;
    readonly delivered_record_ids: readonly string[];
  };
  readonly decision_safe_success: boolean;
  readonly simulated: boolean;
}

interface FrozenRepository {
  readonly repository_id: string;
  readonly bundle_sha256: string;
  readonly snapshot_commit: string;
  readonly snapshot_tree_oid: string;
}

interface Freeze {
  readonly benchmark: "cdeb-v1";
  readonly protocol_version: string;
  readonly study_id: string;
  readonly sealed_task_bundle_sha256: string;
  readonly repository_bundles: readonly FrozenRepository[];
  readonly agent_runtime_image_digest: string;
  readonly requested_model: string;
  readonly observed_model_id: string;
  readonly agent_cli_version: string;
  readonly product_commit: string;
  readonly dist_digest: string;
  readonly evaluator_image_digests: readonly string[];
  readonly analysis_source_digest: string;
  readonly bootstrap_seed: string;
  readonly calibrated_overhead: number;
  readonly claim_thresholds: {
    readonly safe_success_lift_pp: number;
    readonly token_volume_reduction: number;
    readonly revival_reduction: number;
    readonly min_off_revivals: number;
    readonly min_safe_successes_per_arm: number;
    readonly min_finite_replicates: number;
  };
  readonly expected_logical_runs: number;
  readonly analysis_inputs: {
    readonly row_files: readonly string[];
  };
}

interface TaskUnit {
  readonly repository_id: string;
  readonly task_id: string;
  readonly category: string;
  readonly on: readonly Row[];
  readonly off: readonly Row[];
}

interface Interval {
  readonly lower: number;
  readonly upper: number;
}

interface BootstrapDistribution {
  readonly replicates: number;
  readonly finite_replicates: number;
  readonly interval_95: Interval | null;
  /** A finite-replicate bootstrap tail probability, never a zero-resolution p-value. */
  readonly tail_p: number | null;
}

interface TokenBootstrapDistribution extends BootstrapDistribution {
  /** Replicates for which TVPDSS itself existed in both arms. */
  readonly finite_tvpdss_replicates: number;
}

interface UsageGap {
  readonly logical_run_id: string;
  readonly reasons: readonly string[];
}

export interface AnalysisResult {
  readonly schema_version: 1;
  readonly benchmark: "cdeb-v1";
  readonly study_id: string;
  readonly source: {
    readonly freeze_file: "public-freeze.json";
    readonly freeze_sha256: string;
    readonly analysis_source_sha256: string;
    readonly bootstrap_seed: string;
    readonly row_files: readonly string[];
  };
  readonly matrix: {
    readonly rows: number;
    readonly tasks: number;
    readonly repositories: number;
    readonly by_arm: Readonly<Record<Arm, number>>;
    readonly task_ids: readonly string[];
  };
  readonly metrics: {
    readonly safe_success: {
      readonly on: number;
      readonly off: number;
      readonly assigned_per_arm: number;
      readonly lift: number;
    };
    readonly token: {
      readonly availability: "measured" | "unavailable";
      readonly unavailable_runs: readonly UsageGap[];
      readonly total_volume: Readonly<Record<Arm, number | null>>;
      readonly tvpdss: Readonly<Record<Arm, number | null>>;
      readonly reduction: number | null;
      readonly volume_per_assigned_run: Readonly<Record<Arm, number | null>>;
      readonly safe_successes_per_million_tokens: Readonly<Record<Arm, number | null>>;
      readonly category_totals: Readonly<Record<Arm, Readonly<Record<string, number>> | null>>;
      readonly reason: string | null;
    };
    readonly revival: {
      readonly on: number;
      readonly off: number;
      /** Runs whose decision was judged at all; the denominator these rest on. */
      readonly evaluable_on: number;
      readonly evaluable_off: number;
      readonly assigned_per_arm: number;
      readonly relative_reduction: number | null;
      /** ON rate − OFF rate: the inferential metric (§16.5). */
      readonly absolute_difference: number;
    };
  };
  readonly bootstrap: {
    readonly safe_success_lift: BootstrapDistribution;
    readonly token_volume_reduction: TokenBootstrapDistribution;
    readonly revival_absolute_difference: BootstrapDistribution;
  };
  readonly gates: {
    readonly performance: { readonly status: GateStatus; readonly reasons: readonly string[] };
    readonly token_efficiency: { readonly status: GateStatus; readonly reasons: readonly string[] };
    readonly mechanism: { readonly status: GateStatus; readonly reasons: readonly string[] };
    readonly core_behavior_headline: "PASS" | "FAIL";
    readonly token_claim: GateStatus;
    readonly combined_headline: "PASS" | "FAIL";
  };
  readonly appendix: {
    readonly categories: Readonly<Record<string, number>>;
    readonly stop_reasons: Readonly<Record<Arm, Readonly<Record<string, number>>>>;
    readonly exposure: Readonly<Record<Arm, { readonly opportunities: number; readonly deliveries: number; readonly product_failures: number }>>;
    readonly evaluator: { readonly attempts: number; readonly retries: number };
    readonly provenance: Readonly<Record<string, readonly string[]>>;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (message: string): never => {
  throw new Error(`CDEB analysis refused: ${message}`);
};

const requireRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) return fail(`${path} must be an object`);
  return value;
};

const requireString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value === "") return fail(`${path} must be a non-empty string`);
  return value;
};

const requireBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") return fail(`${path} must be a boolean`);
  return value;
};

const requireInteger = (value: unknown, path: string, minimum: number = 0): number => {
  if (!Number.isInteger(value) || (value as number) < minimum) fail(`${path} must be an integer >= ${minimum}`);
  return value as number;
};

const requireNumber = (value: unknown, path: string, minimum: number = 0): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) return fail(`${path} must be a finite number >= ${minimum}`);
  return value;
};

const requireStringArray = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value)) return fail(`${path} must be an array`);
  return value.map((item, index) => requireString(item, `${path}[${index}]`));
};

const has = (record: Record<string, unknown>, name: string): unknown => record[name];

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

/** The digest that must be frozen before the matrix is executed (§18.1). */
export const analysisSourceDigest = (): string => sha256(readFileSync(ANALYSIS_SOURCE));

const parseUsage = (value: unknown, path: string): Usage => {
  const usage = requireRecord(value, path);
  const availability = requireString(has(usage, "availability"), `${path}.availability`);
  if (availability === "measured") {
    const input = requireInteger(has(usage, "input_tokens"), `${path}.input_tokens`);
    const output = requireInteger(has(usage, "output_tokens"), `${path}.output_tokens`);
    const created = requireInteger(has(usage, "cache_creation_input_tokens"), `${path}.cache_creation_input_tokens`);
    const read = requireInteger(has(usage, "cache_read_input_tokens"), `${path}.cache_read_input_tokens`);
    const total = requireInteger(has(usage, "total_token_volume"), `${path}.total_token_volume`);
    if (total !== input + output + created + read) {
      fail(`${path}.total_token_volume does not equal its raw token category sum`);
    }
    return {
      availability,
      input_tokens: input,
      output_tokens: output,
      cache_creation_input_tokens: created,
      cache_read_input_tokens: read,
      total_token_volume: total,
    };
  }
  if (availability === "unavailable") {
    const reasons = requireStringArray(has(usage, "reasons"), `${path}.reasons`);
    if (reasons.length === 0) fail(`${path}.reasons must name at least one usage gap`);
    for (const numeric of [
      "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "total_token_volume",
    ]) {
      if (numeric in usage) fail(`${path} is unavailable but carries ${numeric}`);
    }
    return { availability, reasons };
  }
  return fail(`${path}.availability must be measured or unavailable`);
};

const parseRow = (value: unknown, path: string): Row => {
  const row = requireRecord(value, path);
  const benchmark = requireString(has(row, "benchmark"), `${path}.benchmark`);
  if (benchmark !== "cdeb-v1") fail(`${path}.benchmark must be cdeb-v1`);
  const condition = requireString(has(row, "condition"), `${path}.condition`);
  if (!(ARMS as readonly string[]).includes(condition)) fail(`${path}.condition is not a CDEB arm`);
  const stopReason = requireString(has(row, "stop_reason"), `${path}.stop_reason`);
  if (!(STOP_REASONS as readonly string[]).includes(stopReason)) fail(`${path}.stop_reason is not a CDEB stop reason`);
  const category = requireString(has(row, "category"), `${path}.category`);
  if (!(CATEGORIES as readonly string[]).includes(category)) fail(`${path}.category is not a CDEB category`);

  const evaluation = requireRecord(has(row, "evaluation"), `${path}.evaluation`);
  const exposure = requireRecord(has(row, "exposure"), `${path}.exposure`);
  const observed = requireStringArray(has(row, "observed_model_ids"), `${path}.observed_model_ids`);
  const logicalRunId = requireString(has(row, "logical_run_id"), `${path}.logical_run_id`);
  const repeat = requireInteger(has(row, "repeat"), `${path}.repeat`, 1);
  if (repeat > 3) fail(`${path}.repeat must be at most 3`);
  const functionalPass = requireBoolean(has(evaluation, "functional_pass"), `${path}.evaluation.functional_pass`);
  // Null means the tree could not be judged. It is deliberately not folded to
  // `false` here: `false` is the claim that the rejected approach is absent,
  // and an unread tree supports no claim either way.
  const revivedRaw = has(evaluation, "rejected_decision_revived");
  const revived = revivedRaw === null ? null
    : requireBoolean(revivedRaw, `${path}.evaluation.rejected_decision_revived`);
  // A run whose decision could not be evaluated is not a decision-safe success:
  // DSS requires an evaluable final tree, so `revived === false` rather than
  // `!revived`, which would let null through.
  const expectedSafe = stopReason === "completed" && functionalPass && revived === false;
  const declaredSafe = requireBoolean(has(row, "decision_safe_success"), `${path}.decision_safe_success`);
  if (declaredSafe !== expectedSafe) fail(`${path}.decision_safe_success does not match raw stop/evaluator fields`);

  return {
    benchmark: "cdeb-v1",
    protocol_version: requireString(has(row, "protocol_version"), `${path}.protocol_version`),
    study_id: requireString(has(row, "study_id"), `${path}.study_id`),
    logical_run_id: logicalRunId,
    repository_id: requireString(has(row, "repository_id"), `${path}.repository_id`),
    task_id: requireString(has(row, "task_id"), `${path}.task_id`),
    category: category as Row["category"],
    condition: condition as Arm,
    repeat,
    freeze_manifest_sha256: requireString(has(row, "freeze_manifest_sha256"), `${path}.freeze_manifest_sha256`),
    sealed_task_bundle_sha256: requireString(has(row, "sealed_task_bundle_sha256"), `${path}.sealed_task_bundle_sha256`),
    repository_bundle_sha256: requireString(has(row, "repository_bundle_sha256"), `${path}.repository_bundle_sha256`),
    repository_snapshot: requireString(has(row, "repository_snapshot"), `${path}.repository_snapshot`),
    base_tree_oid: requireString(has(row, "base_tree_oid"), `${path}.base_tree_oid`),
    requested_model: requireString(has(row, "requested_model"), `${path}.requested_model`),
    observed_model_ids: observed,
    agent_cli_version: requireString(has(row, "agent_cli_version"), `${path}.agent_cli_version`),
    agent_runtime_image_digest: requireString(has(row, "agent_runtime_image_digest"), `${path}.agent_runtime_image_digest`),
    product_commit: requireString(has(row, "product_commit"), `${path}.product_commit`),
    dist_digest: requireString(has(row, "dist_digest"), `${path}.dist_digest`),
    usage: parseUsage(has(row, "usage"), `${path}.usage`),
    stop_reason: stopReason as Row["stop_reason"],
    evaluation: {
      evaluator_image_digest: requireString(has(evaluation, "evaluator_image_digest"), `${path}.evaluation.evaluator_image_digest`),
      evaluator_attempts: requireInteger(has(evaluation, "evaluator_attempts"), `${path}.evaluation.evaluator_attempts`, 1),
      functional_pass: functionalPass,
      rejected_decision_revived: revived,
    },
    exposure: {
      hook_opportunities: requireInteger(has(exposure, "hook_opportunities"), `${path}.exposure.hook_opportunities`),
      proxy_executions: requireInteger(has(exposure, "proxy_executions"), `${path}.exposure.proxy_executions`),
      product_failures: requireInteger(has(exposure, "product_failures"), `${path}.exposure.product_failures`),
      delivered_record_ids: requireStringArray(has(exposure, "delivered_record_ids"), `${path}.exposure.delivered_record_ids`),
    },
    decision_safe_success: declaredSafe,
    simulated: requireBoolean(has(row, "simulated"), `${path}.simulated`),
  };
};

const parseFreeze = (value: unknown, path: string): Freeze => {
  const freeze = requireRecord(value, path);
  const inputs = requireRecord(has(freeze, "analysis_inputs"), `${path}.analysis_inputs`);
  const rowFiles = requireStringArray(has(inputs, "row_files"), `${path}.analysis_inputs.row_files`);
  if (new Set(rowFiles).size !== rowFiles.length) fail(`${path}.analysis_inputs.row_files contains duplicate paths`);
  if (rowFiles.length !== 180) fail(`${path}.analysis_inputs.row_files must name exactly 180 rows`);
  for (const rowFile of rowFiles) {
    if (!/^rows\/[a-z0-9][a-z0-9._-]*\.json$/.test(rowFile)) {
      fail(`${path}.analysis_inputs.row_files contains unsafe or non-canonical path ${JSON.stringify(rowFile)}`);
    }
  }

  const repositories = has(freeze, "repository_bundles");
  if (!Array.isArray(repositories) || repositories.length !== CORPUS_REPOSITORIES)
    return fail(`${path}.repository_bundles must name ${String(CORPUS_REPOSITORIES)} repositories`);
  const parsedRepositories = repositories.map((item, index) => {
    const repository = requireRecord(item, `${path}.repository_bundles[${index}]`);
    return {
      repository_id: requireString(has(repository, "repository_id"), `${path}.repository_bundles[${index}].repository_id`),
      bundle_sha256: requireString(has(repository, "bundle_sha256"), `${path}.repository_bundles[${index}].bundle_sha256`),
      snapshot_commit: requireString(has(repository, "snapshot_commit"), `${path}.repository_bundles[${index}].snapshot_commit`),
      snapshot_tree_oid: requireString(has(repository, "snapshot_tree_oid"), `${path}.repository_bundles[${index}].snapshot_tree_oid`),
    };
  });
  if (new Set(parsedRepositories.map((repository) => repository.repository_id)).size !== CORPUS_REPOSITORIES) {
    fail(`${path}.repository_bundles contains duplicate repository IDs`);
  }
  const thresholds = requireRecord(has(freeze, "claim_thresholds"), `${path}.claim_thresholds`);
  const parsedThresholds = {
    safe_success_lift_pp: requireNumber(has(thresholds, "safe_success_lift_pp"), `${path}.claim_thresholds.safe_success_lift_pp`),
    token_volume_reduction: requireNumber(has(thresholds, "token_volume_reduction"), `${path}.claim_thresholds.token_volume_reduction`),
    revival_reduction: requireNumber(has(thresholds, "revival_reduction"), `${path}.claim_thresholds.revival_reduction`),
    min_off_revivals: requireInteger(has(thresholds, "min_off_revivals"), `${path}.claim_thresholds.min_off_revivals`),
    min_safe_successes_per_arm: requireInteger(has(thresholds, "min_safe_successes_per_arm"), `${path}.claim_thresholds.min_safe_successes_per_arm`),
    min_finite_replicates: requireInteger(has(thresholds, "min_finite_replicates"), `${path}.claim_thresholds.min_finite_replicates`),
  };
  if (
    parsedThresholds.safe_success_lift_pp !== SAFE_SUCCESS_LIFT_THRESHOLD * 100 ||
    parsedThresholds.token_volume_reduction !== TOKEN_VOLUME_REDUCTION_THRESHOLD ||
    parsedThresholds.revival_reduction !== REVIVAL_REDUCTION_THRESHOLD ||
    parsedThresholds.min_off_revivals !== MIN_OFF_REVIVALS ||
    parsedThresholds.min_safe_successes_per_arm !== MIN_SAFE_SUCCESSES_PER_ARM ||
    parsedThresholds.min_finite_replicates !== MIN_FINITE_TOKEN_REPLICATES
  ) {
    fail(`${path}.claim_thresholds does not contain CDEB v1's fixed claim gates`);
  }

  const benchmark = requireString(has(freeze, "benchmark"), `${path}.benchmark`);
  if (benchmark !== "cdeb-v1") fail(`${path}.benchmark must be cdeb-v1`);
  const expectedRuns = requireInteger(has(freeze, "expected_logical_runs"), `${path}.expected_logical_runs`);
  if (expectedRuns !== 180) fail(`${path}.expected_logical_runs must be 180`);
  return {
    benchmark: "cdeb-v1",
    protocol_version: requireString(has(freeze, "protocol_version"), `${path}.protocol_version`),
    study_id: requireString(has(freeze, "study_id"), `${path}.study_id`),
    sealed_task_bundle_sha256: requireString(has(freeze, "sealed_task_bundle_sha256"), `${path}.sealed_task_bundle_sha256`),
    repository_bundles: parsedRepositories,
    agent_runtime_image_digest: requireString(has(freeze, "agent_runtime_image_digest"), `${path}.agent_runtime_image_digest`),
    requested_model: requireString(has(freeze, "requested_model"), `${path}.requested_model`),
    observed_model_id: requireString(has(freeze, "observed_model_id"), `${path}.observed_model_id`),
    agent_cli_version: requireString(has(freeze, "agent_cli_version"), `${path}.agent_cli_version`),
    product_commit: requireString(has(freeze, "product_commit"), `${path}.product_commit`),
    dist_digest: requireString(has(freeze, "dist_digest"), `${path}.dist_digest`),
    evaluator_image_digests: requireStringArray(has(freeze, "evaluator_image_digests"), `${path}.evaluator_image_digests`),
    analysis_source_digest: requireString(has(freeze, "analysis_source_digest"), `${path}.analysis_source_digest`),
    bootstrap_seed: requireString(has(freeze, "bootstrap_seed"), `${path}.bootstrap_seed`),
    calibrated_overhead: requireNumber(has(freeze, "calibrated_overhead"), `${path}.calibrated_overhead`),
    claim_thresholds: parsedThresholds,
    expected_logical_runs: expectedRuns,
    analysis_inputs: { row_files: rowFiles },
  };
};

const assertRowsAreFreezeNamed = (studyDirectory: string, rowFiles: readonly string[]): void => {
  const rowsDirectory = join(studyDirectory, "rows");
  if (!existsSync(rowsDirectory) || !lstatSync(rowsDirectory).isDirectory()) {
    fail(`rows directory is missing — the freeze names ${rowFiles.length} row inputs`);
  }
  const expectedNames = new Set(rowFiles.map((rowFile) => rowFile.slice("rows/".length)));
  for (const name of readdirSync(rowsDirectory).sort()) {
    const path = join(rowsDirectory, name);
    if (!lstatSync(path).isFile()) fail(`rows/${name} is not a row file named by the freeze`);
    if (!expectedNames.has(name)) {
      fail(`rows/${name} is present on disk but absent from freeze analysis_inputs.row_files; it is a finding, not an input`);
    }
  }
  for (const rowFile of rowFiles) {
    const path = join(studyDirectory, rowFile);
    if (!existsSync(path) || !lstatSync(path).isFile()) fail(`${rowFile} is named by the freeze but missing`);
  }
};

const assertRowMatchesFreeze = (row: Row, freeze: Freeze, freezeSha: string, path: string): void => {
  if (row.study_id !== freeze.study_id) fail(`${path}: row study_id does not match the freeze`);
  if (row.protocol_version !== freeze.protocol_version) fail(`${path}: row protocol_version does not match the freeze`);
  if (row.freeze_manifest_sha256 !== freezeSha) fail(`${path}: row freeze_manifest_sha256 does not match public-freeze.json`);
  if (row.sealed_task_bundle_sha256 !== freeze.sealed_task_bundle_sha256) fail(`${path}: row sealed_task_bundle_sha256 does not match the freeze`);
  if (row.requested_model !== freeze.requested_model) fail(`${path}: row requested_model does not match the freeze`);
  if (row.observed_model_ids.length !== 1 || row.observed_model_ids[0] !== freeze.observed_model_id) {
    fail(`${path}: row observed_model_ids does not exactly match the frozen observation`);
  }
  if (row.agent_cli_version !== freeze.agent_cli_version) fail(`${path}: row agent_cli_version does not match the freeze`);
  if (row.agent_runtime_image_digest !== freeze.agent_runtime_image_digest) fail(`${path}: row agent_runtime_image_digest does not match the freeze`);
  if (row.product_commit !== freeze.product_commit || row.dist_digest !== freeze.dist_digest) {
    fail(`${path}: row product identity does not match the freeze`);
  }
  if (!freeze.evaluator_image_digests.includes(row.evaluation.evaluator_image_digest)) {
    fail(`${path}: row evaluator image is not frozen`);
  }
  const repository = freeze.repository_bundles.find((item) => item.repository_id === row.repository_id);
  if (repository === undefined) return fail(`${path}: row repository_id is not named by the freeze`);
  if (row.repository_bundle_sha256 !== repository.bundle_sha256) fail(`${path}: row repository bundle does not match the freeze`);
  if (row.repository_snapshot !== repository.snapshot_commit || row.base_tree_oid !== repository.snapshot_tree_oid) {
    fail(`${path}: row repository snapshot does not match the freeze`);
  }
  if (row.simulated) fail(`${path}: simulated rows are never publishable CDEB input`);
};

const taskKey = (row: Pick<Row, "repository_id" | "task_id">): string => `${row.repository_id}\u0000${row.task_id}`;

const buildTaskUnits = (rows: readonly Row[]): readonly TaskUnit[] => {
  const byTask = new Map<string, Row[]>();
  const logicalIds = new Set<string>();
  for (const row of rows) {
    if (logicalIds.has(row.logical_run_id)) fail(`duplicate logical_run_id ${row.logical_run_id}`);
    logicalIds.add(row.logical_run_id);
    const key = taskKey(row);
    const existing = byTask.get(key);
    if (existing === undefined) byTask.set(key, [row]);
    else existing.push(row);
  }
  if (byTask.size !== 30) fail(`matrix has ${byTask.size} task cells, not the required 30`);

  const repositories = new Map<string, number>();
  const tasks: TaskUnit[] = [];
  for (const [key, taskRows] of byTask) {
    const first = taskRows[0] as Row;
    repositories.set(first.repository_id, (repositories.get(first.repository_id) ?? 0) + 1);
    if (taskRows.length !== 6) fail(`task ${key} has ${taskRows.length} rows, not 3 paired repeats per arm`);
    if (new Set(taskRows.map((row) => row.category)).size !== 1) fail(`task ${key} has inconsistent categories`);
    const on = taskRows.filter((row) => row.condition === "commitlore-on").sort((a, b) => a.repeat - b.repeat);
    const off = taskRows.filter((row) => row.condition === "commitlore-off").sort((a, b) => a.repeat - b.repeat);
    for (const [arm, armRows] of [["commitlore-on", on], ["commitlore-off", off]] as const) {
      if (armRows.length !== 3) fail(`task ${key} has ${armRows.length} ${arm} rows, not three`);
      for (const [index, row] of armRows.entries()) {
        const expectedRepeat = index + 1;
        if (row.repeat !== expectedRepeat) fail(`task ${key} ${arm} is missing repeat ${expectedRepeat}`);
        const suffix = arm === "commitlore-on" ? "on" : "off";
        if (!row.logical_run_id.endsWith(`__${suffix}__r${expectedRepeat}`)) {
          fail(`task ${key} ${arm} repeat ${expectedRepeat} has a mismatched logical_run_id`);
        }
      }
    }
    tasks.push({ repository_id: first.repository_id, task_id: first.task_id, category: first.category, on, off });
  }
  if (repositories.size !== CORPUS_REPOSITORIES)
    fail(`matrix has ${String(repositories.size)} repositories, not the required ${String(CORPUS_REPOSITORIES)}`);
  const totalTasks = [...repositories.values()].reduce((sum, count) => sum + count, 0);
  if (totalTasks !== CORPUS_TASKS)
    fail(`matrix has ${String(totalTasks)} tasks, not the required ${String(CORPUS_TASKS)}`);
  for (const [repository, count] of repositories) {
    if (count < MIN_TASKS_PER_REPOSITORY)
      fail(
        `repository ${repository} has ${String(count)} tasks, fewer than the required ${String(MIN_TASKS_PER_REPOSITORY)}`,
      );
  }
  for (const category of CATEGORIES) {
    const actual = tasks.filter((task) => task.category === category).length;
    if (actual !== CATEGORY_QUOTAS[category]) {
      fail(`matrix has ${actual} ${category} tasks, not the frozen quota of ${CATEGORY_QUOTAS[category]}`);
    }
  }
  return tasks.sort((a, b) => `${a.repository_id}\u0000${a.task_id}`.localeCompare(`${b.repository_id}\u0000${b.task_id}`));
};

const count = (rows: readonly Row[], predicate: (row: Row) => boolean): number => rows.filter(predicate).length;

const taskSafe = (task: TaskUnit, arm: Arm): number => count(arm === "commitlore-on" ? task.on : task.off, (row) => row.decision_safe_success);
const taskRevived = (task: TaskUnit, arm: Arm): number =>
  count(arm === "commitlore-on" ? task.on : task.off, (row) => row.evaluation.rejected_decision_revived === true);

/** Runs whose decision the evaluator actually judged, either way. */
const taskRevivalEvaluable = (task: TaskUnit, arm: Arm): number =>
  count(arm === "commitlore-on" ? task.on : task.off, (row) => row.evaluation.rejected_decision_revived !== null);

const measuredUsage = (rows: readonly Row[]): rows is readonly (Row & { readonly usage: MeasuredUsage })[] =>
  rows.every((row) => row.usage.availability === "measured");

interface TokenSample {
  readonly onVolume: number;
  readonly offVolume: number;
  readonly onSuccesses: number;
  readonly offSuccesses: number;
  readonly onTvpdss: number | null;
  readonly offTvpdss: number | null;
  readonly reduction: number | null;
}

interface Sample {
  readonly safeLift: number;
  readonly revivalDifference: number;
  readonly token: TokenSample | null;
}

const calculateSample = (tasks: readonly TaskUnit[], hasCompleteUsage: boolean): Sample => {
  const repeatCount = 3;
  let lift = 0;
  let revivalDifference = 0;
  let onSuccesses = 0;
  let offSuccesses = 0;
  let onVolume = 0;
  let offVolume = 0;
  for (const task of tasks) {
    const onSafe = taskSafe(task, "commitlore-on");
    const offSafe = taskSafe(task, "commitlore-off");
    lift += (onSafe - offSafe) / repeatCount;
    revivalDifference += (taskRevived(task, "commitlore-on") - taskRevived(task, "commitlore-off")) / repeatCount;
    onSuccesses += onSafe;
    offSuccesses += offSafe;
    if (hasCompleteUsage) {
      for (const row of task.on) onVolume += (row.usage as MeasuredUsage).total_token_volume;
      for (const row of task.off) offVolume += (row.usage as MeasuredUsage).total_token_volume;
    }
  }
  const safeLift = lift / tasks.length;
  const absoluteDifference = revivalDifference / tasks.length;
  if (!hasCompleteUsage) return { safeLift, revivalDifference: absoluteDifference, token: null };

  const onTvpdss = onSuccesses === 0 ? null : onVolume / onSuccesses;
  const offTvpdss = offSuccesses === 0 ? null : offVolume / offSuccesses;
  return {
    safeLift,
    revivalDifference: absoluteDifference,
    token: {
      onVolume,
      offVolume,
      onSuccesses,
      offSuccesses,
      onTvpdss,
      offTvpdss,
      reduction: onTvpdss === null || offTvpdss === null || offTvpdss === 0 ? null : 1 - onTvpdss / offTvpdss,
    },
  };
};

/** Fixed FNV-1a seed derivation and Mulberry32 PRNG (§16.2). */
const seededRandom = (seedText: string): (() => number) => {
  let state = 0x811c9dc5;
  for (const byte of Buffer.from(seedText, "utf8")) {
    state ^= byte;
    state = Math.imul(state, 0x01000193);
  }
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const percentile = (values: readonly number[], percentileValue: number): Interval | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const interpolate = (fraction: number): number => {
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const weight = position - lower;
    return (sorted[lower] as number) * (1 - weight) + (sorted[upper] as number) * weight;
  };
  return { lower: interpolate(percentileValue), upper: interpolate(1 - percentileValue) };
};

const tailProbability = (values: readonly number[], direction: "positive" | "negative"): number | null => {
  if (values.length === 0) return null;
  const opposite = values.filter((value) => direction === "positive" ? value <= 0 : value >= 0).length;
  // A 10,000-replicate procedure has 1/10,001, not zero, as its finest tail
  // resolution. This is a descriptive diagnostic, not a claim gate (§16.8).
  return (opposite + 1) / (values.length + 1);
};

const bootstrap = (tasks: readonly TaskUnit[], seed: string, completeUsage: boolean): AnalysisResult["bootstrap"] => {
  const byRepository = new Map<string, TaskUnit[]>();
  for (const task of tasks) {
    const current = byRepository.get(task.repository_id);
    if (current === undefined) byRepository.set(task.repository_id, [task]);
    else current.push(task);
  }
  const strata = [...byRepository.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, repositoryTasks]) => [...repositoryTasks].sort((left, right) => left.task_id.localeCompare(right.task_id)));
  const random = seededRandom(seed);
  const safeLiftSamples: number[] = [];
  const revivalSamples: number[] = [];
  const tokenReductionSamples: number[] = [];
  let finiteTvpdssReplicates = 0;

  for (let replicate = 0; replicate < BOOTSTRAP_REPLICATES; replicate += 1) {
    const sampled: TaskUnit[] = [];
    for (const stratum of strata) {
      for (let index = 0; index < stratum.length; index += 1) {
        sampled.push(stratum[Math.floor(random() * stratum.length)] as TaskUnit);
      }
    }
    const metrics = calculateSample(sampled, completeUsage);
    safeLiftSamples.push(metrics.safeLift);
    revivalSamples.push(metrics.revivalDifference);
    const token = metrics.token;
    if (token !== null && token.onTvpdss !== null && token.offTvpdss !== null) {
      finiteTvpdssReplicates += 1;
      if (token.reduction !== null && Number.isFinite(token.reduction)) tokenReductionSamples.push(token.reduction);
    }
  }

  return {
    safe_success_lift: {
      replicates: BOOTSTRAP_REPLICATES,
      finite_replicates: safeLiftSamples.length,
      interval_95: percentile(safeLiftSamples, 0.025),
      tail_p: tailProbability(safeLiftSamples, "positive"),
    },
    token_volume_reduction: {
      replicates: BOOTSTRAP_REPLICATES,
      finite_replicates: tokenReductionSamples.length,
      finite_tvpdss_replicates: finiteTvpdssReplicates,
      interval_95: percentile(tokenReductionSamples, 0.025),
      tail_p: tailProbability(tokenReductionSamples, "positive"),
    },
    revival_absolute_difference: {
      replicates: BOOTSTRAP_REPLICATES,
      finite_replicates: revivalSamples.length,
      interval_95: percentile(revivalSamples, 0.025),
      tail_p: tailProbability(revivalSamples, "negative"),
    },
  };
};

const status = (passed: boolean): "PASS" | "FAIL" => passed ? "PASS" : "FAIL";

const gatesFor = (
  metrics: AnalysisResult["metrics"],
  bootstrapMetrics: AnalysisResult["bootstrap"],
): AnalysisResult["gates"] => {
  const performanceReasons: string[] = [];
  const performanceInterval = bootstrapMetrics.safe_success_lift.interval_95;
  if (metrics.safe_success.lift < SAFE_SUCCESS_LIFT_THRESHOLD) performanceReasons.push("SafeSuccessLift is below +10 percentage points");
  if (performanceInterval === null || performanceInterval.lower <= 0) performanceReasons.push("paired bootstrap lower bound is not above zero");
  const performance = { status: status(performanceReasons.length === 0), reasons: performanceReasons } as const;

  const tokenReasons: string[] = [];
  let tokenStatus: GateStatus;
  const tokenInterval = bootstrapMetrics.token_volume_reduction.interval_95;
  if (metrics.token.availability === "unavailable") {
    tokenStatus = "NOT MEASURABLE";
    tokenReasons.push("at least one assigned run has unavailable provider usage");
  } else if (metrics.token.reduction === null) {
    tokenStatus = "NOT MEASURABLE";
    tokenReasons.push(metrics.token.reason ?? "TokenVolumeReduction is undefined");
  } else if (bootstrapMetrics.token_volume_reduction.finite_tvpdss_replicates < MIN_FINITE_TOKEN_REPLICATES) {
    tokenStatus = "NOT MEASURABLE";
    tokenReasons.push(`only ${bootstrapMetrics.token_volume_reduction.finite_tvpdss_replicates}/${BOOTSTRAP_REPLICATES} replicates have finite TVPDSS in both arms`);
  } else if (bootstrapMetrics.token_volume_reduction.finite_replicates < MIN_FINITE_TOKEN_REPLICATES) {
    tokenStatus = "NOT MEASURABLE";
    tokenReasons.push(`only ${bootstrapMetrics.token_volume_reduction.finite_replicates}/${BOOTSTRAP_REPLICATES} replicates have a defined TokenVolumeReduction`);
  } else {
    if (metrics.token.reduction < TOKEN_VOLUME_REDUCTION_THRESHOLD) tokenReasons.push("TokenVolumeReduction is below the fixed 15% threshold");
    if (tokenInterval === null || tokenInterval.lower <= 0) tokenReasons.push("paired bootstrap lower bound is not above zero");
    if (metrics.safe_success.on < MIN_SAFE_SUCCESSES_PER_ARM || metrics.safe_success.off < MIN_SAFE_SUCCESSES_PER_ARM) {
      tokenReasons.push("both arms do not have at least ten decision-safe successes");
    }
    tokenStatus = status(tokenReasons.length === 0);
  }
  const token = { status: tokenStatus, reasons: tokenReasons } as const;

  const mechanismReasons: string[] = [];
  let mechanismStatus: GateStatus;
  const revivalInterval = bootstrapMetrics.revival_absolute_difference.interval_95;
  if (metrics.revival.off < MIN_OFF_REVIVALS) {
    mechanismStatus = "OPPORTUNITY FAILURE";
    mechanismReasons.push(`OFF has ${metrics.revival.off} raw revivals; at least ten are required`);
  } else {
    if (metrics.revival.relative_reduction === null || metrics.revival.relative_reduction < REVIVAL_REDUCTION_THRESHOLD) {
      mechanismReasons.push("RevivalReduction is below 30%");
    }
    if (metrics.revival.absolute_difference >= 0) mechanismReasons.push("ON minus OFF revival rate is not negative");
    if (revivalInterval === null || revivalInterval.upper >= 0) {
      mechanismReasons.push("paired bootstrap upper bound for the absolute difference is not below zero");
    }
    mechanismStatus = status(mechanismReasons.length === 0);
  }
  const mechanism = { status: mechanismStatus, reasons: mechanismReasons } as const;
  const core = performance.status === "PASS" && mechanism.status === "PASS";
  const combined = core && token.status === "PASS";
  return {
    performance,
    token_efficiency: token,
    mechanism,
    core_behavior_headline: status(core),
    token_claim: token.status,
    combined_headline: status(combined),
  };
};

const sumsForArm = (rows: readonly Row[], arm: Arm): { readonly opportunities: number; readonly deliveries: number; readonly product_failures: number } => {
  const armRows = rows.filter((row) => row.condition === arm);
  return {
    opportunities: armRows.reduce((sum, row) => sum + row.exposure.hook_opportunities, 0),
    deliveries: armRows.reduce((sum, row) => sum + row.exposure.delivered_record_ids.length, 0),
    product_failures: armRows.reduce((sum, row) => sum + row.exposure.product_failures, 0),
  };
};

const categoryCounts = (tasks: readonly TaskUnit[]): Readonly<Record<string, number>> =>
  Object.fromEntries(CATEGORIES.map((category) => [category, tasks.filter((task) => task.category === category).length]));

const armStopReasons = (rows: readonly Row[], arm: Arm): Readonly<Record<string, number>> =>
  Object.fromEntries(STOP_REASONS.map((reason) => [reason, count(rows.filter((row) => row.condition === arm), (row) => row.stop_reason === reason)]));

const provenance = (rows: readonly Row[], freezeSha: string): Readonly<Record<string, readonly string[]>> => ({
  freeze_manifest_sha256: [freezeSha],
  sealed_task_bundle_sha256: [...new Set(rows.map((row) => row.sealed_task_bundle_sha256))].sort(),
  repository_bundle_sha256: [...new Set(rows.map((row) => row.repository_bundle_sha256))].sort(),
  repository_snapshot: [...new Set(rows.map((row) => row.repository_snapshot))].sort(),
  product_commit: [...new Set(rows.map((row) => row.product_commit))].sort(),
  dist_digest: [...new Set(rows.map((row) => row.dist_digest))].sort(),
  agent_runtime_image_digest: [...new Set(rows.map((row) => row.agent_runtime_image_digest))].sort(),
  evaluator_image_digest: [...new Set(rows.map((row) => row.evaluation.evaluator_image_digest))].sort(),
});

/** Analyze a complete, already freeze-validated matrix. This pure core writes nothing. */
export const analyzeRows = (freeze: Freeze, freezeSha: string, rows: readonly Row[]): AnalysisResult => {
  if (rows.length !== freeze.expected_logical_runs) {
    fail(`matrix has ${rows.length} rows but the freeze requires ${freeze.expected_logical_runs}`);
  }
  const byArm: Record<Arm, number> = {
    "commitlore-on": count(rows, (row) => row.condition === "commitlore-on"),
    "commitlore-off": count(rows, (row) => row.condition === "commitlore-off"),
  };
  if (byArm["commitlore-on"] !== 90 || byArm["commitlore-off"] !== 90) {
    fail(`matrix arms are ${byArm["commitlore-on"]} ON and ${byArm["commitlore-off"]} OFF, not 90 each`);
  }
  const tasks = buildTaskUnits(rows);
  const completeUsage = measuredUsage(rows);
  const point = calculateSample(tasks, completeUsage);
  const safeOn = count(rows, (row) => row.condition === "commitlore-on" && row.decision_safe_success);
  const safeOff = count(rows, (row) => row.condition === "commitlore-off" && row.decision_safe_success);
  const revivalOn = count(rows, (row) => row.condition === "commitlore-on" && row.evaluation.rejected_decision_revived === true);
  const revivalOff = count(rows, (row) => row.condition === "commitlore-off" && row.evaluation.rejected_decision_revived === true);
  const revivalEvaluableOn = count(rows, (row) => row.condition === "commitlore-on" && row.evaluation.rejected_decision_revived !== null);
  const revivalEvaluableOff = count(rows, (row) => row.condition === "commitlore-off" && row.evaluation.rejected_decision_revived !== null);
  const unavailableRuns: UsageGap[] = rows.flatMap((row) => row.usage.availability === "unavailable"
    ? [{ logical_run_id: row.logical_run_id, reasons: row.usage.reasons }]
    : []);
  const token = point.token;
  const categoryTotalFor = (arm: Arm): Readonly<Record<string, number>> => {
    const totals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    for (const row of rows) {
      if (row.condition !== arm) continue;
      const usage = row.usage as MeasuredUsage;
      totals.input_tokens += usage.input_tokens;
      totals.output_tokens += usage.output_tokens;
      totals.cache_creation_input_tokens += usage.cache_creation_input_tokens;
      totals.cache_read_input_tokens += usage.cache_read_input_tokens;
    }
    return totals;
  };
  const tokenMetrics: AnalysisResult["metrics"]["token"] = completeUsage && token !== null
    ? {
      availability: "measured",
      unavailable_runs: [],
      total_volume: { "commitlore-on": token.onVolume, "commitlore-off": token.offVolume },
      tvpdss: { "commitlore-on": token.onTvpdss, "commitlore-off": token.offTvpdss },
      reduction: token.reduction,
      volume_per_assigned_run: { "commitlore-on": token.onVolume / byArm["commitlore-on"], "commitlore-off": token.offVolume / byArm["commitlore-off"] },
      safe_successes_per_million_tokens: {
        "commitlore-on": token.onVolume === 0 ? null : 1_000_000 * safeOn / token.onVolume,
        "commitlore-off": token.offVolume === 0 ? null : 1_000_000 * safeOff / token.offVolume,
      },
      category_totals: { "commitlore-on": categoryTotalFor("commitlore-on"), "commitlore-off": categoryTotalFor("commitlore-off") },
      reason: token.reduction === null ? "TokenVolumeReduction is undefined because TVPDSS(OFF) is zero or an arm has zero safe successes" : null,
    }
    : {
      availability: "unavailable",
      unavailable_runs: unavailableRuns,
      total_volume: { "commitlore-on": null, "commitlore-off": null },
      tvpdss: { "commitlore-on": null, "commitlore-off": null },
      reduction: null,
      volume_per_assigned_run: { "commitlore-on": null, "commitlore-off": null },
      safe_successes_per_million_tokens: { "commitlore-on": null, "commitlore-off": null },
      category_totals: { "commitlore-on": null, "commitlore-off": null },
      reason: "provider usage is unavailable for one or more assigned runs; no partial token aggregate is reported",
    };

  const metrics: AnalysisResult["metrics"] = {
    safe_success: { on: safeOn, off: safeOff, assigned_per_arm: byArm["commitlore-on"], lift: point.safeLift },
    token: tokenMetrics,
    revival: {
      on: revivalOn,
      off: revivalOff,
      evaluable_on: revivalEvaluableOn,
      evaluable_off: revivalEvaluableOff,
      assigned_per_arm: byArm["commitlore-on"],
      relative_reduction: revivalOff === 0 ? null : 1 - revivalOn / revivalOff,
      absolute_difference: point.revivalDifference,
    },
  };
  const bootstrapMetrics = bootstrap(tasks, freeze.bootstrap_seed, completeUsage);
  const gates = gatesFor(metrics, bootstrapMetrics);
  const attempts = rows.reduce((sum, row) => sum + row.evaluation.evaluator_attempts, 0);
  return {
    schema_version: 1,
    benchmark: "cdeb-v1",
    study_id: freeze.study_id,
    source: {
      freeze_file: "public-freeze.json",
      freeze_sha256: freezeSha,
      analysis_source_sha256: analysisSourceDigest(),
      bootstrap_seed: freeze.bootstrap_seed,
      row_files: freeze.analysis_inputs.row_files,
    },
    matrix: {
      rows: rows.length,
      tasks: tasks.length,
      repositories: new Set(tasks.map((task) => task.repository_id)).size,
      by_arm: byArm,
      task_ids: tasks.map((task) => `${task.repository_id}/${task.task_id}`),
    },
    metrics,
    bootstrap: bootstrapMetrics,
    gates,
    appendix: {
      categories: categoryCounts(tasks),
      stop_reasons: { "commitlore-on": armStopReasons(rows, "commitlore-on"), "commitlore-off": armStopReasons(rows, "commitlore-off") },
      exposure: { "commitlore-on": sumsForArm(rows, "commitlore-on"), "commitlore-off": sumsForArm(rows, "commitlore-off") },
      evaluator: { attempts, retries: attempts - rows.length },
      provenance: provenance(rows, freezeSha),
    },
  };
};

const fixed = (value: number | null, places: number = 1): string => value === null ? "unavailable" : value.toFixed(places);
const pp = (value: number | null, signed: boolean = false): string => {
  if (value === null) return "unavailable";
  const rendered = (100 * value).toFixed(1);
  return `${signed && value >= 0 ? "+" : ""}${rendered}pp`;
};
const percent = (value: number | null, signed: boolean = false): string => {
  if (value === null) return "unavailable";
  const rendered = (100 * value).toFixed(1);
  return `${signed && value >= 0 ? "+" : ""}${rendered}%`;
};
const integer = (value: number | null): string => value === null ? "unavailable" : value.toLocaleString("en-US", { maximumFractionDigits: 0 });
const interval = (value: Interval | null): string => value === null ? "unavailable" : `[${pp(value.lower)}, ${pp(value.upper)}]`;
const tailP = (value: number | null): string => value === null ? "unavailable" : value.toFixed(4);
const reportGate = (gate: { readonly status: GateStatus; readonly reasons: readonly string[] }): string =>
  gate.reasons.length === 0 ? gate.status : `${gate.status} — ${gate.reasons.join("; ")}`;

/** Fixed §23 report. All figures interpolate the structured result above. */
export const renderReport = (analysis: AnalysisResult, freeze: Pick<Freeze, "calibrated_overhead">): string => {
  const { metrics, bootstrap: distributions, gates, matrix, appendix } = analysis;
  const token = metrics.token;
  const tokenLines = token.availability === "unavailable"
    ? [
      "OFF  unavailable",
      "ON   unavailable",
      "Reduction unavailable · task-bootstrap 95% CI unavailable",
      "Total token volume: OFF unavailable · ON unavailable",
      "Token volume per assigned run: OFF unavailable · ON unavailable",
      "Safe successes per 1M tokens: OFF unavailable · ON unavailable",
      `Token aggregate unavailable for ${token.unavailable_runs.length} assigned run(s): ${token.unavailable_runs.map((gap) => `${gap.logical_run_id} (${gap.reasons.join(", ")})`).join("; ")}`,
    ]
    : [
      `OFF  ${fixed(token.tvpdss["commitlore-off"])} provider-reported tokens`,
      `ON   ${fixed(token.tvpdss["commitlore-on"])} provider-reported tokens`,
      `Reduction ${percent(token.reduction)} · task-bootstrap 95% CI ${interval(distributions.token_volume_reduction.interval_95)} · tail p ${tailP(distributions.token_volume_reduction.tail_p)}`,
      `Total token volume: OFF ${integer(token.total_volume["commitlore-off"])} · ON ${integer(token.total_volume["commitlore-on"])}`,
      `Token volume per assigned run: OFF ${fixed(token.volume_per_assigned_run["commitlore-off"])} · ON ${fixed(token.volume_per_assigned_run["commitlore-on"])}`,
      `Safe successes per 1M tokens: OFF ${fixed(token.safe_successes_per_million_tokens["commitlore-off"])} · ON ${fixed(token.safe_successes_per_million_tokens["commitlore-on"])}`,
    ];
  const headline = gates.combined_headline === "PASS"
    ? `Across ${matrix.tasks} frozen decision-sensitive tasks from ${matrix.repositories} named repositories, the same pinned coding agent with CommitLore produced ${pp(metrics.safe_success.lift)} more first-pass patches that worked without reviving a previously rejected decision, used ${percent(token.reduction)} less provider-reported task-execution token volume per decision-safe success, and revived rejected approaches ${percent(metrics.revival.relative_reduction)} less often than the same agent with ordinary Git access.`
    : gates.core_behavior_headline === "PASS"
      ? `Across ${matrix.tasks} frozen decision-sensitive tasks from ${matrix.repositories} named repositories, the same pinned coding agent with CommitLore produced ${pp(metrics.safe_success.lift)} more first-pass patches that worked without reviving a previously rejected decision and revived rejected approaches ${percent(metrics.revival.relative_reduction)} less often than the same agent with ordinary Git access. Token efficiency: ${gates.token_efficiency.status}.`
      : gates.token_claim === "PASS"
        ? `Across ${matrix.tasks} frozen decision-sensitive tasks from ${matrix.repositories} named repositories, the same pinned coding agent with CommitLore used ${percent(token.reduction)} less provider-reported task-execution token volume per decision-safe success than the same agent with ordinary Git access.`
        : "No registered headline gate passed; the complete matrix and all gate outcomes remain reported below.";
  const categoryLine = Object.entries(appendix.categories).map(([category, total]) => `${category} ${total}`).join(" · ");
  const stops = (arm: Arm): string => STOP_REASONS.map((reason) => `${reason} ${appendix.stop_reasons[arm][reason]}`).join(" · ");
  const tokenCategories = (arm: Arm): string => {
    const categories = token.category_totals[arm];
    return categories === null
      ? "unavailable"
      : Object.entries(categories).map(([category, total]) => `${category} ${integer(total)}`).join(" · ");
  };
  const provenanceLines = Object.entries(appendix.provenance)
    .map(([name, digests]) => `- ${name}: ${digests.join(", ")}`)
    .join("\n");

  return `CommitLore Decision Efficiency Benchmark v1
${matrix.tasks} frozen decision-sensitive tasks · ${matrix.repositories} named repositories · ${matrix.rows} fresh runs
Same pinned model · same agent harness · byte-identical repository states
${matrix.by_arm["commitlore-on"]} runs per condition · corpus independence tier unavailable from canonical rows
Records delivered [claim]-graded — fixture property, not product: bundles carry no trusted-author git config · delivery surface only; capture surface disabled in both arms

DECISION-SAFE FIRST-PASS SUCCESS
OFF  ${metrics.safe_success.off} / ${metrics.safe_success.assigned_per_arm} (${percent(metrics.safe_success.off / metrics.safe_success.assigned_per_arm)})
ON   ${metrics.safe_success.on} / ${metrics.safe_success.assigned_per_arm} (${percent(metrics.safe_success.on / metrics.safe_success.assigned_per_arm)})
Lift ${pp(metrics.safe_success.lift, true)} · task-bootstrap 95% CI ${interval(distributions.safe_success_lift.interval_95)} · tail p ${tailP(distributions.safe_success_lift.tail_p)}

TOKEN VOLUME PER DECISION-SAFE SUCCESS
${tokenLines.join("\n")}

REJECTED-DECISION REVIVALS
OFF  ${metrics.revival.off} / ${metrics.revival.assigned_per_arm} (${percent(metrics.revival.off / metrics.revival.assigned_per_arm)})
ON   ${metrics.revival.on} / ${metrics.revival.assigned_per_arm} (${percent(metrics.revival.on / metrics.revival.assigned_per_arm)})
Relative reduction ${percent(metrics.revival.relative_reduction)}
Absolute difference (ON - OFF) ${pp(metrics.revival.absolute_difference, true)} · task-bootstrap 95% CI ${interval(distributions.revival_absolute_difference.interval_95)} · tail p ${tailP(distributions.revival_absolute_difference.tail_p)}

CLAIM GATES
Performance             ${reportGate(gates.performance)}
Mechanism               ${reportGate(gates.mechanism)}
Token efficiency        ${reportGate(gates.token_efficiency)}
  Calibrated overhead   ${fixed(freeze.calibrated_overhead, 3)} (descriptive; sets no threshold)
  Feasibility note      q >= ${fixed(freeze.calibrated_overhead / (1 - TOKEN_VOLUME_REDUCTION_THRESHOLD), 3)}

Core behavior headline  ${gates.core_behavior_headline}   (performance AND mechanism — X and Z only; Token ${gates.token_efficiency.status})
Token claim             ${gates.token_claim}   (Y only)
Combined headline       ${gates.combined_headline}   (all three — the only gate that may say X, Y and Z)

HEADLINE
${headline}

APPENDIX
Task IDs: ${matrix.task_ids.join(", ")}
Repository ownership/authorship + reviewer identity: unavailable from canonical rows
Category counts: ${categoryLine}
Stop reasons — OFF: ${stops("commitlore-off")}
Stop reasons — ON: ${stops("commitlore-on")}
Exposure — OFF: opportunities ${appendix.exposure["commitlore-off"].opportunities} · deliveries ${appendix.exposure["commitlore-off"].deliveries} · product failures ${appendix.exposure["commitlore-off"].product_failures}
Exposure — ON: opportunities ${appendix.exposure["commitlore-on"].opportunities} · deliveries ${appendix.exposure["commitlore-on"].deliveries} · product failures ${appendix.exposure["commitlore-on"].product_failures}
Provider token categories — OFF: ${tokenCategories("commitlore-off")}
Provider token categories — ON: ${tokenCategories("commitlore-on")}
Evaluator attempts ${appendix.evaluator.attempts} · evaluator retries ${appendix.evaluator.retries}
Pre-agent attempts: unavailable from canonical rows
Deviations: unavailable from freeze-named row inputs
Public/private task disclosure status: task IDs are derived from the canonical rows
Provenance digests:
${provenanceLines}
`;
};

const writeAtomic = (path: string, contents: string): void => {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const partial = `${path}.partial`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(partial, "w");
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(partial, path);
    const directoryDescriptor = openSync(directory, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(partial)) unlinkSync(partial);
    throw error;
  }
};

export interface AnalyzeOptions {
  readonly write?: boolean;
}

/** Load only the explicit freeze-owned files, validate the full matrix, then optionally emit RESULT files. */
export const analyzeStudy = (studyDirectory: string, options: AnalyzeOptions = {}): AnalysisResult => {
  const normalizedStudy = resolve(studyDirectory);
  const freezePath = join(normalizedStudy, "public-freeze.json");
  if (!existsSync(freezePath)) fail(`public-freeze.json is missing from ${normalizedStudy}`);
  const freezeBytes = readFileSync(freezePath);
  const freeze = parseFreeze(JSON.parse(freezeBytes.toString("utf8")), "public-freeze.json");
  const sourceDigest = analysisSourceDigest();
  if (freeze.analysis_source_digest !== sourceDigest) {
    fail("public-freeze.json analysis_source_digest does not match this registered analyzer source");
  }
  assertRowsAreFreezeNamed(normalizedStudy, freeze.analysis_inputs.row_files);
  const freezeSha = sha256(freezeBytes);
  const rows = freeze.analysis_inputs.row_files.map((rowFile) => {
    const rowPath = join(normalizedStudy, rowFile);
    const row = parseRow(JSON.parse(readFileSync(rowPath, "utf8")), rowFile);
    assertRowMatchesFreeze(row, freeze, freezeSha, rowFile);
    return row;
  });
  const analysis = analyzeRows(freeze, freezeSha, rows);
  if (options.write !== false) {
    writeAtomic(join(normalizedStudy, "RESULT.json"), `${JSON.stringify(analysis, null, 2)}\n`);
    writeAtomic(join(normalizedStudy, "RESULT.md"), renderReport(analysis, freeze));
  }
  return analysis;
};

const usage = (): string => "usage: node --experimental-strip-types bench/cdeb/analyze.ts --study-id <study-id> [--results-root <directory>]";

const main = (): number => {
  const argv = process.argv.slice(2);
  let studyId: string | null = null;
  let resultsRoot = DEFAULT_RESULTS_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--study-id") {
      studyId = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === "--results-root") {
      resultsRoot = argv[index + 1] ?? "";
      index += 1;
    } else {
      console.error(usage());
      return 2;
    }
  }
  if (studyId === null || !/^[a-z0-9][a-z0-9-]*$/.test(studyId)) {
    console.error(usage());
    return 2;
  }
  try {
    const root = resolve(resultsRoot);
    const studyDirectory = resolve(root, studyId);
    if (relative(root, studyDirectory).startsWith("..")) fail("study-id resolves outside the results root");
    const analysis = analyzeStudy(studyDirectory);
    console.log(`cdeb analyze: ${analysis.study_id}: ${analysis.matrix.rows} freeze-named rows analyzed; RESULT.json and RESULT.md regenerated`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === ANALYSIS_SOURCE) {
  process.exitCode = main();
}
