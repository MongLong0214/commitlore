import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  readLegacyExclusionIndex,
  digestReleaseDist,
  runCensus,
  validateRegistryManifest,
  validateV3Candidates,
  type CensusOptions,
  type CensusRegistryManifest,
  type SnapshotEntry,
} from "../bench/cdeb/freeze/census.ts";
import { createRepositoryBundle, type RepositoryBundleIdentity } from "../bench/cdeb/freeze/repository-bundle.ts";
import { assertCandidateSelectable } from "../bench/cdeb/candidate-v3.ts";
import { gitOrThrow } from "../bench/git.ts";
import { createTestRepo } from "./git-fixtures.js";

const ROOT = join(import.meta.dirname, "..");
const BENCH_ROOT = join(ROOT, "bench");
const ACTIVE_STUDY_ROOT = join(BENCH_ROOT, "cdeb", "studies", "cdeb-fresh-v3r1");
const ACTIVE_INDEX = join(BENCH_ROOT, "cdeb", "studies", "cdeb-fresh-v3r1", "corpus", "legacy-exclusion-index.json");
// `bench/results/` and `bench/cdeb/archive/` are historical evidence: a guard
// that forces recorded history to be rewritten is worse than the path it removes.
const HISTORICAL_EVIDENCE_EXCLUSIONS = [
  join(BENCH_ROOT, "results"),
  join(BENCH_ROOT, "cdeb", "archive"),
] as const;
const scratch: string[] = [];

const filesUnder = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
};

const isWithin = (path: string, directory: string): boolean => path === directory || path.startsWith(`${directory}/`);

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const snapshot = (repositoryId: string, identity: RepositoryBundleIdentity, bundlePath: string): SnapshotEntry => ({
  repository_id: repositoryId,
  remote_url: `https://example.invalid/${repositoryId}.git`,
  default_branch: "main",
  snapshot_sha: identity.snapshot_commit,
  bundle_path: bundlePath,
  bundle_sha256: identity.bundle_sha256,
  snapshot_commit: identity.snapshot_commit,
  snapshot_tree_oid: identity.snapshot_tree_oid,
  refs_included: identity.refs_included,
  refs_digest: identity.refs_digest,
  notes_refs_included: identity.notes_refs_included,
  notes_ref_digest: identity.notes_ref_digest,
  source_authorization_id: "auth-test",
  frozen_at: "2026-08-20T22:08:19Z",
});

const writeAuthorization = (path: string, repositories: readonly string[]): void => {
  const rows = repositories.map((repository) => `| \`auth-test\` | ${repository} | Test Owner | yes |`);
  writeFileSync(path, ["# Source authorization", "", "## Granted", "", "| authorization_id | repository | owner | in the sealed corpus |", "|---|---|---|---|", ...rows, "", "## Other"].join("\n"), "utf8");
};

const commitDecision = (cwd: string, id = "r-census01"): string => {
  writeFileSync(join(cwd, "decision.ts"), "export const decision = 'portable';\n", "utf8");
  gitOrThrow(cwd, ["add", "decision.ts"]);
  gitOrThrow(cwd, ["commit", "--quiet", "-m", ["decision: preserve portable behaviour", "", "Ruled-out: global cache | it leaks state across tenants", `Record-Id: ${id}`, "Provenance: authored"].join("\n")]);
  return gitOrThrow(cwd, ["rev-parse", "HEAD"]).trim();
};

const fixture = (exclusions: readonly Record<string, string>[] = []) => {
  const root = mkdtempSync(join(tmpdir(), "cdeb-v3-census-"));
  scratch.push(root);
  const repositoriesRoot = join(root, "repositories");
  const repositoryId = "fixture-repository";
  const repositoryPath = join(repositoriesRoot, repositoryId);
  mkdirSync(repositoriesRoot, { recursive: true });
  createTestRepo({ path: repositoryPath });

  const productRoot = join(root, "product");
  createTestRepo({ path: productRoot });
  mkdirSync(join(productRoot, "dist"));
  writeFileSync(join(productRoot, "dist", "query.js"), "export const release = true;\n", "utf8");
  gitOrThrow(productRoot, ["add", "dist/query.js"]);
  gitOrThrow(productRoot, ["commit", "--quiet", "-m", "ship test dist"]);
  const releaseCommit = gitOrThrow(productRoot, ["rev-parse", "HEAD"]).trim();
  gitOrThrow(productRoot, ["tag", "v-test"]);

  const studyRoot = join(root, "study");
  const corpus = join(studyRoot, "corpus");
  mkdirSync(corpus, { recursive: true });
  writeFileSync(join(studyRoot, "study.json"), `${JSON.stringify({ study_id: "cdeb-test-v3", release_tag: "v-test", release_commit: releaseCommit, product_dist_sha256: digestReleaseDist(productRoot, releaseCommit) })}\n`, "utf8");
  const snapshotsPath = join(corpus, "snapshots.json");
  const authorizationPath = join(root, "AUTHORIZATION.md");
  const registryPath = join(corpus, "candidate-registry.jsonl");
  const summaryPath = join(corpus, "census-summary.json");
  const registryManifestPath = join(corpus, "candidate-registry.manifest.json");
  const exclusionIndexPath = join(corpus, "legacy-exclusion-index.json");
  writeFileSync(join(corpus, "legacy-exclusion-index.json"), `${JSON.stringify({ schema_version: 1, exclusions }, null, 2)}\n`, "utf8");
  return {
    root, repositoriesRoot, repositoryId, repositoryPath, productRoot, studyRoot, snapshotsPath, authorizationPath,
    registryPath, summaryPath, registryManifestPath, exclusionIndexPath,
    options: {
      studyRoot, repositoriesRoot, productRepositoryRoot: productRoot, generatorCommitSha: "a".repeat(40), generatedAt: "2026-08-21T00:00:00.000Z",
      snapshotsPath, authorizationPath, registryPath, summaryPath, registryManifestPath, exclusionIndexPath,
    } satisfies CensusOptions,
  };
};

const writeCensusInputs = (files: ReturnType<typeof fixture>, sha: string): void => {
  const bundlePath = join(files.studyRoot, "corpus", "bundles", `${files.repositoryId}.bundle`);
  const identity = createRepositoryBundle(files.repositoryId, files.repositoryPath, bundlePath, sha);
  writeFileSync(files.snapshotsPath, `${JSON.stringify({ schema_version: 2, repositories: [snapshot(files.repositoryId, identity, join("bundles", `${files.repositoryId}.bundle`))] }, null, 2)}\n`, "utf8");
  writeAuthorization(files.authorizationPath, [files.repositoryId]);
};

const validV3 = (overrides: Record<string, unknown> = {}) => ({
  schema_version: 3,
  study_id: "cdeb-test-v3",
  candidate_id: "candidate-1",
  repository_id: "fixture-repository",
  source_snapshot_sha: "b".repeat(40),
  source_record_ids: ["r-source01"],
  source_refs: ["b".repeat(40)],
  qualification_status: "pending",
  pending_fields: ["human_review_required"],
  ineligibility_codes: [],
  ...overrides,
});

describe("CDEB-Fresh v3 snapshot census", () => {
  it("writes only v3 rows and a manifest bound to the frozen release", () => {
    const files = fixture();
    const frozen = commitDecision(files.repositoryPath);
    writeCensusInputs(files, frozen);

    const summary = runCensus(files.options);
    const [entry] = readFileSync(files.registryPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const manifest = JSON.parse(readFileSync(files.registryManifestPath, "utf8")) as CensusRegistryManifest;

    expect(summary.repositories[0]?.candidates_reported).toBe(1);
    expect(entry).toMatchObject({ schema_version: 3, study_id: "cdeb-test-v3", source_snapshot_sha: frozen, qualification_status: "pending" });
    expect(entry.pending_fields).toContain("natural_record");
    expect(entry.benchmark).toBeUndefined();
    expect(manifest).toMatchObject({ study_id: "cdeb-test-v3", product_release_tag: "v-test", product_release_commit: expect.stringMatching(/^[0-9a-f]{40}$/), candidate_count: 1, query_protocol_version: "cdeb-candidate-query-v1", index_schema_version: expect.any(Number) });
    expect(manifest.registry_sha256).toBe(createHash("sha256").update(readFileSync(files.registryPath)).digest("hex"));
    expect(() => assertCandidateSelectable(entry)).toThrow(/qualification_status is pending/);
  });

  it("refuses re-adding benchmark: cdeb-v1 to a v3 row by naming expected and received identity", () => {
    const legacy = { ...validV3({ schema_version: 1 }), benchmark: "cdeb-v1" };
    expect(() => validateV3Candidates([legacy], "cdeb-test-v3", new Map([["fixture-repository", "b".repeat(40)]]))).toThrow(/benchmark \(must be absent\).*expected "absent", received "cdeb-v1"/);
  });

  it("refuses a foreign v3 study_id by naming expected and received identity", () => {
    expect(() => validateV3Candidates([validV3({ study_id: "foreign-study" })], "cdeb-test-v3", new Map([["fixture-repository", "b".repeat(40)]]))).toThrow(/study_id expected "cdeb-test-v3", received "foreign-study"/);
  });

  it("refuses a source snapshot that differs from its frozen repository snapshot", () => {
    expect(() => validateV3Candidates([validV3({ source_snapshot_sha: "c".repeat(40) })], "cdeb-test-v3", new Map([["fixture-repository", "b".repeat(40)]]))).toThrow(/source_snapshot_sha expected "b+", received "c+"/);
  });

  it("refuses manifest count and registry digest disagreements", () => {
    const files = fixture();
    writeFileSync(files.registryPath, `${JSON.stringify(validV3())}\n`, "utf8");
    const base: CensusRegistryManifest = {
      schema_version: 1, study_id: "cdeb-test-v3", snapshot_manifest_sha256: "a".repeat(64), generator_commit_sha: "a".repeat(40),
      product_release_tag: "v-test", product_release_commit: "b".repeat(40), product_dist_sha256: "c".repeat(64),
      query_protocol_version: "cdeb-candidate-query-v1", index_schema_version: 4, generated_at: "2026-08-21T00:00:00.000Z", candidate_count: 1,
      registry_sha256: createHash("sha256").update(readFileSync(files.registryPath)).digest("hex"),
    };
    expect(() => validateRegistryManifest({ ...base, candidate_count: 2 }, files.registryPath, "cdeb-test-v3")).toThrow(/candidate_count expected 1, received 2/);
    expect(() => validateRegistryManifest({ ...base, registry_sha256: "d".repeat(64) }, files.registryPath, "cdeb-test-v3")).toThrow(/registry_sha256 expected .* received d+/);
  });

  it("fails hard when the required exclusion index is absent", () => {
    const files = fixture();
    const frozen = commitDecision(files.repositoryPath);
    writeCensusInputs(files, frozen);
    rmSync(files.exclusionIndexPath);
    expect(() => runCensus(files.options)).toThrow(/legacy exclusion index is required, received absent/);
  });

  it("keeps a Record-Id named by the index as an ineligible visible row", () => {
    const index = readLegacyExclusionIndex(ACTIVE_INDEX);
    const record = index.exclusions.find((entry) => entry.kind === "record-id");
    expect(record).toBeDefined();
    const files = fixture([record!]);
    const frozen = commitDecision(files.repositoryPath, record!.value);
    writeCensusInputs(files, frozen);
    runCensus(files.options);
    const [entry] = readFileSync(files.registryPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(entry).toMatchObject({ candidate_id: record!.value, qualification_status: "ineligible" });
    expect(entry.ineligibility_codes).toContain(`legacy-exclusion:${record!.reason}`);
  });

  // The three below are the rest of the index that a candidate can actually
  // carry. `exclusionsFor` matches an entry against candidate_id, record_ids and
  // decision_source_refs, so a study id, a task id, a prompt or fixture hash, a
  // randomization block and a trajectory id have no field to arrive in and no
  // candidate can be made ineligible by them.
  //
  // Each pins the value it expects instead of reading it back out of the index.
  // A test that sources both the fixture and the expectation from the same entry
  // passes whatever that entry happens to say, which leaves the identity itself
  // unguarded.
  it("keeps the index's ambiguous candidate identity ineligible", () => {
    const index = readLegacyExclusionIndex(ACTIVE_INDEX);
    const record = index.exclusions.find((e) => e.kind === "candidate-id" && e.value === "r-d0004gatecensus");
    expect(record).toBeDefined();
    const files = fixture([record!]);
    const frozen = commitDecision(files.repositoryPath, record!.value);
    writeCensusInputs(files, frozen);
    runCensus(files.options);
    const [entry] = readFileSync(files.registryPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(entry).toMatchObject({ candidate_id: "r-d0004gatecensus", qualification_status: "ineligible" });
    expect(entry.ineligibility_codes).toContain("legacy-exclusion:ambiguous-pending-adjudication");
  });

  it("keeps the benchmark-authored record ineligible", () => {
    const index = readLegacyExclusionIndex(ACTIVE_INDEX);
    const record = index.exclusions.find((e) => e.kind === "benchmark-authored-record" && e.value === "r-cdebp01");
    expect(record).toBeDefined();
    const files = fixture([record!]);
    const frozen = commitDecision(files.repositoryPath, record!.value);
    writeCensusInputs(files, frozen);
    runCensus(files.options);
    const [entry] = readFileSync(files.registryPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(entry).toMatchObject({ candidate_id: "r-cdebp01", qualification_status: "ineligible" });
    expect(entry.ineligibility_codes).toContain("legacy-exclusion:benchmark-authored");
  });

  it("keeps the publicly answer-exposed decision ineligible under its own reason", () => {
    // This value is also the record-id entry's value, so a candidate carrying it
    // collects both codes. The reason is what separates them, and the reason is
    // what a reader of the census sees.
    const index = readLegacyExclusionIndex(ACTIVE_INDEX);
    const record = index.exclusions.find((e) => e.kind === "publicly-answer-exposed-decision" && e.value === "r-gcunstageable");
    expect(record).toBeDefined();
    const files = fixture([record!]);
    const frozen = commitDecision(files.repositoryPath, record!.value);
    writeCensusInputs(files, frozen);
    runCensus(files.options);
    const [entry] = readFileSync(files.registryPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(entry).toMatchObject({ candidate_id: "r-gcunstageable", qualification_status: "ineligible" });
    expect(entry.ineligibility_codes).toContain("legacy-exclusion:publicly-answer-exposed");
  });

  it("refuses a declared dist digest that differs from the release-tagged dist", () => {
    const files = fixture();
    const frozen = commitDecision(files.repositoryPath);
    writeCensusInputs(files, frozen);
    writeFileSync(join(files.studyRoot, "study.json"), `${JSON.stringify({ study_id: "cdeb-test-v3", release_tag: "v-test", release_commit: gitOrThrow(files.productRoot, ["rev-parse", "HEAD"]).trim(), product_dist_sha256: "0".repeat(64) })}\n`, "utf8");
    expect(() => runCensus(files.options)).toThrow(/product dist digest expected [0-9a-f]{64}, received [0-9a-f]{64}/);
  });

  it("reads the sealed bundle after the source branch moves", () => {
    const files = fixture();
    const frozen = commitDecision(files.repositoryPath);
    writeCensusInputs(files, frozen);
    writeFileSync(join(files.repositoryPath, "later.ts"), "export const later = true;\n", "utf8");
    gitOrThrow(files.repositoryPath, ["add", "later.ts"]);
    gitOrThrow(files.repositoryPath, ["commit", "--quiet", "-m", "advance source branch"]);

    const summary = runCensus(files.options);
    expect(summary.repositories[0]?.candidates_reported).toBe(1);
  });

  it("forbids personal paths in runnable code and active-study artifacts", () => {
    expect(HISTORICAL_EVIDENCE_EXCLUSIONS).toEqual([
      join(BENCH_ROOT, "results"),
      join(BENCH_ROOT, "cdeb", "archive"),
    ]);

    const runnableCode = filesUnder(BENCH_ROOT).filter(
      (path) => /\.(?:ts|mjs|js)$/.test(path) && !HISTORICAL_EVIDENCE_EXCLUSIONS.some((directory) => isWithin(path, directory)),
    );
    const activeStudyArtifacts = filesUnder(ACTIVE_STUDY_ROOT);
    const scanned = [...new Set([...runnableCode, ...activeStudyArtifacts])].sort();
    const personalPaths = scanned.filter((path) => readFileSync(path, "utf8").includes("/Users/"));

    expect(personalPaths.map((path) => relative(BENCH_ROOT, path))).toEqual([]);
  });
});
