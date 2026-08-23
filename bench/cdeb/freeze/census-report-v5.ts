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
  assertNegativeIsNotOverstated,
  censusRatio,
  MIN_DISTINCT_SHAPES_FOR_A_NEGATIVE,
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
  readonly no_passing_revival_found: number;
  readonly semantic_boundary_ambiguous: number;
  readonly not_buildable_other: number;
  readonly void_invalid_acceptance: number;
  readonly undecided: number;
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
  /** Repositories that can no longer reach the floor whatever the remaining candidates do. */
  readonly floor_unreachable_in: readonly string[];
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
    const negative = judged.filter(
      (row) => row.adjudication === "NO_PASSING_REVIVAL_FOUND_WITHIN_SEARCH_BUDGET",
    ).length;
    const ambiguous = judged.filter((row) => row.adjudication === "SEMANTIC_BOUNDARY_AMBIGUOUS").length;
    const voided = judged.filter((row) => row.adjudication === "VOID_INVALID_ACCEPTANCE").length;
    const other = judged.length - violable - negative - ambiguous - voided;
    // The pilot takes three per repository off the top; the reserve is what is left.
    reserveTotal += Math.max(0, violable - PILOT_PER_REPOSITORY);
    outcomes.push({
      repository_id: repository,
      candidates: members.length,
      adjudicated: judged.length,
      functionally_violable: violable,
      no_passing_revival_found: negative,
      semantic_boundary_ambiguous: ambiguous,
      not_buildable_other: other,
      void_invalid_acceptance: voided,
      undecided: members.length - judged.length + voided,
      acceptance_command: acceptanceCommands[repository] ?? "unrecorded",
      meets_floor: violable >= FLOOR_BUILDABLE_PER_REPOSITORY,
      still_needed: Math.max(0, FLOOR_BUILDABLE_PER_REPOSITORY - violable),
    });
  }

  // A voided row occupies a candidate without deciding it, so completeness is
  // counted from decided rows rather than from rows present.
  const decided = outcomes.reduce((total, outcome) => total + outcome.adjudicated - outcome.void_invalid_acceptance, 0);
  const complete = decided === population.length;

  /**
   * A stratum whose floor is out of reach decides the study before the census
   * finishes.
   *
   * The estimand averages over four *fixed* repositories. If one of them has
   * fewer candidates left than it needs, no result from the other three can
   * repair it -- so waiting for the remaining rows would not change the answer,
   * it would only delay it. This is arithmetic on the registered floor, not a
   * new threshold: the floor is untouched and what is computed is whether it is
   * still reachable.
   */
  const unreachable = outcomes.filter(
    (outcome) => outcome.functionally_violable + (outcome.candidates - outcome.adjudicated) < FLOOR_BUILDABLE_PER_REPOSITORY,
  );

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

  for (const outcome of unreachable) {
    reasons.push(
      `${outcome.repository_id}: the floor is out of reach -- ${String(outcome.functionally_violable)} violable ` +
        `and ${String(outcome.candidates - outcome.adjudicated)} candidate(s) left, against a floor of ` +
        `${String(FLOOR_BUILDABLE_PER_REPOSITORY)}. No result from the other repositories can repair a fixed stratum`,
    );
  }

  return {
    complete,
    ratio: censusRatio(rows),
    repositories: outcomes,
    confirmatory_reserve_total: reserveTotal,
    floor_unreachable_in: unreachable.map((outcome) => outcome.repository_id),
    // An unreachable floor settles the study before the census finishes.
    // Waiting for the remaining rows would not change the answer.
    verdict:
      unreachable.length > 0
        ? "TERMINAL_HOLD"
        : !complete
          ? "INCOMPLETE"
          : reasons.length === 0
            ? "FLOORS_MET"
            : "TERMINAL_HOLD",
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

/**
 * The descriptive result, published whichever way the confirmatory study lands.
 *
 * The wording of the negative is load-bearing and was corrected once already.
 * An earlier revision of this function said the remaining decisions "were
 * already enforced by the tree itself", which is a universal claim about every
 * possible implementation, drawn from a handful of failed attempts. What the
 * census can say is that its search did not find one. The sentence now says
 * that, and `assertNegativeIsNotOverstated` refuses the stronger phrasing if it
 * ever comes back.
 */
export const descriptiveResult = (report: CensusReport): string => {
  const text = [
    `Of ${String(report.ratio.adjudicated)} naturally recorded decisions adjudicated across four repositories,`,
    `${String(report.ratio.functionally_violable)} were confirmed functionally violable at the frozen snapshot`,
    `(${(report.ratio.observed_functional_violability_rate * 100).toFixed(0)}% of everything adjudicated, and`,
    `${(report.ratio.violability_rate_among_assessable * 100).toFixed(0)}% of the`,
    `${String(report.ratio.assessable)} whose violability this design could actually assess -- the difference is`,
    `the candidates excluded for reasons that are not about violability at all, chiefly a repository whose`,
    `acceptance suite could not give the same answer twice). For`,
    `${String(report.ratio.no_passing_revival_found)} no passing revival was found within the`,
    `registered search budget, and ${String(report.ratio.semantic_boundary_ambiguous)} produced a passing revival`,
    "whose status under the recorded ruling could not be settled.",
    // Phrased to survive being quoted out of context, which is how the earlier
    // wording travelled. assertNegativeIsNotOverstated is blunt enough to reject
    // even a negated use of the overclaim, and that bluntness is the point: a
    // sentence that only reads correctly with its qualifier attached will
    // eventually appear without it.
    `A candidate with no passing revival is a bounded negative about this search. Each required at least`,
    `${String(MIN_DISTINCT_SHAPES_FOR_A_NEGATIVE)} structurally distinct shapes to fail, and a shape nobody`,
    "tried is not a shape that does not exist. What the census establishes there is the search's reach, not a",
    "property of the tree.",
    `What refused the attempts that were made: ${
      Object.entries(report.ratio.by_mechanism)
        .sort(([, left], [, right]) => right - left)
        .map(([mechanism, count]) => `${mechanism} ${String(count)}`)
        .join(", ") || "none recorded"
    }.`,
    `Shapes attempted: ${
      Object.entries(report.ratio.by_shape_attempted)
        .sort(([, left], [, right]) => right - left)
        .map(([shape, count]) => `${shape} ${String(count)}`)
        .join(", ") || "none recorded"
    }.`,
    "Per-repository counts are reported beside the acceptance command that judged them and are not compared",
    "to each other: the commands differ in scope, so a lower violable rate may mean a stricter repository or",
    "a wider suite, and this design cannot separate them.",
  ].join(" ");
  assertNegativeIsNotOverstated(text);
  return text;
};
