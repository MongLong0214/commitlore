/**
 * Whole-host token accounting — #1035 and #1033 §1, revision
 * `native-efficacy-r6.1`.
 *
 * The legacy driver's total is not this total, and #1035 says so directly: it
 * "excludes cache reads in its legacy total, maps missing usage to zero". Both
 * are correct for what they were built for — that total bounds *work* for a
 * global cap, and a cached prefix re-read every turn would swallow the cap — and
 * both are wrong for a cost comparison between two arms. A study whose treatment
 * arm reads a larger cached prefix would report the treatment as cheaper.
 *
 * So this is a separate accounting rather than a change to the old one, and it
 * differs in three ways that each matter to the result:
 *
 *   1. **Four categories, kept apart.** Input, cache creation, cache read and
 *      output are reported separately and per model, because they are priced
 *      differently and a single number cannot be re-derived into them.
 *   2. **Missing is `null`, never `0`.** #1035 forbids `value || 0`. A zero is a
 *      measurement and an absence is not, and collapsing them makes an arm whose
 *      usage failed to report look free.
 *   3. **Zero after observed spend is a lower bound, not a total.** "If final
 *      usage is missing or reports zero despite observed earlier consumption,
 *      retain known lower/subtotals and unknown complete usage."
 *
 * Nothing here prices anything. #1035 keeps reported tokens, a host cost
 * estimate, an independently recomputed price and actual billing as four
 * different objects, and an unknown model or scope "cannot receive an arbitrary
 * fallback price", so no rate table lives in this module.
 */

/**
 * What the counted total covers. Explicit because the CLI's aggregate meaning is
 * something #1035 requires be established by observation -- "Do not assume
 * top-level `usage` includes subagents or blindly add `modelUsage` to it".
 */
export type UsageScope = "host_total" | "main_loop" | "partial" | "unknown";

export type Completeness = "complete" | "lower_bound" | "unknown";

export interface UsageCategories {
  readonly input: number | null;
  readonly cache_creation: number | null;
  readonly cache_read: number | null;
  readonly output: number | null;
}

export const EMPTY_CATEGORIES: UsageCategories = {
  input: null,
  cache_creation: null,
  cache_read: null,
  output: null,
};

export interface ObservedRequest {
  /**
   * Real request identity. Content blocks of one request share it, and #1035
   * deduplicates by it rather than by position, because a stream repeats a
   * request's usage per block with the output figure growing.
   */
  readonly request_id: string;
  readonly model: string;
  /** An auxiliary call is a distinct request and stays included. */
  readonly role: "main" | "auxiliary";
  /** Later events for one request supersede earlier ones. */
  readonly sequence: number;
  readonly usage: UsageCategories;
}

export interface UsageAccount {
  readonly scope: UsageScope;
  readonly totals: UsageCategories;
  /** The four categories summed, or `null` when any of them is unknown. */
  readonly total: number | null;
  readonly by_model: Readonly<Record<string, UsageCategories>>;
  /** Distinct requests after deduplication. */
  readonly requests: number;
  readonly completeness: Completeness;
  readonly notes: readonly string[];
}

/**
 * A counter, or `null`.
 *
 * #1035: "No numeric coercion or `value || 0`; counters are finite nonnegative
 * safe integers or null." A string that parses, a float, a negative or a NaN are
 * all absences of a valid measurement, and each becomes `null` rather than a
 * number somebody later adds up.
 */
export const counterOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

const CATEGORY_KEYS = ["input", "cache_creation", "cache_read", "output"] as const;

type CategoryKey = (typeof CATEGORY_KEYS)[number];

/**
 * Read the four categories out of a raw usage object.
 *
 * The field names are the CLI's. `cache_read_input_tokens` is read here and
 * deliberately not dropped: excluding it is exactly the legacy behaviour #1035
 * names as a thing the measured path must not inherit.
 */
export const categoriesOf = (raw: unknown): UsageCategories => {
  if (typeof raw !== "object" || raw === null) return EMPTY_CATEGORIES;
  const fields = raw as Record<string, unknown>;
  return {
    input: counterOf(fields["input_tokens"]),
    cache_creation: counterOf(fields["cache_creation_input_tokens"]),
    cache_read: counterOf(fields["cache_read_input_tokens"]),
    output: counterOf(fields["output_tokens"]),
  };
};

/**
 * Add two categories, where one unknown makes the sum unknown.
 *
 * Treating `null` as zero here is the same error as `value || 0` one level up:
 * it would turn "we do not know what this request cost" into "this request was
 * free", and the arm with the broken reporter would win.
 */
const addCategory = (left: number | null, right: number | null): number | null =>
  left === null || right === null ? null : left + right;

const addCategories = (left: UsageCategories, right: UsageCategories): UsageCategories => ({
  input: addCategory(left.input, right.input),
  cache_creation: addCategory(left.cache_creation, right.cache_creation),
  cache_read: addCategory(left.cache_read, right.cache_read),
  output: addCategory(left.output, right.output),
});

/** Start from zero so a genuinely empty set sums to zero rather than unknown. */
const ZERO: UsageCategories = { input: 0, cache_creation: 0, cache_read: 0, output: 0 };

export const totalOf = (categories: UsageCategories): number | null => {
  let total = 0;
  for (const key of CATEGORY_KEYS) {
    const value = categories[key as CategoryKey];
    if (value === null) return null;
    total += value;
  }
  return total;
};

/**
 * Collapse repeated events for one request to its latest complete value.
 *
 * "Deduplicate content blocks by real request identity; cumulative output uses
 * the latest complete value." Summing the blocks instead would multiply one
 * request's input by however many content blocks it happened to produce.
 */
const latestPerRequest = (requests: readonly ObservedRequest[]): ObservedRequest[] => {
  const latest = new Map<string, ObservedRequest>();
  for (const request of requests) {
    const seen = latest.get(request.request_id);
    if (seen === undefined || request.sequence >= seen.sequence) latest.set(request.request_id, request);
  }
  return [...latest.values()];
};

export interface AccountOptions {
  readonly scope: UsageScope;
  /**
   * The host's own final aggregate, when it reported one.
   *
   * Reconciled against the per-request reconstruction rather than trusted over
   * it: #1035 calls them "alternative totals", and the disagreement between them
   * is information rather than an error to resolve silently.
   */
  readonly reportedFinal?: UsageCategories;
}

/**
 * Account for one phase's observed requests.
 *
 * Returns the per-request reconstruction, per model, with an explicit
 * completeness. A `lower_bound` is a real answer: it says the run spent at least
 * this much and that the total is not known, which is what #1035 asks for when a
 * final figure contradicts observed earlier consumption.
 */
export const accountUsage = (
  requests: readonly ObservedRequest[],
  options: AccountOptions,
): UsageAccount => {
  const distinct = latestPerRequest(requests);
  const notes: string[] = [];

  let totals = ZERO;
  const byModel: Record<string, UsageCategories> = {};
  for (const request of distinct) {
    totals = addCategories(totals, request.usage);
    byModel[request.model] = addCategories(byModel[request.model] ?? ZERO, request.usage);
  }

  const duplicates = requests.length - distinct.length;
  if (duplicates > 0) notes.push(`${String(duplicates)} repeated request event(s) collapsed to their latest value`);

  let completeness: Completeness = totalOf(totals) === null ? "lower_bound" : "complete";
  if (completeness === "lower_bound") {
    notes.push("at least one request reported no usable usage, so the total is a lower bound on known categories");
  }
  if (distinct.length === 0) {
    completeness = "unknown";
    notes.push("no request was observed, which is not the same as a run that cost nothing");
  }

  const final = options.reportedFinal;
  if (final !== undefined) {
    const finalTotal = totalOf(final);
    const observedTotal = totalOf(totals);
    // "If final usage is missing or reports zero despite observed earlier
    // consumption, retain known lower/subtotals and unknown complete usage."
    if (finalTotal === 0 && observedTotal !== null && observedTotal > 0) {
      completeness = "lower_bound";
      notes.push(
        `the host reported a final total of 0 after ${String(observedTotal)} observed token(s); ` +
          "the observed subtotal is retained and the complete usage is unknown",
      );
    } else if (finalTotal !== null && observedTotal !== null && finalTotal !== observedTotal) {
      notes.push(
        `the host's final total (${String(finalTotal)}) and the per-request reconstruction ` +
          `(${String(observedTotal)}) disagree; both are retained as alternative totals`,
      );
    }
  }

  return {
    scope: options.scope,
    totals,
    total: totalOf(totals),
    by_model: byModel,
    requests: distinct.length,
    completeness,
    notes,
  };
};
