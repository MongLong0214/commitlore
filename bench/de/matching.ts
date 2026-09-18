/**
 * Reference units, record assessments and the counting rules — #1038 §2 and
 * #1041, revision `native-efficacy-r6.1`.
 *
 * The types are the contract's own; what is written here is the arithmetic on
 * top of them, which is where a study of this shape usually loses its meaning.
 * Four rounding habits would each flatter the treatment, and none of them looks
 * like a mistake in a results table:
 *
 *   - counting `partial` coverage toward recall, so a record that dropped the
 *     one exception in a scoped rule reads as a hit;
 *   - counting a unit twice because two records happened to mention it;
 *   - reading `unknown` as `none`, which converts "nobody judged this" into
 *     evidence of failure;
 *   - reporting 0% where the denominator is empty, which is a number in place
 *     of "this was not measured".
 *
 * So `complete` alone is recall, joint coverage is one unit, `unknown` stays
 * unknown, and an empty denominator returns `null` rather than zero. `null`
 * means undefined, and a caller that prints it as 0 has undone the point.
 *
 * Nothing here judges. The assessments arrive already made, by the disclosed
 * method #1038 requires, and this module only adds them up.
 */

/** #1038 §2. `none` is an observed absence; `unknown` is an absent observation. */
export type Coverage = "complete" | "partial" | "none" | "unknown";

/** The stage an observation belongs to. Coverage never migrates between them. */
export type Stage = "committed" | "solve_delivered" | "repair_delivered";

export type HandoffValidity = "current" | "overridden" | "unknown";

export type NextStatus = "applicable" | "overridden" | "irrelevant" | "unknown";

export type SourceSupport = "supported" | "unsupported" | "unknown";

export type Usefulness = "useful" | "irrelevant" | "unknown";

/** Fixed before any record is generated (#1038 §2). Never rewritten from output. */
export interface DecisionUnit {
  readonly id: string;
  readonly source_refs: readonly string[];
  readonly statement: string;
  readonly required_qualifiers: readonly string[];
  readonly handoff_validity: HandoffValidity;
  readonly eligible_for_new_capture: boolean;
  readonly already_recorded: boolean;
  readonly next_requirement_ids: readonly string[];
  readonly next_status: NextStatus;
}

export interface RecordAssessment {
  /** Canonical native record identity. Notes and message copies share one. */
  readonly record_ref: string;
  readonly units: readonly { readonly unit_id: string; readonly coverage: Coverage }[];
  readonly source_support: SourceSupport;
  readonly usefulness: Usefulness;
  readonly stale_or_misqualified: boolean | null;
  readonly evidence_refs: readonly string[];
  readonly reason: string;
  readonly assessor_method: string;
}

export interface UnitCoverageAssessment {
  readonly unit_id: string;
  readonly stage: Stage;
  /** The exact joint set, when several records together express one unit. */
  readonly record_refs: readonly string[];
  readonly coverage: Coverage;
  readonly evidence_refs: readonly string[];
  readonly reason: string;
  readonly assessor_method: string;
}

/**
 * Counts and the rate, together on purpose.
 *
 * `recall` is `complete / applicable`, so a unit nobody judged sits in the
 * denominator and pushes the rate down — a reference set that was half assessed
 * reports a low recall rather than an honest refusal to answer. #1041 settles
 * this by disclosure rather than by suppression ("unknown ... stays unknown with
 * reference coverage disclosed"), which is why `unknown` ships beside the rate
 * instead of the rate becoming `null`.
 *
 * It follows that `recall` alone is not a publishable number. A report that
 * prints it without `unknown` has dropped the difference between "the records
 * missed these" and "nobody looked".
 */
export interface RecallTally {
  /** Units in the denominator for this measure, after applicability. */
  readonly applicable: number;
  readonly complete: number;
  readonly partial: number;
  readonly none: number;
  readonly unknown: number;
  /** `complete / applicable`, or `null` when there is no applicable unit. */
  readonly recall: number | null;
}

export interface RecordQualityTally {
  /** Canonical record identities, after collapsing notes and message copies. */
  readonly records: number;
  readonly supported: number;
  readonly unsupported: number;
  readonly support_unknown: number;
  readonly useful: number;
  readonly irrelevant: number;
  readonly usefulness_unknown: number;
  readonly stale_or_misqualified: number;
  /** `supported / records`, or `null` when no new record was produced. */
  readonly supported_rate: number | null;
}

const rate = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

/**
 * The one coverage observation for a unit at a stage.
 *
 * More than one is a contract violation rather than a tie to break: #1038 says a
 * unit is covered at most once per episode and stage, and a joint match is
 * already expressed as several `record_refs` inside a single assessment. Picking
 * one silently is how a later re-assessment replaces an earlier verdict without
 * anyone seeing it, so this throws instead.
 */
const coverageOf = (
  unitId: string,
  stage: Stage,
  assessments: readonly UnitCoverageAssessment[],
): Coverage => {
  const found = assessments.filter((a) => a.unit_id === unitId && a.stage === stage);
  if (found.length > 1) {
    throw new Error(
      `unit ${unitId} has ${String(found.length)} coverage assessments at stage ${stage}; ` +
        "a unit is covered at most once per stage and a joint match belongs in one assessment's record_refs",
    );
  }
  // No assessment is not an observed absence. Nobody judged this unit, which is
  // `unknown`; reading it as `none` would manufacture evidence of failure.
  return found[0]?.coverage ?? "unknown";
};

const tally = (units: readonly DecisionUnit[], stage: Stage, assessments: readonly UnitCoverageAssessment[]): RecallTally => {
  let complete = 0;
  let partial = 0;
  let none = 0;
  let unknown = 0;
  for (const unit of units) {
    const coverage = coverageOf(unit.id, stage, assessments);
    if (coverage === "complete") complete += 1;
    else if (coverage === "partial") partial += 1;
    else if (coverage === "none") none += 1;
    else unknown += 1;
  }
  return {
    applicable: units.length,
    complete,
    partial,
    none,
    unknown,
    // Only `complete` counts. #1033 §4: partial is reported separately, not
    // rounded up, and a scoped rule that lost its exception is partial.
    recall: rate(complete, units.length),
  };
};

/**
 * Recall for records the actor was in a position to capture anew.
 *
 * `eligible_for_new_capture` is prepared from the source, the permission and the
 * already-recorded status — never from what the run turned out to find, and
 * never from a native cap. An already-recorded unit cannot be an eligible NEW
 * capture (#1038 §2), so it is out of this denominator while remaining in
 * applicability and delivery.
 */
export const newCaptureRecall = (
  units: readonly DecisionUnit[],
  assessments: readonly UnitCoverageAssessment[],
): RecallTally =>
  tally(
    units.filter((unit) => unit.eligible_for_new_capture && !unit.already_recorded),
    "committed",
    assessments,
  );

/**
 * Recall at a delivery stage, over the units that apply to the next task.
 *
 * Already-recorded units belong here: the question at delivery is whether the
 * decision reached the consumer, not who wrote it down. Stage is required and
 * never defaulted, because a joint committed match does not imply a joint
 * delivered one, and a repair-only statement cannot improve solve-stage recall.
 */
export const deliveryRecall = (
  units: readonly DecisionUnit[],
  assessments: readonly UnitCoverageAssessment[],
  stage: "solve_delivered" | "repair_delivered",
): RecallTally =>
  tally(units.filter((unit) => unit.next_status === "applicable"), stage, assessments);

/**
 * Record-quality counts over canonical record identities.
 *
 * Collapsing is by `record_ref`, which #1038 defines as the canonical native
 * record: the notes copy and the message copy of one record are one item, and
 * counting them twice would inflate whichever arm writes records at all. It is
 * deliberately *not* similarity-based — two genuinely separate records that say
 * overlapping things stay two, because "redundant records are not automatically
 * useful" is a finding to report rather than a duplicate to hide.
 *
 * `supported`, `useful` and `stale_or_misqualified` are kept apart (#1041): a
 * verbatim quote can be source-supported and still over-broad, and a faithful
 * record can be irrelevant to the next task.
 */
export const recordQuality = (assessments: readonly RecordAssessment[]): RecordQualityTally => {
  const canonical = new Map<string, RecordAssessment>();
  for (const assessment of assessments) {
    if (!canonical.has(assessment.record_ref)) canonical.set(assessment.record_ref, assessment);
  }
  const records = [...canonical.values()];
  const count = (predicate: (a: RecordAssessment) => boolean): number => records.filter(predicate).length;
  const supported = count((a) => a.source_support === "supported");
  return {
    records: records.length,
    supported,
    unsupported: count((a) => a.source_support === "unsupported"),
    support_unknown: count((a) => a.source_support === "unknown"),
    useful: count((a) => a.usefulness === "useful"),
    irrelevant: count((a) => a.usefulness === "irrelevant"),
    usefulness_unknown: count((a) => a.usefulness === "unknown"),
    stale_or_misqualified: count((a) => a.stale_or_misqualified === true),
    // No new record means undefined precision, not 0% (#1041).
    supported_rate: rate(supported, records.length),
  };
};
