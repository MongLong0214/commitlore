/**
 * CDEB-06: candidate tree ingestion — the evaluator side of the final tree
 * (PRD §11.1 / §19.3).
 *
 * The archive is the ONLY input (§12.2). Ingestion:
 *
 *   1. decompresses (zstd magic sniffed; raw tar accepted),
 *   2. extracts through the hygiene gate in tree.ts — traversal, `.git`
 *      smuggling, escaping symlinks, hardlinks, device nodes and bombs are
 *      all refused BEFORE the evaluator reads anything,
 *   3. makes the extraction read-only,
 *   4. recomputes the git tree OID with the SAME staging code the freeze
 *      used (git-tree.ts) — the evaluator never trusts a claimed OID, it
 *      re-derives it, and when the orchestrator supplies the freeze's claim
 *      a mismatch is a refusal (§19.3: final tree/evaluator tree mismatch 금지).
 *
 * A refusal is not an infrastructure error. It is a candidate tree that the
 * pinned harness cannot evaluate as a functional patch, and §13's
 * intention-to-treat reads it as the agent's output: the engine turns every
 * refusal into functional FAIL (engine.ts). The refusal code is named so a
 * reviewer can tell a broken patch from an attack tree.
 */

import { chmodSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { extractTreeArchive, maybeDecompress, sha256Hex } from "./tree.ts";
import { stageAndWriteTree } from "./git-tree.ts";
import type { IngestLimits, IngestedTree } from "./types.ts";
import { DEFAULT_INGEST_LIMITS } from "./types.ts";

const makeReadOnly = (dir: string): void => {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      makeReadOnly(path);
      chmodSync(path, 0o555);
    } else if (stat.isSymbolicLink()) {
      // symlinks carry no writable content; modes follow their targets
    } else {
      chmodSync(path, stat.mode & 0o111 ? 0o555 : 0o444);
    }
  }
};

export interface IngestOptions {
  /** The freeze's claimed OID, when the orchestrator supplies it. */
  readonly claimedOid?: string;
  readonly limits?: IngestLimits;
  /** Cap on the COMPRESSED archive bytes, before decompression. */
  readonly maxArchiveBytes?: number;
}

export const DEFAULT_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

/**
 * Materializes a candidate archive under `destRoot` (a fresh directory the
 * caller owns) and recomputes its identity.
 */
export const ingestFinalTree = (
  archiveBytes: Buffer,
  destRoot: string,
  options: IngestOptions = {},
): IngestedTree => {
  const limits = options.limits ?? DEFAULT_INGEST_LIMITS;
  const treeRoot = join(destRoot, "tree");
  if (archiveBytes.length > (options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES)) {
    return {
      root: treeRoot,
      candidate_tree_oid: "0".repeat(40),
      refusal: { code: "archive-too-large", detail: `archive is ${String(archiveBytes.length)} compressed bytes` },
    };
  }
  const tar = maybeDecompress(archiveBytes);
  const extraction = extractTreeArchive(tar, treeRoot, limits);

  if (extraction.refusal !== null) {
    return { root: treeRoot, candidate_tree_oid: "0".repeat(40), refusal: extraction.refusal };
  }

  makeReadOnly(treeRoot);

  const stageScratch = join(destRoot, "stage");
  const { treeOid } = stageAndWriteTree(treeRoot, stageScratch);

  if (options.claimedOid !== undefined && options.claimedOid !== treeOid) {
    return {
      root: treeRoot,
      candidate_tree_oid: treeOid,
      refusal: {
        code: "tree-oid-mismatch",
        detail: `recomputed ${treeOid} does not match the freeze's claimed ${options.claimedOid}`,
      },
    };
  }

  return { root: treeRoot, candidate_tree_oid: treeOid, refusal: null };
};

/** Identity of the archive bytes themselves, for the row's final_tree block. */
export const archiveDigest = (archiveBytes: Buffer): string => sha256Hex(archiveBytes);
