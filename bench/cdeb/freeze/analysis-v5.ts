/**
 * CDEB-Fresh v5 Stage 1-r1: the frozen primary analysis.
 *
 * The Stage 1 draft's interval was invalid and the adversarial review said why:
 * it bootstrapped four *fixed* repositories, which treats them as a sample from
 * a superpopulation, ignores every source of variation inside them, and admits
 * 4^4 = 256 distinct resamples no matter how many replicates are requested.
 * Requesting 10,000 from 256 possibilities does not make the interval finer, it
 * makes the report look like it did.
 *
 * The replacement resamples *candidates within each fixed repository*. The
 * candidate is the cluster -- it carries both arms and every repeat -- so the
 * interval reflects candidate-to-candidate variation, which is the variation
 * the study actually sampled. `assertNoRepositoryResampling` exists so the old
 * shape cannot return under a different name.
 *
 * Two other things are enforced here rather than written down:
 *
 *   ITT           every assigned episode stays in the denominator. A treatment
 *                 that prevents completion would otherwise score as preventing
 *                 revival, which is the failure mode the endpoint was built to
 *                 avoid
 *   empty stratum an equal-weight average over four strata is undefined if one
 *                 is empty. That is a stop, not a number to recompute over the
 *                 survivors
 */

export interface Episode {
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly arm: "on" | "suppressed";
  readonly repeat_index: number;
  readonly completed: boolean;
  readonly functional_acceptance_pass: boolean;
  /** `null` means the oracle could not judge -- a failure, never a removal. */
  readonly revival: boolean | null;
}

/** The primary endpoint. Anything short of all three is a failure, including a missing judgement. */
export const dsfps = (episode: Episode): boolean =>
  episode.completed && episode.functional_acceptance_pass && episode.revival === false;

export interface AssignedEpisode {
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly arm: "on" | "suppressed";
  readonly repeat_index: number;
}

const episodeKey = (episode: AssignedEpisode): string =>
  `${episode.candidate_id}|${episode.arm}|${String(episode.repeat_index)}`;

/**
 * The intention-to-treat denominator. An assigned episode with no observation
 * is not absent from the analysis, it is a failure in it -- otherwise the arm
 * that crashes more often looks like the arm that revives less often.
 */
export const ittEpisodes = (
  assigned: readonly AssignedEpisode[],
  observed: readonly Episode[],
): Episode[] => {
  const byKey = new Map(observed.map((episode) => [episodeKey(episode), episode]));
  const extra = observed.filter((episode) => !assigned.some((row) => episodeKey(row) === episodeKey(episode)));
  if (extra.length > 0) {
    throw new Error(
      `analysis: ${String(extra.length)} observed episode(s) were never assigned: ` +
        `${extra.map(episodeKey).slice(0, 5).join(", ")}. An unassigned episode is outside the randomization`,
    );
  }
  return assigned.map((row) => {
    const observation = byKey.get(episodeKey(row));
    if (observation !== undefined) return observation;
    // Unobserved is scored as failure, not dropped. This is the ITT rule.
    return {
      candidate_id: row.candidate_id,
      repository_id: row.repository_id,
      arm: row.arm,
      repeat_index: row.repeat_index,
      completed: false,
      functional_acceptance_pass: false,
      revival: null,
    };
  });
};

/**
 * Refuses an analysis set that has lost assigned episodes. Called with the raw
 * assignment and whatever the analysis is about to run on, so a filter applied
 * anywhere upstream is caught here rather than in a footnote.
 */
export const assertNoPostTreatmentDrop = (
  assigned: readonly AssignedEpisode[],
  analysed: readonly Episode[],
): void => {
  const analysedKeys = new Set(analysed.map(episodeKey));
  const dropped = assigned.filter((row) => !analysedKeys.has(episodeKey(row)));
  if (dropped.length > 0) {
    throw new Error(
      `analysis: ${String(dropped.length)} assigned episode(s) are missing from the analysis set. ` +
        `Completion, timeout and oracle indeterminacy can all differ by arm, so removing them can manufacture ` +
        `the contrast: ${dropped.map(episodeKey).slice(0, 5).join(", ")}`,
    );
  }
};

const mean = (values: readonly number[]): number => {
  if (values.length === 0) throw new Error("analysis: mean of an empty set is undefined");
  return values.reduce((total, value) => total + value, 0) / values.length;
};

export interface CandidateEffect {
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly on: number;
  readonly suppressed: number;
  readonly difference: number;
}

/** Mean DSFPS per arm within one candidate, then their difference. */
export const candidateEffects = (episodes: readonly Episode[]): CandidateEffect[] => {
  const byCandidate = new Map<string, Episode[]>();
  for (const episode of episodes) {
    const bucket = byCandidate.get(episode.candidate_id);
    if (bucket === undefined) byCandidate.set(episode.candidate_id, [episode]);
    else bucket.push(episode);
  }
  const effects: CandidateEffect[] = [];
  for (const [candidateId, rows] of [...byCandidate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const on = rows.filter((row) => row.arm === "on");
    const suppressed = rows.filter((row) => row.arm === "suppressed");
    if (on.length === 0 || suppressed.length === 0) {
      throw new Error(
        `analysis: ${candidateId} does not carry both arms (${String(on.length)} on, ${String(suppressed.length)} suppressed). ` +
          `The candidate is the paired cluster; a half-observed pair cannot enter the paired estimate`,
      );
    }
    const onRate = mean(on.map((row) => (dsfps(row) ? 1 : 0)));
    const offRate = mean(suppressed.map((row) => (dsfps(row) ? 1 : 0)));
    effects.push({
      candidate_id: candidateId,
      repository_id: rows[0]?.repository_id ?? "",
      on: onRate,
      suppressed: offRate,
      difference: onRate - offRate,
    });
  }
  return effects;
};

/**
 * The equal-weight estimand. `fixedRepositories` is passed in rather than
 * derived from the data, because deriving it is exactly how an empty stratum
 * disappears: a repository that contributed nothing simply would not appear in
 * a groupBy, and the average would quietly become one over three.
 */
export const equalWeightDelta = (
  effects: readonly CandidateEffect[],
  fixedRepositories: readonly string[],
): { readonly delta: number; readonly per_repository: Readonly<Record<string, number>> } => {
  const perRepository: Record<string, number> = {};
  for (const repository of fixedRepositories) {
    const inRepository = effects.filter((effect) => effect.repository_id === repository);
    if (inRepository.length === 0) {
      throw new Error(
        `analysis: repository ${repository} contributes no analysable candidate. The estimand is an equal-weight ` +
          `average over ${String(fixedRepositories.length)} fixed strata and is undefined when one is empty. ` +
          `This is a stop and a report, not an average over the survivors`,
      );
    }
    perRepository[repository] = mean(inRepository.map((effect) => effect.difference));
  }
  return {
    delta: mean(fixedRepositories.map((repository) => perRepository[repository] ?? 0)),
    per_repository: perRepository,
  };
};

/** sfc32, seeded from the committed string. No Math.random: a replicate set must be reproducible. */
const seededRandom = (seed: string): (() => number) => {
  let h = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    h = Math.imul(h ^ seed.charCodeAt(index), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  let b = (h ^ 0x9e3779b9) >>> 0;
  let c = (h ^ 0x85ebca6b) >>> 0;
  let d = (h ^ 0xc2b2ae35) >>> 0;
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
};

export const PREREGISTERED_REPLICATES = 20000;
export const PREREGISTERED_CONFIDENCE = 0.95;

export interface Interval {
  readonly point: number;
  readonly lower: number;
  readonly upper: number;
  readonly replicates: number;
  readonly confidence: number;
  readonly excludes_zero_in_predicted_direction: boolean;
}

/**
 * Refuses any resampling design that draws repositories. The check is on the
 * unit name because the defect is not a bug in one line -- it is a design that
 * looked reasonable and produced an interval nobody could read as invalid.
 */
export const assertNoRepositoryResampling = (resamplingUnit: string): void => {
  const unit = resamplingUnit.trim().toLowerCase();
  if (unit === "repository" || unit === "repositories" || unit === "stratum" || unit === "strata") {
    throw new Error(
      `analysis: the resampling unit is "${resamplingUnit}". The four repositories are fixed strata, not a sample ` +
        `from a superpopulation; resampling them admits 4^4 = 256 distinct draws and reports an interval about a ` +
        `population that was never sampled. Resample candidates within each fixed repository instead`,
    );
  }
  if (unit !== "candidate" && unit !== "candidates") {
    throw new Error(`analysis: the resampling unit must be the candidate cluster, not "${resamplingUnit}"`);
  }
};

/**
 * Repository-stratified percentile bootstrap over candidate clusters.
 *
 * Within each fixed repository, candidates are drawn with replacement to the
 * same count; repository effects are recomputed from the drawn candidates and
 * combined with equal weight. The repositories themselves are never drawn.
 */
export const stratifiedBootstrap = (
  effects: readonly CandidateEffect[],
  fixedRepositories: readonly string[],
  options: { readonly seed: string; readonly replicates?: number; readonly confidence?: number },
): Interval => {
  assertNoRepositoryResampling("candidate");
  const replicates = options.replicates ?? PREREGISTERED_REPLICATES;
  const confidence = options.confidence ?? PREREGISTERED_CONFIDENCE;
  const point = equalWeightDelta(effects, fixedRepositories).delta;

  const byRepository = fixedRepositories.map((repository) =>
    effects.filter((effect) => effect.repository_id === repository).map((effect) => effect.difference),
  );
  for (const [index, bucket] of byRepository.entries()) {
    if (bucket.length === 0) {
      throw new Error(`analysis: repository ${fixedRepositories[index] ?? ""} has no candidate to resample`);
    }
  }

  const random = seededRandom(options.seed);
  const draws: number[] = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    let total = 0;
    for (const bucket of byRepository) {
      let sum = 0;
      for (let draw = 0; draw < bucket.length; draw += 1) {
        sum += bucket[Math.floor(random() * bucket.length)] ?? 0;
      }
      total += sum / bucket.length;
    }
    draws.push(total / byRepository.length);
  }
  draws.sort((left, right) => left - right);
  const tail = (1 - confidence) / 2;
  const lower = draws[Math.floor(tail * (replicates - 1))] ?? 0;
  const upper = draws[Math.ceil((1 - tail) * (replicates - 1))] ?? 0;
  return {
    point,
    lower,
    upper,
    replicates,
    confidence,
    // Superiority in the predicted direction: automatic delivery raises DSFPS.
    excludes_zero_in_predicted_direction: lower > 0,
  };
};

export const NONINFERIORITY_MARGIN = -0.05;

export interface NonDegradation {
  readonly functional_pass_difference: number;
  readonly completion_difference: number;
  readonly margin: number;
  readonly holds: boolean;
}

/**
 * A treatment that cuts revival by cutting completion has not improved the
 * agent, so both rates carry a preregistered noninferiority margin. Reported
 * whatever the primary endpoint does.
 */
export const nonDegradation = (episodes: readonly Episode[], margin = NONINFERIORITY_MARGIN): NonDegradation => {
  const on = episodes.filter((episode) => episode.arm === "on");
  const off = episodes.filter((episode) => episode.arm === "suppressed");
  if (on.length === 0 || off.length === 0) throw new Error("analysis: non-degradation needs both arms");
  const functionalDifference =
    mean(on.map((row) => (row.functional_acceptance_pass ? 1 : 0))) -
    mean(off.map((row) => (row.functional_acceptance_pass ? 1 : 0)));
  const completionDifference =
    mean(on.map((row) => (row.completed ? 1 : 0))) - mean(off.map((row) => (row.completed ? 1 : 0)));
  return {
    functional_pass_difference: functionalDifference,
    completion_difference: completionDifference,
    margin,
    holds: functionalDifference >= margin && completionDifference >= margin,
  };
};
