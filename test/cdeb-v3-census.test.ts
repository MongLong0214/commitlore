import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterAll, describe, expect, it } from "vitest";

import {
  readGrantedAuthorizations,
  runCensus,
  type SnapshotEntry,
} from "../bench/cdeb/freeze/census.ts";
import { gitOrThrow } from "../bench/git.ts";
import { createTestRepo } from "./git-fixtures.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CDEB_ROOT = join(ROOT, "bench", "cdeb");
const STUDY_ROOT = join(CDEB_ROOT, "studies", "cdeb-fresh-v3");
const scratch: string[] = [];

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const snapshot = (repositoryId: string, snapshotSha: string): SnapshotEntry => ({
  repository_id: repositoryId,
  remote_url: `https://example.invalid/${repositoryId}.git`,
  default_branch: "main",
  snapshot_sha: snapshotSha,
  source_authorization_id: "auth-test",
  frozen_at: "2026-08-20T22:08:19Z",
});

const writeSnapshots = (path: string, repositories: readonly SnapshotEntry[]): void => {
  writeFileSync(path, `${JSON.stringify({ schema_version: 1, repositories }, null, 2)}\n`, "utf8");
};

const writeAuthorization = (path: string, repositories: readonly string[]): void => {
  const rows = repositories.map((repository) => `| \`auth-test\` | ${repository} | Test Owner | yes |`);
  writeFileSync(
    path,
    [
      "# Source authorization",
      "",
      "## Granted",
      "",
      "| authorization_id | repository | owner | in the sealed corpus |",
      "|---|---|---|---|",
      ...rows,
      "",
      "## Other",
    ].join("\n"),
    "utf8",
  );
};

const fixture = (repositoryId = "fixture-repository") => {
  const root = mkdtempSync(join(tmpdir(), "cdeb-v3-census-"));
  scratch.push(root);
  const repositoriesRoot = join(root, "repositories");
  const repositoryPath = join(repositoriesRoot, repositoryId);
  mkdirSync(repositoriesRoot, { recursive: true });
  createTestRepo({ path: repositoryPath });
  const snapshotsPath = join(root, "snapshots.json");
  const authorizationPath = join(root, "AUTHORIZATION.md");
  const registryPath = join(root, "candidate-registry.jsonl");
  const summaryPath = join(root, "census-summary.json");
  return { root, repositoriesRoot, repositoryPath, snapshotsPath, authorizationPath, registryPath, summaryPath };
};

const commitDecision = (cwd: string): string => {
  writeFileSync(join(cwd, "decision.ts"), "export const decision = 'portable';\n", "utf8");
  gitOrThrow(cwd, ["add", "decision.ts"]);
  gitOrThrow(cwd, [
    "commit",
    "--quiet",
    "-m",
    [
      "decision: preserve portable behaviour",
      "",
      "Ruled-out: global cache | it leaks state across tenants",
      "Record-Id: r-census01",
      "Provenance: authored",
    ].join("\n"),
  ]);
  return gitOrThrow(cwd, ["rev-parse", "HEAD"]).trim();
};

describe("CDEB-Fresh v3 snapshot census", () => {
  it("validates snapshots.json with exactly the four §6.1 repositories and 40-hex SHAs", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(readJson(join(CDEB_ROOT, "schemas", "snapshots.schema.json")));
    const snapshots = readJson(join(STUDY_ROOT, "corpus", "snapshots.json")) as {
      repositories: readonly SnapshotEntry[];
    };

    expect(validate(snapshots), JSON.stringify(validate.errors)).toBe(true);
    expect(snapshots.repositories.map((repository) => repository.repository_id)).toEqual([
      "gitseed",
      "agent-operator-score",
      "logic-pro-mcp",
      "agent-control-plane",
    ]);
    for (const repository of snapshots.repositories) {
      expect(repository.snapshot_sha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("derives every snapshot authorization from AUTHORIZATION.md's Granted table", () => {
    const snapshots = readJson(join(STUDY_ROOT, "corpus", "snapshots.json")) as {
      repositories: readonly SnapshotEntry[];
    };
    const granted = readGrantedAuthorizations(join(CDEB_ROOT, "AUTHORIZATION.md"));

    for (const repository of snapshots.repositories) {
      expect(granted.get(repository.repository_id), repository.repository_id).toBe(
        repository.source_authorization_id,
      );
    }
  });

  it("refuses, by repository name, when its frozen snapshot object is absent", () => {
    const files = fixture();
    writeSnapshots(files.snapshotsPath, [snapshot("fixture-repository", "a".repeat(40))]);
    writeAuthorization(files.authorizationPath, ["fixture-repository"]);

    expect(() => runCensus(files)).toThrow(
      "repository fixture-repository does not contain frozen snapshot aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; fetch that commit",
    );
  });

  it("accepts a present frozen snapshot even when the checkout sits elsewhere", () => {
    const files = fixture();
    const frozen = commitDecision(files.repositoryPath);
    writeFileSync(join(files.repositoryPath, "later.ts"), "export const later = true;\n", "utf8");
    gitOrThrow(files.repositoryPath, ["add", "later.ts"]);
    gitOrThrow(files.repositoryPath, ["commit", "--quiet", "-m", "later work"]);
    writeSnapshots(files.snapshotsPath, [snapshot("fixture-repository", frozen)]);
    writeAuthorization(files.authorizationPath, ["fixture-repository"]);

    const summary = runCensus(files);

    expect(summary.repositories).toHaveLength(1);
    expect(summary.repositories[0]?.records_examined).toBe(1);
    expect(summary.repositories[0]?.candidates_reported).toBe(1);
    expect(readFileSync(files.registryPath, "utf8")).toContain(frozen);
  });

  it("refuses a repository absent from AUTHORIZATION.md's Granted table", () => {
    const files = fixture();
    const frozen = commitDecision(files.repositoryPath);
    writeSnapshots(files.snapshotsPath, [snapshot("fixture-repository", frozen)]);
    writeAuthorization(files.authorizationPath, []);

    expect(() => runCensus(files)).toThrow("repository fixture-repository is not granted by AUTHORIZATION.md");
  });

  it("writes a summary whose per-repository candidate total equals its JSONL lines", () => {
    const files = fixture();
    const frozen = commitDecision(files.repositoryPath);
    writeSnapshots(files.snapshotsPath, [snapshot("fixture-repository", frozen)]);
    writeAuthorization(files.authorizationPath, ["fixture-repository"]);

    const summary = runCensus(files);
    const entries = readFileSync(files.registryPath, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(summary.repositories).toHaveLength(1);
    expect(summary.repositories[0]?.candidates_reported).toBe(entries.length);
    expect(readJson(files.summaryPath)).toEqual(summary);
  });

  it("never marks a candidate eligible while any field remains undecided", () => {
    const files = fixture();
    const frozen = commitDecision(files.repositoryPath);
    writeSnapshots(files.snapshotsPath, [snapshot("fixture-repository", frozen)]);
    writeAuthorization(files.authorizationPath, ["fixture-repository"]);
    runCensus(files);

    const entries = readFileSync(files.registryPath, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as {
        natural_record: unknown;
        benchmark_authored: unknown;
        eligibility: Record<string, unknown>;
        review_status: string;
      });
    for (const entry of entries) {
      const undecided =
        entry.natural_record === "undecided" ||
        entry.benchmark_authored === "undecided" ||
        Object.values(entry.eligibility).some((value) => value === "undecided");
      if (undecided) expect(entry.review_status).not.toBe("accepted");
    }
  });
});
