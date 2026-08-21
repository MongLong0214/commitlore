/** CDEB-Fresh v3 snapshot census (PRD §6.6–§7, §21). */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import { SCHEMA_VERSION as INDEX_SCHEMA_VERSION } from "../../../dist/core/index-db.js";
import { addRfc3339DateTimeFormat } from "../ledger.js";
import {
  enumerateCandidateRegistry,
  type CandidateRegistryCensus,
  type CandidateRegistryEntry,
} from "./candidate-registry.ts";
import { materializeBundle, type RepositoryBundleIdentity } from "./repository-bundle.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CDEB_ROOT = resolve(HERE, "..");
const STUDY_ROOT = join(CDEB_ROOT, "studies", "cdeb-fresh-v3r1");
const QUERY_PROTOCOL_VERSION = "cdeb-candidate-query-v1";

export interface SnapshotEntry {
  readonly repository_id: string;
  readonly remote_url: string;
  readonly default_branch: string;
  readonly snapshot_sha: string;
  readonly bundle_path: string;
  readonly bundle_sha256: string;
  readonly snapshot_commit: string;
  readonly snapshot_tree_oid: string;
  readonly refs_included: readonly string[];
  readonly refs_digest: string;
  readonly notes_refs_included: boolean;
  readonly notes_ref_digest: string;
  readonly source_authorization_id: string;
  readonly frozen_at: string;
}

export interface SnapshotManifest {
  readonly schema_version: 2;
  readonly repositories: readonly SnapshotEntry[];
}

export interface LegacyExclusionEntry {
  readonly kind: string;
  readonly value: string;
  readonly reason: string;
  readonly source_study: string;
  readonly evidence_ref: string;
}

export interface LegacyExclusionIndex {
  readonly schema_version: 1;
  readonly exclusions: readonly LegacyExclusionEntry[];
}

export interface CandidateV3Entry {
  readonly schema_version: 3;
  readonly study_id: string;
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly source_snapshot_sha: string;
  readonly source_record_ids: readonly string[];
  readonly source_refs: readonly string[];
  readonly qualification_status: "pending" | "eligible" | "ineligible";
  readonly pending_fields: readonly string[];
  readonly ineligibility_codes: readonly string[];
}

export interface CensusSummaryEntry extends CandidateRegistryCensus {
  readonly repository_id: string;
}

export interface CensusSummary {
  readonly schema_version: 1;
  readonly repositories: readonly CensusSummaryEntry[];
}

export interface CensusRegistryManifest {
  readonly schema_version: 1;
  readonly study_id: string;
  readonly snapshot_manifest_sha256: string;
  readonly generator_commit_sha: string;
  readonly product_release_tag: string;
  readonly product_release_commit: string;
  readonly product_dist_sha256: string;
  readonly query_protocol_version: string;
  readonly index_schema_version: number;
  readonly generated_at: string;
  readonly candidate_count: number;
  readonly registry_sha256: string;
}

interface StudyManifest {
  readonly study_id: string;
  readonly release_tag: string;
  readonly release_commit: string;
  readonly product_dist_sha256: string;
}

export interface CensusOptions {
  readonly studyRoot?: string;
  readonly snapshotsPath?: string;
  readonly authorizationPath?: string;
  readonly repositoriesRoot?: string;
  readonly registryPath?: string;
  readonly summaryPath?: string;
  readonly registryManifestPath?: string;
  readonly exclusionIndexPath?: string;
  /** Test-only seam for a repository containing a release-tagged dist directory. */
  readonly productRepositoryRoot?: string;
  readonly generatorCommitSha?: string;
  readonly generatedAt?: string;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

const formatValidationErrors = (errors: unknown): string =>
  Array.isArray(errors)
    ? errors.map((error) => `${String(error.instancePath)} ${String(error.message)}`).join("; ")
    : "unknown validation error";

const validatorFor = (schemaPath: string) => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addRfc3339DateTimeFormat(ajv);
  return ajv.compile<unknown>(readJson(schemaPath) as AnySchema);
};

const git = (cwd: string, args: readonly string[], encoding: "utf8" | "buffer" = "utf8") =>
  spawnSync("git", args, { cwd, encoding, maxBuffer: 32 * 1024 * 1024 });

const gitText = (cwd: string, args: readonly string[]): string => {
  const result = git(cwd, args);
  if (result.status !== 0 || typeof result.stdout !== "string") {
    throw new Error(`census: git ${args.join(" ")} failed: ${String(result.stderr).trim()}`);
  }
  return result.stdout.trim();
};

const requireHex = (label: string, value: string): void => {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`census: ${label} expected a 40-hex commit, received ${JSON.stringify(value)}`);
  }
};

export const readSnapshots = (snapshotsPath: string): SnapshotManifest => {
  const snapshots = readJson(snapshotsPath);
  const validate = validatorFor(join(CDEB_ROOT, "schemas", "snapshots.schema.json"));
  if (!validate(snapshots)) {
    throw new Error(`census: snapshots file is invalid: ${formatValidationErrors(validate.errors)}`);
  }
  return snapshots as SnapshotManifest;
};

export const readLegacyExclusionIndex = (path: string): LegacyExclusionIndex => {
  if (!existsSync(path)) throw new Error(`census: legacy exclusion index is required, received absent ${path}`);
  const parsed = readJson(path) as Partial<LegacyExclusionIndex>;
  if (parsed.schema_version !== 1 || !Array.isArray(parsed.exclusions)) {
    throw new Error(`census: legacy exclusion index expected schema_version 1 with exclusions array, received invalid ${path}`);
  }
  for (const [index, entry] of parsed.exclusions.entries()) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof (entry as LegacyExclusionEntry).kind !== "string" ||
      typeof (entry as LegacyExclusionEntry).value !== "string" ||
      typeof (entry as LegacyExclusionEntry).reason !== "string" ||
      typeof (entry as LegacyExclusionEntry).source_study !== "string" ||
      typeof (entry as LegacyExclusionEntry).evidence_ref !== "string"
    ) {
      throw new Error(`census: legacy exclusion index row ${String(index)} is missing required evidence fields`);
    }
  }
  return parsed as LegacyExclusionIndex;
};

/** Reads the Granted table, deliberately not the similarly named corpus list. */
export const readGrantedAuthorizations = (authorizationPath: string): ReadonlyMap<string, string> => {
  const authorization = readFileSync(authorizationPath, "utf8");
  const heading = /^## Granted\s*$/m.exec(authorization);
  if (heading === null || heading.index === undefined) throw new Error("census: AUTHORIZATION.md has no Granted table");
  const afterHeading = authorization.slice(heading.index + heading[0].length);
  const nextHeading = afterHeading.search(/^##\s/m);
  const granted = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
  const entries = new Map<string, string>();
  for (const line of granted.split("\n")) {
    const cells = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/);
    if (cells?.[1] !== undefined && cells[2] !== undefined) entries.set(cells[2].trim(), cells[1]);
  }
  return entries;
};

const ensureAuthorized = (repository: SnapshotEntry, grants: ReadonlyMap<string, string>): void => {
  const authorizationId = grants.get(repository.repository_id);
  if (authorizationId === undefined || authorizationId !== repository.source_authorization_id) {
    throw new Error(`census: repository ${repository.repository_id} is not granted by AUTHORIZATION.md for ${repository.source_authorization_id}`);
  }
};

// Census is discovery, not adjudication.  The raw registry may expose values
// that a later reviewer will consider, but this run deliberately makes none
// of those judgments.  A deterministic legacy exclusion is the sole
// exception: it remains visible as an ineligible row rather than disappearing.
const PENDING_ADJUDICATION_FIELDS = [
  "natural_record",
  "benchmark_authored",
  "explicit_rejection_reason",
  "wrong_path_functionally_viable",
  "deterministic_oracle_possible",
  "current_code_does_not_reveal_reason",
  "bounded_implementation",
] as const;

const exclusionsFor = (candidate: CandidateRegistryEntry, index: LegacyExclusionIndex): LegacyExclusionEntry[] => {
  const values = new Set([candidate.candidate_id, ...candidate.record_ids, ...candidate.decision_source_refs]);
  return index.exclusions.filter((entry) => values.has(entry.value));
};

const v3CandidateFor = (candidate: CandidateRegistryEntry, studyId: string, snapshotSha: string, index: LegacyExclusionIndex): CandidateV3Entry => {
  const exclusions = exclusionsFor(candidate, index);
  const ineligibilityCodes = exclusions.map((entry) => `legacy-exclusion:${entry.reason}`);
  const pendingFields = ineligibilityCodes.length === 0 ? [...PENDING_ADJUDICATION_FIELDS] : [];
  return {
    schema_version: 3,
    study_id: studyId,
    candidate_id: candidate.candidate_id,
    repository_id: candidate.repository_id,
    source_snapshot_sha: snapshotSha,
    source_record_ids: candidate.record_ids,
    source_refs: candidate.decision_source_refs,
    qualification_status: ineligibilityCodes.length > 0 ? "ineligible" : "pending",
    pending_fields: pendingFields,
    ineligibility_codes: [...new Set(ineligibilityCodes)].sort(),
  };
};

const bundleIdentityFor = (repository: SnapshotEntry): RepositoryBundleIdentity => {
  if (repository.snapshot_sha !== repository.snapshot_commit) {
    throw new Error(`census: repository ${repository.repository_id} snapshot_sha ${repository.snapshot_sha} does not match snapshot_commit ${repository.snapshot_commit}`);
  }
  return {
    repository_id: repository.repository_id,
    bundle_sha256: repository.bundle_sha256,
    snapshot_commit: repository.snapshot_commit,
    snapshot_tree_oid: repository.snapshot_tree_oid,
    refs_digest: repository.refs_digest,
    notes_ref_digest: repository.notes_ref_digest,
    refs_included: repository.refs_included,
    notes_refs_included: repository.notes_refs_included,
  };
};

const bundlePathFor = (snapshotsPath: string, repository: SnapshotEntry): string => {
  if (isAbsolute(repository.bundle_path)) throw new Error(`census: repository ${repository.repository_id} bundle_path must be relative, received ${repository.bundle_path}`);
  const manifestDirectory = dirname(resolve(snapshotsPath));
  const path = resolve(manifestDirectory, repository.bundle_path);
  if (relative(manifestDirectory, path).startsWith("..")) throw new Error(`census: repository ${repository.repository_id} bundle_path escapes snapshots directory`);
  return path;
};

const enumerateSealedRepository = (
  repository: SnapshotEntry,
  snapshotsPath: string,
): ReturnType<typeof enumerateCandidateRegistry> => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "cdeb-census-"));
  try {
    const materializedRepository = join(temporaryRoot, "repository");
    materializeBundle(bundleIdentityFor(repository), bundlePathFor(snapshotsPath, repository), materializedRepository);
    return enumerateCandidateRegistry({
      cwd: materializedRepository,
      repositoryId: repository.repository_id,
      snapshotRef: repository.snapshot_commit,
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

const identityError = (field: string, expected: string, received: unknown): Error =>
  new Error(`census: candidate identity ${field} expected ${JSON.stringify(expected)}, received ${JSON.stringify(received)}`);

export function validateV3Candidates(candidates: readonly unknown[], studyId: string, snapshots: ReadonlyMap<string, string>): asserts candidates is CandidateV3Entry[] {
  const validate = validatorFor(join(CDEB_ROOT, "schemas", "candidate-v3.schema.json"));
  for (const candidate of candidates) {
    const row = candidate as Record<string, unknown>;
    if ("benchmark" in row) throw identityError("benchmark (must be absent)", "absent", row.benchmark);
    if (row.schema_version !== 3) throw identityError("schema_version", "3", row.schema_version);
    if (row.study_id !== studyId) throw identityError("study_id", studyId, row.study_id);
    const repositoryId = typeof row.repository_id === "string" ? row.repository_id : "";
    const expectedSnapshot = snapshots.get(repositoryId);
    if (expectedSnapshot === undefined) throw identityError("repository_id", "a repository in snapshots.json", row.repository_id);
    if (row.source_snapshot_sha !== expectedSnapshot) throw identityError("source_snapshot_sha", expectedSnapshot, row.source_snapshot_sha);
    if (!validate(candidate)) throw new Error(`census: candidate ${String(row.candidate_id)} violates candidate-v3.schema.json: ${formatValidationErrors(validate.errors)}`);
  }
}

// The release tag stores dist as Git blobs, so this is a reproducible shipped
// artifact digest: sorted `dist/<path>\0<bytes>\0`, not a rebuild-dependent tarball.
export const digestReleaseDist = (root: string, releaseCommit: string): string => {
  const listing = gitText(root, ["ls-tree", "-r", "-z", releaseCommit, "--", "dist"]);
  const hash = createHash("sha256");
  for (const entry of listing.split("\0").filter((value) => value !== "")) {
    const match = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
    if (match?.[1] === undefined || match[2] === undefined) throw new Error(`census: cannot parse release dist entry ${JSON.stringify(entry)}`);
    const blob = git(root, ["cat-file", "blob", match[1]], "buffer");
    if (blob.status !== 0 || !Buffer.isBuffer(blob.stdout)) throw new Error(`census: cannot read release dist blob ${match[1]}`);
    hash.update(match[2]); hash.update("\0"); hash.update(blob.stdout); hash.update("\0");
  }
  return hash.digest("hex");
};

const readStudyManifest = (studyRoot: string): StudyManifest => {
  const manifest = readJson(join(studyRoot, "study.json")) as Partial<StudyManifest>;
  if (typeof manifest.study_id !== "string" || typeof manifest.release_tag !== "string" || typeof manifest.release_commit !== "string" || typeof manifest.product_dist_sha256 !== "string") throw new Error(`census: study manifest expected study_id, release_tag, release_commit, and product_dist_sha256 at ${studyRoot}`);
  requireHex("study manifest release_commit", manifest.release_commit);
  if (!/^[0-9a-f]{64}$/.test(manifest.product_dist_sha256)) throw new Error(`census: study manifest product_dist_sha256 expected a 64-hex digest, received ${JSON.stringify(manifest.product_dist_sha256)}`);
  return manifest as StudyManifest;
};

const verifyProductRelease = (study: StudyManifest, productRoot: string): CensusRegistryManifest => {
  const tagCommit = gitText(productRoot, ["rev-parse", "--verify", "--end-of-options", `${study.release_tag}^{commit}`]);
  if (tagCommit !== study.release_commit) throw identityError("product_release_commit", study.release_commit, tagCommit);
  const expected = study.product_dist_sha256;
  const received = digestReleaseDist(productRoot, study.release_commit);
  if (expected !== received) throw new Error(`census: product dist digest expected ${expected}, received ${received}; refusing to enumerate with a non-release dist`);
  return {
    schema_version: 1, study_id: study.study_id, snapshot_manifest_sha256: "", generator_commit_sha: "",
    product_release_tag: study.release_tag, product_release_commit: study.release_commit, product_dist_sha256: received,
    query_protocol_version: QUERY_PROTOCOL_VERSION, index_schema_version: INDEX_SCHEMA_VERSION, generated_at: "", candidate_count: 0, registry_sha256: "",
  };
};

export const validateRegistryManifest = (manifest: CensusRegistryManifest, registryPath: string, expectedStudyId: string): void => {
  if (manifest.study_id !== expectedStudyId) throw identityError("manifest study_id", expectedStudyId, manifest.study_id);
  const registry = readFileSync(registryPath, "utf8");
  const count = registry === "" ? 0 : registry.trimEnd().split("\n").length;
  if (manifest.candidate_count !== count) throw new Error(`census: manifest candidate_count expected ${String(count)}, received ${String(manifest.candidate_count)}`);
  const receivedHash = sha256(registry);
  if (manifest.registry_sha256 !== receivedHash) throw new Error(`census: manifest registry_sha256 expected ${receivedHash}, received ${manifest.registry_sha256}`);
};

/** Enumerates only verified sealed bundles; it never opens a measured repository. */
export const runCensus = (options: CensusOptions = {}): CensusSummary => {
  const studyRoot = options.studyRoot ?? STUDY_ROOT;
  const snapshotsPath = options.snapshotsPath ?? join(studyRoot, "corpus", "snapshots.json");
  const authorizationPath = options.authorizationPath ?? join(CDEB_ROOT, "AUTHORIZATION.md");
  const registryPath = options.registryPath ?? join(studyRoot, "corpus", "candidate-registry.jsonl");
  const summaryPath = options.summaryPath ?? join(studyRoot, "corpus", "census-summary.json");
  const registryManifestPath = options.registryManifestPath ?? join(studyRoot, "corpus", "candidate-registry.manifest.json");
  const exclusionIndexPath = options.exclusionIndexPath ?? join(studyRoot, "corpus", "legacy-exclusion-index.json");
  const study = readStudyManifest(studyRoot);
  const product = verifyProductRelease(study, options.productRepositoryRoot ?? resolve(CDEB_ROOT, "..", ".."));
  const snapshots = readSnapshots(snapshotsPath);
  const exclusions = readLegacyExclusionIndex(exclusionIndexPath);
  const grants = readGrantedAuthorizations(authorizationPath);
  const snapshotByRepository = new Map(snapshots.repositories.map((entry) => [entry.repository_id, entry.snapshot_sha]));
  const entries: CandidateV3Entry[] = [];
  const summaries: CensusSummaryEntry[] = [];
  for (const repository of snapshots.repositories) {
    ensureAuthorized(repository, grants);
    const registry = enumerateSealedRepository(repository, snapshotsPath);
    const v3 = registry.candidates.map((candidate) => v3CandidateFor(candidate, study.study_id, repository.snapshot_sha, exclusions));
    validateV3Candidates(v3, study.study_id, snapshotByRepository);
    entries.push(...v3); summaries.push({ repository_id: repository.repository_id, ...registry.census });
  }
  const summary: CensusSummary = { schema_version: 1, repositories: summaries };
  const registry = entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length === 0 ? "" : "\n");
  writeFileSync(registryPath, registry, "utf8");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const generatorCommitSha = options.generatorCommitSha ?? gitText(resolve(CDEB_ROOT, "..", ".."), ["rev-parse", "HEAD"]);
  requireHex("generator_commit_sha", generatorCommitSha);
  const manifest: CensusRegistryManifest = {
    ...product, snapshot_manifest_sha256: sha256(readFileSync(snapshotsPath)), generator_commit_sha: generatorCommitSha,
    generated_at: options.generatedAt ?? new Date().toISOString(), candidate_count: entries.length, registry_sha256: sha256(registry),
  };
  validateRegistryManifest(manifest, registryPath, study.study_id);
  writeFileSync(registryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return summary;
};

type CliOptions = CensusOptions;
const requiredValue = (argv: readonly string[], index: number, flag: string): string => {
  const value = argv[index + 1]; if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`); return value;
};
const parseCli = (argv: readonly string[]): CliOptions => {
  const options: CliOptions = {};
  const flags: Readonly<Record<string, keyof CliOptions>> = { "--snapshots": "snapshotsPath", "--authorization": "authorizationPath", "--repositories-root": "repositoriesRoot", "--registry": "registryPath", "--summary": "summaryPath", "--registry-manifest": "registryManifestPath", "--exclusion-index": "exclusionIndexPath" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]; const field = arg === undefined ? undefined : flags[arg];
    if (field === undefined) throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    (options as Record<string, string>)[field] = requiredValue(argv, index, arg!); index += 1;
  }
  return options;
};
const isMain = (): boolean => process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain()) {
  try { process.stdout.write(`${JSON.stringify(runCensus(parseCli(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; }
}
