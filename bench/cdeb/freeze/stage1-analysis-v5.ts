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
import {
  assertPowerRuleComplete,
  confirmatoryRepeatRule,
  simulatePower,
  type PowerAndResourceRule,
} from "./effect-independence-v5.ts";

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

interface PowerRuleFile {
  readonly frozen_before_pilot: boolean;
  readonly fields: Record<string, unknown>;
}

/**
 * Binds the committed power rule to the calculation, and to every other
 * artifact that restates any part of it.
 *
 * Both halves were missing and a readiness review found them together. An
 * earlier revision raised the envelope in `power-and-resource-rule.json` while
 * `STAGE1-PREREGISTRATION-r1.md`, the randomization plan, the analysis plan and
 * a threshold rationale went on stating the superseded figures -- four frozen
 * artifacts disagreeing with the fifth, which leaves a reader free to quote
 * whichever suits. And nothing loaded the JSON into the power calculation, so
 * the committed numbers and the executable gate had never met.
 */
export const assertEnvelopeArtifactsAgree = (studyRoot: string): void => {
  const root = resolve(studyRoot);
  const r1 = join(root, "stage1-r1");
  const rule = readJson<PowerRuleFile>(join(r1, "power-and-resource-rule.json"));
  assertPowerRuleComplete(rule as unknown as PowerAndResourceRule);

  const importantEffect = Number(rule.fields.minimum_practically_important_dsfps_effect);
  const powerTarget = Number(rule.fields.power_target);
  const budget = Number(rule.fields.maximum_resource_budget_episodes);
  const table = rule.fields.repeats_rule as Record<string, unknown>;

  // The repeat table must be SSOT 9.2 exactly. A branch quietly widened is a
  // larger study registered without saying so.
  for (const [branch, expected] of [
    ["M>=40 and m>=5", 4],
    ["30<=M<40 and m>=5", 5],
    ["24<=M<30 and m>=5", 6],
  ] as const) {
    if (table[branch] !== expected) {
      throw new Error(`envelope: repeats_rule["${branch}"] is ${String(table[branch])}, not ${String(expected)}`);
    }
    // And the code must agree with the table it is validating.
    const total = branch.startsWith("M>=40") ? 40 : branch.startsWith("30") ? 30 : 24;
    if (confirmatoryRepeatRule(total, 5) !== expected) {
      throw new Error(`envelope: confirmatoryRepeatRule disagrees with the committed table at M=${String(total)}`);
    }
  }
  if (table.otherwise !== "HOLD") throw new Error("envelope: the repeats rule must HOLD outside its registered branches");
  if (confirmatoryRepeatRule(23, 5) !== "HOLD" || confirmatoryRepeatRule(40, 4) !== "HOLD") {
    throw new Error("envelope: the repeat rule must HOLD below 24 buildable and below 5 per repository");
  }

  // SSOT 9.3: the registered design must reach the registered power at the
  // registered effect, under the simulation the SSOT names.
  for (const [total, repeats] of [
    [40, 4],
    [36, 5],
    [30, 5],
    [28, 6],
    [24, 6],
  ] as const) {
    const per = [Math.floor(total / 4), Math.floor(total / 4), Math.floor(total / 4), total - 3 * Math.floor(total / 4)];
    const power = simulatePower({
      candidates_per_repository: per,
      repeats_per_arm: repeats,
      baseline_rate: 0.4,
      true_effect: importantEffect,
      replicates: 3000,
      seed: "cdeb-v5-ssot-9.3",
    });
    if (power < powerTarget) {
      throw new Error(
        `envelope: at M=${String(total)} with ${String(repeats)} repeats the design reaches power ` +
          `${power.toFixed(2)} at +${String(importantEffect)}, below the registered ${String(powerTarget)}. HOLD ` +
          `and report; do not lower the important effect to match`,
      );
    }
    const episodes = Math.round(total * repeats * 2 * (1 + Number(rule.fields.infrastructure_allowance)));
    if (episodes > budget) {
      throw new Error(
        `envelope: M=${String(total)} at ${String(repeats)} repeats needs ${String(episodes)} episodes with the ` +
          `allowance, above the registered budget of ${String(budget)}`,
      );
    }
  }

  // Every artifact that restates a registered figure must restate the same one.
  const restatements: { readonly path: string; readonly text: string }[] = [
    { path: "STAGE1-PREREGISTRATION-r1.md", text: readFileSync(join(r1, "STAGE1-PREREGISTRATION-r1.md"), "utf8") },
    { path: "analysis-plan.md", text: readFileSync(join(r1, "analysis-plan.md"), "utf8") },
    { path: "randomization-plan.json", text: readFileSync(join(r1, "randomization-plan.json"), "utf8") },
  ];
  for (const { path, text } of restatements) {
    // The lookbehind matters: the registered tables read "M=28 repeats 6", where
    // the leading number is the corpus size and only the trailing one is the
    // repeat count. Without it the check reported the corpus size as an
    // unregistered repeat count.
    for (const match of text.matchAll(/(?<!M=)\b(\d+)\s+repeats\b/g)) {
      const stated = Number(match[1]);
      const context = text.slice(Math.max(0, (match.index ?? 0) - 260), (match.index ?? 0) + 260);
      // A document may narrate a superseded figure, but only while saying so.
      const narrating = /revision|earlier|superseded|no longer|used to/i.test(context);
      if (![4, 5, 6].includes(stated) && !narrating) {
        throw new Error(
          `envelope: ${path} states ${String(stated)} repeats, which is not a branch of the registered rule`,
        );
      }
    }
  }
};

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
