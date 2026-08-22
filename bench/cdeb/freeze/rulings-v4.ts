/**
 * Ruling text for Stage B review.
 *
 * The census stores only digests of a decision's ruling and reason, because the
 * anchor is what binds them and the text itself is not needed to count. Stage B
 * asks whether a rejected path is hidden, viable and bounded, and that cannot be
 * read from a digest -- so the text is extracted here, separately, and kept out
 * of the Stage A evidence set entirely.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execGit } from "../../../dist/core/git.js";
import { RULED_OUT_KEY, runQuery, valuesOf } from "../../../dist/core/query.js";
import { splitRuledOut } from "../../../dist/core/trailers.js";

import { decisionTextSha256 } from "./decision-anchor.ts";
import type { SnapshotEntry, V4CandidateEntry } from "./census-v4.ts";
import { materializeBundle, type RepositoryBundleIdentity } from "./repository-bundle.ts";

export interface RulingEntry {
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly ruling: string;
  readonly reason: string;
}

const bundleIdentityFor = (snapshot: SnapshotEntry): RepositoryBundleIdentity => ({
  repository_id: snapshot.repository_id,
  bundle_sha256: snapshot.bundle_sha256,
  snapshot_commit: snapshot.snapshot_commit,
  snapshot_tree_oid: snapshot.snapshot_tree_oid,
  refs_digest: snapshot.refs_digest,
  notes_ref_digest: snapshot.notes_ref_digest,
  refs_included: snapshot.refs_included,
  notes_refs_included: snapshot.notes_refs_included,
});

/**
 * Matching is by digest, not by position. The census and this extractor walk
 * the same history, but binding on ordinal alone would attach the wrong text to
 * a candidate the moment either walk changed order, and the mistake would be
 * silent -- a plausible ruling under the wrong anchor.
 */
export const extractRulings = (
  cwd: string,
  candidates: readonly V4CandidateEntry[],
): RulingEntry[] => {
  const wanted = new Map<string, V4CandidateEntry>();
  for (const candidate of candidates) {
    wanted.set(`${candidate.source_commit_sha}:${candidate.decision_sha256}:${candidate.reason_sha256}`, candidate);
  }
  const queried = runQuery({ cwd, allHistory: true, at: new Date("9999-12-31T23:59:59.999Z") });
  const found: RulingEntry[] = [];
  const claim = (sha: string, alternative: string, reason: string): void => {
    const key = `${sha}:${decisionTextSha256(alternative)}:${decisionTextSha256(reason)}`;
    const candidate = wanted.get(key);
    if (candidate === undefined) return;
    wanted.delete(key);
    found.push({ candidate_id: candidate.candidate_id, repository_id: candidate.repository_id, ruling: alternative, reason });
  };

  for (const record of queried.records) {
    for (const value of valuesOf(record, RULED_OUT_KEY)) {
      const split = splitRuledOut(String(value));
      if (split.malformed || split.alternative === "" || split.reason === "") continue;
      claim(record.sha, split.alternative, split.reason);
    }
  }
  // Ordinary-source decisions are not records, so the query above cannot see
  // them; they are read from the raw bodies the same way the census read them.
  for (const candidate of candidates) {
    if (candidate.storage_kind !== "ordinary-source") continue;
    if (!wanted.has(`${candidate.source_commit_sha}:${candidate.decision_sha256}:${candidate.reason_sha256}`)) continue;
    const body = readCommitBody(cwd, candidate.source_commit_sha);
    for (const value of unfoldedRuledOutValues(body)) {
      const split = splitRuledOut(value);
      if (split.malformed || split.alternative === "" || split.reason === "") continue;
      claim(candidate.source_commit_sha, split.alternative, split.reason);
    }
  }
  return found;
};

const readCommitBody = (cwd: string, sha: string): string => {
  const result = execGit(["show", "-s", "--format=%B", "--end-of-options", sha], { cwd });
  if (result.code !== 0) throw new Error(`rulings v4: cannot read commit ${sha}: ${result.stderr.trim()}`);
  return result.stdout;
};

export const unfoldedRuledOutValues = (body: string): string[] => {
  const lines = body.split("\n");
  const values: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.startsWith(`${RULED_OUT_KEY}:`)) continue;
    let value = line.slice(RULED_OUT_KEY.length + 1).trim();
    for (let next = index + 1; next < lines.length; next += 1) {
      const continuation = lines[next]!;
      if (!/^\s+\S/.test(continuation)) break;
      value = `${value} ${continuation.trim()}`;
    }
    values.push(value);
  }
  return values;
};

export const runRulingExtraction = (studyRoot: string): RulingEntry[] => {
  const root = resolve(studyRoot);
  const snapshots = JSON.parse(readFileSync(join(root, "corpus", "snapshots.json"), "utf8")) as {
    repositories: readonly SnapshotEntry[];
  };
  const candidates = readFileSync(join(root, "feasibility", "candidate-census.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as V4CandidateEntry);

  const rulings: RulingEntry[] = [];
  for (const snapshot of snapshots.repositories) {
    const mine = candidates.filter((candidate) => candidate.repository_id === snapshot.repository_id);
    if (mine.length === 0) continue;
    const scratch = mkdtempSync(join(tmpdir(), "cdeb-v4-rulings-"));
    try {
      const repository = join(scratch, "repository");
      materializeBundle(bundleIdentityFor(snapshot), join(root, "corpus", snapshot.bundle_path), repository);
      rulings.push(...extractRulings(repository, mine));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return rulings;
};

const main = (argv: readonly string[]): void => {
  const index = argv.indexOf("--study-root");
  const studyRoot = index >= 0 ? argv[index + 1] : undefined;
  if (studyRoot === undefined) throw new Error("rulings v4: --study-root is required");
  const rulings = runRulingExtraction(studyRoot);
  writeFileSync(
    join(resolve(studyRoot), "feasibility", "rulings.jsonl"),
    `${rulings.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
  process.stdout.write(`rulings extracted: ${String(rulings.length)}\n`);
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
