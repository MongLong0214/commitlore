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

// ---------------------------------------------------------------------------
// Rejected-path work (bug #141)
// ---------------------------------------------------------------------------
//
// `reproposed`/`reproposal_matches` above answer "did this run's output match
// the rejected alternative's signature", on any surface the task names —
// including a transcript, a commit message, or a comment, all of which an
// agent can use to *explain* that it declined the alternative rather than to
// pursue it. That is why `code` exists: added lines, minus documentation and
// comments, so implementing an alternative counts and explaining that it was
// avoided does not.
//
// What `code` cannot say is *how much*. A run that types one declining
// sentence and a run that edits three files toward the rejected alternative
// before reverting both produce zero characters of surviving "code" evidence
// — one because it never touched the path, the other because the harness only
// reads the final diff. Of the two, only the second one cost something. The
// functions below attribute the diff's hunks to `reproposed_if`, hunk by
// hunk, so that magnitude is countable instead of collapsed into the same
// boolean.

/** Dependency manifests: an added line here declares a package, not application code. */
const DEPENDENCY_MANIFEST =
  /(^|\/)(package\.json|requirements(-[\w.-]+)?\.txt|pyproject\.toml|Pipfile|Cargo\.toml|go\.mod|Gemfile|composer\.json)$/i;

export interface DiffHunk {
  readonly file: string;
  readonly isManifest: boolean;
  readonly addedLines: readonly string[];
  readonly removedLines: readonly string[];
}

/**
 * Splits a unified diff into per-hunk added/removed lines, tagged with the
 * file each hunk belongs to. `codeText` answers "is there a match anywhere in
 * the diff"; this answers "which hunk", so a match can be attributed to a
 * specific edit rather than to the diff as a whole.
 */
export const parseDiffHunks = (diff: string): readonly DiffHunk[] => {
  const hunks: DiffHunk[] = [];
  let file = "";
  let isManifest = false;
  let added: string[] = [];
  let removed: string[] = [];
  let open = false;

  const flush = (): void => {
    if (open) hunks.push({ file, isManifest, addedLines: added, removedLines: removed });
    added = [];
    removed = [];
    open = false;
  };

  for (const line of diff.split("\n")) {
    // `+++ b/path` opens a file, the same signal `codeText` reads its doc-file
    // flag from; here it decides `isManifest` instead.
    if (line.startsWith("+++ ")) {
      flush();
      file = line.slice(4).replace(/^b\//, "").trim();
      isManifest = DEPENDENCY_MANIFEST.test(file);
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("diff --git")) continue;
    if (line.startsWith("@@")) {
      flush();
      open = true;
      continue;
    }
    if (!open) continue;
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  flush();
  return hunks;
};

/**
 * Reconstructs a hunk (or a single line of one) as a synthetic one-hunk diff,
 * so it can be run back through `evaluateGroup` — the same literal/regex
 * matching, including the `code` surface's doc-file and comment stripping —
 * rather than a second, parallel matcher that could disagree with a task
 * author's actual `reproposed_if` clauses.
 */
const syntheticDiffSurfaces = (
  file: string,
  addedLines: readonly string[],
  removedLines: readonly string[],
): Surfaces => ({
  transcript: "",
  commits: "",
  diff: [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -0,0 +0,0 @@",
    ...addedLines.map((line) => `+${line}`),
    ...removedLines.map((line) => `-${line}`),
  ].join("\n"),
});

export interface RejectedPathWork {
  /** Hunks whose added code matched `group` — editing toward it, not mentioning it. */
  readonly editHunks: number;
  /** Added and removed lines inside the hunks counted above. */
  readonly linesChanged: number;
  /** Added lines in a recognized dependency manifest that matched `group`. */
  readonly dependencyAdditions: number;
  /** 1 if any of the above happened at all, 0 if none did. */
  readonly firstEditOccurred: 0 | 1;
}

/**
 * Rejected-path work: how much a diff pursued `group` (normally a task's
 * `reproposed_if`) rather than merely mentioning it (bug #141).
 *
 * A hunk counts on its **added** lines only — reads only added lines, so
 * deleting the rejected code is not proposing it, the same rule `codeText`
 * already applies to the whole-diff detector. Removed lines still count
 * toward `linesChanged` once a hunk has matched, because they are part of the
 * same edit's cost.
 */
export const countRejectedPathWork = (group: MatcherGroup, diff: string): RejectedPathWork => {
  const hunks = parseDiffHunks(diff);
  let editHunks = 0;
  let linesChanged = 0;
  let dependencyAdditions = 0;

  for (const hunk of hunks) {
    if (hunk.isManifest) {
      for (const line of hunk.addedLines) {
        if (evaluateGroup(group, syntheticDiffSurfaces(hunk.file, [line], [])).matched) {
          dependencyAdditions += 1;
        }
      }
    }
    if (evaluateGroup(group, syntheticDiffSurfaces(hunk.file, hunk.addedLines, [])).matched) {
      editHunks += 1;
      linesChanged += hunk.addedLines.length + hunk.removedLines.length;
    }
  }

  return {
    editHunks,
    linesChanged,
    dependencyAdditions,
    firstEditOccurred: editHunks > 0 || dependencyAdditions > 0 ? 1 : 0,
  };
};
