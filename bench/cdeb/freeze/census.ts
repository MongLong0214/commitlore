/** CDEB-Fresh v3 snapshot-bound candidate census (PRD §6.6–§6.7). */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { AnySchema } from "ajv";

import {
  enumerateCandidateRegistry,
  type CandidateRegistryCensus,
  type CandidateRegistryEntry,
} from "./candidate-registry.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CDEB_ROOT = resolve(HERE, "..");
const STUDY_ROOT = join(CDEB_ROOT, "studies", "cdeb-fresh-v3");
const DEFAULT_REPOSITORIES_ROOT = "/Users/isaac/projects";

export interface SnapshotEntry {
  readonly repository_id: string;
  readonly remote_url: string;
  readonly default_branch: string;
  readonly snapshot_sha: string;
  readonly source_authorization_id: string;
  readonly frozen_at: string;
}

export interface SnapshotManifest {
  readonly schema_version: 1;
  readonly repositories: readonly SnapshotEntry[];
}

export interface CensusSummaryEntry extends CandidateRegistryCensus {
  readonly repository_id: string;
}

export interface CensusSummary {
  readonly schema_version: 1;
  readonly repositories: readonly CensusSummaryEntry[];
}

export interface CensusOptions {
  readonly snapshotsPath?: string;
  readonly authorizationPath?: string;
  readonly repositoriesRoot?: string;
  readonly registryPath?: string;
  readonly summaryPath?: string;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const formatValidationErrors = (errors: unknown): string =>
  Array.isArray(errors)
    ? errors.map((error) => `${String(error.instancePath)} ${String(error.message)}`).join("; ")
    : "unknown validation error";

const validatorFor = (schemaPath: string) => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  (addFormats as unknown as (instance: Ajv2020) => void)(ajv);
  return ajv.compile<unknown>(readJson(schemaPath) as AnySchema);
};

export const readSnapshots = (snapshotsPath: string): SnapshotManifest => {
  const snapshots = readJson(snapshotsPath);
  const validate = validatorFor(join(CDEB_ROOT, "schemas", "snapshots.schema.json"));
  if (!validate(snapshots)) {
    throw new Error(`census: snapshots file is invalid: ${formatValidationErrors(validate.errors)}`);
  }
  return snapshots as SnapshotManifest;
};

/** Reads the Granted table, deliberately not the similarly named corpus list. */
export const readGrantedAuthorizations = (authorizationPath: string): ReadonlyMap<string, string> => {
  const authorization = readFileSync(authorizationPath, "utf8");
  const heading = /^## Granted\s*$/m.exec(authorization);
  if (heading === null || heading.index === undefined) {
    throw new Error("census: AUTHORIZATION.md has no Granted table");
  }
  const afterHeading = authorization.slice(heading.index + heading[0].length);
  const nextHeading = afterHeading.search(/^##\s/m);
  const granted = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);

  const entries = new Map<string, string>();
  for (const line of granted.split("\n")) {
    const cells = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/);
    if (cells === null) continue;
    const authorizationId = cells[1];
    const repositoryId = cells[2];
    if (authorizationId !== undefined && repositoryId !== undefined) {
      entries.set(repositoryId.trim(), authorizationId);
    }
  }
  return entries;
};

const git = (cwd: string, args: readonly string[]) =>
  spawnSync("git", args, { cwd, encoding: "utf8" });

const requireFrozenSnapshotObject = (repository: SnapshotEntry, cwd: string): void => {
  const frozen = git(cwd, ["cat-file", "-e", `${repository.snapshot_sha}^{commit}`]);
  if (frozen.status !== 0) {
    throw new Error(
      `census: repository ${repository.repository_id} does not contain frozen snapshot ${repository.snapshot_sha}; fetch that commit before running the census`,
    );
  }
};

const ensureAuthorized = (repository: SnapshotEntry, grants: ReadonlyMap<string, string>): void => {
  const authorizationId = grants.get(repository.repository_id);
  if (authorizationId === undefined || authorizationId !== repository.source_authorization_id) {
    throw new Error(
      `census: repository ${repository.repository_id} is not granted by AUTHORIZATION.md for ${repository.source_authorization_id}`,
    );
  }
};

const validateCandidates = (candidates: readonly CandidateRegistryEntry[]): void => {
  const validate = validatorFor(join(CDEB_ROOT, "schemas", "candidate.schema.json"));
  for (const candidate of candidates) {
    if (!validate(candidate)) {
      throw new Error(
        `census: candidate ${candidate.candidate_id} violates candidate.schema.json: ${formatValidationErrors(validate.errors)}`,
      );
    }
  }
};

/**
 * Enumerates the frozen snapshot object in every authorized primary repository.
 * It does no adjudication: the registry instrument owns all mechanical judgement.
 */
export const runCensus = (options: CensusOptions = {}): CensusSummary => {
  const snapshotsPath = options.snapshotsPath ?? join(STUDY_ROOT, "corpus", "snapshots.json");
  const authorizationPath = options.authorizationPath ?? join(CDEB_ROOT, "AUTHORIZATION.md");
  const repositoriesRoot = options.repositoriesRoot ?? DEFAULT_REPOSITORIES_ROOT;
  const registryPath = options.registryPath ?? join(STUDY_ROOT, "corpus", "candidate-registry.jsonl");
  const summaryPath = options.summaryPath ?? join(STUDY_ROOT, "corpus", "census-summary.json");
  const snapshots = readSnapshots(snapshotsPath);
  const grants = readGrantedAuthorizations(authorizationPath);
  const entries: CandidateRegistryEntry[] = [];
  const summaries: CensusSummaryEntry[] = [];

  for (const repository of snapshots.repositories) {
    ensureAuthorized(repository, grants);
    const cwd = join(repositoriesRoot, repository.repository_id);
    requireFrozenSnapshotObject(repository, cwd);
    const registry = enumerateCandidateRegistry({
      cwd,
      repositoryId: repository.repository_id,
      snapshotRef: repository.snapshot_sha,
    });
    validateCandidates(registry.candidates);
    entries.push(...registry.candidates);
    summaries.push({ repository_id: repository.repository_id, ...registry.census });
  }

  const summary: CensusSummary = { schema_version: 1, repositories: summaries };
  writeFileSync(registryPath, entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length === 0 ? "" : "\n"), "utf8");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
};

type CliOptions = {
  snapshotsPath?: string;
  authorizationPath?: string;
  repositoriesRoot?: string;
  registryPath?: string;
  summaryPath?: string;
};

const requiredValue = (argv: readonly string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
};

const parseCli = (argv: readonly string[]): CliOptions => {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--snapshots":
        options.snapshotsPath = requiredValue(argv, index, arg);
        index += 1;
        break;
      case "--authorization":
        options.authorizationPath = requiredValue(argv, index, arg);
        index += 1;
        break;
      case "--repositories-root":
        options.repositoriesRoot = requiredValue(argv, index, arg);
        index += 1;
        break;
      case "--registry":
        options.registryPath = requiredValue(argv, index, arg);
        index += 1;
        break;
      case "--summary":
        options.summaryPath = requiredValue(argv, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  return options;
};

const isMain = (): boolean =>
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain()) {
  try {
    const summary = runCensus(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
