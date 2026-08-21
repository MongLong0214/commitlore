/**
 * CDEB-Fresh v3 ordinary-source packets (PRD §7.2–§7.4, §8.1).
 *
 * Candidate discovery is allowed to learn about a CommitLore record.  This
 * module deliberately does not receive that record: its input is only the
 * candidate's ordinary commit refs and the sealed snapshot that contains
 * them.  It writes the material GOLD may receive, and records *that* record
 * material was excluded without copying any of its payload into the packet.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { git, gitOrThrow, parseTrailers, type Trailer } from "../../git.ts";
import { materializeBundle, type RepositoryBundleIdentity } from "./repository-bundle.ts";
import type { SnapshotEntry } from "./census.ts";

const HERE = dirname(new URL(import.meta.url).pathname);
const CDEB_ROOT = resolve(HERE, "..");
const DEFAULT_STUDY_ROOT = join(CDEB_ROOT, "studies", "cdeb-fresh-v3r1");

/** The complete public CommitLore trailer vocabulary, including legacy fields. */
const COMMITLORE_TRAILER_KEYS = new Set([
  "record-id",
  "ruled-out",
  "provenance",
  "certainty",
  "blast",
  "undo",
  "limit",
  "verified",
  "warn",
  "follows",
  "supersedes",
  "expires",
  "evidence",
  "commitlore-version",
]);

export interface SourcePacketCandidate {
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly source_snapshot_sha: string;
  /** Ordinary commit refs handed over by candidate discovery; never record text. */
  readonly source_refs: readonly string[];
}

export interface SourcePacketExcludedRef {
  readonly exclusion_ref: string;
  readonly kind: "commitlore-trailer" | "commitlore-note";
  readonly source_ref: string;
  readonly why: string;
}

export interface SourcePacketSource {
  readonly path: string;
  readonly kind: "ordinary-commit-message";
  readonly source_ref: string;
  readonly sha256: string;
}

export interface SourcePacketManifest {
  readonly schema_version: 1;
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly snapshot_sha: string;
  readonly cutoff: string;
  readonly sources: readonly SourcePacketSource[];
  readonly packet_sha256: string;
  readonly excluded_refs: readonly SourcePacketExcludedRef[];
  /** A structural redaction result, not candidate adjudication or eligibility. */
  readonly decision_content_after_redaction: "ordinary-body-survives" | "empty";
}

export interface SourcePacketResult {
  readonly directory: string;
  readonly manifest: SourcePacketManifest;
}

export interface BuildSourcePacketOptions {
  readonly candidate: SourcePacketCandidate;
  readonly snapshot: SnapshotEntry;
  /** The active study holding the sealed corpus; defaults to cdeb-fresh-v3r1. */
  readonly studyRoot?: string;
  /** Defaults to the active study's source-packets directory. */
  readonly outputRoot?: string;
  /** Allows tests and callers to use a disposable materialization parent. */
  readonly scratchParent?: string;
}

const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

const canonicalJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

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

const bundlePathFor = (snapshot: SnapshotEntry, studyRoot: string): string => {
  if (snapshot.bundle_path.startsWith("/") || snapshot.bundle_path.split(/[\\/]/).includes("..")) {
    throw new Error(`source packet: bundle_path for ${snapshot.repository_id} must stay under the sealed study root`);
  }
  return join(studyRoot, "corpus", snapshot.bundle_path);
};

const isCommitLoreTrailer = (trailer: Trailer): boolean => COMMITLORE_TRAILER_KEYS.has(trailer.key.toLowerCase());

/**
 * Finds Git's terminal trailer block after `parseTrailers` has established
 * that one exists.  The scan is only a location finder: Git remains the
 * authority for whether a line is a trailer at all.  It never consumes line
 * zero, so a conventional `subject: prose` commit subject remains prose.
 */
const trailerBlockStart = (message: string, trailers: readonly Trailer[]): number => {
  const lines = message.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const keys = new Set(trailers.map((trailer) => trailer.key.toLowerCase()));
  let index = lines.length - 1;
  while (index > 0) {
    const line = lines[index] ?? "";
    if (/^[ \t]/.test(line)) {
      index -= 1;
      continue;
    }
    const match = /^([^:]+):(?:[ \t]|$)/.exec(line);
    if (match !== null && keys.has(match[1]!.toLowerCase())) {
      index -= 1;
      continue;
    }
    break;
  }
  return index + 1;
};

export interface RedactedCommitMessage {
  readonly text: string;
  /** Whether body prose, rather than only the mandatory subject, remains. */
  readonly ordinaryBodySurvives: boolean;
  readonly removedTrailerCount: number;
}

/**
 * Keeps a commit's subject/body prose and ordinary Git trailers, while removing
 * every CommitLore trailer plus its folded continuation lines.  Rebuilding the
 * ordinary trailer tail from Git's parsed representation avoids treating a
 * `Ruled-out:` sentence in non-trailer prose as a record.
 */
export const redactCommitMessage = (cwd: string, message: string): RedactedCommitMessage => {
  const trailers = parseTrailers(cwd, message);
  const removed = trailers.filter(isCommitLoreTrailer);
  if (removed.length === 0) {
    const lines = message.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
    return { text: `${lines.join("\n")}\n`, ordinaryBodySurvives: lines.slice(1).some((line) => line.trim() !== ""), removedTrailerCount: 0 };
  }

  const lines = message.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const start = trailerBlockStart(message, trailers);
  const prose = lines.slice(0, start).join("\n").replace(/\s+$/, "");
  const ordinaryTrailers = trailers.filter((trailer) => !isCommitLoreTrailer(trailer));
  const ordinaryTail = ordinaryTrailers.map((trailer) => `${trailer.key}: ${trailer.value}`).join("\n");
  const text = ordinaryTail === "" ? `${prose}\n` : `${prose}\n\n${ordinaryTail}\n`;
  const proseLines = prose.split("\n");
  return {
    text,
    ordinaryBodySurvives: proseLines.slice(1).some((line) => line.trim() !== ""),
    removedTrailerCount: removed.length,
  };
};

const noteFor = (cwd: string, ref: string): string | null => {
  const result = git(cwd, ["notes", "--ref=commitlore", "show", ref]);
  return result.status === 0 ? result.stdout : null;
};

const sourceFileBytes = (sourceRef: string, message: string): string =>
  `# Ordinary commit message\n\nCommit: ${sourceRef}\n\n${message}`;

const packetPayloadSha256 = (directory: string): string => {
  const hash = createHash("sha256");
  const sources = readdirSync(join(directory, "sources")).filter((name) => name.endsWith(".md")).sort();
  for (const name of sources) {
    hash.update(`sources/${name}`); hash.update("\0"); hash.update(readFileSync(join(directory, "sources", name))); hash.update("\0");
  }
  hash.update("excluded.json"); hash.update("\0"); hash.update(readFileSync(join(directory, "excluded.json"))); hash.update("\0");
  return hash.digest("hex");
};

const packetFiles = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...packetFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
};

/** Refuses record text and rendered records after packet construction or delivery. */
export const assertSourcePacketHasNoLeaks = (directory: string): void => {
  for (const path of packetFiles(directory)) {
    const text = readFileSync(path, "utf8");
    if (/Record-Id\s*:/i.test(text)) {
      throw new Error(`source packet leak: Record-Id found in ${relative(directory, path)}`);
    }
    if (/^Ruled-out\s*:/im.test(text)) {
      throw new Error(`source packet leak: rendered Ruled-out line found in ${relative(directory, path)}`);
    }
    if (/\b(?:benchmark|treatment|task|cdeb)\s+(?:results?|rows?)\b/i.test(text)) {
      throw new Error(`source packet leak: benchmark result text found in ${relative(directory, path)}`);
    }
  }
};

/** Verifies the manifest's emitted-source hashes and packet hash from packet bytes. */
export const verifySourcePacket = (directory: string): SourcePacketManifest => {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")) as SourcePacketManifest;
  for (const source of manifest.sources) {
    const actual = sha256(readFileSync(join(directory, source.path)));
    if (actual !== source.sha256) {
      throw new Error(`source packet: source ${source.path} sha256 expected ${source.sha256}, received ${actual}`);
    }
  }
  const actualPacket = packetPayloadSha256(directory);
  if (actualPacket !== manifest.packet_sha256) {
    throw new Error(`source packet: packet sha256 expected ${manifest.packet_sha256}, received ${actualPacket}`);
  }
  assertSourcePacketHasNoLeaks(directory);
  return manifest;
};

/** The packet hash covers redacted source bytes and exclusions, never its self-referential manifest. */
export const sourcePacketPayloadSha256 = (directory: string): string => packetPayloadSha256(directory);

export const buildSourcePacket = (options: BuildSourcePacketOptions): SourcePacketResult => {
  const { candidate, snapshot } = options;
  if (candidate.repository_id !== snapshot.repository_id) {
    throw new Error(`source packet: candidate repository ${candidate.repository_id} does not match snapshot ${snapshot.repository_id}`);
  }
  if (candidate.source_snapshot_sha !== snapshot.snapshot_sha || snapshot.snapshot_sha !== snapshot.snapshot_commit) {
    throw new Error(`source packet: candidate ${candidate.candidate_id} is not bound to snapshot ${snapshot.snapshot_sha}`);
  }
  if (candidate.source_refs.length === 0) throw new Error(`source packet: candidate ${candidate.candidate_id} has no ordinary source refs`);
  if (new Set(candidate.source_refs).size !== candidate.source_refs.length) throw new Error(`source packet: candidate ${candidate.candidate_id} repeats a source ref`);

  const studyRoot = options.studyRoot ?? DEFAULT_STUDY_ROOT;
  const outputRoot = options.outputRoot ?? join(studyRoot, "source-packets");
  const destination = join(outputRoot, candidate.candidate_id);
  if (existsSync(destination)) throw new Error(`source packet: refusing to overwrite existing packet ${destination}`);
  mkdirSync(outputRoot, { recursive: true });
  const staging = mkdtempSync(join(outputRoot, ".source-packet-"));
  const scratch = mkdtempSync(join(options.scratchParent ?? dirname(staging), "cdeb-source-"));

  try {
    const bundle = bundlePathFor(snapshot, studyRoot);
    const repository = join(scratch, "repository");
    materializeBundle(bundleIdentityFor(snapshot), bundle, repository);
    mkdirSync(join(staging, "sources"));

    const excluded: SourcePacketExcludedRef[] = [];
    const sources: SourcePacketSource[] = [];
    let ordinaryBodySurvives = false;
    for (const [index, requestedRef] of candidate.source_refs.entries()) {
      const sourceRef = gitOrThrow(repository, ["rev-parse", "--verify", `${requestedRef}^{commit}`]).trim();
      if (git(repository, ["merge-base", "--is-ancestor", sourceRef, snapshot.snapshot_commit]).status !== 0) {
        throw new Error(`source packet: source ref ${requestedRef} is not reachable from sealed snapshot ${snapshot.snapshot_commit}`);
      }
      const rawMessage = gitOrThrow(repository, ["show", "-s", "--format=%B", sourceRef]);
      const redacted = redactCommitMessage(repository, rawMessage);
      ordinaryBodySurvives ||= redacted.ordinaryBodySurvives;
      const filename = `${String(index + 1).padStart(3, "0")}-${sourceRef}.md`;
      const relativePath = `sources/${filename}`;
      writeFileSync(join(staging, relativePath), sourceFileBytes(sourceRef, redacted.text), "utf8");
      sources.push({ path: relativePath, kind: "ordinary-commit-message", source_ref: sourceRef, sha256: sha256(readFileSync(join(staging, relativePath))) });

      for (let trailer = 0; trailer < redacted.removedTrailerCount; trailer += 1) {
        excluded.push({
          exclusion_ref: `commit:${sourceRef}:trailer:${String(trailer + 1)}`,
          kind: "commitlore-trailer",
          source_ref: sourceRef,
          why: "CommitLore trailer payload is excluded so GOLD receives only ordinary sources.",
        });
      }
      if (noteFor(repository, sourceRef) !== null) {
        excluded.push({
          exclusion_ref: `commit:${sourceRef}:note`,
          kind: "commitlore-note",
          source_ref: sourceRef,
          why: "The refs/notes/commitlore note is the CommitLore record and is excluded entirely.",
        });
      }
    }
    const orderedExcluded = [...excluded].sort((left, right) => left.exclusion_ref.localeCompare(right.exclusion_ref));
    writeFileSync(join(staging, "excluded.json"), canonicalJson({ schema_version: 1, excluded_refs: orderedExcluded }), "utf8");
    const manifest: SourcePacketManifest = {
      schema_version: 1,
      candidate_id: candidate.candidate_id,
      repository_id: candidate.repository_id,
      snapshot_sha: snapshot.snapshot_sha,
      cutoff: snapshot.frozen_at,
      sources,
      packet_sha256: packetPayloadSha256(staging),
      excluded_refs: orderedExcluded,
      decision_content_after_redaction: ordinaryBodySurvives ? "ordinary-body-survives" : "empty",
    };
    writeFileSync(join(staging, "manifest.json"), canonicalJson(manifest), "utf8");
    verifySourcePacket(staging);
    renameSync(staging, destination);
    return { directory: destination, manifest };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
