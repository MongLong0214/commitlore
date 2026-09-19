/**
 * The seeded schedule and the pair budget — #1036, revision
 * `native-efficacy-r6.1`.
 *
 * `--execute` is what spends money; without it #1036 says the runner does
 * read-only planning and writes nothing. That makes the plan a deliverable in
 * its own right, and it is the half of the runner that can be wrong silently:
 * a schedule that favours one arm, or a budget that lets a pair start and run
 * out halfway, produces a complete-looking results file rather than an error.
 *
 * Two rules carry the comparison.
 *
 * **The arm order is drawn fairly and then frozen.** Which arm goes first
 * matters — the first one warms whatever the second one then shares (provider
 * caches, a source checkout's page cache, the operator's attention) — so the
 * initial order is drawn per cluster from the seed and alternates for that
 * cluster's later pairs, and the same order is reused for capture, solve and
 * repair. Redrawing per phase would let one arm lead a capture and trail a
 * solve, which is neither balanced nor reproducible.
 *
 * **A pair starts whole or not at all.** #1036: reserve the declared worst-case
 * pair budget before starting it, and "Do not spend leftover budget on a
 * favorable single arm". A pair that runs the control and then stops has not
 * produced a cheap half-measurement; it has produced an unpaired row that a
 * later reader will average in.
 *
 * The seed is a string and the generator is written out here rather than
 * imported, because a schedule has to be reproducible from the run metadata
 * alone, years after whatever version of a dependency was installed.
 */

export type Arm = "off" | "native";

export const ARMS: readonly Arm[] = ["off", "native"];

/** The fields of a StudyCase this module needs. #1038 owns the whole type. */
export interface ScheduleCase {
  readonly id: string;
  readonly cluster_id: string;
}

export interface ScheduledPair {
  readonly case_id: string;
  readonly cluster_id: string;
  /** 1-based, so a log line reads as "repetition 2 of 3". */
  readonly repetition: number;
  /** Frozen for capture, solve and repair alike. */
  readonly order: readonly [Arm, Arm];
}

/**
 * A small, explicit PRNG.
 *
 * Deliberately not `Math.random` and deliberately not a dependency: the
 * schedule must be reproducible from the seed recorded in the run metadata, and
 * a reader re-deriving it later has this function in front of them rather than
 * a version range.
 */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** FNV-1a, so any seed string maps to a 32-bit state. */
const hashSeed = (seed: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** Fisher-Yates, drawn from the seeded generator so the order is reproducible. */
const shuffled = <T>(items: readonly T[], next: () => number): T[] => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    const here = out[index]!;
    out[index] = out[swap]!;
    out[swap] = here;
  }
  return out;
};

export interface PlanInput {
  readonly cases: readonly ScheduleCase[];
  /** Repetitions per case. Capture repeats too (#1033 §1). */
  readonly repeat: number;
  readonly seed: string;
}

/**
 * The full sequential plan, in the order the runner will walk it.
 *
 * Clusters are shuffled rather than taken in file order, so a results file
 * truncated by an interruption is not systematically the first half of the
 * manifest.
 */
export const planSchedule = ({ cases, repeat, seed }: PlanInput): ScheduledPair[] => {
  if (!Number.isSafeInteger(repeat) || repeat < 1) {
    throw new Error(`repeat must be a positive safe integer; got ${String(repeat)}`);
  }
  const next = mulberry32(hashSeed(seed));

  const byCluster = new Map<string, ScheduleCase[]>();
  for (const entry of cases) {
    const bucket = byCluster.get(entry.cluster_id);
    if (bucket === undefined) byCluster.set(entry.cluster_id, [entry]);
    else bucket.push(entry);
  }

  const plan: ScheduledPair[] = [];
  for (const cluster of shuffled([...byCluster.keys()], next)) {
    // One draw per cluster, then strict alternation. Drawing per pair would
    // leave the split to chance and could hand one arm every lead in a small
    // cluster, which is the imbalance this is here to remove.
    let first: Arm = next() < 0.5 ? "off" : "native";
    for (const entry of byCluster.get(cluster) ?? []) {
      for (let repetition = 1; repetition <= repeat; repetition += 1) {
        plan.push({
          case_id: entry.id,
          cluster_id: cluster,
          repetition,
          order: first === "off" ? ["off", "native"] : ["native", "off"],
        });
        first = first === "off" ? "native" : "off";
      }
    }
  }
  return plan;
};

export interface PhaseLimits {
  /** Token ceiling for one capture call. */
  readonly capture: number;
  readonly solve: number;
  readonly repair: number;
}

/**
 * The worst case for one pair: two captures, two solves, two repairs.
 *
 * #1036 fixes the shape — "at most six actor sessions" — and the reservation is
 * made against this rather than against what a pair is expected to use, because
 * an expectation that turns out low leaves the second arm unfunded and the row
 * unpaired.
 */
export const worstCasePairCost = (limits: PhaseLimits): number =>
  2 * (limits.capture + limits.solve + limits.repair);

const isLimit = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/**
 * Reject limits that are not finite, positive, safe integers (#1036).
 *
 * A zero or a NaN here would make `worstCasePairCost` report a pair as free and
 * every reservation succeed, which is the failure that spends the whole
 * authorisation before anyone reads a number.
 */
export const assertUsableLimits = (limits: PhaseLimits): void => {
  for (const phase of ["capture", "solve", "repair"] as const) {
    if (!isLimit(limits[phase])) {
      throw new Error(`the ${phase} token limit must be a positive safe integer; got ${String(limits[phase])}`);
    }
  }
};

export type ReservationOutcome = "reserved" | "insufficient" | "unknown-consumption";

export interface Reservation {
  readonly outcome: ReservationOutcome;
  readonly required: number;
  /** What remains after this pair, when it could be reserved. */
  readonly remainingAfter: number | null;
  readonly reason: string;
}

export interface ReserveInput {
  /**
   * Authorised tokens still available, or `null` when consumption could not be
   * established.
   *
   * `null` is not zero: #1036 says unknown consumption "stops later spending
   * when remaining authorization cannot be established; it does not erase
   * already known quality". So the pair does not start and nothing already
   * measured is discarded.
   */
  readonly remaining: number | null;
  readonly limits: PhaseLimits;
}

/** Reserve the whole pair, or decline it. There is no partial start. */
export const reservePair = ({ remaining, limits }: ReserveInput): Reservation => {
  assertUsableLimits(limits);
  const required = worstCasePairCost(limits);

  if (remaining === null) {
    return {
      outcome: "unknown-consumption",
      required,
      remainingAfter: null,
      reason: "remaining authorisation could not be established, so no further pair starts; measured rows stand",
    };
  }
  if (remaining < required) {
    return {
      outcome: "insufficient",
      required,
      remainingAfter: null,
      reason:
        `the worst case for this pair is ${String(required)} and ${String(remaining)} remain; ` +
        "running only the arm that fits would leave an unpaired row",
    };
  }
  return {
    outcome: "reserved",
    required,
    remainingAfter: remaining - required,
    reason: "the whole pair is funded at its worst case",
  };
};
