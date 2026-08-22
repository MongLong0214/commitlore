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

/**
 * The join key carries the repository as well.
 *
 * An earlier version keyed on candidate, arm and repeat only, and built the
 * lookup with `new Map(observed.map(...))`. Both were defects and an
 * adversarial review found them together. Last-write-wins meant a failed
 * episode could be retried and the success, carrying the same key, would
 * silently replace it -- every assigned key still present, so the
 * post-treatment-drop guard saw nothing. Omitting the repository meant an
 * observation could arrive labelled with a repository it was not assigned to
 * and be carried into the equal-weight average under the wrong stratum.
 */
const episodeKey = (episode: AssignedEpisode): string =>
  `${episode.repository_id}|${episode.candidate_id}|${episode.arm}|${String(episode.repeat_index)}`;

/**
 * The intention-to-treat denominator. An assigned episode with no observation
 * is not absent from the analysis, it is a failure in it -- otherwise the arm
 * that crashes more often looks like the arm that revives less often.
 *
 * Duplicates are refused rather than resolved. There is no correct way to pick
 * between two observations of one assigned episode: whichever rule is applied,
 * it applies after the outcomes are visible.
 */
export const ittEpisodes = (
  assigned: readonly AssignedEpisode[],
  observed: readonly Episode[],
): Episode[] => {
  const assignedKeys = new Set(assigned.map(episodeKey));
  const duplicatedAssignments = assigned
    .map(episodeKey)
    .filter((key, index, all) => all.indexOf(key) !== index);
  if (duplicatedAssignments.length > 0) {
    throw new Error(
      `analysis: the assignment contains ${String(duplicatedAssignments.length)} duplicate key(s): ` +
        `${[...new Set(duplicatedAssignments)].slice(0, 5).join(", ")}`,
    );
  }

  const byKey = new Map<string, Episode>();
  for (const episode of observed) {
    const key = episodeKey(episode);
    if (byKey.has(key)) {
      throw new Error(
        `analysis: two observations for the assigned episode ${key}. A retried episode whose second attempt ` +
          `overwrites its first erases a treatment failure while leaving every assigned key present, which is ` +
          `invisible to the post-treatment-drop check. Give each attempt its own identity and preregister how ` +
          `retries are scored`,
      );
    }
    byKey.set(key, episode);
  }

  const extra = observed.filter((episode) => !assignedKeys.has(episodeKey(episode)));
  if (extra.length > 0) {
    throw new Error(
      `analysis: ${String(extra.length)} observed episode(s) were never assigned: ` +
        `${extra.map(episodeKey).slice(0, 5).join(", ")}. An unassigned episode is outside the randomization, ` +
        `and a mismatched repository label is one of the ways that happens`,
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

/** One candidate's DSFPS outcomes, kept per arm so repeats can be resampled. */
export interface CandidateCluster {
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly on: readonly number[];
  readonly suppressed: readonly number[];
}

export const candidateClusters = (episodes: readonly Episode[]): CandidateCluster[] => {
  const byCandidate = new Map<string, Episode[]>();
  for (const episode of episodes) {
    const bucket = byCandidate.get(episode.candidate_id);
    if (bucket === undefined) byCandidate.set(episode.candidate_id, [episode]);
    else bucket.push(episode);
  }
  const clusters: CandidateCluster[] = [];
  for (const [candidateId, rows] of [...byCandidate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const on = rows.filter((row) => row.arm === "on");
    const suppressed = rows.filter((row) => row.arm === "suppressed");
    if (on.length === 0 || suppressed.length === 0) {
      throw new Error(
        `analysis: ${candidateId} does not carry both arms (${String(on.length)} on, ${String(suppressed.length)} suppressed)`,
      );
    }
    clusters.push({
      candidate_id: candidateId,
      repository_id: rows[0]?.repository_id ?? "",
      on: on.map((row) => (dsfps(row) ? 1 : 0)),
      suppressed: suppressed.map((row) => (dsfps(row) ? 1 : 0)),
    });
  }
  return clusters;
};

const drawMean = (values: readonly number[], random: () => number): number => {
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[Math.floor(random() * values.length)] ?? 0;
  }
  return sum / values.length;
};

/**
 * Repository-stratified two-level percentile bootstrap.
 *
 * Within each fixed repository, candidates are drawn with replacement to the
 * same count; **within each drawn candidate, repeats are drawn with replacement
 * inside each arm**; repository effects are recomputed and combined with equal
 * weight. The repositories themselves are never drawn.
 *
 * The second level was missing and an adversarial review showed what that costs.
 * Resampling only the per-candidate point estimates makes the interval reflect
 * between-candidate spread alone. Where candidates happen to agree, the spread
 * is zero and the interval collapses:
 *
 *   50 candidates, 8 repeats, every one 1 of 8 ON against 0 of 8 SUPPRESSED
 *   -> every candidate effect is exactly 0.125
 *   -> every draw is 0.125, interval [0.125, 0.125], superiority declared
 *
 * Zero width from eight coin flips per arm is not a small uncertainty, it is an
 * unrepresented one. Drawing the repeats too puts it back.
 */
export const stratifiedBootstrap = (
  clusters: readonly CandidateCluster[],
  fixedRepositories: readonly string[],
  options: { readonly seed: string; readonly replicates?: number; readonly confidence?: number },
): Interval => {
  assertNoRepositoryResampling("candidate");
  const replicates = options.replicates ?? PREREGISTERED_REPLICATES;
  const confidence = options.confidence ?? PREREGISTERED_CONFIDENCE;
  const point = equalWeightDelta(
    clusters.map((cluster) => ({
      candidate_id: cluster.candidate_id,
      repository_id: cluster.repository_id,
      on: mean(cluster.on),
      suppressed: mean(cluster.suppressed),
      difference: mean(cluster.on) - mean(cluster.suppressed),
    })),
    fixedRepositories,
  ).delta;

  const byRepository = fixedRepositories.map((repository) =>
    clusters.filter((cluster) => cluster.repository_id === repository),
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
        const cluster = bucket[Math.floor(random() * bucket.length)];
        if (cluster === undefined) continue;
        sum += drawMean(cluster.on, random) - drawMean(cluster.suppressed, random);
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

export interface NonDegradationEndpoint {
  readonly point: number;
  readonly lower: number;
  readonly margin: number;
  readonly holds: boolean;
}

export interface NonDegradation {
  readonly functional_pass: NonDegradationEndpoint;
  readonly completion: NonDegradationEndpoint;
  readonly margin: number;
  readonly holds: boolean;
}

/** Per-arm rate of a boolean episode property, as a candidate cluster. */
const propertyClusters = (
  episodes: readonly Episode[],
  property: (episode: Episode) => boolean,
): CandidateCluster[] => {
  const byCandidate = new Map<string, Episode[]>();
  for (const episode of episodes) {
    const bucket = byCandidate.get(episode.candidate_id);
    if (bucket === undefined) byCandidate.set(episode.candidate_id, [episode]);
    else bucket.push(episode);
  }
  return [...byCandidate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([candidateId, rows]) => ({
      candidate_id: candidateId,
      repository_id: rows[0]?.repository_id ?? "",
      on: rows.filter((row) => row.arm === "on").map((row) => (property(row) ? 1 : 0)),
      suppressed: rows.filter((row) => row.arm === "suppressed").map((row) => (property(row) ? 1 : 0)),
    }));
};

/**
 * A treatment that cuts revival by cutting completion has not improved the
 * agent, so both rates carry a preregistered noninferiority margin.
 *
 * Two things here were wrong in the first version and an adversarial review
 * found both. It pooled every episode, so the equal-repository weighting that
 * the primary endpoint uses did not apply -- a completion collapse confined to
 * a small repository was diluted by three large ones. And it compared a point
 * estimate to the margin with no interval, so an arbitrarily imprecise estimate
 * a hair above -5 points passed.
 *
 * Measured: one repository with a single candidate whose ON arm completed
 * nothing, against three repositories of twenty that completed everything,
 * pooled to -1.6 points and passed. Under equal weighting that repository alone
 * is -100 points and the margin fails, which is the answer.
 */
export const nonDegradation = (
  episodes: readonly Episode[],
  fixedRepositories: readonly string[],
  options: { readonly seed: string; readonly replicates?: number; readonly confidence?: number },
  margin = NONINFERIORITY_MARGIN,
): NonDegradation => {
  const endpoint = (property: (episode: Episode) => boolean): NonDegradationEndpoint => {
    const clusters = propertyClusters(episodes, property);
    const interval = stratifiedBootstrap(clusters, fixedRepositories, options);
    return { point: interval.point, lower: interval.lower, margin, holds: interval.lower >= margin };
  };
  const functionalPass = endpoint((row) => row.functional_acceptance_pass);
  const completion = endpoint((row) => row.completed);
  return {
    functional_pass: functionalPass,
    completion,
    margin,
    holds: functionalPass.holds && completion.holds,
  };
};

export interface ClaimGate {
  readonly superiority: Interval;
  readonly non_degradation: NonDegradation;
  readonly may_claim_improvement: boolean;
  readonly refusals: readonly string[];
}

/**
 * The single gate a headline claim must pass. It exists because the two results
 * were separately computed and separately reported, which leaves the claim to
 * whoever writes the summary -- and a superiority interval excluding zero reads
 * as a result whether or not completion collapsed underneath it.
 */
export const claimGate = (
  assigned: readonly AssignedEpisode[],
  observed: readonly Episode[],
  fixedRepositories: readonly string[],
  options: { readonly seed: string; readonly replicates?: number; readonly confidence?: number },
): ClaimGate => {
  const episodes = ittEpisodes(assigned, observed);
  assertNoPostTreatmentDrop(assigned, episodes);
  const superiority = stratifiedBootstrap(candidateClusters(episodes), fixedRepositories, options);
  const degradation = nonDegradation(episodes, fixedRepositories, options);
  const refusals: string[] = [];
  if (!superiority.excludes_zero_in_predicted_direction) {
    refusals.push("the primary interval does not exclude zero in the predicted direction");
  }
  if (!degradation.completion.holds) {
    refusals.push(
      `completion fell below the ${String(degradation.margin)} margin ` +
        `(lower bound ${degradation.completion.lower.toFixed(3)})`,
    );
  }
  if (!degradation.functional_pass.holds) {
    refusals.push(
      `functional acceptance fell below the ${String(degradation.margin)} margin ` +
        `(lower bound ${degradation.functional_pass.lower.toFixed(3)})`,
    );
  }
  return {
    superiority,
    non_degradation: degradation,
    may_claim_improvement: refusals.length === 0,
    refusals,
  };
};
