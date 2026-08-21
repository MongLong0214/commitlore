/**
 * The source-packet boundary is intentionally tested twice: focused synthetic
 * cases exercise every redaction rule, while the leak audit constructs packets
 * from the active sealed bundles.  The latter is the audit that protects GOLD.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  assertSourcePacketHasNoLeaks,
  buildSourcePacket,
  redactCommitMessage,
  sourcePacketPayloadSha256,
  verifySourcePacket,
  type SourcePacketCandidate,
} from "../bench/cdeb/freeze/source-packet.ts";
import { createRepositoryBundle, materializeBundle, type RepositoryBundleIdentity } from "../bench/cdeb/freeze/repository-bundle.ts";
import type { SnapshotEntry } from "../bench/cdeb/freeze/census.ts";
import { gitOrThrow } from "../bench/git.ts";
import { createTestRepo } from "./git-fixtures.js";

const ROOT = join(import.meta.dirname, "..");
const ACTIVE_STUDY_ROOT = join(ROOT, "bench", "cdeb", "studies", "cdeb-fresh-v3r1");
const scratch: string[] = [];

/**
 * These remain deliberately visible rather than being represented by a false
 * CI assertion. A property is listed here until CI can observe it directly.
 */
export const KNOWN_UNVERIFIED = [
  "the redaction leak assertions are exercised against real sealed-bundle packets only on a machine holding the bundles; CI runs the synthetic-fixture cases only",
] as const;

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const directory = mkdtempSync(join(tmpdir(), `cdeb-source-packet-${label}-`));
  scratch.push(directory);
  return directory;
};

const hash = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

const fixture = (message: string, note: string | null = null) => {
  const root = temp("fixture");
  const repository = createTestRepo({ path: join(root, "repository") });
  writeFileSync(join(repository, "decision.md"), "ordinary current code\n", "utf8");
  gitOrThrow(repository, ["add", "decision.md"]);
  gitOrThrow(repository, ["commit", "--quiet", "-m", message]);
  const commit = gitOrThrow(repository, ["rev-parse", "HEAD"]).trim();
  if (note !== null) gitOrThrow(repository, ["notes", "--ref=commitlore", "add", "-m", note, commit]);

  const studyRoot = join(root, "study");
  const bundlePath = join(studyRoot, "corpus", "bundles", "fixture-repository.bundle");
  const identity = createRepositoryBundle("fixture-repository", repository, bundlePath, commit);
  const snapshot: SnapshotEntry = {
    repository_id: "fixture-repository",
    remote_url: "https://example.invalid/fixture-repository.git",
    default_branch: "main",
    snapshot_sha: identity.snapshot_commit,
    bundle_path: "bundles/fixture-repository.bundle",
    bundle_sha256: identity.bundle_sha256,
    snapshot_commit: identity.snapshot_commit,
    snapshot_tree_oid: identity.snapshot_tree_oid,
    refs_included: identity.refs_included,
    refs_digest: identity.refs_digest,
    notes_refs_included: identity.notes_refs_included,
    notes_ref_digest: identity.notes_ref_digest,
    source_authorization_id: "auth-test",
    frozen_at: "2026-08-21T00:00:00Z",
  };
  const candidate: SourcePacketCandidate = {
    candidate_id: "fixture-candidate",
    repository_id: snapshot.repository_id,
    source_snapshot_sha: snapshot.snapshot_sha,
    source_refs: [commit],
  };
  return { root, studyRoot, snapshot, candidate };
};

const buildFixturePacket = (message: string, note: string | null = null) => {
  const files = fixture(message, note);
  return buildSourcePacket({
    candidate: files.candidate,
    snapshot: files.snapshot,
    studyRoot: files.studyRoot,
    outputRoot: join(files.root, "packets"),
    scratchParent: files.root,
  });
};

const bytesUnder = (directory: string): string => {
  const walk = (current: string): string[] => readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name);
    return entry.isDirectory() ? walk(path) : [readFileSync(path, "utf8")];
  });
  return walk(directory).join("\n");
};

const activeSnapshots = (): readonly SnapshotEntry[] =>
  (JSON.parse(readFileSync(join(ACTIVE_STUDY_ROOT, "corpus", "snapshots.json"), "utf8")) as { repositories: SnapshotEntry[] }).repositories;

const activeCandidates = (): readonly SourcePacketCandidate[] =>
  readFileSync(join(ACTIVE_STUDY_ROOT, "corpus", "candidate-registry.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as SourcePacketCandidate);

const activeBundlePath = (snapshot: SnapshotEntry): string =>
  join(ACTIVE_STUDY_ROOT, "corpus", snapshot.bundle_path);

const missingActiveBundle = activeSnapshots().find((snapshot) => !existsSync(activeBundlePath(snapshot)));

const realBundleAuditSkipMessage = missingActiveBundle === undefined
  ? null
  : `sealed bundle ${activeBundlePath(missingActiveBundle)} is missing; restore the original frozen artifact at that path (rebuilding from the snapshot SHA cannot reproduce snapshots.json's digest)`;

if (realBundleAuditSkipMessage !== null) {
  console.info(`CDEB source-packet real-bundle audit skipped: ${realBundleAuditSkipMessage}`);
}

const realBundleAuditName = realBundleAuditSkipMessage === null
  ? "audits real packets made from sealed bundles, including the required negative control"
  : `audits real packets made from sealed bundles, including the required negative control — SKIPPED: ${realBundleAuditSkipMessage}`;

const identityFor = (snapshot: SnapshotEntry): RepositoryBundleIdentity => ({
  repository_id: snapshot.repository_id,
  bundle_sha256: snapshot.bundle_sha256,
  snapshot_commit: snapshot.snapshot_commit,
  snapshot_tree_oid: snapshot.snapshot_tree_oid,
  refs_digest: snapshot.refs_digest,
  notes_ref_digest: snapshot.notes_ref_digest,
  refs_included: snapshot.refs_included,
  notes_refs_included: snapshot.notes_refs_included,
});

const noteFromSealedBundle = (snapshot: SnapshotEntry, sourceRef: string, root: string): string => {
  const repository = join(root, "note-repository");
  materializeBundle(identityFor(snapshot), join(ACTIVE_STUDY_ROOT, "corpus", snapshot.bundle_path), repository);
  return gitOrThrow(repository, ["notes", "--ref=commitlore", "show", sourceRef]);
};

describe("CDEB-Fresh v3 ordinary-source packets", () => {
  it("declares every known verification gap", () => {
    expect(KNOWN_UNVERIFIED.length).toBeGreaterThan(0);
  });

  it("removes every CommitLore trailer and continuation while retaining ordinary prose and Git trailers", () => {
    const packet = buildFixturePacket([
      "feat: keep source-side policy explicit",
      "",
      "The ordinary explanation is available to GOLD.",
      "",
      "Signed-off-by: Source Author <source@example.invalid>",
      "Co-authored-by: Co Author <co@example.invalid>",
      "Record-Id: r-sourcepacket01",
      "  folded record identity detail",
      "Ruled-out: shared cache | cross-tenant state",
      "  folded rationale detail",
      "Provenance: authored",
      "Certainty: firm",
      "Blast: module",
      "Undo: easy",
      "Limit: no mutable global state",
      "Verified: targeted tests pass",
      "Warn: preserve process isolation",
      "Follows: r-prior01",
      "Supersedes: r-older01",
      "Expires: 2030-01-01",
      "Evidence: issue #1",
      "CommitLore-Version: 2.0.0",
    ].join("\n"));

    const source = readFileSync(join(packet.directory, packet.manifest.sources[0]!.path), "utf8");
    expect(source).toContain("feat: keep source-side policy explicit");
    expect(source).toContain("The ordinary explanation is available to GOLD.");
    expect(source).toContain("Signed-off-by: Source Author <source@example.invalid>");
    expect(source).toContain("Co-authored-by: Co Author <co@example.invalid>");
    for (const forbidden of [
      "Record-Id:", "folded record identity detail", "Ruled-out:", "folded rationale detail", "Provenance:",
      "Certainty:", "Blast:", "Undo:", "Limit:", "Verified:", "Warn:", "Follows:", "Supersedes:",
      "Expires:", "Evidence:", "CommitLore-Version:",
    ]) expect(source).not.toContain(forbidden);
    expect(packet.manifest.decision_content_after_redaction).toBe("ordinary-body-survives");
  });

  it("excludes refs/notes/commitlore entirely and visibly marks a trailer-only decision source empty", () => {
    const note = "Record-Id: r-note-only\nRuled-out: direct write | use the queue";
    const packet = buildFixturePacket([
      "chore: preserve the historical commit",
      "",
      "Record-Id: r-trailer-only",
      "Ruled-out: direct write | use the queue",
      "  continuation must not survive",
    ].join("\n"), note);
    const packetBytes = bytesUnder(packet.directory);

    expect(packetBytes).not.toContain(note);
    expect(packet.manifest.excluded_refs.some((entry) => entry.kind === "commitlore-note")).toBe(true);
    expect(packet.manifest.excluded_refs.some((entry) => entry.kind === "commitlore-trailer")).toBe(true);
    // The subject remains as required, but no ordinary body prose remains for
    // a later GOLD role to extract a decision from. This is not an eligibility judgment.
    expect(packet.manifest.decision_content_after_redaction).toBe("empty");
  });

  it.skipIf(missingActiveBundle !== undefined)(realBundleAuditName, () => {
    const snapshots = activeSnapshots();
    const candidates = activeCandidates();
    const snapshotByRepository = new Map(snapshots.map((snapshot) => [snapshot.repository_id, snapshot]));
    // This is a deterministic leak-audit sample, not the study selection. The
    // note-backed gitseed row ensures the audit checks real note bytes too.
    const sampleIds = [
      "r-gs8e05",
      ...snapshots.filter((snapshot) => snapshot.repository_id !== "gitseed").map((snapshot) =>
        candidates.find((candidate) => candidate.repository_id === snapshot.repository_id)!.candidate_id,
      ),
    ];
    const sample = sampleIds.map((id) => candidates.find((candidate) => candidate.candidate_id === id)!);
    expect(sample).toHaveLength(4);
    const root = temp("real");
    const outputRoot = join(root, "packets");
    const packets = sample.map((candidate) => buildSourcePacket({
      candidate,
      snapshot: snapshotByRepository.get(candidate.repository_id)!,
      studyRoot: ACTIVE_STUDY_ROOT,
      outputRoot,
      scratchParent: root,
    }));

    const noteCandidate = sample[0]!;
    const note = noteFromSealedBundle(snapshotByRepository.get(noteCandidate.repository_id)!, noteCandidate.source_refs[0]!, root);
    const packetBytes = packets.map((packet) => bytesUnder(packet.directory)).join("\n");
    expect(packetBytes).not.toContain("Record-Id");
    expect(packetBytes).not.toMatch(/^Ruled-out\s*:/m);
    expect(packetBytes).not.toContain(note);
    expect(packetBytes).not.toMatch(/\b(?:benchmark|treatment|task|cdeb)\s+(?:results?|rows?)\b/i);
    for (const packet of packets) {
      for (const source of packet.manifest.sources) {
        expect(hash(readFileSync(join(packet.directory, source.path)))).toBe(source.sha256);
      }
      expect(verifySourcePacket(packet.directory)).toEqual(packet.manifest);
    }

    const packet = packets[0]!;
    const sourcePath = join(packet.directory, packet.manifest.sources[0]!.path);
    const original = readFileSync(sourcePath, "utf8");
    const originalPacketHash = sourcePacketPayloadSha256(packet.directory);
    try {
      // NEGATIVE CONTROL: plant the forbidden line *after* a real packet has
      // been built, prove the real audit fails, then restore its exact bytes.
      writeFileSync(sourcePath, `${original}Record-Id: r-negative-control\n`, "utf8");
      expect(() => assertSourcePacketHasNoLeaks(packet.directory)).toThrow(/Record-Id found/);

      writeFileSync(sourcePath, `${original}ordinary source mutation\n`, "utf8");
      expect(sourcePacketPayloadSha256(packet.directory)).not.toBe(originalPacketHash);
      expect(() => verifySourcePacket(packet.directory)).toThrow(/source .* sha256 expected/);
    } finally {
      writeFileSync(sourcePath, original, "utf8");
    }
    expect(verifySourcePacket(packet.directory)).toEqual(packet.manifest);

    const surviving = packets.filter((packet) => packet.manifest.decision_content_after_redaction === "ordinary-body-survives").length;
    const empty = packets.length - surviving;
    console.info(`CDEB source-packet redaction measurement (sealed-bundle audit sample): ${surviving} ordinary-body-survives, ${empty} empty.`);
  });
});
