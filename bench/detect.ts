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

export interface ReproposalMatchResult extends DetectionResult {
  readonly count: number;
}

/**
 * Case, unicode form and whitespace are not signal — an agent proposing
 * "Redis" and one proposing "redis  cache" made the same proposal.
 */
export const normalize = (text: string): string =>
  text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Documentation, where naming a technology is discussion rather than use. */
const DOC_FILE = /\.(md|markdown|txt|rst|adoc)$/i;

/** A line whose content is a comment in any of the languages these tasks use. */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#|<!--|--)/;

/**
 * Added lines that are code: the diff's `+` lines, minus documentation files
 * and minus comments.
 *
 * `artifacts` was introduced to stop a transcript matcher scoring a refusal as
 * a re-proposal, and it did not go far enough. An agent writes its reasoning
 * into commit messages, into markdown, and into comments, and all three are
 * artifacts — so a run that avoided RabbitMQ *and said so* scored as having
 * proposed it. Measured on the M1 matrix, that was three of the treatment arm's
 * five flags and none of the control arm's seven, because only the treatment
 * arm is told the names it then mentions (`bench/DETECTOR-DEFECT.md`).
 *
 * Implementing an alternative leaves a manifest entry, an import, a
 * construction or a configured endpoint. Explaining that it was avoided leaves
 * a sentence. This surface keeps the first and drops the second.
 */
const codeText = (diff: string): string => {
  const kept: string[] = [];
  let inDocFile = false;
  for (const line of diff.split("\n")) {
    // `+++ b/path` opens a file; `--- a/path` is its pair and carries the same
    // path on a rename, so the `+++` side is the one that decides.
    if (line.startsWith("+++ ")) {
      inDocFile = DOC_FILE.test(line.slice(4).replace(/^b\//, "").trim());
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("diff --git") || line.startsWith("@@")) continue;
    if (!line.startsWith("+")) continue;
    if (inDocFile) continue;
    const body = line.slice(1);
    if (COMMENT_LINE.test(body)) continue;
    kept.push(body);
  }
  return kept.join("\n");
};

const surfaceText = (surfaces: Surfaces, where: Matcher["in"]): string => {
  if (where === "transcript") return surfaces.transcript;
  if (where === "diff") return surfaces.diff;
  if (where === "commits") return surfaces.commits;
  if (where === "code") return codeText(surfaces.diff);
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

export const countReproposalMatches = (group: MatcherGroup, surfaces: Surfaces): ReproposalMatchResult => {
  const result = evaluateGroup(group, surfaces);
  return { ...result, count: new Set(result.labels).size };
};

/** Violations are counted per matched clause, so one run can carry several. */
export const countViolations = (group: MatcherGroup | undefined, surfaces: Surfaces): DetectionResult => {
  if (group === undefined) return { matched: false, labels: [] };
  const clauses = [...(group.any_of ?? []), ...(group.all_of ?? [])];
  const hits = clauses.filter((m) => matches(m, surfaces)).map(labelOf);
  return { matched: hits.length > 0, labels: hits };
};
