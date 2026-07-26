import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { fisherExactTwoTailed, rateDifference } from "./stats.ts";
import type { Interval } from "./stats.ts";
import type { RunRecord, StopReason } from "./types.ts";

/**
 * The runner passes `--model` to the driver but does not put it on the row
 * (runner.ts builds `RunRecord` without it, and `RunRecord` has no such field).
 * Re-proposal behaviour is model-dependent, so a rate whose model is unknown is
 * not a comparable number — and once several JSONL files are aggregated
 * together, the invocation's command line is no longer able to say which rows
 * came from which model. Rather than assume, missing models are surfaced under
 * this label everywhere a model is reported. T-702 reported the runner change
 * upstream; until it lands this is what keeps the gap visible instead of silent.
 */
export const UNRECORDED_MODEL = "(unrecorded)";

const modelOf = (row: RunRecord): string => {
  const value = (row as { model?: unknown }).model;
  return typeof value === "string" && value.trim() !== "" ? value : UNRECORDED_MODEL;
};

/**
 * A row that failed carries no measurement — the runner writes `reproposed:
 * false` on it because the field is required, not because the agent declined to
 * re-propose. Leaving those in the denominator would let an arm that crashed
 * more often look like the arm that behaved better, so the analysis set drops
 * them and the count of what was dropped is reported next to the result.
 * Simulated rows are dropped for the reason the whole harness marks them.
 */
export const exclusionReason = (row: RunRecord): string | null => {
  if (row.simulated === true) return "simulated";
  if (row.stopped_by === "error") return "error";
  if (row.stopped_by === "over-tokens" && row.turns === 0) return "never-started";
  return null;
};

export const isUsable = (row: RunRecord): boolean => exclusionReason(row) === null;

// ---------------------------------------------------------------------------
// CPAA — cost per accepted annal (ADR-0007 "운영 지표", PRD-F7 requirement 3)
// ---------------------------------------------------------------------------

/**
 * Why a CPAA has no value. Absent when it has one.
 *
 * The two reasons are not the same finding and are never collapsed:
 * `not-instrumented` says the harness did not record what a record cost, and
 * `no-accepted-records` says it did and nothing was accepted. The first is a
 * gap in the measurement; the second is a measurement.
 */
export type CpaaUndefined = "not-instrumented" | "no-accepted-records";

export interface Cpaa {
  /** Tokens per accepted record, or null — never NaN, never Infinity, never 0. */
  readonly cpaa: number | null;
  /** Why `cpaa` is null. Null when it is not. */
  readonly undefined_because: CpaaUndefined | null;
  readonly harvest_tokens: number;
  readonly verify_tokens: number;
  readonly accepted_records: number;
  /** Rows carrying all three fields — the only ones that contributed. */
  readonly rows_instrumented: number;
  /** Rows that carried some of the three but not all: counted, never summed. */
  readonly rows_partial: number;
}

const nonNegative = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/**
 * Computes CPAA over a set of rows.
 *
 * A row contributes only when it carries **all three** instruments. A row with
 * `accepted_records` and no `harvest_tokens` would otherwise add records to the
 * denominator at a cost of zero and drag the ratio down — the same class of
 * error as leaving a crashed run in a re-proposal denominator, and it points the
 * same direction: it makes CommitLore look cheaper than it was measured to be.
 * Partially instrumented rows are counted and reported instead.
 *
 * Division by zero is not reachable: with no accepted records the ratio has no
 * value, and that is returned as one, rather than as an `Infinity` that
 * survives `JSON.stringify` as `null` and reads downstream as "free".
 */
export const computeCpaa = (rows: readonly RunRecord[]): Cpaa => {
  let harvest = 0;
  let verify = 0;
  let accepted = 0;
  let instrumented = 0;
  let partial = 0;

  for (const row of rows) {
    const rowHarvest = nonNegative(row.harvest_tokens);
    const rowVerify = nonNegative(row.verify_tokens);
    const rowAccepted = nonNegative(row.accepted_records);
    if (rowHarvest === null || rowVerify === null || rowAccepted === null) {
      if (rowHarvest !== null || rowVerify !== null || rowAccepted !== null) partial += 1;
      continue;
    }
    harvest += rowHarvest;
    verify += rowVerify;
    accepted += rowAccepted;
    instrumented += 1;
  }

  const totals = {
    harvest_tokens: harvest,
    verify_tokens: verify,
    accepted_records: accepted,
    rows_instrumented: instrumented,
    rows_partial: partial,
  };

  if (instrumented === 0) return { cpaa: null, undefined_because: "not-instrumented", ...totals };
  if (accepted === 0) return { cpaa: null, undefined_because: "no-accepted-records", ...totals };
  return { cpaa: (harvest + verify) / accepted, undefined_because: null, ...totals };
};

/** The sentence printed in place of a number, naming what is missing. */
export const explainCpaa = (cpaa: Cpaa): string => {
  if (cpaa.undefined_because === null) {
    return (
      `${cpaa.cpaa?.toFixed(1)} tokens/record ` +
      `((${cpaa.harvest_tokens} harvest + ${cpaa.verify_tokens} verify) / ${cpaa.accepted_records} accepted, ` +
      `${cpaa.rows_instrumented} row(s))`
    );
  }
  if (cpaa.undefined_because === "no-accepted-records") {
    return (
      `undefined — 0 records accepted across ${cpaa.rows_instrumented} instrumented row(s), ` +
      `so a cost per accepted record has no value (not 0, not infinite)`
    );
  }
  const partial =
    cpaa.rows_partial === 0
      ? ""
      : `; ${cpaa.rows_partial} row(s) carry some of harvest_tokens/verify_tokens/accepted_records but not all`;
  return (
    "undefined — not instrumented: no row carries all of harvest_tokens, verify_tokens " +
    `and accepted_records, so nothing priced what a record cost to produce${partial}`
  );
};

export interface ConditionSummary {
  readonly cond: string;
  readonly n: number;
  readonly reproposed: number;
  /** null when n is 0 — an undefined rate is not 0. */
  readonly reproposal_rate: number | null;
  readonly runs_with_violations: number;
  readonly violation_rate: number | null;
  readonly total_violations: number;
  readonly mean_violations: number | null;
  readonly mean_turns: number | null;
  readonly mean_tokens: number | null;
  readonly stopped_by: Readonly<Record<StopReason, number>>;
  /** Cost per accepted annal for this arm. Never NaN, never Infinity. */
  readonly cpaa: Cpaa;
}

export interface Summary {
  readonly rows: number;
  readonly files: readonly string[];
  readonly run_ids: readonly string[];
  readonly seeds: readonly number[];
  readonly tasks: readonly string[];
  readonly drivers: readonly string[];
  readonly models: readonly string[];
  readonly simulated_rows: number;
  readonly excluded_rows: number;
  /** Why rows left the analysis set, so a dropped run is never invisible. */
  readonly exclusions: Readonly<Record<string, number>>;
  /** Every row, including the ones that carry no measurement. */
  readonly conditions: readonly ConditionSummary[];
  /** The analysis set: rows that actually measured something. */
  readonly analysis: readonly ConditionSummary[];
  readonly comparison: Comparison | null;
  /** CPAA over the analysis set as a whole, alongside the per-arm figures. */
  readonly cpaa: Cpaa;
}

export interface ContingencyTable {
  /** condition A, re-proposed */
  readonly a: number;
  /** condition A, did not re-propose */
  readonly b: number;
  /** condition B, re-proposed */
  readonly c: number;
  /** condition B, did not re-propose */
  readonly d: number;
}

export interface FisherResult {
  readonly p_value: number;
  /** null when any cell is 0 — the estimate would be on the boundary, not a measurement. */
  readonly odds_ratio: number | null;
  readonly odds_ratio_reason: string | null;
}

/**
 * Two-tailed Fisher exact test, chosen in ADR-0007 because n is small. The
 * arithmetic lives in `stats.ts` and is verified in `test/bench-stats.test.ts`
 * against textbook values and an independent exact-rational implementation.
 */
export const fisherExact = (table: ContingencyTable): FisherResult => {
  const result = fisherExactTwoTailed(table.a, table.b, table.c, table.d);
  return {
    p_value: result.pValue,
    odds_ratio: result.oddsRatio,
    odds_ratio_reason: result.oddsRatioReason,
  };
};

export interface Comparison {
  /** The arm the treatment is measured against. */
  readonly baseline: string;
  readonly treatment: string;
  /** a/b = treatment re-proposed / did not; c/d = baseline. */
  readonly table: ContingencyTable;
  readonly treatment_rate: number | null;
  readonly baseline_rate: number | null;
  readonly p_value: number;
  /** Below 1 means the treatment re-proposed less often. Null on any zero cell. */
  readonly odds_ratio: number | null;
  readonly odds_ratio_reason: string | null;
  /**
   * The headline effect size: treatment rate − baseline rate, in proportion
   * points, with a 95% Newcombe interval. Unlike the odds ratio this stays
   * defined when an arm records zero events, which is the case this benchmark
   * actually produces.
   */
  readonly rate_difference: number | null;
  readonly rate_difference_ci95: Interval | null;
  /** (task, seed) cells measured in both arms — the design is paired. */
  readonly paired_cells: number;
  readonly excluded_rows: number;
}

const REQUIRED_FIELDS = [
  "run_id",
  "task",
  "cond",
  "seed",
  "reproposed",
  "violations",
  "turns",
  "tokens",
  "stopped_by",
  "duration_ms",
  "driver",
  "started_at",
  "simulated",
] as const;

export const parseRows = (file: string, contents: string): readonly RunRecord[] => {
  const rows: RunRecord[] = [];
  contents.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`${file}:${index + 1}: not valid JSON — ${(error as Error).message}`);
    }
    if (typeof parsed !== "object" || parsed === null) throw new Error(`${file}:${index + 1}: not a JSON object`);
    const row = parsed as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
      if (row[field] === undefined) throw new Error(`${file}:${index + 1}: missing field \`${field}\``);
    }
    rows.push(parsed as RunRecord);
  });
  return rows;
};

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

const emptyStopCounts = (): Record<StopReason, number> => ({
  completed: 0,
  timeout: 0,
  "over-turns": 0,
  "over-tokens": 0,
  error: 0,
});

const summarizeCondition = (cond: string, rows: readonly RunRecord[]): ConditionSummary => {
  const stopped = emptyStopCounts();
  for (const row of rows) {
    if (row.stopped_by in stopped) stopped[row.stopped_by] += 1;
  }
  const reproposed = rows.filter((row) => row.reproposed === true).length;
  const withViolations = rows.filter((row) => row.violations > 0).length;
  const totalViolations = rows.reduce((sum, row) => sum + row.violations, 0);
  return {
    cond,
    n: rows.length,
    reproposed,
    reproposal_rate: ratio(reproposed, rows.length),
    runs_with_violations: withViolations,
    violation_rate: ratio(withViolations, rows.length),
    total_violations: totalViolations,
    mean_violations: mean(rows.map((row) => row.violations)),
    mean_turns: mean(rows.map((row) => row.turns)),
    mean_tokens: mean(rows.map((row) => row.tokens)),
    stopped_by: stopped,
    cpaa: computeCpaa(rows),
  };
};

/**
 * `commitlore-on` is the treatment whenever both v0.1 arms are present; two
 * other conditions fall back to alphabetical order so an ablation file still
 * gets a table. Anything other than exactly two conditions has no single
 * comparison to make, so none is invented.
 */
const pickArms = (conditions: readonly string[]): { treatment: string; baseline: string } | null => {
  if (conditions.includes("commitlore-on") && conditions.includes("commitlore-off")) {
    return { treatment: "commitlore-on", baseline: "commitlore-off" };
  }
  if (conditions.length !== 2) return null;
  const [first, second] = conditions;
  if (first === undefined || second === undefined) return null;
  return { treatment: second, baseline: first };
};

export const compare = (rows: readonly RunRecord[], excluded: number): Comparison | null => {
  const arms = pickArms([...new Set(rows.map((row) => row.cond))].sort());
  if (arms === null) return null;

  const treatment = rows.filter((row) => row.cond === arms.treatment);
  const baseline = rows.filter((row) => row.cond === arms.baseline);
  const table: ContingencyTable = {
    a: treatment.filter((row) => row.reproposed === true).length,
    b: treatment.filter((row) => row.reproposed !== true).length,
    c: baseline.filter((row) => row.reproposed === true).length,
    d: baseline.filter((row) => row.reproposed !== true).length,
  };

  const cellsOf = (arm: readonly RunRecord[]): Set<string> =>
    new Set(arm.map((row) => `${row.task} ${row.seed}`));
  const treatmentCells = cellsOf(treatment);
  const pairedCells = [...cellsOf(baseline)].filter((cell) => treatmentCells.has(cell)).length;

  const test = fisherExact(table);
  const effect = rateDifference(table.a, table.b, table.c, table.d);
  return {
    baseline: arms.baseline,
    treatment: arms.treatment,
    table,
    treatment_rate: ratio(table.a, treatment.length),
    baseline_rate: ratio(table.c, baseline.length),
    p_value: test.p_value,
    odds_ratio: test.odds_ratio,
    odds_ratio_reason: test.odds_ratio_reason,
    rate_difference: effect.difference,
    rate_difference_ci95: effect.ci95,
    paired_cells: pairedCells,
    excluded_rows: excluded,
  };
};

export const summarize = (rows: readonly RunRecord[], files: readonly string[]): Summary => {
  const conditions = [...new Set(rows.map((row) => row.cond))].sort();
  const usable = rows.filter(isUsable);

  const exclusions: Record<string, number> = {};
  for (const row of rows) {
    const reason = exclusionReason(row);
    if (reason !== null) exclusions[reason] = (exclusions[reason] ?? 0) + 1;
  }

  const byCondition = (source: readonly RunRecord[]): readonly ConditionSummary[] =>
    conditions.map((cond) =>
      summarizeCondition(
        cond,
        source.filter((row) => row.cond === cond),
      ),
    );

  return {
    rows: rows.length,
    files: [...files],
    run_ids: [...new Set(rows.map((row) => row.run_id))].sort(),
    seeds: [...new Set(rows.map((row) => row.seed))].sort((a, b) => a - b),
    tasks: [...new Set(rows.map((row) => row.task))].sort(),
    drivers: [...new Set(rows.map((row) => row.driver))].sort(),
    models: [...new Set(rows.map(modelOf))].sort(),
    simulated_rows: rows.filter((row) => row.simulated === true).length,
    excluded_rows: rows.length - usable.length,
    exclusions,
    conditions: byCondition(rows),
    analysis: byCondition(usable),
    comparison: compare(usable, rows.length - usable.length),
    cpaa: computeCpaa(usable),
  };
};

const showRate = (rate: number | null, numerator: number, denominator: number): string =>
  rate === null ? `n/a (0 runs)` : `${rate.toFixed(3)} (${numerator}/${denominator})`;

const showMean = (value: number | null): string => (value === null ? "n/a" : value.toFixed(1));

const showP = (p: number): string => (p < 0.0001 ? p.toExponential(2) : p.toFixed(4));

const formatConditions = (heading: string, conditions: readonly ConditionSummary[]): string[] => {
  const lines: string[] = [heading, ""];
  for (const condition of conditions) {
    lines.push(`## ${condition.cond}  (n=${condition.n})`);
    lines.push(
      `   reproposal rate  ${showRate(condition.reproposal_rate, condition.reproposed, condition.n)}`,
    );
    lines.push(
      `   violation rate   ${showRate(condition.violation_rate, condition.runs_with_violations, condition.n)}` +
        `  total=${condition.total_violations}`,
    );
    lines.push(`   mean turns       ${showMean(condition.mean_turns)}`);
    lines.push(`   mean tokens      ${showMean(condition.mean_tokens)}`);
    lines.push(
      `   stopped_by       completed=${condition.stopped_by.completed} ` +
        `timeout=${condition.stopped_by.timeout} over-turns=${condition.stopped_by["over-turns"]} ` +
        `over-tokens=${condition.stopped_by["over-tokens"]} error=${condition.stopped_by.error}`,
    );
    lines.push(`   CPAA             ${explainCpaa(condition.cpaa)}`);
    lines.push("");
  }
  return lines;
};

export const formatSummary = (summary: Summary): string => {
  const lines: string[] = [];
  lines.push(`rows      ${summary.rows}`);
  lines.push(`files     ${summary.files.join(", ")}`);
  lines.push(`run_ids   ${summary.run_ids.join(", ")}`);
  lines.push(`tasks     ${summary.tasks.length} (${summary.tasks.join(", ")})`);
  lines.push(`seeds     ${summary.seeds.join(", ")}`);
  lines.push(`drivers   ${summary.drivers.join(", ")}`);
  lines.push(`models    ${summary.models.join(", ")}`);
  if (summary.models.includes(UNRECORDED_MODEL)) {
    lines.push("");
    lines.push("!! Some rows carry no `model`, so their re-proposal rate is not a comparable number:");
    lines.push("!! re-proposal behaviour is model-dependent and these rows cannot say which model produced them.");
  }
  if (summary.simulated_rows > 0) {
    lines.push("");
    lines.push(`!! ${summary.simulated_rows}/${summary.rows} rows are SIMULATED (dry-run driver).`);
    lines.push("!! These numbers exercise the harness. They are not evidence and must not be published.");
  }
  lines.push("");

  lines.push(...formatConditions("# All rows", summary.conditions));

  if (summary.excluded_rows > 0) {
    const detail = Object.entries(summary.exclusions)
      .map(([reason, count]) => `${reason}=${count}`)
      .join(" ");
    lines.push(
      `# Analysis set — ${summary.rows - summary.excluded_rows}/${summary.rows} rows ` +
        `(${summary.excluded_rows} excluded: ${detail})`,
    );
    lines.push("");
    lines.push(...formatConditions("", summary.analysis).slice(2));
  }

  lines.push("# CPAA — cost per accepted annal");
  lines.push("");
  lines.push(`   analysis set     ${explainCpaa(summary.cpaa)}`);
  lines.push("");
  lines.push("   CPAA prices the pipeline that *writes* records, which is not the pipeline");
  lines.push("   every other number here measures. It is reported per arm above and over the");
  lines.push("   analysis set here; an arm that accepted nothing has no cost per record, and");
  lines.push("   that is printed as undefined rather than as 0 or as a division by zero.");
  lines.push("");

  const comparison = summary.comparison;
  if (comparison === null) {
    const measured = summary.analysis.reduce((total, condition) => total + condition.n, 0);
    lines.push("# Comparison");
    lines.push("");
    lines.push(
      measured === 0
        ? "   not computed — the analysis set is empty, so there is nothing to test"
        : "   not computed — a comparison needs exactly two conditions",
    );
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`# Comparison — ${comparison.treatment} vs ${comparison.baseline}`);
  lines.push("");
  lines.push(
    `   ${comparison.treatment.padEnd(18)} reproposed ${comparison.table.a}, not ${comparison.table.b}` +
      `   rate ${showRate(comparison.treatment_rate, comparison.table.a, comparison.table.a + comparison.table.b)}`,
  );
  lines.push(
    `   ${comparison.baseline.padEnd(18)} reproposed ${comparison.table.c}, not ${comparison.table.d}` +
      `   rate ${showRate(comparison.baseline_rate, comparison.table.c, comparison.table.c + comparison.table.d)}`,
  );
  lines.push("");
  lines.push(`   Fisher exact (two-tailed)  p = ${showP(comparison.p_value)}`);
  const pp = (value: number): string => `${(value * 100).toFixed(1)}pp`;
  lines.push(
    `   rate difference            ${comparison.rate_difference === null ? "n/a" : pp(comparison.rate_difference)}` +
      (comparison.rate_difference_ci95 === null
        ? ""
        : `   95% CI [${pp(comparison.rate_difference_ci95.lo)}, ${pp(comparison.rate_difference_ci95.hi)}]`),
  );
  if (comparison.odds_ratio === null) {
    lines.push(`   odds ratio                 not estimable`);
    if (comparison.odds_ratio_reason !== null) lines.push(`                              ${comparison.odds_ratio_reason}`);
  } else {
    lines.push(`   odds ratio                 ${comparison.odds_ratio.toFixed(4)}`);
  }
  lines.push(`   paired (task, seed) cells  ${comparison.paired_cells}`);
  lines.push(`   rows excluded              ${comparison.excluded_rows}`);
  lines.push("");
  lines.push("   Fisher exact treats the runs as independent. This design is paired by");
  lines.push("   (task, seed), so the test is the pre-registered one but not the most");
  lines.push("   powerful available — read it as conservative, not as the last word.");
  lines.push("");
  return lines.join("\n");
};

const main = (): number => {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const files = args.filter((arg) => !arg.startsWith("--"));
  if (files.length === 0) {
    process.stderr.write("usage: metrics.ts <results.jsonl> [more.jsonl ...] [--json]\n");
    return 2;
  }

  const rows: RunRecord[] = [];
  for (const file of files) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      process.stderr.write(`metrics: no such file: ${resolved}\n`);
      return 2;
    }
    rows.push(...parseRows(resolved, fs.readFileSync(resolved, "utf8")));
  }

  if (rows.length === 0) {
    process.stderr.write(`metrics: no rows in ${files.join(", ")} — nothing to aggregate\n`);
    return 1;
  }

  const summary = summarize(rows, files);
  process.stdout.write(asJson ? `${JSON.stringify(summary, null, 2)}\n` : formatSummary(summary));
  return 0;
};

if (import.meta.filename === process.argv[1]) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`metrics: ${(error as Error).message}\n`);
    process.exitCode = 2;
  }
}
