/**
 * CDEB-06: canonical final-tree freeze (PRD §11.1), the freeze-side half of
 * the evaluator pipeline.
 *
 * The agent's working tree becomes: a git tree OID (via the shared hermetic
 * staging in git-tree.ts), and a deterministic archive of exactly the staged
 * content — nothing else from the working directory enters the archive, so
 * `node_modules`, build output and anything else the tree's `.gitignore`
 * excludes stay out of the evaluated identity (§11.1 v1.2).
 *
 * Two digests are returned and both matter:
 *
 *   - `tar_sha256` — over the uncompressed deterministic tar bytes. This one
 *     is stable across zstd builds and machines; it is the identity other
 *     machines can recompute.
 *   - `archive_zst_sha256` — over the `.tar.zst` artifact §19.1 stores,
 *     compressed at the pinned level by the pinned node's bundled zstd.
 *
 * CDEB-07's freeze step records these in `final-tree.json` and writes
 * `final-tree.tar.zst`; the evaluator then ingests the archive and RECOMPUTES
 * the OID rather than trusting the claim (ingest.ts).
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { entriesFromDirectory, renderArchive, compressZstd, sha256Hex } from "./tree.ts";
import { stageAndWriteTree } from "./git-tree.ts";

export interface FrozenFinalTree {
  readonly final_tree_oid: string;
  readonly tar_sha256: string;
  readonly archive_zst_sha256: string;
  /** The `.tar.zst` bytes §19.1 stores. */
  readonly archive_zst: Buffer;
  readonly staged_file_count: number;
}

/** The extra §11.1 provenance CDEB-07 stores in `final-tree.json`. */
export interface FrozenTreeProvenance {
  readonly base_tree_oid: string;
  readonly canonical_diff_sha256: string;
  readonly workspace_status_digest: string;
}

const FROZEN_GIT_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ADVICE: "0",
  GIT_OPTIONAL_LOCKS: "0",
};

const FROZEN_GIT_FLAGS = [
  "-c", "core.fsmonitor=false",
  "-c", "core.autocrlf=false",
  "-c", "core.symlinks=true",
  "-c", "core.ignorecase=false",
  "-c", "core.fileMode=true",
] as const;

const gitOrThrow = (workdir: string, env: Record<string, string>, args: readonly string[]): Buffer => {
  const result = spawnSync("git", [...args], {
    cwd: workdir,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`final tree provenance: git ${args.join(" ")} failed (${String(result.status)}): ${Buffer.from(result.stderr ?? Buffer.alloc(0)).toString("utf8").trim()}`);
  }
  return Buffer.from(result.stdout ?? Buffer.alloc(0));
};

/**
 * Freezes the agent's final working tree. `scratchDir` must be a fresh
 * directory the caller owns; nothing here writes inside `workdir`.
 */
export const freezeFinalTree = (workdir: string, scratchDir: string): FrozenFinalTree => {
  const { treeOid, staged } = stageAndWriteTree(workdir, scratchDir);
  const paths = staged.map((entry) => entry.path);
  const entries = entriesFromDirectory(workdir, paths);
  const tar = renderArchive(entries);
  const zst = compressZstd(tar);
  return {
    final_tree_oid: treeOid,
    tar_sha256: sha256Hex(tar),
    archive_zst_sha256: sha256Hex(zst),
    archive_zst: Buffer.from(zst),
    staged_file_count: paths.length,
  };
};

/**
 * Captures the base→final binary diff and porcelain status from the actual
 * materialized repository.  It stages through a temporary index and asserts
 * that its tree is the OID the hermetic freezer already produced; otherwise a
 * "diff of the tree" would be a second, drifting implementation of §11.1.
 *
 * This is intentionally separate from `freezeFinalTree`: evaluator controls
 * also freeze plain fixture directories with no Git history, while a measured
 * CDEB workspace is always a materialized repository and therefore has a base.
 */
export const frozenTreeProvenance = (
  workdir: string,
  scratchDir: string,
  frozen: FrozenFinalTree,
): FrozenTreeProvenance => {
  const indexPath = join(scratchDir, "cdeb-final-index");
  const env: Record<string, string> = {
    ...FROZEN_GIT_ENV,
    GIT_INDEX_FILE: indexPath,
    TMPDIR: scratchDir,
  };
  const base_tree_oid = gitOrThrow(workdir, env, ["rev-parse", "HEAD^{tree}"]).toString("utf8").trim();
  gitOrThrow(workdir, env, [...FROZEN_GIT_FLAGS, "read-tree", "HEAD"]);
  gitOrThrow(workdir, env, [...FROZEN_GIT_FLAGS, "add", "-A", "--", "."]);
  const staged = gitOrThrow(workdir, env, [...FROZEN_GIT_FLAGS, "write-tree"]).toString("utf8").trim();
  if (staged !== frozen.final_tree_oid) {
    throw new Error(
      `final tree provenance: temporary-index OID ${staged} differs from hermetic freezer OID ${frozen.final_tree_oid}`,
    );
  }
  const canonicalDiff = gitOrThrow(
    workdir,
    env,
    [...FROZEN_GIT_FLAGS, "diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "--no-renames", "HEAD"],
  );
  const workspaceStatus = gitOrThrow(
    workdir,
    env,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
  );
  return {
    base_tree_oid,
    canonical_diff_sha256: sha256Hex(canonicalDiff),
    workspace_status_digest: sha256Hex(workspaceStatus),
  };
};

/** Writes the §19.1 artifacts (`final-tree.tar.zst`) under a run directory. */
export const writeFrozenArtifacts = (runDir: string, frozen: FrozenFinalTree): string => {
  const archivePath = join(runDir, "final-tree.tar.zst");
  writeFileSync(archivePath, frozen.archive_zst);
  return archivePath;
};
