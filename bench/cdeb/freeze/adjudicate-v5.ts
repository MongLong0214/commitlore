/**
 * G4 adjudication: is the ruled-out approach still functionally violable?
 *
 * The requirement itself never moves. A candidate is only studiable if a patch
 * exists that implements what the decision ruled out **and passes the
 * registered functional acceptance**, because the endpoint is exactly that
 * event. Relaxing it would make the study measure something other than what it
 * claims to.
 *
 * Two corrections are baked into this file, both of them things the census got
 * wrong first and had to be told.
 *
 * The first is about evidence. Verdicts used to be built on an adjudicator's
 * sentence -- "acceptance again passed" -- and seven of them turned out to have
 * been written about a command the sandbox never let run. Prose cannot be
 * audited, so an attempt now carries a machine receipt or it is not counted.
 *
 * The second is about logic, and it is the one worth reading twice.
 * FUNCTIONALLY_VIOLABLE is existential: one passing revival settles it forever.
 * The opposite verdict is universal -- "no implementation of this approach can
 * pass" -- and no number of failed attempts establishes a universal. This file
 * used to call that outcome TREE_ENFORCED, which reads as a finding about the
 * tree. It is a finding about the search. The name now says so.
 */

import {
  assertReceiptAdmissible,
  type ValidatedReceipt,
} from "./acceptance-receipt-v5.ts";

/** What in the frozen tree refused the ruled-out approach in the attempts made. */
export const ENFORCEMENT_MECHANISMS = [
  /** A test asserts the compliant behaviour, or names the forbidden one. */
  "test",
  /** A schema, contract document or closed field list rejects the shape. */
  "schema",
  /** The type system will not compile the ruled-out form. */
  "type",
  /** A runtime check throws, refuses or exits on it. */
  "runtime-guard",
  /** An invariant elsewhere in the tree becomes false, breaking something unrelated. */
  "structural-invariant",
] as const;

export type EnforcementMechanism = (typeof ENFORCEMENT_MECHANISMS)[number];

/**
 * The conceptual shapes a revival can take.
 *
 * A negative verdict is only as good as the variety of what was tried, and
 * variety is not string distance. Candidate v4-a7b04c5208e493e4 was adjudicated
 * twice by accident: one worker tried two phrasings of *replacement*, failed
 * both and concluded the tree enforced the decision; the other added an opt-in
 * path and passed the entire suite. Both workers were competent. The first one
 * had simply never left the first shape.
 */
export const REVIVAL_SHAPES = [
  /** Swap the decided mechanism out for the ruled-out one. */
  "replacement",
  /** Add the ruled-out one alongside, both live. */
  "additive-coexistence",
  /** Ship it behind a flag, setting or constructor argument, default unchanged. */
  "opt-in-configurable",
  /** Introduce it as a second version of the interface. */
  "versioned",
  /** Do it at a different seam -- a wrapper, an adapter, a different layer. */
  "alternate-integration-boundary",
] as const;

export type RevivalShape = (typeof REVIVAL_SHAPES)[number];

/**
 * The census dispositions. Exactly one is required per candidate; anything
 * still unset is undecided and the census is not complete.
 */
export const ADJUDICATIONS = [
  /** A revival exists and passes the registered acceptance under a valid receipt. */
  "FUNCTIONALLY_VIOLABLE",
  /**
   * Every revival attempted failed. A bounded negative about this search, not a
   * proof about the tree -- the length of the name is the point.
   */
  "NO_PASSING_REVIVAL_FOUND_WITHIN_SEARCH_BUDGET",
  /** A revival passed, but whether it violates the recorded decision cannot be settled. */
  "SEMANTIC_BOUNDARY_AMBIGUOUS",
  /** The registered acceptance does not give the same answer twice on the unmodified tree. */
  "FUNCTIONAL_ACCEPTANCE_NONDETERMINISTIC",
  "ORACLE_NOT_BUILDABLE",
  "TASK_NOT_BUILDABLE",
  "FIREWALL_NOT_BUILDABLE",
  /** Adjudicated without a valid acceptance receipt. Preserved, never reused. */
  "VOID_INVALID_ACCEPTANCE",
  "OTHER_REGISTERED_REASON",
] as const;

export type Adjudication = (typeof ADJUDICATIONS)[number];

/**
 * The name this outcome used to carry, kept so historical artifacts stay
 * readable and so nobody re-derives what the rename was about.
 *
 * Artifacts written under the old name are not edited. They are read through
 * this map and reported as bounded negatives.
 */
export const SUPERSEDED_ADJUDICATION_NAMES: Readonly<Record<string, Adjudication>> = {
  TREE_ENFORCED: "NO_PASSING_REVIVAL_FOUND_WITHIN_SEARCH_BUDGET",
  NOT_BUILDABLE_OTHER: "OTHER_REGISTERED_REASON",
};

export const canonicalAdjudication = (name: string): Adjudication => {
  if ((ADJUDICATIONS as readonly string[]).includes(name)) return name as Adjudication;
  const mapped = SUPERSEDED_ADJUDICATION_NAMES[name];
  if (mapped !== undefined) return mapped;
  throw new Error(`adjudicate: ${name} is not a registered disposition`);
};

/** Dispositions that are a bounded negative rather than a demonstrated property. */
export const BOUNDED_NEGATIVES: ReadonlySet<Adjudication> = new Set<Adjudication>([
  "NO_PASSING_REVIVAL_FOUND_WITHIN_SEARCH_BUDGET",
]);

/**
 * Whether a passing revival actually violates the recorded decision.
 *
 * Separated from functional viability because #842 produced a case where they
 * came apart: replacement failed, an opt-in backend passed the whole suite, and
 * whether that violates "does not use JSON storage" depends on whether the
 * ruling was about the default or about the mechanism. Reading the passing
 * patch as an automatic violation would let the wider reading win by default,
 * every time, on the strength of it being the convenient one.
 */
export const SEMANTIC_VERDICTS = ["VIOLATION_CONFIRMED", "NOT_A_VIOLATION", "AMBIGUOUS"] as const;
export type SemanticVerdict = (typeof SEMANTIC_VERDICTS)[number];

export interface SemanticJudgement {
  readonly verdict: SemanticVerdict;
  /** Which reading of the ruling the judge applied, in its own words. */
  readonly reading: string;
  readonly rationale: string;
  readonly shape: RevivalShape;
}

export interface SemanticAdjudication {
  readonly verdict: SemanticVerdict;
  readonly reading: string;
  readonly rationale: string;
  /**
   * The independent blind judgements this verdict was reduced from. Two are
   * required, and `reduceSemanticJudgements` decides what they mean together.
   */
  readonly judgements: readonly SemanticJudgement[];
  /**
   * True when the judges saw the patch and the ruling but not the census
   * state, so they could not know which answer keeps the candidate.
   */
  readonly blind_to_census_consequences: boolean;
}

/**
 * Two independent blind judgements per passing revival, and a disagreement
 * settles as AMBIGUOUS.
 *
 * Registered after six pairs of the round had been read and before the other
 * twenty-two, which is stated plainly because the timing is the only thing that
 * makes it checkable. One of those six disagreed with itself -- the same model,
 * the same rule, the same diff, once NOT_A_VIOLATION and once AMBIGUOUS -- and a
 * single judgement would have recorded whichever run happened to be kept.
 *
 * What agreement between two runs of one model measures is stability, not
 * correctness: a reading this design gets consistently wrong stays consistently
 * wrong. The rule is therefore a floor and not a warrant, and its direction is
 * the conservative one -- it can only move a candidate out of
 * FUNCTIONALLY_VIOLABLE, never into it.
 */
export const MIN_SEMANTIC_JUDGEMENTS = 2;

export const reduceSemanticJudgements = (
  judgements: readonly SemanticJudgement[],
): { readonly verdict: SemanticVerdict; readonly why: string } => {
  if (judgements.length < MIN_SEMANTIC_JUDGEMENTS) {
    throw new Error(
      `semantic: ${String(judgements.length)} blind judgement(s) where ${String(MIN_SEMANTIC_JUDGEMENTS)} are ` +
        `required. One judgement records whichever run happened to be kept`,
    );
  }
  const verdicts = new Set(judgements.map((judgement) => judgement.verdict));
  if (verdicts.size > 1) {
    return {
      verdict: "AMBIGUOUS",
      why: `the blind judges disagreed (${[...verdicts].sort().join(" vs ")}), so the ruling does not settle this patch`,
    };
  }
  const [only] = [...verdicts];
  return { verdict: only as SemanticVerdict, why: "the blind judges agreed" };
};

export interface RevivalAttempt {
  readonly attempt_id: string;
  /** What the ruled-out approach was implemented as. */
  readonly approach: string;
  readonly shape: RevivalShape;
  /**
   * True when this row is the unmodified tree rather than a revival.
   *
   * Adjudicators record the baseline reproduction alongside their attempts, and
   * it passes acceptance by construction. Counting it as a passing revival made
   * two negative verdicts read as violable -- the evidence said "318 passed,
   * matching ../baseline.txt", which is the tree working, not the ruled-out
   * approach working.
   */
  readonly is_baseline?: boolean;
  /** The machine receipt. Its absence excludes the attempt; there is no prose fallback. */
  readonly receipt: ValidatedReceipt;
  /**
   * Failures the attempt's own sloppiness caused. Kept separate because a
   * revival that fails because it was written badly says nothing about whether
   * the approach is viable, and counting those as enforcement would inflate the
   * negative with the adjudicator's own mistakes.
   */
  readonly failures_attributable_to_the_patch: readonly string[];
  /** Failures no implementation of this approach could avoid. */
  readonly failures_no_implementation_can_avoid: readonly string[];
  readonly enforcing_mechanism: EnforcementMechanism | null;
  /** Where the enforcement lives, so a reader can open it. */
  readonly enforcement_locator: string | null;
  /** Present only on attempts whose receipt says acceptance passed. */
  readonly semantic?: SemanticAdjudication;
}

export interface CandidateAdjudication {
  readonly schema_version: 2;
  readonly study_id: "cdeb-fresh-v5";
  readonly stage: "stage1-r1";
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly ruled_out_approach: string;
  readonly acceptance_command: string;
  readonly baseline_fingerprint: string;
  readonly attempts: readonly RevivalAttempt[];
  readonly adjudication: Adjudication;
  readonly adjudicated_at: string;
  /** Set when this row replaces an earlier verdict for the same candidate. */
  readonly supersedes?: string;
}

const MECHANISMS: ReadonlySet<string> = new Set(ENFORCEMENT_MECHANISMS);

/**
 * The minimum number of structurally distinct shapes that must fail before a
 * negative verdict is recorded at all.
 *
 * Three, because two was demonstrably not enough -- see REVIVAL_SHAPES. The
 * requirement cannot make a universal claim safe, since nothing finite can. It
 * moves the floor above the case that actually failed, and the verdict's name
 * carries the rest.
 */
export const MIN_DISTINCT_SHAPES_FOR_A_NEGATIVE = 3;

export const revivalAttempts = (attempts: readonly RevivalAttempt[]): RevivalAttempt[] =>
  attempts.filter((attempt) => attempt.is_baseline !== true);

/**
 * Attempts admissible as evidence: a revival, carrying a valid receipt.
 *
 * Fails closed. An attempt whose receipt did not validate is not counted as a
 * failure either -- it is not counted at all, because a run that did not
 * happen as registered is evidence about the harness, not about the approach.
 */
export const admissibleAttempts = (attempts: readonly RevivalAttempt[]): RevivalAttempt[] =>
  revivalAttempts(attempts).filter((attempt) => attempt.receipt.receipt_valid);

/**
 * A single passing revival settles viability. The requirement is existential,
 * so one attempt that passes makes the candidate violable however many others
 * failed -- but only once the semantic question has also been answered.
 */
export const adjudicationOf = (attempts: readonly RevivalAttempt[]): Adjudication => {
  const admissible = admissibleAttempts(attempts);
  if (admissible.length === 0) {
    throw new Error(
      "adjudicate: no revival attempt carries a valid acceptance receipt, so this candidate has not been " +
        "adjudicated. A verdict here would rest on the adjudicator's description of a run nobody can check",
    );
  }
  const passing = admissible.filter((attempt) => attempt.receipt.acceptance_passed);
  if (passing.length === 0) return "NO_PASSING_REVIVAL_FOUND_WITHIN_SEARCH_BUDGET";

  const confirmed = passing.filter((attempt) => attempt.semantic?.verdict === "VIOLATION_CONFIRMED");
  if (confirmed.length > 0) return "FUNCTIONALLY_VIOLABLE";
  if (passing.some((attempt) => attempt.semantic?.verdict === "AMBIGUOUS")) return "SEMANTIC_BOUNDARY_AMBIGUOUS";
  // Every passing revival was judged not to violate the ruling. The search
  // found working code, not a wrong path, so the search has not finished.
  return "NO_PASSING_REVIVAL_FOUND_WITHIN_SEARCH_BUDGET";
};

/**
 * A passing revival has to have been read for what it means, and read by
 * someone who could not tell which answer was convenient.
 */
export const assertPassingRevivalsAreSemanticallyJudged = (row: CandidateAdjudication): void => {
  for (const attempt of admissibleAttempts(row.attempts)) {
    if (!attempt.receipt.acceptance_passed) continue;
    if (attempt.semantic === undefined) {
      throw new Error(
        `adjudicate: ${row.candidate_id} attempt ${attempt.attempt_id} passed acceptance but was never judged ` +
          `against the ruling. Functional viability and semantic violation are different questions`,
      );
    }
    if (!attempt.semantic.blind_to_census_consequences) {
      throw new Error(
        `adjudicate: ${row.candidate_id} attempt ${attempt.attempt_id} was judged by an adjudicator that could ` +
          `see what the answer would do to the census`,
      );
    }
    if (attempt.semantic.rationale.trim() === "" || attempt.semantic.reading.trim() === "") {
      throw new Error(
        `adjudicate: ${row.candidate_id} attempt ${attempt.attempt_id} records a semantic verdict with no reading ` +
          `of the ruling behind it`,
      );
    }
    const reduced = reduceSemanticJudgements(attempt.semantic.judgements);
    if (reduced.verdict !== attempt.semantic.verdict) {
      throw new Error(
        `adjudicate: ${row.candidate_id} attempt ${attempt.attempt_id} records ${attempt.semantic.verdict} but its ` +
          `blind judgements reduce to ${reduced.verdict} -- ${reduced.why}`,
      );
    }
  }
};

/**
 * A bounded negative needs at least one attempt that failed for a reason no
 * better patch could remove, and that reason has to name a registered mechanism
 * and a place to look.
 *
 * Without this an adjudicator could write a deliberately broken patch, watch it
 * fail, and record the tree as refusing something it does not refuse.
 */
export const assertNegativeIsEvidenced = (row: CandidateAdjudication): void => {
  if (!BOUNDED_NEGATIVES.has(row.adjudication)) return;
  const structural = admissibleAttempts(row.attempts).filter(
    (attempt) => attempt.failures_no_implementation_can_avoid.length > 0,
  );
  if (structural.length === 0) {
    throw new Error(
      `adjudicate: ${row.candidate_id} found no passing revival, but no attempt failed for a reason a better ` +
        `patch could not remove. A revival that fails because it was written badly is evidence about the patch`,
    );
  }
  for (const attempt of structural) {
    if (attempt.enforcing_mechanism === null || !MECHANISMS.has(attempt.enforcing_mechanism)) {
      throw new Error(
        `adjudicate: ${row.candidate_id} attempt ${attempt.attempt_id} names no registered enforcement mechanism ` +
          `(one of ${ENFORCEMENT_MECHANISMS.join(", ")})`,
      );
    }
    if ((attempt.enforcement_locator ?? "").trim() === "") {
      throw new Error(
        `adjudicate: ${row.candidate_id} attempt ${attempt.attempt_id} says something refused the revival but ` +
          `does not say where, so nobody can check it`,
      );
    }
  }
};

/**
 * A candidate found violable must have a passing attempt whose violation was
 * confirmed -- the adjudication and the evidence cannot drift apart.
 */
export const assertViolableIsEvidenced = (row: CandidateAdjudication): void => {
  if (row.adjudication !== "FUNCTIONALLY_VIOLABLE") return;
  const confirmed = admissibleAttempts(row.attempts).filter(
    (attempt) => attempt.receipt.acceptance_passed && attempt.semantic?.verdict === "VIOLATION_CONFIRMED",
  );
  if (confirmed.length === 0) {
    throw new Error(
      `adjudicate: ${row.candidate_id} is FUNCTIONALLY_VIOLABLE with no receipted attempt that both passed ` +
        `acceptance and was confirmed to violate the ruling`,
    );
  }
};

/**
 * A negative verdict must say how hard it was tried, counted in conceptual
 * shapes rather than in wording.
 *
 * Three restatements of replacement are one attempt with three names. The
 * distinctness that matters is the one the failed verdict actually lacked.
 */
export const assertNegativeIsBounded = (row: CandidateAdjudication): void => {
  if (!BOUNDED_NEGATIVES.has(row.adjudication)) return;
  const shapes = new Set(admissibleAttempts(row.attempts).map((attempt) => attempt.shape));
  if (shapes.size < MIN_DISTINCT_SHAPES_FOR_A_NEGATIVE) {
    throw new Error(
      `adjudicate: ${row.candidate_id} found no passing revival after ${String(shapes.size)} distinct shape(s) ` +
        `(${[...shapes].join(", ") || "none"}), below the registered ${String(MIN_DISTINCT_SHAPES_FOR_A_NEGATIVE)}. ` +
        `The shapes not yet tried are ${REVIVAL_SHAPES.filter((shape) => !shapes.has(shape)).join(", ")}`,
    );
  }
};

export const assertAdjudicationConsistent = (row: CandidateAdjudication): void => {
  if (row.adjudication === "VOID_INVALID_ACCEPTANCE") return;
  const evidential: readonly Adjudication[] = [
    "FUNCTIONALLY_VIOLABLE",
    "NO_PASSING_REVIVAL_FOUND_WITHIN_SEARCH_BUDGET",
    "SEMANTIC_BOUNDARY_AMBIGUOUS",
  ];
  if (!evidential.includes(row.adjudication)) return;

  for (const attempt of revivalAttempts(row.attempts)) {
    if (attempt.receipt.receipt_valid) assertReceiptAdmissible(attempt.receipt);
  }
  assertPassingRevivalsAreSemanticallyJudged(row);
  assertNegativeIsBounded(row);
  const implied = adjudicationOf(row.attempts);
  if (row.adjudication !== implied) {
    throw new Error(`adjudicate: ${row.candidate_id} records ${row.adjudication} but its attempts imply ${implied}`);
  }
  assertNegativeIsEvidenced(row);
  assertViolableIsEvidenced(row);
};

export interface CensusRatio {
  readonly adjudicated: number;
  readonly functionally_violable: number;
  readonly no_passing_revival_found: number;
  readonly semantic_boundary_ambiguous: number;
  readonly other_not_buildable: number;
  readonly void_invalid_acceptance: number;
  readonly by_mechanism: Readonly<Record<string, number>>;
  readonly by_shape_attempted: Readonly<Record<string, number>>;
  /** Observed functional violability rate over fully adjudicated candidates. */
  readonly observed_functional_violability_rate: number;
}

const OTHER_NOT_BUILDABLE: ReadonlySet<Adjudication> = new Set<Adjudication>([
  "FUNCTIONAL_ACCEPTANCE_NONDETERMINISTIC",
  "ORACLE_NOT_BUILDABLE",
  "TASK_NOT_BUILDABLE",
  "FIREWALL_NOT_BUILDABLE",
  "OTHER_REGISTERED_REASON",
]);

/**
 * The descriptive result the study publishes whichever way the confirmatory
 * numbers land: how much of a real decision corpus is still violable at all.
 *
 * Voided rows are excluded from the denominator rather than counted as
 * negatives -- an invalid run is an absence of evidence in both directions.
 */
export const censusRatio = (rows: readonly CandidateAdjudication[]): CensusRatio => {
  const byMechanism: Record<string, number> = {};
  const byShape: Record<string, number> = {};
  let violable = 0;
  let negative = 0;
  let ambiguous = 0;
  let other = 0;
  let voided = 0;

  for (const row of rows) {
    if (row.adjudication === "VOID_INVALID_ACCEPTANCE") {
      voided += 1;
      continue;
    }
    for (const attempt of admissibleAttempts(row.attempts)) {
      byShape[attempt.shape] = (byShape[attempt.shape] ?? 0) + 1;
    }
    if (row.adjudication === "FUNCTIONALLY_VIOLABLE") violable += 1;
    else if (row.adjudication === "SEMANTIC_BOUNDARY_AMBIGUOUS") ambiguous += 1;
    else if (OTHER_NOT_BUILDABLE.has(row.adjudication)) other += 1;
    else {
      negative += 1;
      for (const attempt of admissibleAttempts(row.attempts)) {
        if (attempt.enforcing_mechanism === null) continue;
        byMechanism[attempt.enforcing_mechanism] = (byMechanism[attempt.enforcing_mechanism] ?? 0) + 1;
      }
    }
  }

  const adjudicated = violable + negative + ambiguous + other;
  return {
    adjudicated,
    functionally_violable: violable,
    no_passing_revival_found: negative,
    semantic_boundary_ambiguous: ambiguous,
    other_not_buildable: other,
    void_invalid_acceptance: voided,
    by_mechanism: byMechanism,
    by_shape_attempted: byShape,
    observed_functional_violability_rate: adjudicated === 0 ? 0 : violable / adjudicated,
  };
};

/**
 * The population the final product-effect claim may be made about.
 *
 * It is not "all decisions". A study that could only measure the decisions
 * still violable at the frozen snapshot has measured those, and saying so is
 * the difference between a finding and an overclaim.
 */
export const CLAIM_POPULATION =
  "historical repository decisions that remained functionally violable at the frozen snapshot and passed the preregistered task and oracle gates" as const;

export const assertClaimPopulationScoped = (claimText: string): void => {
  if (/\ball (?:repository )?decisions\b/i.test(claimText)) {
    throw new Error(
      `claim: "all decisions" is not the population this study measured. Scope it to ${CLAIM_POPULATION}`,
    );
  }
  if (!claimText.includes(CLAIM_POPULATION)) {
    throw new Error(`claim: a product-effect claim must name its population -- ${CLAIM_POPULATION}`);
  }
};

/**
 * Refuses to describe a bounded negative as a demonstrated property of the tree.
 *
 * The rename is only half the correction; the other half is that the report
 * prose has to stop making the universal claim too. "The tree enforces this
 * decision" is not something this design can establish, and a sentence saying
 * it would travel further than the artifact that qualifies it.
 */
export const assertNegativeIsNotOverstated = (reportText: string): void => {
  const overclaims = [
    /\btree[- ]enforced\b(?!.*bounded)/i,
    /\bcannot be violated\b/i,
    /\bimpossible to (?:violate|implement)\b/i,
    /\bthe tree enforces\b/i,
    /\bstructurally impossible\b/i,
  ];
  for (const pattern of overclaims) {
    if (pattern.test(reportText)) {
      throw new Error(
        `report: "${reportText.match(pattern)?.[0] ?? ""}" states a universal that failed searches cannot ` +
          `establish. The registered wording is no passing revival found within the search budget`,
      );
    }
  }
};
