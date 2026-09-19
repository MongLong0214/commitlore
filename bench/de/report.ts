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
import type { ControlStratum } from "./screen.ts";

export interface RunInputs {
  readonly plan: readonly ScheduledPair[];
  readonly sourceGroupOf: (caseId: string) => string;
  readonly runDir: string;
  /**
   * The unaided-control stratum for a case, when a baseline has established
   * one. Absent means no baseline was run, which is not the same as `unknown`:
   * `unknown` is a baseline that answered nothing.
   *
   * Optional because a report over evidence predating the baseline is still a
   * report, and demanding a stratum would make old runs unreadable.
   */
  readonly stratumOf?: (caseId: string) => ControlStratum | null;
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
  /**
   * The harness bound that ended the capture session, or null if none did.
   *
   * Reported beside the handoff rather than folded into it. A row stopped by
   * this study's own turn cap and a row where the actor genuinely failed are
   * both `terminal_failure`, and only one of them is evidence about the actor.
   */
  readonly stopped_on_bound: string | null;
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
        stopped_on_bound: arm.capture.stoppedOnBound ?? null,
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
  /**
   * Rows whose capture session was ended by one of this harness's own bounds.
   *
   * Separate from `terminal_handoffs` because the two overlap without being the
   * same set, and because this one is a fact about the instrument. A run with
   * any of these has not measured what it set out to measure: the first real
   * run stopped both arms on `error_max_turns` at different phases, which is a
   * turn cap being compared against itself.
   */
  readonly stopped_on_bound: readonly ArmObservation[];
  /**
   * H1 again, split by the unaided-control stratum — #1038 §1, §3.
   *
   * Reported *beside* `h1`, never instead of it. The whole point of keeping a
   * case whose control passes in the sample is that it stays in the headline
   * mean; the split is what makes that mean interpretable rather than what
   * replaces it. Reading only the `control_fails` row would be the selection
   * the issue forbids, arrived at by a different route.
   *
   * Empty when no stratum was supplied, which is honest about a run made
   * before any baseline existed.
   */
  readonly h1_by_stratum: readonly { readonly stratum: ControlStratum; readonly pairs: number; readonly effect: PairedEffect }[];
  readonly observations: readonly ArmObservation[];
}

/**
 * Split the planned rows by stratum and run the same effect over each subset.
 *
 * Rows whose case has no stratum are left out of the split rather than bucketed
 * into `unknown`: no baseline ran, and inventing one would make a run that
 * predates the baseline look as though it had been screened.
 *
 * Every stratum present gets a row, including one with no resolvable mean. A
 * stratum that vanished when its cases were all unresolved is a stratum the
 * reader would assume had no cases.
 */
const stratify = (
  rows: readonly JoinedRow[],
  stratumOf: ((caseId: string) => ControlStratum | null) | undefined,
): Report["h1_by_stratum"] => {
  if (stratumOf === undefined) return [];
  const buckets = new Map<ControlStratum, JoinedRow[]>();
  for (const row of rows) {
    const stratum = stratumOf(row.case_id);
    if (stratum === null) continue;
    const bucket = buckets.get(stratum) ?? [];
    bucket.push(row);
    buckets.set(stratum, bucket);
  }
  // A fixed order, so two reports of the same run read the same way.
  const order: readonly ControlStratum[] = ["control_fails", "control_reaches_it_unaided", "unknown"];
  return order
    .filter((stratum) => buckets.has(stratum))
    .map((stratum) => {
      const bucket = buckets.get(stratum)!;
      return {
        stratum,
        // Pairs, not rows: each pair contributes one row per arm.
        pairs: new Set(bucket.map((row) => `${row.case_id}#${String(row.repetition)}`)).size,
        effect: pairedEffect(bucket),
      };
    });
};

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
    h1_by_stratum: stratify(rows, inputs.stratumOf),
    // "Show feedback-pass/audit-fail with zero repair as a detector miss, not
    // avoided rework." Counting it as a success is how a study congratulates
    // itself for a failure nobody caught.
    detector_misses: observations.filter(
      (entry) => entry.score === true && entry.audit_score === false && entry.repair_decision !== "repair",
    ),
    // "Show terminal handoff failure beside zero solve/repair spending."
    terminal_handoffs: observations.filter((entry) => entry.handoff === "terminal_failure"),
    stopped_on_bound: observations.filter((entry) => entry.stopped_on_bound !== null),
    observations,
  };
};

const pct = (value: number | null): string => (value === null ? "unavailable" : `${(value * 100).toFixed(1)}%`);

/**
 * Say it, and say what it means, rather than printing a count nobody reads.
 *
 * A bound that binds is not a finding about the arms -- it is the study
 * measuring its own ceiling. The first real run printed "terminal handoff
 * failures: 1" and nothing else, and that line was read as an outcome for
 * several minutes before the session logs said `error_max_turns`.
 */
/**
 * The split, printed under the headline mean it qualifies rather than in place
 * of it.
 *
 * The standing note prints whenever any split exists, not only when a
 * `control_reaches_it_unaided` row is present: a reader who sees the split only
 * on the runs where it is inconvenient has been told about that run rather than
 * about the method.
 */
const stratumLines = (split: Report["h1_by_stratum"]): string[] => {
  if (split.length === 0) return [];
  return [
    "",
    "  by unaided-control stratum (#1038 §1, §3) — this qualifies the mean above, it does not replace it:",
    ...split.map((entry) => {
      const off = pct(entry.effect.off.value);
      const native = pct(entry.effect.native.value);
      return `    ${entry.stratum.padEnd(28)} ${String(entry.pairs)} pair(s)  OFF ${off}  NATIVE ${native}  diff ${points(entry.effect.differencePoints)}`;
    }),
    "    reading only the control_fails row is the case selection #1038 forbids, reached another way.",
  ];
};

const boundLines = (stopped: readonly ArmObservation[]): string[] => {
  if (stopped.length === 0) return [];
  const byBound = new Map<string, number>();
  for (const row of stopped) {
    const bound = row.stopped_on_bound ?? "unknown";
    byBound.set(bound, (byBound.get(bound) ?? 0) + 1);
  }
  return [
    `sessions stopped by this harness's own bounds: ${String(stopped.length)} (${[...byBound]
      .map(([bound, count]) => `${bound} x${String(count)}`)
      .join(", ")})`,
    "  those rows say what the bound allowed, not what the arm can do — the means above are not a comparison while any remain.",
  ];
};

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
    ...stratumLines(report.h1_by_stratum),
    `detector misses (feedback passed, audit failed, no repair): ${String(report.detector_misses.length)}`,
    `terminal handoff failures: ${String(report.terminal_handoffs.length)}`,
    ...boundLines(report.stopped_on_bound),
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
