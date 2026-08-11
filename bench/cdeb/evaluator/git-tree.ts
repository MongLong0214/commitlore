/**
 * CDEB-06: the ONE git staging implementation both sides of the final tree
 * share (PRD §11.1).
 *
 * Freeze (§11.1, CDEB-07's call site) stages the agent's working tree and
 * writes the tree OID; ingest (this ticket) re-stages the extracted archive
 * and recomputes the OID. If those two staging paths ever diverge, the same
 * tree gets two identities and every "evaluator tree == final tree" check
 * becomes noise. So there is exactly one implementation, here, and both
 * sides call it.
 *
 * Hermetic by construction, because the staging runs over a tree an UNTRUSTED
 * author wrote:
 *
 *   - GIT_DIR is a fresh directory the evaluator owns — the candidate tree's
 *     own `.git` (if smuggled) is never consulted; ingest refuses `.git`
 *     entries before this runs anyway (tree.ts).
 *   - GIT_CONFIG_GLOBAL/SYSTEM point at /dev/null — no host identity, no host
 *     hooks, no host filters.
 *   - core.fsmonitor=false — fsmonitor is a code-execution surface triggered
 *     by `git add`; a candidate cannot supply the binary, but the flag makes
 *     the refusal explicit rather than environmental.
 *   - core.autocrlf=false, core.symlinks=true — fixed so the OID does not
 *     depend on the machine's defaults; any `.gitattributes` EOL rules in the
 *     tree apply identically on both sides because both sides are this code.
 *   - the index file lives in the evaluator's git dir, never in the tree.
 *
 * Determinism: `git write-tree` hashes (path, mode, content) only — mtimes,
 * enumeration order and host state do not reach the OID.
 */

import { mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const HERMETIC_GIT_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ADVICE: "0",
  GIT_OPTIONAL_LOCKS: "0",
};

const GIT_FLAGS = [
  "-c", "core.fsmonitor=false",
  "-c", "core.autocrlf=false",
  "-c", "core.symlinks=true",
  "-c", "core.ignorecase=false",
  "-c", "core.fileMode=true",
] as const;

const runGit = (cwd: string, env: Record<string, string>, args: readonly string[]): string => {
  const result = spawnSync("git", [...args], {
    cwd,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${String(result.status)}): ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout;
};

/** Staged entry listing: `mode oid stage\tpath`, the tree's own manifest. */
export interface StagedEntry {
  readonly mode: string;
  readonly oid: string;
  readonly path: string;
}

/**
 * Stages everything under `workTree` into a fresh evaluator-owned index and
 * returns the written tree OID plus the staged entry list.
 *
 * `git add -A` honours the tree's own `.gitignore` — the same rule the freeze
 * applies (§11.1 v1.2), and the same rules re-apply on ingest because the
 * archive carries the tree's `.gitignore` exactly as the agent left it.
 */
export const stageAndWriteTree = (workTree: string, scratchDir: string): { treeOid: string; staged: StagedEntry[] } => {
  const gitDir = join(scratchDir, "eval-git-dir");
  const indexFile = join(scratchDir, "eval-index");
  mkdirSync(gitDir, { recursive: true });

  const env: Record<string, string> = {
    ...HERMETIC_GIT_ENV,
    TMPDIR: scratchDir,
    GIT_DIR: gitDir,
    GIT_WORK_TREE: workTree,
    GIT_INDEX_FILE: indexFile,
  };

  // init gets NO GIT_WORK_TREE: with an explicit directory argument git
  // refuses the work-tree variable because the repository does not exist yet.
  runGit(workTree, { ...HERMETIC_GIT_ENV, TMPDIR: scratchDir }, ["init", "--quiet", "--bare", gitDir]);
  runGit(workTree, env, [...GIT_FLAGS, "add", "-A", "--", "."]);

  const lsOut = runGit(workTree, env, ["ls-files", "-s", "-z"]);
  const staged: StagedEntry[] = [];
  for (const record of lsOut.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const meta = record.slice(0, tab).split(" ");
    staged.push({ mode: meta[0] ?? "", oid: meta[1] ?? "", path: record.slice(tab + 1) });
  }
  staged.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const treeOid = runGit(workTree, env, [...GIT_FLAGS, "write-tree"]).trim();
  rmSync(gitDir, { recursive: true, force: true });
  rmSync(indexFile, { force: true });
  return { treeOid, staged };
};
