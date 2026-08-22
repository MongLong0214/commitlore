/**
 * CDEB-Fresh v5 Stage 1-r1 gate G1: the buildability census.
 *
 * Stage 0 said 62 decisions could in principle be studied. Nobody has yet built
 * a task or an oracle for any of them, so "can it be studied" is still an
 * opinion. G1 turns it into a frozen, outcome-blind disposition: every one of
 * the 62 is either BUILDABLE or NOT_BUILDABLE with a registered reason, decided
 * before any episode runs.
 *
 * The failure this guards against is narrow and specific. A builder working
 * through 62 candidates will find some with crisp violation boundaries and some
 * that are awkward. If the awkward ones may be dropped with a free-form note,
 * the corpus quietly becomes "the decisions that were easy to catch an agent
 * on", and the study then measures the corpus rather than the treatment. So the
 * reasons are a closed list, and a reason outside it is a throw rather than a
 * row.
 *
 * Two invariants matter more than the schema:
 *
 *   exactly one   a candidate with no disposition and a candidate with two are
 *                 the same defect wearing different clothes -- the census no
 *                 longer says what the population is
 *   outcome-blind a disposition row may not carry an outcome field at all, so
 *                 "not buildable" can never be reached by looking at how the
 *                 episode went
 */

export const BUILDABLE = "BUILDABLE" as const;

/**
 * The closed list of NOT_BUILDABLE reasons, from FINAL-PRD §4 G1. Each is a
 * property of the *instrument* -- whether a task, an acceptance test, an oracle
 * or a control can be constructed -- never a property of a result.
 */
export const NOT_BUILDABLE_REASONS = [
  /** No maintenance need can be stated without the record leaking into it. */
  "no-neutral-record-blind-task",
  /** Acceptance would have to be judged, not executed. */
  "no-deterministic-functional-acceptance",
  /** The ruled-out approach cannot be made to pass acceptance, so revival is unobservable. */
  "no-functionally-passing-violation-control",
  /** Fewer than two distinct compliant patches pass acceptance. */
  "fewer-than-two-compliant-passing-controls",
  /** The oracle returns the same verdict for a compliant and a ruled-out control. */
  "oracle-cannot-distinguish-controls",
  /** The decision's paths cannot be separated from unrelated work in the tree. */
  "scope-cannot-be-isolated",
  /** No frozen base tree, or no evidence the task author was kept off the record. */
  "firewall-provenance-cannot-be-demonstrated",
] as const;

export type NotBuildableReason = (typeof NOT_BUILDABLE_REASONS)[number];
export type Disposition = typeof BUILDABLE | `NOT_BUILDABLE:${NotBuildableReason}`;

/**
 * The mechanical screens, run over the sealed bundles before any human or agent
 * reads a candidate. They can only ever *refute* buildability: a candidate that
 * survives all of them is not thereby buildable, it is merely not yet excluded.
 * Recording them separately from the disposition keeps that distinction visible.
 */
export interface MechanicalScreen {
  /** The frozen snapshot resolves and its tree matches the sealed digest. */
  readonly base_tree_resolvable: boolean;
  /** At least one path in the decision's scope still exists at the snapshot. */
  readonly scope_paths_present: number;
  readonly scope_paths_total: number;
  /** The repository has an executable test command at the snapshot. */
  readonly acceptance_runner_present: boolean;
  readonly acceptance_runner: string | null;
}

export interface BuildabilityRow {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v5";
  readonly stage: "stage1-r1";
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly screen: MechanicalScreen;
  /**
   * `null` means the census is not finished. It is not a third disposition and
   * it never satisfies G1 -- `assertCensusComplete` throws on it. The field
   * exists so the incomplete census is a visible artifact rather than a missing
   * file that reads as "nothing to do here".
   */
  readonly disposition: Disposition | null;
  readonly decided_at: string | null;
  readonly evidence: string | null;
}

const REASON_SET: ReadonlySet<string> = new Set(NOT_BUILDABLE_REASONS);

/** Parses a disposition string, failing closed on anything off the list. */
export const parseDisposition = (raw: string): Disposition => {
  if (raw === BUILDABLE) return BUILDABLE;
  const prefix = "NOT_BUILDABLE:";
  if (!raw.startsWith(prefix)) {
    throw new Error(`buildability: "${raw}" is neither ${BUILDABLE} nor ${prefix}<registered_reason>`);
  }
  const reason = raw.slice(prefix.length);
  if (!REASON_SET.has(reason)) {
    throw new Error(
      `buildability: "${reason}" is not a registered reason. A convenience exclusion is not a reason; ` +
        `registered reasons are ${NOT_BUILDABLE_REASONS.join(", ")}`,
    );
  }
  return raw as Disposition;
};

/** Runs the screens' refutations. Returns the reason a screen fires, or null. */
export const screenRefutes = (screen: MechanicalScreen): NotBuildableReason | null => {
  if (!screen.base_tree_resolvable) return "firewall-provenance-cannot-be-demonstrated";
  if (screen.scope_paths_present === 0) return "scope-cannot-be-isolated";
  if (!screen.acceptance_runner_present) return "no-deterministic-functional-acceptance";
  return null;
};

/**
 * Every candidate in the frozen population appears exactly once. A candidate
 * outside the population is as much a defect as a missing one: it means the
 * census and the Stage 0 corpus disagree about what is being studied.
 */
export const assertExactlyOneDispositionPerCandidate = (
  population: readonly string[],
  rows: readonly BuildabilityRow[],
): void => {
  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row.candidate_id, (seen.get(row.candidate_id) ?? 0) + 1);

  const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicated.length > 0) {
    throw new Error(`buildability: ${String(duplicated.length)} candidate(s) disposed twice: ${duplicated.join(", ")}`);
  }
  const expected = new Set(population);
  const missing = population.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(
      `buildability: ${String(missing.length)} of ${String(population.length)} candidates have no disposition: ` +
        `${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " ..." : ""}`,
    );
  }
  const extra = [...seen.keys()].filter((id) => !expected.has(id));
  if (extra.length > 0) {
    throw new Error(`buildability: ${String(extra.length)} disposed candidate(s) are outside the frozen population: ${extra.join(", ")}`);
  }
};

/**
 * The census is complete only when no disposition is still `null`. This is the
 * check that stands between an unfinished census and a pilot episode, and it is
 * expected to throw on the artifact as currently committed.
 */
export const assertCensusComplete = (rows: readonly BuildabilityRow[]): void => {
  const undecided = rows.filter((row) => row.disposition === null).map((row) => row.candidate_id);
  if (undecided.length > 0) {
    throw new Error(
      `buildability: ${String(undecided.length)} of ${String(rows.length)} candidates have no frozen disposition. ` +
        `A census with an open slot cannot fix the population, and the population must be fixed before the first episode`,
    );
  }
  for (const row of rows) {
    if (row.disposition !== null) parseDisposition(row.disposition);
    if (row.decided_at === null) {
      throw new Error(`buildability: ${row.candidate_id} is disposed without a decision time`);
    }
  }
};

/** Fields whose presence on a disposition row would make the census outcome-aware. */
export const OUTCOME_BEARING_FIELDS = [
  "arm",
  "dsfps",
  "revival",
  "functional_acceptance_pass",
  "completed",
  "episode_id",
  "effect",
  "delta",
  "transcript",
] as const;

/**
 * A disposition must be reachable from the instrument alone. If an outcome
 * field can appear on the row, then "we could not build an oracle for this one"
 * becomes available after seeing that the one in question went badly.
 */
export const assertDispositionsOutcomeBlind = (rows: readonly Record<string, unknown>[]): void => {
  for (const row of rows) {
    for (const field of OUTCOME_BEARING_FIELDS) {
      if (field in row) {
        throw new Error(
          `buildability: row ${String(row.candidate_id)} carries "${field}". A buildability disposition that can ` +
            `see an outcome is a post-hoc exclusion with a schema`,
        );
      }
    }
  }
};

/**
 * BUILDABLE is a claim that an oracle exists and discriminates. It is only ever
 * true of a candidate whose controls have been validated, so the two artifacts
 * are checked against each other rather than trusted separately.
 */
export const assertBuildableHasValidatedControls = (
  rows: readonly BuildabilityRow[],
  validatedCandidateIds: ReadonlySet<string>,
): void => {
  const unbacked = rows
    .filter((row) => row.disposition === BUILDABLE && !validatedCandidateIds.has(row.candidate_id))
    .map((row) => row.candidate_id);
  if (unbacked.length > 0) {
    throw new Error(
      `buildability: ${String(unbacked.length)} candidate(s) are BUILDABLE with no validated oracle controls: ` +
        `${unbacked.join(", ")}. BUILDABLE asserts an oracle was built and shown to discriminate`,
    );
  }
};

export interface CensusSummary {
  readonly total: number;
  readonly buildable: number;
  readonly not_buildable: number;
  readonly undecided: number;
  readonly by_reason: Readonly<Record<string, number>>;
}

export const summarizeCensus = (rows: readonly BuildabilityRow[]): CensusSummary => {
  const byReason: Record<string, number> = {};
  let buildable = 0;
  let notBuildable = 0;
  let undecided = 0;
  for (const row of rows) {
    if (row.disposition === null) {
      undecided += 1;
      continue;
    }
    if (row.disposition === BUILDABLE) {
      buildable += 1;
      continue;
    }
    notBuildable += 1;
    const reason = row.disposition.slice("NOT_BUILDABLE:".length);
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return { total: rows.length, buildable, not_buildable: notBuildable, undecided, by_reason: byReason };
};
