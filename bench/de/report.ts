/**
 * `report.ts` — the saved-evidence report (#1037, revision
 * `native-efficacy-r6.1`).
 *
 * "All modes use saved evidence only and perform zero model/checker calls."
 *
 * That is the whole contract of this file and it is enforced by what it
 * imports: `node:fs` and the shared arithmetic, and nothing that can spawn. A
 * report that re-ran a checker to fill a gap would be reporting today's
 * repository rather than the run, and a gap filled is a gap nobody can see.
 *
 * It starts from the **plan**, not from the episode files that happen to exist
 * (#1037). The episodes that are missing are not missing at random — they are
 * the ones that crashed, timed out or were never reached — so iterating the
 * directory would quietly drop exactly the rows that matter and make the arm
 * that fails more often look like the arm that behaved better.
 *
 * Every number it prints carries what qualifies it: the mean carries the
 * unresolved and unobserved counts, the difference is withheld when either arm
 * has no mean, and the relative reduction only appears when the control is
 * positive. Those rules live in `aggregate.ts`; this file renders them without
 * rounding any of them away.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  joinPlan,
  meanFor,
  pairedEffect,
  plannedRows,
  type JoinedRow,
  type ObservedOutcome,
  type PairedEffect,
} from "./aggregate.ts";
import type { EpisodeRecord } from "./episode.ts";
import type { ScheduledPair } from "./schedule.ts";

export interface RunInputs {
  readonly plan: readonly ScheduledPair[];
  readonly sourceGroupOf: (caseId: string) => string;
  readonly runDir: string;
}

const episodePath = (runDir: string, pair: ScheduledPair): string =>
  join(runDir, `${pair.case_id}-rep${String(pair.repetition)}`, "episode.json");

/**
 * Read one episode, or report that it is absent.
 *
 * Absent is a first-class answer: a planned pair with no episode file is a row
 * the report keeps, and #1037 is explicit that missing data cannot be filled
 * from another run or a fresh capture.
 */
export const readEpisode = (runDir: string, pair: ScheduledPair): EpisodeRecord | null => {
  const path = episodePath(runDir, pair);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as EpisodeRecord;
  } catch {
    // Unreadable is not the same as absent, but it is equally not a result.
    return null;
  }
};

export interface ArmObservation extends ObservedOutcome {
  /** The audit's own verdict, kept beside the first score rather than merged. */
  readonly audit_score: boolean | null;
  readonly repair_decision: string | null;
  readonly handoff: string;
}

/**
 * Turn the saved episodes into observations, preserving every distinction the
 * scorer made.
 *
 * `first_pass` is the feedback verdict on the first artifact. The audit is
 * reported beside it and never folded in: #1037 asks for "feedback-pass /
 * audit-fail with zero repair" to be shown as a detector miss, and merging the
 * two would erase exactly that row.
 */
export const observationsFrom = (
  plan: readonly ScheduledPair[],
  runDir: string,
): ArmObservation[] => {
  const out: ArmObservation[] = [];
  for (const pair of plan) {
    const episode = readEpisode(runDir, pair);
    if (episode === null) continue;
    for (const arm of episode.arms) {
      out.push({
        case_id: pair.case_id,
        repetition: pair.repetition,
        arm: arm.arm,
        score: arm.solve?.feedback.verdict.score ?? null,
        audit_score: arm.audit?.verdict.score ?? null,
        repair_decision: arm.repairChoice?.decision ?? null,
        handoff: arm.capture.handoff,
      });
    }
  }
  return out;
};

export interface Report {
  readonly protocol_revision: "native-efficacy-r6.1";
  readonly experiment: "baseline";
  readonly planned_pairs: number;
  readonly episodes_present: number;
  readonly rows: readonly JoinedRow[];
  readonly h1: PairedEffect;
  /** Rows whose feedback passed and whose audit failed, with no repair run. */
  readonly detector_misses: readonly ArmObservation[];
  readonly terminal_handoffs: readonly ArmObservation[];
  readonly observations: readonly ArmObservation[];
}

export const buildReport = (inputs: RunInputs): Report => {
  const observations = observationsFrom(inputs.plan, inputs.runDir);
  const planned = plannedRows(inputs.plan, inputs.sourceGroupOf);
  const rows = joinPlan(planned, observations);

  return {
    protocol_revision: "native-efficacy-r6.1",
    experiment: "baseline",
    planned_pairs: inputs.plan.length,
    episodes_present: inputs.plan.filter((pair) => readEpisode(inputs.runDir, pair) !== null).length,
    rows,
    h1: pairedEffect(rows),
    // "Show feedback-pass/audit-fail with zero repair as a detector miss, not
    // avoided rework." Counting it as a success is how a study congratulates
    // itself for a failure nobody caught.
    detector_misses: observations.filter(
      (entry) => entry.score === true && entry.audit_score === false && entry.repair_decision !== "repair",
    ),
    // "Show terminal handoff failure beside zero solve/repair spending."
    terminal_handoffs: observations.filter((entry) => entry.handoff === "terminal_failure"),
    observations,
  };
};

const pct = (value: number | null): string => (value === null ? "unavailable" : `${(value * 100).toFixed(1)}%`);

const points = (value: number | null): string =>
  value === null ? "withheld — one arm has no mean" : `${value >= 0 ? "+" : ""}${value.toFixed(1)} points`;

export const renderReport = (report: Report): string => {
  const off = report.h1.off;
  const native = report.h1.native;
  const lines = [
    `protocol ${report.protocol_revision}, experiment ${report.experiment}`,
    `${String(report.episodes_present)} of ${String(report.planned_pairs)} planned pair(s) produced an episode`,
    "",
    "H1 — first workflow pass, three-level mean:",
    `  OFF    ${pct(off.value)}  (${String(off.observed)}/${String(off.planned)} rows observed, ` +
      `${String(off.unresolved)} unresolved, ${String(off.groups)} source group(s))`,
    `  NATIVE ${pct(native.value)}  (${String(native.observed)}/${String(native.planned)} rows observed, ` +
      `${String(native.unresolved)} unresolved, ${String(native.groups)} source group(s))`,
    `  difference ${points(report.h1.differencePoints)}`,
    `  relative reduction ${
      report.h1.relativeReduction === null
        ? "withheld — needs both means and a positive control"
        : report.h1.relativeReduction.toFixed(3)
    }`,
    "",
    `detector misses (feedback passed, audit failed, no repair): ${String(report.detector_misses.length)}`,
    `terminal handoff failures: ${String(report.terminal_handoffs.length)}`,
    "",
    "no model and no checker ran to produce this: it reads saved evidence only.",
  ];
  return lines.join("\n");
};

/**
 * The counts a reader needs before the means mean anything.
 *
 * Exposed separately so a caller can assert on them rather than parse prose.
 */
export const coverageOf = (report: Report): { readonly observed: number; readonly planned: number } => ({
  observed: report.rows.filter((row) => row.status === "observed").length,
  planned: report.rows.length,
});

export const meanOf = meanFor;
