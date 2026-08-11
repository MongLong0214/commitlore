/**
 * Shared builders for the CDEB-06 evaluator tests. Every fixture tree here
 * is REAL: real files frozen through the real freeze pipeline, archived as
 * real bytes, ingested and judged by the real entrypoint in a subprocess.
 * Nothing about the attack trees is mocked — they are the artifacts.
 */

import { chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { freezeFinalTree, writeFrozenArtifacts, type FrozenFinalTree } from "../bench/cdeb/evaluator/freeze-tree.ts";
import { evaluateLocal, type LocalEvaluationResult } from "../bench/cdeb/evaluator/runner-local.ts";
import type { EvaluatorOutput } from "../bench/cdeb/evaluator/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");
export const FIXTURE_ROOT = join(REPO_ROOT, "bench", "cdeb", "test-fixtures", "evaluator");
export const SEALED_DIR = join(FIXTURE_ROOT, "sealed");
export const TASK_ID = "smoke-calc-fix";
export const TEST_IMAGE_DIGEST = `sha256:${"ab".repeat(32)}`;

const sha256Hex = (input: Buffer): string => createHash("sha256").update(input).digest("hex");

export const scratchDirs: string[] = [];

/** Restores write permission: ingest makes extractions read-only. */
const unlock = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      unlock(path);
    }
    chmodSync(path, stat.mode | 0o700);
  }
};

export const cleanupScratch = (): void => {
  for (const dir of scratchDirs) {
    try {
      unlock(dir);
    } catch {
      // best effort — the tmp OS reclaims whatever is left
    }
    rmSync(dir, { recursive: true, force: true });
  }
  scratchDirs.length = 0;
};

export const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `cdeb-ev-${label}-`));
  scratchDirs.push(dir);
  return dir;
};

export const fixtureFile = (...parts: string[]): string => readFileSync(join(FIXTURE_ROOT, ...parts), "utf8");

/** Copies the smoke base repo and applies file overrides (tree-relative). */
export const buildTree = (label: string, overrides: Record<string, string>): string => {
  const dir = join(tempDir(label), "tree");
  cpSync(join(FIXTURE_ROOT, "base"), dir, { recursive: true });
  for (const [rel, content] of Object.entries(overrides)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
};

export interface PreparedRun {
  readonly frozen: FrozenFinalTree;
  readonly archivePath: string;
  readonly treeDir: string;
}

/** Freezes a fixture tree and writes the §19.1 archive artifact. */
export const prepareRun = (label: string, treeDir: string): PreparedRun => {
  const frozen = freezeFinalTree(treeDir, tempDir(`${label}-freeze`));
  const runDir = tempDir(`${label}-run`);
  const archivePath = writeFrozenArtifacts(runDir, frozen);
  return { frozen, archivePath, treeDir };
};

export interface EvaluateOverrides {
  readonly claimedOid?: string;
  readonly tasksDir?: string;
  readonly timeoutMs?: number;
  readonly env?: Record<string, string>;
}

/** Runs the real entrypoint (subprocess) over a prepared run. */
export const evaluatePrepared = (run: PreparedRun, overrides: EvaluateOverrides = {}): LocalEvaluationResult => {
  const previousEnv: Record<string, string | undefined> = {};
  const env = overrides.env ?? {};
  for (const [key, value] of Object.entries(env)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return evaluateLocal({
      tasksDir: overrides.tasksDir ?? SEALED_DIR,
      taskId: TASK_ID,
      archivePath: run.archivePath,
      claimedOid: overrides.claimedOid ?? run.frozen.final_tree_oid,
      imageDigest: TEST_IMAGE_DIGEST,
      timeoutMs: overrides.timeoutMs,
    });
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

/**
 * Canary: the fixtures are inputs, not scratch. A snapshot of every path
 * under the fixture root, taken before and after a suite, must be identical
 * — any test that writes inside the fixture store fails loudly here instead
 * of silently corrupting the next run's inputs.
 */
export const snapshotFixtures = (): string[] => {
  const paths: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const rel = abs.slice(FIXTURE_ROOT.length + 1);
      const stat = lstatSync(abs);
      if (stat.isDirectory()) {
        paths.push(`${rel}/`);
        walk(abs);
      } else if (stat.isSymbolicLink()) {
        paths.push(`${rel}@`);
      } else {
        paths.push(`${rel}:${String(stat.size)}:${sha256Hex(readFileSync(abs))}`);
      }
    }
  };
  walk(FIXTURE_ROOT);
  return paths;
};

export const expectVerdict = (result: LocalEvaluationResult): EvaluatorOutput => {
  if (result.verdict === null) {
    throw new Error(`no verdict: exit ${String(result.exitCode)} stderr: ${result.stderr.slice(0, 400)}`);
  }
  return result.verdict;
};
