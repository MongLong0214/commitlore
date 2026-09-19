/**
 * `run.ts` — the native efficacy runner's read-only planning mode (#1036,
 * revision `native-efficacy-r6.1`).
 *
 * #1036 makes planning a mode rather than a step: "No execute means read-only
 * planning: no model, setup, checker or run-file writes." So this invocation
 * spends nothing, writes nothing, and answers two questions a person needs
 * before authorising anything — what will be run, in what order, and what the
 * declared worst case costs.
 *
 * The cost it prints is a **ceiling from the declared limits, not a
 * measurement**. #1039 §4 forbids inventing a sample quota, and a plan cannot
 * know what an episode will actually use; what it can say is what the
 * reservation rule will hold back, which is the number an authorisation has to
 * cover.
 *
 * `--execute` is not implemented here and says so. #1036 asks that retired
 * modes "fail clearly before inference, not silently map to native", and a flag
 * that quietly planned instead of running would be the same defect wearing the
 * opposite label.
 */

import { readFileSync } from "node:fs";

import { Command } from "commander";

import {
  planSchedule,
  reservePair,
  worstCasePairCost,
  type PhaseLimits,
  type ScheduleCase,
  type ScheduledPair,
} from "./schedule.ts";

/** The subset of the case manifest a plan needs. #1038 owns the whole shape. */
export interface ManifestCase extends ScheduleCase {
  readonly source_group: string;
}

export interface CaseManifest {
  readonly cases: readonly ManifestCase[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * Read and validate a case manifest.
 *
 * Validated rather than trusted, because every later denominator is derived
 * from it: a duplicate id would make one case count twice, and a missing
 * `source_group` would silently collapse two groups into one and re-weight the
 * mean (#1033 §1).
 */
export const readManifest = (path: string): CaseManifest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`could not read the case manifest at ${path}: ${(error as Error).message}`);
  }
  if (!isObject(parsed) || !Array.isArray(parsed["cases"])) {
    throw new Error(`the case manifest at ${path} has no "cases" array`);
  }
  const seen = new Set<string>();
  const cases: ManifestCase[] = [];
  for (const entry of parsed["cases"]) {
    if (!isObject(entry)) throw new Error("a case entry is not an object");
    const { id, cluster_id, source_group } = entry;
    if (!isNonEmptyString(id)) throw new Error("a case entry has no id");
    if (seen.has(id)) throw new Error(`case ${id} appears more than once; one case would count twice`);
    seen.add(id);
    if (!isNonEmptyString(cluster_id)) throw new Error(`case ${id} has no cluster_id`);
    if (!isNonEmptyString(source_group)) throw new Error(`case ${id} has no source_group`);
    cases.push({ id, cluster_id, source_group });
  }
  if (cases.length === 0) throw new Error("the case manifest declares no cases");
  return { cases };
};

export interface PlanSummary {
  readonly protocol_revision: "native-efficacy-r6.1";
  readonly experiment: "baseline";
  readonly seed: string;
  readonly repeat: number;
  readonly cases: number;
  readonly clusters: number;
  readonly source_groups: number;
  readonly pairs: number;
  /** Two per pair: the study is paired, and an unpaired row is not a row. */
  readonly actor_sessions_worst_case: number;
  readonly tokens_worst_case: number;
  readonly limits: PhaseLimits;
  readonly plan: readonly ScheduledPair[];
}

export const summarise = (
  manifest: CaseManifest,
  options: { readonly seed: string; readonly repeat: number; readonly limits: PhaseLimits },
): PlanSummary => {
  const plan = planSchedule({ cases: manifest.cases, repeat: options.repeat, seed: options.seed });
  const perPair = worstCasePairCost(options.limits);
  return {
    protocol_revision: "native-efficacy-r6.1",
    experiment: "baseline",
    seed: options.seed,
    repeat: options.repeat,
    cases: manifest.cases.length,
    clusters: new Set(manifest.cases.map((entry) => entry.cluster_id)).size,
    source_groups: new Set(manifest.cases.map((entry) => entry.source_group)).size,
    pairs: plan.length,
    // Six per pair (#1036): two captures, two solves, two repairs.
    actor_sessions_worst_case: plan.length * 6,
    tokens_worst_case: plan.length * perPair,
    limits: options.limits,
    plan,
  };
};

const render = (summary: PlanSummary): string => {
  const lines = [
    `protocol ${summary.protocol_revision}, experiment ${summary.experiment}`,
    `seed ${summary.seed}, repeat ${String(summary.repeat)}`,
    `${String(summary.cases)} case(s) in ${String(summary.clusters)} cluster(s) and ` +
      `${String(summary.source_groups)} source group(s)`,
    `${String(summary.pairs)} paired episode(s)`,
    "",
    "declared worst case — a ceiling from the limits, not a measurement:",
    `  ${String(summary.actor_sessions_worst_case)} actor session(s)`,
    `  ${String(summary.tokens_worst_case)} token(s) ` +
      `(${String(worstCasePairCost(summary.limits))} reserved per pair, whole or not at all)`,
    "",
    "order (frozen for capture, solve and repair alike):",
    ...summary.plan.map(
      (pair, index) =>
        `  ${String(index + 1).padStart(3)}. ${pair.cluster_id}/${pair.case_id} ` +
        `rep ${String(pair.repetition)} — ${pair.order.join(" then ")}`,
    ),
    "",
    "nothing was written and no model was called: this is a plan.",
  ];
  return lines.join("\n");
};

interface Options {
  readonly cases: string;
  readonly repeat: string;
  readonly seed: string;
  readonly captureTokenLimit: string;
  readonly solveTokenLimit: string;
  readonly repairTokenLimit: string;
  readonly json?: boolean;
  readonly execute?: boolean;
}

const limitsFrom = (options: Options): PhaseLimits => ({
  capture: Number(options.captureTokenLimit),
  solve: Number(options.solveTokenLimit),
  repair: Number(options.repairTokenLimit),
});

export const main = (argv: readonly string[], write: (text: string) => void): number => {
  const program = new Command();
  program
    .name("de/run")
    .description("plan the native efficacy study (#1036). Without --execute nothing is written or spent.")
    .requiredOption("--cases <path>", "case manifest JSON")
    .option("--repeat <n>", "repetitions per case", "1")
    .option("--seed <s>", "schedule seed, recorded so the order can be re-derived", "1")
    .option("--capture-token-limit <n>", "token ceiling for one capture call", "20000")
    .option("--solve-token-limit <n>", "token ceiling for one solve", "120000")
    .option("--repair-token-limit <n>", "token ceiling for one repair", "120000")
    .option("--json", "emit the plan as JSON")
    .option("--execute", "run the study (not wired yet)")
    .allowExcessArguments(false);

  program.parse([...argv], { from: "user" });
  const options = program.opts<Options>();

  if (options.execute === true) {
    write(
      "de/run: --execute is not wired yet. The planning mode above is real; refusing rather than " +
        "quietly planning, because a flag that does something other than what it says is the defect " +
        "this study exists to avoid.\n",
    );
    return 2;
  }

  const repeat = Number(options.repeat);
  const limits = limitsFrom(options);
  // Reserve once against an unbounded budget purely to run the limit
  // validation, so a bad ceiling fails here rather than at the first pair.
  reservePair({ remaining: Number.MAX_SAFE_INTEGER, limits });

  const summary = summarise(readManifest(options.cases), { seed: options.seed, repeat, limits });
  write(options.json === true ? `${JSON.stringify(summary, null, 2)}\n` : `${render(summary)}\n`);
  return 0;
};

if (import.meta.filename === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2), (text) => process.stdout.write(text));
  } catch (error) {
    process.stderr.write(`de/run: ${(error as Error).message}\n`);
    process.exitCode = 2;
  }
}
