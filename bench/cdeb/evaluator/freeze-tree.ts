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

/** Writes the §19.1 artifacts (`final-tree.tar.zst`) under a run directory. */
export const writeFrozenArtifacts = (runDir: string, frozen: FrozenFinalTree): string => {
  const archivePath = join(runDir, "final-tree.tar.zst");
  writeFileSync(archivePath, frozen.archive_zst);
  return archivePath;
};
