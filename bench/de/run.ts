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

import { executePlan, type ExecutableCase } from "./execute.ts";
import { renderScreen, screenCases } from "./screen.ts";
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
    // The whole entry, not the three fields a plan needs: `--execute` reads
    // the discussion, the staged files, the checker and the described checks
    // from the same file, and rebuilding the object here silently dropped them.
    cases.push({ ...(entry as Record<string, unknown>), id, cluster_id, source_group } as ManifestCase);
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
  readonly runDir?: string;
  readonly actor?: string;
  readonly actorArg?: string[];
  readonly offArg?: string[];
  readonly nativeArg?: string[];
  readonly screen?: string;
  readonly maxTotalTokens?: string;
  readonly timeoutMs: string;
  readonly checkerRevision: string;
}

const limitsFrom = (options: Options): PhaseLimits => ({
  capture: Number(options.captureTokenLimit),
  solve: Number(options.solveTokenLimit),
  repair: Number(options.repairTokenLimit),
});

/** Repeatable option, so an actor's argv is built rather than shell-split. */
const collect = (value: string, previous: string[]): string[] => [...previous, value];

/**
 * The manifest entries an execution needs, keyed by id.
 *
 * A planning run never reaches this, which is why the planning manifest may
 * omit everything an actor would need: a plan is about order and cost, and
 * demanding a checker to print one would make the cheap mode expensive.
 */
export const executableCases = (
  manifest: { readonly cases: readonly ManifestCase[] },
  path: string,
): Map<string, ExecutableCase> => {
  const out = new Map<string, ExecutableCase>();
  for (const entry of manifest.cases) {
    const runnable = entry as Partial<ExecutableCase> & ManifestCase;
    for (const field of ["discussion", "staged", "next_request", "checker", "described"] as const) {
      if (runnable[field] === undefined) {
        throw new Error(
          `case ${entry.id} in ${path} has no ${field}; --execute needs a runnable manifest, ` +
            "and a plan-only one is not upgraded silently",
        );
      }
    }
    out.set(entry.id, { ...runnable, secrets: runnable.secrets ?? [] } as ExecutableCase);
  }
  return out;
};

export const main = async (argv: readonly string[], write: (text: string) => void): Promise<number> => {
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
    .option("--execute", "run the study; requires --run-dir and --actor")
    .option("--run-dir <path>", "a NEW directory for this run's evidence")
    .option("--actor <command>", "the command that starts one actor session")
    .option("--actor-arg <value>", "an argument both arms receive, repeatable", collect, [] as string[])
    .option("--off-arg <value>", "an argument only the OFF arm receives, repeatable", collect, [] as string[])
    .option(
      "--native-arg <value>",
      "an argument only the NATIVE arm receives -- this is the intervention (#1040), repeatable",
      collect,
      [] as string[],
    )
    .option(
      "--screen <trials>",
      "with --execute, run N unaided controls per case instead of the study (#1038 §3): no " +
        "discussion, no record, no intervention. A case the control passes cannot attribute a " +
        "pass to the record. Exits 1 when any control passed",
    )
    .option("--max-total-tokens <n>", "authorised token ceiling for the whole run")
    .option("--timeout-ms <n>", "wall clock for one actor session", "600000")
    .option("--checker-revision <s>", "the frozen checker revision to require", "checker@r6.1")
    .allowExcessArguments(false);

  program.parse([...argv], { from: "user" });
  const options = program.opts<Options>();

  const repeat = Number(options.repeat);
  const limits = limitsFrom(options);
  // Reserve once against an unbounded budget purely to run the limit
  // validation, so a bad ceiling fails here rather than at the first pair.
  reservePair({ remaining: Number.MAX_SAFE_INTEGER, limits });

  const manifest = readManifest(options.cases);
  const summary = summarise(manifest, { seed: options.seed, repeat, limits });

  if (options.execute !== true) {
    write(options.json === true ? `${JSON.stringify(summary, null, 2)}\n` : `${render(summary)}\n`);
    return 0;
  }

  if (options.runDir === undefined || options.actor === undefined) {
    write("de/run: --execute needs --run-dir and --actor. Nothing was run.\n");
    return 2;
  }
  /*
   * The trial count is validated before the manifest is made runnable.
   *
   * A bad flag should fail on the flag. Left below `executableCases`, a
   * `--screen 0` against a plan-only manifest came back complaining about a
   * missing discussion, which sends the reader to the wrong file.
   */
  const trials = options.screen === undefined ? null : Number(options.screen);
  if (trials !== null && (!Number.isSafeInteger(trials) || trials < 1)) {
    write(`de/run: --screen needs a positive whole number of trials, got "${String(options.screen)}". Nothing was run.\n`);
    return 2;
  }

  const runnable = executableCases(manifest, options.cases);

  if (trials !== null) {
    /*
     * The screen runs instead of the study, never beside it.
     *
     * Its whole value is that it costs a fraction of a measured run and answers
     * the one question that decides whether the measured run is worth making.
     * Folding it into `--execute` would make it a tax on every run rather than
     * a gate before one.
     */
    const screened = await screenCases([...runnable.values()], {
      runDir: options.runDir,
      actor: { command: options.actor, args: options.actorArg ?? [] },
      trials,
      timeoutMs: Number(options.timeoutMs),
      checkerRevision: options.checkerRevision,
    });
    write(`${renderScreen(screened)}\n`);
    // Exit 1 when any control passed: a case that cannot separate the arms is a
    // finding, and a CI step that ran this should be able to notice.
    return screened.some((result) => result.passed_unaided > 0) ? 1 : 0;
  }

  // An absent ceiling is unknown, not unlimited: `reservePair` then refuses the
  // first pair rather than spending whatever happens to be authorised.
  const budget = options.maxTotalTokens === undefined ? null : Number(options.maxTotalTokens);

  const executed = await executePlan(summary.plan, executableCases(manifest, options.cases), {
    runDir: options.runDir,
    actor: {
      command: options.actor,
      args: options.actorArg ?? [],
      // The intervention. Empty on both sides means one identical invocation
      // twice, which is not two arms -- the state the first pilot ran in.
      perArm: { off: options.offArg ?? [], native: options.nativeArg ?? [] },
    },
    limits,
    timeoutMs: Number(options.timeoutMs),
    budget,
    checkerRevision: options.checkerRevision,
  });

  const ran = executed.filter((entry) => entry.episode !== null).length;
  const stopped = executed.find((entry) => entry.episode === null);
  write(
    `${[
      `ran ${String(ran)} of ${String(summary.plan.length)} planned pair(s)`,
      ...(stopped === undefined
        ? []
        : [`stopped before ${stopped.pair.case_id} rep ${String(stopped.pair.repetition)}: ${stopped.reservation.reason}`]),
      `evidence: ${options.runDir}`,
    ].join("\n")}\n`,
  );
  return stopped === undefined ? 0 : 1;
};

if (import.meta.filename === process.argv[1]) {
  main(process.argv.slice(2), (text) => process.stdout.write(text))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`de/run: ${(error as Error).message}\n`);
      process.exitCode = 2;
    });
}
