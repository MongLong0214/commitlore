/**
 * A1 corroboration scan. Metadata, never a gate.
 *
 * v4 asked one question -- is the ruling recoverable from the same commit's
 * prose -- and turned the answer into an admission gate. An adversarial review
 * of that result made two separate objections: the gate should not have existed,
 * and the search behind it was too narrow to support the conclusion drawn from
 * it. This addresses both. The search is wider: the commit's own redacted prose,
 * every Markdown document in the frozen tree, and the test and comment text
 * around the decision's own paths. And the result cannot exclude anything, by
 * construction -- `attachCorroboration` receives an authority verdict it has no
 * way to change.
 */

import { execGit } from "../../../dist/core/git.js";

import type { CorroborationHit } from "./authority-v5.ts";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "that", "this",
  "it", "is", "was", "were", "be", "been", "as", "at", "by", "from", "into", "would",
  "could", "not", "no", "but", "so", "than", "then", "its", "their", "our", "we", "can",
  "will", "have", "has", "had", "when", "which", "what", "who", "how", "why", "all", "any",
]);

export const contentWords = (value: string): Set<string> =>
  new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/u)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word)),
  );

/**
 * The best coverage of the ruling's content words inside any one window of the
 * source, not across the whole file.
 *
 * Whole-file bag-of-words was the first implementation and it reported 200 of
 * 241 candidates corroborated -- a figure that would have read as a refutation
 * of v4. It was noise: a long source file about retries contains every content
 * word of a ruling about retries, scattered over hundreds of lines, without
 * documenting the decision anywhere. Corroboration means the decision is
 * discussed somewhere, so the words have to appear together.
 */
export const WINDOW_LINES = 40;

export const coverage = (source: string, ruling: string): number => {
  const wanted = contentWords(ruling);
  if (wanted.size === 0) return 0;
  const lines = source.split("\n");
  let best = 0;
  for (let start = 0; start < Math.max(1, lines.length); start += Math.ceil(WINDOW_LINES / 2)) {
    const have = contentWords(lines.slice(start, start + WINDOW_LINES).join("\n"));
    let shared = 0;
    for (const word of wanted) if (have.has(word)) shared += 1;
    const score = shared / wanted.size;
    if (score > best) best = score;
    if (best === 1) break;
  }
  return best;
};

/** Metadata threshold, recorded so a reader can apply another one. */
export const CORROBORATION_COVERAGE = 0.6;

/**
 * A ruling with too few content words cannot be matched meaningfully.
 *
 * Spot-checking the first run found "artifact storage port" matching two
 * unrelated ADRs and "fixing this gap in this commit" matching whatever it was
 * pointed at. Three generic words clear any threshold. Below this floor the
 * scan reports nothing rather than a hit, and the candidate is marked
 * undecidable for corroboration -- which is metadata about the metadata, not an
 * exclusion.
 */
export const MIN_RULING_CONTENT_WORDS = 5;

export const corroborationDecidable = (ruling: string): boolean =>
  contentWords(ruling).size >= MIN_RULING_CONTENT_WORDS;

const classify = (path: string): CorroborationHit["kind"] => {
  const lower = path.toLowerCase();
  if (/(^|\/)docs?\/adr|adr-\d|(^|\/)adr(s)?\//u.test(lower)) return "adr";
  if (/(^|\/)(docs?|design|rfc)s?\//u.test(lower)) return "design-doc";
  if (/(test|spec)\./u.test(lower) || /(^|\/)(tests?|spec)\//u.test(lower)) return "test-rationale";
  return "ordinary-prose";
};

export interface ScanInputs {
  readonly cwd: string;
  readonly snapshotSha: string;
  readonly ruling: string;
  readonly reason: string;
  readonly ordinarySource: string;
  readonly scopePaths: readonly string[];
  /** Markdown paths in the frozen tree, listed once per repository. */
  readonly documentPaths: readonly string[];
}

const readBlob = (cwd: string, snapshotSha: string, path: string): string | null => {
  const result = execGit(["show", "--end-of-options", `${snapshotSha}:${path}`], { cwd });
  return result.code === 0 ? result.stdout : null;
};

/**
 * Where the same decision can be found besides its record. Returns every hit,
 * not the first: the count and the kinds are what make A1 informative.
 */
export const scanCorroboration = (inputs: ScanInputs): CorroborationHit[] => {
  // Too generic to match: report nothing rather than noise.
  if (!corroborationDecidable(inputs.ruling)) return [];
  const hits: CorroborationHit[] = [];
  const target = `${inputs.ruling} ${inputs.reason}`;

  // 1. The commit's own prose, with the record already removed.
  if (coverage(inputs.ordinarySource, inputs.ruling) >= CORROBORATION_COVERAGE) {
    hits.push({ kind: "ordinary-prose", locator: "commit-body" });
  }

  // 2. Every Markdown document in the frozen tree. v4 never looked here.
  for (const path of inputs.documentPaths) {
    const text = readBlob(inputs.cwd, inputs.snapshotSha, path);
    if (text === null) continue;
    if (coverage(text, inputs.ruling) >= CORROBORATION_COVERAGE) {
      hits.push({ kind: classify(path), locator: path });
    }
  }

  // 3. The decision's own paths, for a comment or a test that explains it.
  for (const path of inputs.scopePaths) {
    if (path.startsWith("commit:")) continue;
    const text = readBlob(inputs.cwd, inputs.snapshotSha, path);
    if (text === null) continue;
    if (coverage(text, target) >= CORROBORATION_COVERAGE) {
      hits.push({ kind: classify(path) === "test-rationale" ? "test-rationale" : "code-comment", locator: path });
    }
  }

  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.kind}:${hit.locator}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Markdown paths in a frozen tree, listed once and reused across candidates. */
export const listDocuments = (cwd: string, snapshotSha: string, limit = 400): string[] => {
  const result = execGit(["ls-tree", "-r", "--name-only", "--end-of-options", snapshotSha], { cwd });
  if (result.code !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((path) => path !== "" && /\.(md|mdx|rst|txt|adoc)$/iu.test(path))
    .slice(0, limit);
};
