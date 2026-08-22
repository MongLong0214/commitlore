/**
 * The one entry point that runs the Stage 1-r1 analysis.
 *
 * `analysis-v5.ts` exports the pieces, and an adversarial review pointed out
 * that exported pieces are a menu: an analyst can call the interval and skip
 * the ITT construction, or skip non-degradation, or run an older path, and the
 * report will still truthfully say the registered functions exist. Nothing
 * downstream can tell which were used.
 *
 * So the registered analysis is a program, not a library. It loads the frozen
 * schedule and the raw observations, checks that every cross-artifact identity
 * matches, builds the ITT denominator, runs the claim gate, and writes one
 * deterministic result artifact. There is no argument that turns a check off.
 *
 * It refuses to run at all while the study is pre-execution, which is now.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { claimGate, type AssignedEpisode, type Episode } from "./analysis-v5.ts";
import { assertCensusComplete, type BuildabilityRow } from "./buildability-v5.ts";
import { assertRuntimeLockComplete, type RuntimeLock } from "./runtime-lock-v5.ts";

interface RandomizationPlan {
  readonly status: string;
  readonly seed: { readonly value: string | null };
  readonly schedule_sha256: string | null;
  readonly schedule_path: string | null;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);

export interface AnalysisPreconditions {
  readonly ready: boolean;
  readonly blockers: readonly string[];
}

/**
 * Everything that must hold before an analysis is meaningful. Reported as a
 * list rather than a throw so the CLI can print all of them at once -- a
 * blocker at a time is how a study gets walked forward one unblocking at a
 * time.
 */
export const analysisPreconditions = (studyRoot: string): AnalysisPreconditions => {
  const root = resolve(studyRoot);
  const r1 = join(root, "stage1-r1");
  const blockers: string[] = [];

  try {
    assertCensusComplete(readJsonl<BuildabilityRow>(join(r1, "buildability-census.jsonl")));
  } catch (error) {
    blockers.push(`buildability census: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    assertRuntimeLockComplete(readJson<RuntimeLock>(join(r1, "runtime-lock.json")));
  } catch (error) {
    blockers.push(`runtime lock: ${error instanceof Error ? error.message : String(error)}`);
  }

  const randomization = readJson<RandomizationPlan>(join(r1, "randomization-plan.json"));
  if (randomization.seed.value === null) blockers.push("randomization: no seed is committed");
  if (randomization.schedule_sha256 === null) blockers.push("randomization: no schedule hash is committed");
  if (randomization.schedule_path === null || !existsSync(join(r1, randomization.schedule_path ?? ""))) {
    blockers.push("randomization: the frozen schedule does not exist");
  }

  const observations = join(r1, "episodes.jsonl");
  if (!existsSync(observations)) blockers.push("observations: episodes.jsonl does not exist, so no episode has run");

  return { ready: blockers.length === 0, blockers };
};

export interface AnalysisResult {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v5";
  readonly stage: "stage1-r1";
  readonly gate: ReturnType<typeof claimGate>;
}

/** Runs the registered analysis. Throws unless every precondition holds. */
export const runStage1Analysis = (studyRoot: string, fixedRepositories: readonly string[]): AnalysisResult => {
  const root = resolve(studyRoot);
  const r1 = join(root, "stage1-r1");
  const preconditions = analysisPreconditions(root);
  if (!preconditions.ready) {
    throw new Error(
      `stage1-analysis: refusing to analyse. ${String(preconditions.blockers.length)} precondition(s) unmet:\n  - ` +
        preconditions.blockers.join("\n  - "),
    );
  }
  const randomization = readJson<RandomizationPlan>(join(r1, "randomization-plan.json"));
  const seed = randomization.seed.value;
  if (seed === null) throw new Error("stage1-analysis: unreachable, preconditions passed without a seed");

  const assigned = readJsonl<AssignedEpisode>(join(r1, randomization.schedule_path ?? ""));
  const observed = readJsonl<Episode>(join(r1, "episodes.jsonl"));
  return {
    schema_version: 1,
    study_id: "cdeb-fresh-v5",
    stage: "stage1-r1",
    gate: claimGate(assigned, observed, fixedRepositories, { seed }),
  };
};

const FIXED_REPOSITORIES = ["agent-control-plane", "agent-operator-score", "gitseed", "logic-pro-mcp"] as const;

const main = (argv: readonly string[]): void => {
  let studyRoot: string | undefined;
  let checkOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--study-root") {
      studyRoot = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--check") {
      checkOnly = true;
    } else if (argv[index]?.startsWith("--")) {
      throw new Error(`stage1-analysis: unknown flag ${argv[index] ?? ""}`);
    }
  }
  if (studyRoot === undefined) throw new Error("stage1-analysis: --study-root is required");
  const root = resolve(studyRoot);

  const preconditions = analysisPreconditions(root);
  if (checkOnly) {
    process.stdout.write(preconditions.ready ? "analysis preconditions: ready\n" : "analysis preconditions: NOT READY\n");
    for (const blocker of preconditions.blockers) process.stdout.write(`  - ${blocker}\n`);
    process.exitCode = preconditions.ready ? 0 : 1;
    return;
  }

  const result = runStage1Analysis(root, FIXED_REPOSITORIES);
  writeFileSync(join(root, "stage1-r1", "analysis-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Delta ${result.gate.superiority.point.toFixed(4)} ` +
      `[${result.gate.superiority.lower.toFixed(4)}, ${result.gate.superiority.upper.toFixed(4)}]\n` +
      `claim permitted: ${String(result.gate.may_claim_improvement)}\n`,
  );
  for (const refusal of result.gate.refusals) process.stdout.write(`  refused: ${refusal}\n`);
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
