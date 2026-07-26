import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { RunRecord, StopReason } from "./types.ts";

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
}

export interface Summary {
  readonly rows: number;
  readonly files: readonly string[];
  readonly run_ids: readonly string[];
  readonly seeds: readonly number[];
  readonly tasks: readonly string[];
  readonly drivers: readonly string[];
  readonly simulated_rows: number;
  readonly conditions: readonly ConditionSummary[];
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
  readonly odds_ratio: number;
}

/**
 * The seam T-702 (#23) fills in: a two-tailed Fisher exact test, chosen in
 * ADR-0007 because n is small. Unimplemented on purpose — a placeholder that
 * returned a number would be a fabricated result.
 */
export const fisherExact = (_table: ContingencyTable): FisherResult => {
  throw new Error("fisherExact is not implemented yet — T-702 (#23) adds the two-tailed test");
};

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
  };
};

export const summarize = (rows: readonly RunRecord[], files: readonly string[]): Summary => {
  const conditions = [...new Set(rows.map((row) => row.cond))].sort();
  return {
    rows: rows.length,
    files: [...files],
    run_ids: [...new Set(rows.map((row) => row.run_id))].sort(),
    seeds: [...new Set(rows.map((row) => row.seed))].sort((a, b) => a - b),
    tasks: [...new Set(rows.map((row) => row.task))].sort(),
    drivers: [...new Set(rows.map((row) => row.driver))].sort(),
    simulated_rows: rows.filter((row) => row.simulated === true).length,
    conditions: conditions.map((cond) =>
      summarizeCondition(
        cond,
        rows.filter((row) => row.cond === cond),
      ),
    ),
  };
};

const showRate = (rate: number | null, numerator: number, denominator: number): string =>
  rate === null ? `n/a (0 runs)` : `${rate.toFixed(3)} (${numerator}/${denominator})`;

const showMean = (value: number | null): string => (value === null ? "n/a" : value.toFixed(1));

export const formatSummary = (summary: Summary): string => {
  const lines: string[] = [];
  lines.push(`rows      ${summary.rows}`);
  lines.push(`files     ${summary.files.join(", ")}`);
  lines.push(`run_ids   ${summary.run_ids.join(", ")}`);
  lines.push(`tasks     ${summary.tasks.length} (${summary.tasks.join(", ")})`);
  lines.push(`seeds     ${summary.seeds.join(", ")}`);
  lines.push(`drivers   ${summary.drivers.join(", ")}`);
  if (summary.simulated_rows > 0) {
    lines.push("");
    lines.push(`!! ${summary.simulated_rows}/${summary.rows} rows are SIMULATED (dry-run driver).`);
    lines.push("!! These numbers exercise the harness. They are not evidence and must not be published.");
  }
  lines.push("");
  for (const condition of summary.conditions) {
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
    lines.push("");
  }
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
