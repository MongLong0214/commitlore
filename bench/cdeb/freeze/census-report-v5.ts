/**
 * Turns the adjudication runs into the census the study has to publish.
 *
 * Written while the census is still running, deliberately. Every rule here --
 * what counts as evidence, which comparisons are refused, how the floor is
 * checked -- is fixed before the numbers it will be applied to exist, so none
 * of it can be shaped by the answer.
 *
 * The floor check is the load-bearing part. SSOT §7.3 asks for at least 8
 * buildable per repository and 24 in the confirmatory reserve, and the estimand
 * is an equal-weight average over four *fixed* strata. That makes the pooled
 * violable share the wrong number to judge feasibility by: a corpus can be 77%
 * violable overall and still fail, if the share is carried by the repositories
 * that happen to have the most candidates.
 */

import {
  assertAdjudicationConsistent,
  censusRatio,
  type CandidateAdjudication,
  type CensusRatio,
} from "./adjudicate-v5.ts";

export const FLOOR_BUILDABLE_PER_REPOSITORY = 8;
export const FLOOR_CONFIRMATORY_RESERVE_TOTAL = 24;
export const PILOT_PER_REPOSITORY = 3;

export interface RepositoryOutcome {
  readonly repository_id: string;
  readonly candidates: number;
  readonly adjudicated: number;
  readonly functionally_violable: number;
  readonly tree_enforced: number;
  readonly not_buildable_other: number;
  /** What acceptance judged this repository, kept beside its counts. */
  readonly acceptance_command: string;
  readonly meets_floor: boolean;
  /** How many of its unadjudicated candidates would have to be violable to reach the floor. */
  readonly still_needed: number;
}

export interface CensusReport {
  readonly complete: boolean;
  readonly ratio: CensusRatio;
  readonly repositories: readonly RepositoryOutcome[];
  readonly confirmatory_reserve_total: number;
  readonly verdict: "FLOORS_MET" | "TERMINAL_HOLD" | "INCOMPLETE";
  readonly reasons: readonly string[];
}

/**
 * Refuses to read a partial census as a result. An answer computed from 27 of
 * 62 rows is a progress report, and the difference matters because the
 * remaining rows are not a random sample of the ones already done -- the slow
 * repository finishes last, and it is the one whose floor is least certain.
 */
export const buildCensusReport = (
  rows: readonly CandidateAdjudication[],
  population: readonly { readonly candidate_id: string; readonly repository_id: string }[],
  acceptanceCommands: Readonly<Record<string, string>>,
): CensusReport => {
  for (const row of rows) assertAdjudicationConsistent(row);

  const repositories = [...new Set(population.map((row) => row.repository_id))].sort();
  const byCandidate = new Map(rows.map((row) => [row.candidate_id, row]));
  const outcomes: RepositoryOutcome[] = [];
  let reserveTotal = 0;

  for (const repository of repositories) {
    const members = population.filter((row) => row.repository_id === repository);
    const judged = members.map((row) => byCandidate.get(row.candidate_id)).filter((row) => row !== undefined);
    const violable = judged.filter((row) => row.adjudication === "FUNCTIONALLY_VIOLABLE").length;
    const enforced = judged.filter((row) => row.adjudication === "TREE_ENFORCED").length;
    const other = judged.filter((row) => row.adjudication === "NOT_BUILDABLE_OTHER").length;
    // The pilot takes three per repository off the top; the reserve is what is left.
    reserveTotal += Math.max(0, violable - PILOT_PER_REPOSITORY);
    outcomes.push({
      repository_id: repository,
      candidates: members.length,
      adjudicated: judged.length,
      functionally_violable: violable,
      tree_enforced: enforced,
      not_buildable_other: other,
      acceptance_command: acceptanceCommands[repository] ?? "unrecorded",
      meets_floor: violable >= FLOOR_BUILDABLE_PER_REPOSITORY,
      still_needed: Math.max(0, FLOOR_BUILDABLE_PER_REPOSITORY - violable),
    });
  }

  const complete = rows.length === population.length;
  const reasons: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.meets_floor) continue;
    const unjudged = outcome.candidates - outcome.adjudicated;
    reasons.push(
      `${outcome.repository_id}: ${String(outcome.functionally_violable)} violable of ` +
        `${String(outcome.candidates)}, needs ${String(FLOOR_BUILDABLE_PER_REPOSITORY)}` +
        (unjudged > 0
          ? ` (${String(unjudged)} unadjudicated, so ${String(outcome.still_needed)} of them must be violable)`
          : " and cannot reach it"),
    );
  }
  if (reserveTotal < FLOOR_CONFIRMATORY_RESERVE_TOTAL) {
    reasons.push(
      `confirmatory reserve is ${String(reserveTotal)} after the pilot takes ` +
        `${String(PILOT_PER_REPOSITORY)} per repository, needs ${String(FLOOR_CONFIRMATORY_RESERVE_TOTAL)}`,
    );
  }

  return {
    complete,
    ratio: censusRatio(rows),
    repositories: outcomes,
    confirmatory_reserve_total: reserveTotal,
    verdict: !complete ? "INCOMPLETE" : reasons.length === 0 ? "FLOORS_MET" : "TERMINAL_HOLD",
    reasons,
  };
};

/**
 * The floors are the registered ones and may not move to fit the corpus.
 *
 * This exists because the temptation arrives exactly when the census lands one
 * short: the numbers are in, the study is otherwise ready, and eight looks
 * arbitrary from close up. It was fixed before any candidate was adjudicated,
 * which is the only moment it could have been fixed honestly.
 */
export const assertFloorsUnchanged = (perRepository: number, reserveTotal: number): void => {
  if (perRepository !== FLOOR_BUILDABLE_PER_REPOSITORY || reserveTotal !== FLOOR_CONFIRMATORY_RESERVE_TOTAL) {
    throw new Error(
      `census: the registered floors are ${String(FLOOR_BUILDABLE_PER_REPOSITORY)} per repository and ` +
        `${String(FLOOR_CONFIRMATORY_RESERVE_TOTAL)} in reserve. A floor adjusted after the census is a floor ` +
        `chosen to be met`,
    );
  }
};

/** The descriptive result, published whichever way the confirmatory study lands. */
export const descriptiveResult = (report: CensusReport): string =>
  [
    `Of ${String(report.ratio.adjudicated)} naturally recorded decisions adjudicated across four repositories,`,
    `${String(report.ratio.functionally_violable)} remained functionally violable at the frozen snapshot and`,
    `${String(report.ratio.tree_enforced)} were already enforced by the tree itself`,
    `(${(report.ratio.tree_enforced_share * 100).toFixed(0)}%).`,
    `Enforcement mechanisms observed: ${
      Object.entries(report.ratio.by_mechanism)
        .sort(([, left], [, right]) => right - left)
        .map(([mechanism, count]) => `${mechanism} ${String(count)}`)
        .join(", ") || "none recorded"
    }.`,
    "Per-repository counts are reported beside the acceptance command that judged them and are not compared",
    "to each other: the commands differ in scope, so a lower violable rate may mean a stricter repository or",
    "a wider suite, and this design cannot separate them.",
  ].join(" ");
