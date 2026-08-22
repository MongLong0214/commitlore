/**
 * Builds the Stage 1-r1 buildability census from the sealed v5 corpus.
 *
 * The mechanical screens run here, against materializations of the four sealed
 * bundles whose digests are re-verified from bytes before anything is read. A
 * screen can only refute buildability -- surviving all three does not make a
 * candidate BUILDABLE, because BUILDABLE asserts an oracle exists and
 * discriminates, and no oracle has been built. Those rows are written with
 * `disposition: null`, which `assertCensusComplete` refuses.
 *
 * That refusal is the point. The census is a real artifact in an unfinished
 * state rather than an absent file, so the gap between "Stage 0 said 62 could
 * be studied" and "62 have been shown buildable" is visible in the tree instead
 * of living in a paragraph.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { BuildabilityRow, MechanicalScreen } from "./buildability-v5.ts";
import { screenRefutes, summarizeCensus } from "./buildability-v5.ts";

interface SnapshotEntry {
  readonly repository_id: string;
  readonly bundle_path: string;
  readonly bundle_sha256: string;
  readonly snapshot_commit: string;
  readonly snapshot_tree_oid: string;
}

interface CensusEntry {
  readonly candidate_id: string;
  readonly repository_id: string;
  readonly path_scope: readonly string[];
}

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);

/**
 * The acceptance runners this study is prepared to drive. A repository whose
 * tests cannot be executed by the frozen runtime has no deterministic
 * functional acceptance, whatever its test files look like.
 */
const ACCEPTANCE_RUNNERS: readonly { readonly marker: string; readonly runner: string }[] = [
  { marker: "package.json", runner: "npm test" },
  { marker: "pyproject.toml", runner: "pytest" },
  { marker: "pytest.ini", runner: "pytest" },
  { marker: "Package.swift", runner: "swift test" },
];

const detectRunner = (cwd: string, files: ReadonlySet<string>): string | null => {
  for (const { marker, runner } of ACCEPTANCE_RUNNERS) {
    if (!files.has(marker)) continue;
    if (marker !== "package.json") return runner;
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    // A package.json without a test script is a manifest, not a test harness.
    if (manifest.scripts?.test !== undefined) return runner;
  }
  return null;
};

interface Materialization {
  readonly files: ReadonlySet<string>;
  readonly runner: string | null;
  readonly tree_matches: boolean;
}

const materializeForScreening = (bundlePath: string, snapshot: SnapshotEntry): Materialization => {
  const actual = createHash("sha256").update(readFileSync(bundlePath)).digest("hex");
  if (actual !== snapshot.bundle_sha256) {
    throw new Error(
      `stage1-census: ${snapshot.repository_id}'s bundle hashes to ${actual}, not the frozen ${snapshot.bundle_sha256}`,
    );
  }
  const target = mkdtempSync(join(tmpdir(), "cdeb-screen-"));
  try {
    git(tmpdir(), ["clone", "--quiet", "--no-hardlinks", bundlePath, target]);
    git(target, ["checkout", "--quiet", "--detach", snapshot.snapshot_commit]);
    const treeOid = git(target, ["rev-parse", "HEAD^{tree}"]).trim();
    const files = new Set(
      git(target, ["ls-tree", "-r", "--name-only", "HEAD"])
        .split("\n")
        .filter((line) => line !== ""),
    );
    return { files, runner: detectRunner(target, files), tree_matches: treeOid === snapshot.snapshot_tree_oid };
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
};

export interface Stage1CensusResult {
  readonly rows: readonly BuildabilityRow[];
  readonly repositories: readonly {
    readonly repository_id: string;
    readonly runner: string | null;
    readonly tree_matches: boolean;
    readonly candidates: number;
    readonly refuted: number;
  }[];
}

export const runStage1Census = (studyRoot: string): Stage1CensusResult => {
  const root = resolve(studyRoot);
  const snapshots = (
    JSON.parse(readFileSync(join(root, "corpus", "snapshots.json"), "utf8")) as { repositories: SnapshotEntry[] }
  ).repositories;

  const qualified = new Set(
    readJsonl<{ candidate_id: string; qualified: boolean }>(join(root, "feasibility", "qualification.jsonl"))
      .filter((entry) => entry.qualified)
      .map((entry) => entry.candidate_id),
  );
  const census = readJsonl<CensusEntry>(join(root, "feasibility", "candidate-census.jsonl")).filter((entry) =>
    qualified.has(entry.candidate_id),
  );
  if (census.length !== qualified.size) {
    throw new Error(
      `stage1-census: ${String(qualified.size)} qualified candidates but ${String(census.length)} census rows`,
    );
  }

  const materialized = new Map<string, Materialization>();
  for (const snapshot of snapshots) {
    materialized.set(
      snapshot.repository_id,
      materializeForScreening(join(root, "corpus", snapshot.bundle_path), snapshot),
    );
  }

  const rows: BuildabilityRow[] = [];
  for (const entry of [...census].sort((left, right) => left.candidate_id.localeCompare(right.candidate_id))) {
    const state = materialized.get(entry.repository_id);
    if (state === undefined) throw new Error(`stage1-census: ${entry.repository_id} has no sealed bundle`);
    const screen: MechanicalScreen = {
      base_tree_resolvable: state.tree_matches,
      scope_paths_present: entry.path_scope.filter((path) => state.files.has(path)).length,
      scope_paths_total: entry.path_scope.length,
      acceptance_runner_present: state.runner !== null,
      acceptance_runner: state.runner,
    };
    const refuted = screenRefutes(screen);
    rows.push({
      schema_version: 1,
      study_id: "cdeb-fresh-v5",
      stage: "stage1-r1",
      candidate_id: entry.candidate_id,
      repository_id: entry.repository_id,
      screen,
      // A screen that fires decides the row. A screen that does not fire decides
      // nothing: BUILDABLE needs an oracle, and none exists.
      disposition: refuted === null ? null : `NOT_BUILDABLE:${refuted}`,
      decided_at: refuted === null ? null : new Date(0).toISOString(),
      evidence: refuted === null ? null : `mechanical screen over the sealed ${entry.repository_id} bundle`,
    });
  }

  return {
    rows,
    repositories: snapshots.map((snapshot) => ({
      repository_id: snapshot.repository_id,
      runner: materialized.get(snapshot.repository_id)?.runner ?? null,
      tree_matches: materialized.get(snapshot.repository_id)?.tree_matches ?? false,
      candidates: rows.filter((row) => row.repository_id === snapshot.repository_id).length,
      refuted: rows.filter((row) => row.repository_id === snapshot.repository_id && row.disposition !== null).length,
    })),
  };
};

const main = (argv: readonly string[]): void => {
  let studyRoot: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--study-root") {
      studyRoot = argv[index + 1];
      index += 1;
    } else if (argv[index]?.startsWith("--")) {
      throw new Error(`stage1-census: unknown flag ${argv[index] ?? ""}`);
    }
  }
  if (studyRoot === undefined) throw new Error("stage1-census: --study-root is required");
  const root = resolve(studyRoot);
  const result = runStage1Census(root);
  const outDir = join(root, "stage1-r1");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "buildability-census.jsonl"),
    `${result.rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  const summary = summarizeCensus(result.rows);
  writeFileSync(
    join(outDir, "buildability-summary.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        study_id: "cdeb-fresh-v5",
        stage: "stage1-r1",
        census_complete: summary.undecided === 0,
        summary,
        repositories: result.repositories,
        note:
          "A mechanical screen can only refute buildability. Rows with disposition null survived every screen and " +
          "are still undecided, because BUILDABLE asserts a validated discriminating oracle and none has been built.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  for (const repository of result.repositories) {
    process.stdout.write(
      `${repository.repository_id.padEnd(22)} candidates ${String(repository.candidates).padStart(3)}` +
        `  screen-refuted ${String(repository.refuted).padStart(3)}` +
        `  runner ${repository.runner ?? "none"}\n`,
    );
  }
  process.stdout.write(
    `census: ${String(summary.total)} rows, ${String(summary.buildable)} buildable, ` +
      `${String(summary.not_buildable)} not buildable, ${String(summary.undecided)} undecided\n`,
  );
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
