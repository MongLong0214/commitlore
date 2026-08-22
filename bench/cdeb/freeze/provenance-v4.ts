/**
 * CDEB-Fresh v4 Stage 0 provenance audit (G1 and the mechanical half of G2).
 *
 * For every enumerated decision this produces the ordinary-source evidence a
 * reviewer is allowed to see: the commit's prose with every CommitLore trailer
 * and note removed, plus the shape of the change it made. Gold may never be a
 * copy of a rendered record, so the packet is what the record would have been
 * written from rather than the record itself.
 *
 * What is decided here is only what a program can decide. Whether the surviving
 * prose actually supports the ruling and its reason is a judgment, and it is
 * left to the paired reviewers.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execGit } from "../../../dist/core/git.js";

import { assertNoDecisionAnchorExposure } from "./decision-anchor.ts";
import type { SnapshotEntry, V4CandidateEntry } from "./census-v4.ts";
import { materializeBundle, type RepositoryBundleIdentity } from "./repository-bundle.ts";
import { redactCommitMessage } from "./source-packet.ts";

export const PROVENANCE_TIERS = ["P1", "P2", "unsupported"] as const;
export type ProvenanceTier = (typeof PROVENANCE_TIERS)[number];

export interface ProvenanceAuditEntry {
  readonly schema_version: 1;
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly source_commit_sha: string;
  readonly decision_audit_anchor: string;
  /** Redacted ordinary prose. This is the reviewer's whole evidence base. */
  readonly ordinary_source: string;
  readonly ordinary_source_sha256: string;
  readonly ordinary_body_chars: number;
  readonly ordinary_body_survives: boolean;
  readonly removed_trailer_count: number;
  /** Lines the second pass took out after the product's redaction ran. */
  readonly residual_record_lines_removed: number;
  readonly files_changed: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly changed_paths: readonly string[];
  readonly benchmark_authored: boolean;
  readonly provenance_value: string | null;
  /** G1 and the mechanical part of G2. The judgment part stays undecided. */
  readonly g1_natural_provenance: boolean;
  readonly g2_mechanical: boolean;
  readonly mechanical_exclusion: string | null;
  readonly provenance_tier: ProvenanceTier | "pending";
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

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

const numstat = (cwd: string, sha: string): { files: number; insertions: number; deletions: number; paths: string[] } => {
  const result = execGit(["show", "--pretty=format:", "--numstat", "--end-of-options", sha], { cwd });
  if (result.code !== 0) return { files: 0, insertions: 0, deletions: 0, paths: [] };
  let insertions = 0;
  let deletions = 0;
  const paths: string[] = [];
  for (const line of result.stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    // A binary file reports "-" for both counts; it still changed.
    insertions += Number.parseInt(parts[0] ?? "0", 10) || 0;
    deletions += Number.parseInt(parts[1] ?? "0", 10) || 0;
    const path = (parts[2] ?? "").trim();
    if (path !== "") paths.push(path);
  }
  return { files: paths.length, insertions, deletions, paths: [...new Set(paths)].sort() };
};

const bodyOf = (cwd: string, sha: string): string => {
  const result = execGit(["show", "-s", "--format=%B", "--end-of-options", sha], { cwd });
  if (result.code !== 0) throw new Error(`provenance v4: cannot read commit ${sha}: ${result.stderr.trim()}`);
  return result.stdout;
};

/**
 * A record whose provenance the product itself calls reconstructed was minted
 * by tooling rather than written when the decision was made. ADR-0014 refuses
 * that identity, and a benchmark built on it would be measuring its own
 * backfill.
 */
const isBenchmarkAuthored = (candidate: V4CandidateEntry): boolean =>
  candidate.provenance_value === "reconstructed" || candidate.provenance_value === "migrated";


/**
 * A second redaction pass, and the reason it exists.
 *
 * The product's redaction rebuilds the ordinary trailer tail from Git's own
 * parse, which deliberately does not treat a `Ruled-out:` sentence in prose as
 * a record. That is right for the product and wrong here: a squashed commit
 * embeds whole commit messages, indented, and Git does not see their trailers
 * either. Two candidates' packets carried a complete record -- including the
 * ruling a Stage A reviewer must be blind to -- and eleven carried at least one
 * CommitLore line.
 *
 * The bias is deliberately the other way for a blind evidence packet. Removing
 * a prose sentence that merely looks like a trailer costs a sentence; leaving a
 * record in costs the answer.
 */
export const COMMITLORE_KEY_LINE =
  /^[ \t]*(?:Ruled-out|Record-Id|Provenance|CommitLore-Version|Limit|Warn|Evidence|Blast|Undo|Certainty|Supersedes|Lifecycle|Expires|Verified|Scope|Deciders|Confidence)[ \t]*:/;

export interface SecondPassResult {
  readonly text: string;
  readonly removedLines: number;
}

export const stripEmbeddedRecordLines = (text: string): SecondPassResult => {
  const lines = text.split("\n");
  const kept: string[] = [];
  let removed = 0;
  let dropping = false;
  for (const line of lines) {
    if (COMMITLORE_KEY_LINE.test(line)) {
      dropping = true;
      removed += 1;
      continue;
    }
    // A folded continuation belongs to the line above it, so it goes too.
    if (dropping && /^[ \t]+\S/.test(line) && line.trim() !== "") {
      removed += 1;
      continue;
    }
    dropping = false;
    kept.push(line);
  }
  return { text: kept.join("\n").replace(/\n{3,}/gu, "\n\n"), removedLines: removed };
};

/**
 * The packet must not contain a CommitLore key line at all. This is checked
 * after the second pass rather than trusted from it: the first pass looked
 * clean too.
 */
export const assertPacketHasNoRecordLines = (entries: readonly ProvenanceAuditEntry[]): void => {
  for (const entry of entries) {
    const offending = entry.ordinary_source.split("\n").filter((line) => COMMITLORE_KEY_LINE.test(line));
    if (offending.length > 0) {
      throw new Error(
        `provenance v4: packet for ${entry.candidate_id} still carries ${String(offending.length)} CommitLore line(s), first: ${offending[0]!.trim().slice(0, 60)}`,
      );
    }
  }
};

export const auditRepository = (
  cwd: string,
  snapshot: SnapshotEntry,
  candidates: readonly V4CandidateEntry[],
): ProvenanceAuditEntry[] => {
  const bodies = new Map<string, string>();
  const stats = new Map<string, ReturnType<typeof numstat>>();
  const entries: ProvenanceAuditEntry[] = [];
  for (const candidate of candidates) {
    if (candidate.repository_id !== snapshot.repository_id) {
      throw new Error(`provenance v4: candidate ${candidate.candidate_id} is not from ${snapshot.repository_id}`);
    }
    let body = bodies.get(candidate.source_commit_sha);
    if (body === undefined) {
      body = bodyOf(cwd, candidate.source_commit_sha);
      bodies.set(candidate.source_commit_sha, body);
    }
    let stat = stats.get(candidate.source_commit_sha);
    if (stat === undefined) {
      stat = numstat(cwd, candidate.source_commit_sha);
      stats.set(candidate.source_commit_sha, stat);
    }
    const firstPass = redactCommitMessage(cwd, body);
    const secondPass = stripEmbeddedRecordLines(firstPass.text);
    const redacted = {
      text: secondPass.text,
      ordinaryBodySurvives: firstPass.ordinaryBodySurvives && secondPass.text.split("\n").slice(1).some((line) => line.trim() !== ""),
      removedTrailerCount: firstPass.removedTrailerCount,
    };
    const benchmarkAuthored = isBenchmarkAuthored(candidate);
    const g1 = candidate.pre_cutoff && !benchmarkAuthored;
    const g2Mechanical = redacted.ordinaryBodySurvives && stat.files > 0;
    const exclusion = benchmarkAuthored
      ? "benchmark-authored"
      : !redacted.ordinaryBodySurvives
        ? "source-packet-empty"
        : stat.files === 0
          ? "scope-unresolvable"
          : null;
    entries.push({
      schema_version: 1,
      candidate_id: candidate.candidate_id,
      repository_id: candidate.repository_id,
      source_commit_sha: candidate.source_commit_sha,
      decision_audit_anchor: candidate.decision_audit_anchor,
      ordinary_source: redacted.text,
      ordinary_source_sha256: sha256(redacted.text),
      ordinary_body_chars: redacted.text.length,
      ordinary_body_survives: redacted.ordinaryBodySurvives,
      removed_trailer_count: redacted.removedTrailerCount,
      residual_record_lines_removed: secondPass.removedLines,
      files_changed: stat.files,
      insertions: stat.insertions,
      deletions: stat.deletions,
      changed_paths: stat.paths,
      benchmark_authored: benchmarkAuthored,
      provenance_value: candidate.provenance_value,
      g1_natural_provenance: g1,
      g2_mechanical: g2Mechanical,
      mechanical_exclusion: exclusion,
      provenance_tier: exclusion === null ? "pending" : "unsupported",
    });
  }
  return entries;
};

/**
 * The redacted packet is the reviewer's evidence, so it must not carry the
 * benchmark's own key. Nothing writes the anchor into it, and this is the check
 * that keeps that true rather than assumed.
 */
export const assertPacketsCarryNoAnchor = (entries: readonly ProvenanceAuditEntry[]): void => {
  for (const entry of entries) {
    assertNoDecisionAnchorExposure(
      entry.ordinary_source,
      [entry.decision_audit_anchor],
      `ordinary source for ${entry.candidate_id}`,
    );
  }
};

/**
 * The redaction has to have removed something for at least the record-backed
 * decisions, or it is silently inert and every "no leak" result below means
 * nothing. Ordinary-source candidates legitimately have no trailer to remove.
 */
export const assertRedactionDidWork = (
  entries: readonly ProvenanceAuditEntry[],
  recordBackedIds: ReadonlySet<string>,
): void => {
  const recordBacked = entries.filter((entry) => recordBackedIds.has(entry.candidate_id));
  if (recordBacked.length === 0) return;
  const redacted = recordBacked.filter((entry) => entry.removed_trailer_count > 0);
  if (redacted.length === 0) {
    throw new Error(
      "provenance v4: no CommitLore trailer was removed from any record-backed candidate; the redaction is inert",
    );
  }
};

export interface RunProvenanceOptions {
  readonly studyRoot: string;
}

export const runProvenanceAudit = (options: RunProvenanceOptions): ProvenanceAuditEntry[] => {
  const studyRoot = resolve(options.studyRoot);
  const snapshots = JSON.parse(readFileSync(join(studyRoot, "corpus", "snapshots.json"), "utf8")) as {
    repositories: readonly SnapshotEntry[];
  };
  const candidates = readFileSync(join(studyRoot, "feasibility", "candidate-census.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as V4CandidateEntry);

  const entries: ProvenanceAuditEntry[] = [];
  for (const snapshot of snapshots.repositories) {
    const mine = candidates.filter((candidate) => candidate.repository_id === snapshot.repository_id);
    if (mine.length === 0) continue;
    const root = mkdtempSync(join(tmpdir(), "cdeb-v4-provenance-"));
    try {
      const repository = join(root, "repository");
      materializeBundle(
        bundleIdentityFor(snapshot),
        join(studyRoot, "corpus", snapshot.bundle_path),
        repository,
      );
      entries.push(...auditRepository(repository, snapshot, mine));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  assertPacketsCarryNoAnchor(entries);
  assertPacketHasNoRecordLines(entries);
  assertRedactionDidWork(
    entries,
    new Set(candidates.filter((candidate) => candidate.storage_kind !== "ordinary-source").map((candidate) => candidate.candidate_id)),
  );
  return entries;
};

const main = (argv: readonly string[]): void => {
  const index = argv.indexOf("--study-root");
  const studyRoot = index >= 0 ? argv[index + 1] : undefined;
  if (studyRoot === undefined) throw new Error("provenance v4: --study-root is required");
  const entries = runProvenanceAudit({ studyRoot });
  writeFileSync(
    join(resolve(studyRoot), "feasibility", "provenance-audit.jsonl"),
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
  const byRepository = new Map<string, ProvenanceAuditEntry[]>();
  for (const entry of entries) {
    const list = byRepository.get(entry.repository_id) ?? [];
    list.push(entry);
    byRepository.set(entry.repository_id, list);
  }
  for (const [repository, list] of [...byRepository].sort()) {
    const passed = list.filter((entry) => entry.mechanical_exclusion === null).length;
    const empty = list.filter((entry) => entry.mechanical_exclusion === "source-packet-empty").length;
    const authored = list.filter((entry) => entry.mechanical_exclusion === "benchmark-authored").length;
    const scope = list.filter((entry) => entry.mechanical_exclusion === "scope-unresolvable").length;
    process.stdout.write(
      `${repository.padEnd(22)} audited ${String(list.length).padStart(4)}` +
        `  mechanical-pass ${String(passed).padStart(4)}` +
        `  empty-packet ${String(empty).padStart(3)}` +
        `  benchmark-authored ${String(authored).padStart(3)}` +
        `  no-scope ${String(scope).padStart(3)}\n`,
    );
  }
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
