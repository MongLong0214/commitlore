import type { Matcher, MatcherGroup } from "./types.ts";

export interface Surfaces {
  /** What the agent said. */
  readonly transcript: string;
  /** Working-tree diff against the seeded HEAD. */
  readonly diff: string;
  /** Commit messages the agent wrote during the run. */
  readonly commits: string;
}

export interface DetectionResult {
  readonly matched: boolean;
  readonly labels: readonly string[];
}

/**
 * Case, unicode form and whitespace are not signal — an agent proposing
 * "Redis" and one proposing "redis  cache" made the same proposal.
 */
export const normalize = (text: string): string =>
  text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

const surfaceText = (surfaces: Surfaces, where: Matcher["in"]): string => {
  if (where === "transcript") return surfaces.transcript;
  if (where === "diff") return surfaces.diff;
  if (where === "commits") return surfaces.commits;
  if (where === "artifacts") return [surfaces.diff, surfaces.commits].join("\n");
  return [surfaces.transcript, surfaces.diff, surfaces.commits].join("\n");
};

export const labelOf = (matcher: Matcher): string =>
  matcher.label ?? `${matcher.kind}:${matcher.value}`;

/** Throws on an uncompilable pattern so a typo fails at load time, not silently at match time. */
export const compileMatcher = (matcher: Matcher): RegExp | null => {
  if (matcher.kind !== "regex") return null;
  return new RegExp(matcher.value, matcher.flags ?? "i");
};

export const matches = (matcher: Matcher, surfaces: Surfaces): boolean => {
  const haystack = surfaceText(surfaces, matcher.in);
  if (matcher.kind === "literal") {
    const needle = normalize(matcher.value);
    return needle !== "" && normalize(haystack).includes(needle);
  }
  const pattern = compileMatcher(matcher);
  return pattern !== null && pattern.test(haystack);
};

/**
 * `any_of` and `all_of` are ANDed when both are present. A group with no
 * populated clause never matches — an empty `violation_if` means "no violation
 * is defined", not "everything violates".
 */
export const evaluateGroup = (group: MatcherGroup | undefined, surfaces: Surfaces): DetectionResult => {
  if (group === undefined) return { matched: false, labels: [] };
  const anyOf = group.any_of ?? [];
  const allOf = group.all_of ?? [];
  if (anyOf.length === 0 && allOf.length === 0) return { matched: false, labels: [] };

  const anyHits = anyOf.filter((m) => matches(m, surfaces));
  const allHits = allOf.filter((m) => matches(m, surfaces));
  const anySatisfied = anyOf.length === 0 || anyHits.length > 0;
  const allSatisfied = allHits.length === allOf.length;
  const labels = [...anyHits, ...allHits].map(labelOf);
  return { matched: anySatisfied && allSatisfied, labels };
};

/** Violations are counted per matched clause, so one run can carry several. */
export const countViolations = (group: MatcherGroup | undefined, surfaces: Surfaces): DetectionResult => {
  if (group === undefined) return { matched: false, labels: [] };
  const clauses = [...(group.any_of ?? []), ...(group.all_of ?? [])];
  const hits = clauses.filter((m) => matches(m, surfaces)).map(labelOf);
  return { matched: hits.length > 0, labels: hits };
};
