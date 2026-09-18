/**
 * The first-solve checkpoint — #1034 §3-§4, revision `native-efficacy-r6.1`.
 *
 * A repair restores what the first solve actually left, and #1034 is emphatic
 * about what that is: "the old handoff plus code only" is the wrong answer. The
 * first solve may have committed, and it may have written a native note. Reset
 * its notes to the handoff while keeping its newer code and the repair reads a
 * memory that never existed at that point — a patch paired with another stage's
 * memory, which is why source identity and notes identity are recorded together
 * here and checked together on restore.
 *
 * Four properties are load-bearing and each is easy to lose quietly:
 *
 *   1. **Collection does not touch the actor's index.** Every step that needs an
 *      index uses an isolated `GIT_INDEX_FILE`, so a snapshot taken mid-episode
 *      cannot stage or unstage anything the actor did.
 *   2. **The diff is a function of the tree, not of the config.** `diff.external`
 *      or `diff.relative` in a subdirectory silently produce zero bytes, so
 *      every diff here is taken with `--no-ext-diff --no-relative --no-textconv`
 *      and `--binary`.
 *   3. **Staging semantics survive.** HEAD-to-index and index-to-worktree are
 *      separate patches and are re-applied separately, because a single combined
 *      diff restores the content and loses what was staged.
 *   4. **A limitation is declared, never papered over.** An unsupported
 *      submodule, LFS filter or oversized payload is recorded and makes the
 *      checkpoint incomplete, which #1042's rule 3 turns into `unavailable`
 *      rather than a silent partial restore.
 *
 * `git apply` is used exactly as #1034 prescribes: `--index --whitespace=nowarn`
 * for the staged half, plain `--whitespace=nowarn` for the unstaged half, and no
 * three-way, reject files or whitespace correction anywhere. Those flags exist
 * to make a failed restore fail rather than to make it approximately succeed.
 */

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

import { git, gitOrThrow } from "../git.ts";

/**
 * A diff is a function of the tree *and* the configuration. `diff.external`
 * replaces the driver and prints nothing git can re-apply; `diff.relative` in a
 * subdirectory drops every path outside it. Both produce a clean, empty,
 * completely wrong patch, and a checkpoint built from one restores nothing while
 * reporting success.
 */
const DIFF_FLAGS = ["--no-ext-diff", "--no-relative", "--no-textconv", "--binary"] as const;

/** Anything larger is declared rather than embedded. 8 MiB of base64 is enough. */
const NEW_FILE_LIMIT_BYTES = 8 * 1024 * 1024;

export type CheckpointStage = "handoff" | "first_solve" | "repair";

export interface NotesRef {
  readonly ref: string;
  /** The ref's object id, or `null` when it was deleted by this stage. */
  readonly oid: string | null;
}

export interface NewFile {
  readonly path: string;
  readonly kind: "file" | "symlink";
  /** Octal mode as git reports it, so an executable bit survives the round trip. */
  readonly mode: string;
  /** Base64 for `kind: "file"`. Absent for a symlink. */
  readonly base64?: string;
  /** The link text for `kind: "symlink"`, recorded without ever being followed. */
  readonly target?: string;
}

export interface CheckpointLimitation {
  readonly kind: "submodule" | "lfs" | "oversized" | "symlink_escape" | "unreadable";
  readonly detail: string;
}

export interface Checkpoint {
  readonly stage: CheckpointStage;
  readonly taken_at: string;
  /** HEAD at the moment of collection. */
  readonly head: string;
  /**
   * The worktree's tree identity, computed in an isolated index.
   *
   * Recorded beside `notes` on purpose (#1034 §3): the pair is what makes a
   * mismatch detectable, so a patch cannot later be paired with another stage's
   * memory without something noticing.
   */
  readonly worktree_tree: string;
  readonly notes: readonly NotesRef[];
  /** A bundle of every ref, so commits and note objects travel together. */
  readonly bundle_path: string;
  /** HEAD to index. Empty string means no staged delta, which is a no-op. */
  readonly staged_patch: string;
  /** Index to worktree. Empty string means no unstaged delta. */
  readonly unstaged_patch: string;
  readonly new_files: readonly NewFile[];
  readonly limitations: readonly CheckpointLimitation[];
}

export interface TakeOptions {
  readonly cwd: string;
  readonly stage: CheckpointStage;
  /** Where the bundle is written. Must already exist. */
  readonly outDir: string;
  /**
   * Exact repo-relative paths this harness owns and may drop.
   *
   * Exact paths, never directories or globs: #1034 says to exclude only
   * explicitly owned harness artifacts and not broad source directories, and a
   * directory rule is how a source tree gets quietly trimmed.
   */
  readonly exclude?: readonly string[];
  readonly now?: () => Date;
}

/**
 * A scratch index inside the git directory, never inside the worktree.
 *
 * The first version put it beside the bundle, which in a real run is a directory
 * under the repository being snapshotted -- and `git add -A` then picked up the
 * index file itself as an untracked file, so the tree identity differed from the
 * one computed the same way on restore. `--absolute-git-dir` because a relative
 * one is resolved against the caller's cwd, and a linked worktree's git dir is
 * elsewhere entirely.
 */
const isolatedIndex = (cwd: string, label: string): Record<string, string> => ({
  GIT_INDEX_FILE: join(
    gitOrThrow(cwd, ["rev-parse", "--absolute-git-dir"]).trim(),
    `de-checkpoint-index-${label}`,
  ),
});

const lines = (output: string): string[] =>
  output.split("\n").map((line) => line.trim()).filter((line) => line !== "");

/** NUL-separated, because a path may legitimately contain a newline. */
const zLines = (output: string): string[] => output.split("\0").filter((entry) => entry !== "");

const readNotes = (cwd: string): NotesRef[] =>
  lines(gitOrThrow(cwd, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/notes/"]))
    .map((line) => {
      const [ref, oid] = line.split(" ");
      return { ref: ref ?? "", oid: oid ?? null };
    })
    .filter((entry) => entry.ref !== "");

/**
 * Inside the workspace by lexical containment, with no filesystem call.
 *
 * `realpath` would resolve the link, which is the one thing #1034 forbids here:
 * "Never follow symlinks outside the workspace". A lexical check answers the
 * question without touching the target at all.
 */
const escapesWorkspace = (target: string, fromDir: string, root: string): boolean => {
  if (isAbsolute(target)) return !normalize(target).startsWith(root + sep);
  const landing = normalize(resolve(fromDir, target));
  return landing !== root && !landing.startsWith(root + sep);
};

const collectNewFiles = (
  cwd: string,
  exclude: ReadonlySet<string>,
  limitations: CheckpointLimitation[],
): NewFile[] => {
  const root = resolve(cwd);
  const untracked = zLines(gitOrThrow(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]));
  const files: NewFile[] = [];
  for (const path of untracked) {
    if (exclude.has(path)) continue;
    const absolute = join(root, path);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      limitations.push({ kind: "unreadable", detail: `${path}: ${(error as Error).message}` });
      continue;
    }
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(absolute);
      if (escapesWorkspace(target, dirname(absolute), root)) {
        // Recorded, not followed, and not silently dropped: a link out of the
        // workspace is a real part of what the solve left, and restoring it
        // blindly would reach outside the restored tree.
        limitations.push({ kind: "symlink_escape", detail: `${path} -> ${target}` });
        continue;
      }
      files.push({ path, kind: "symlink", mode: "120000", target });
      continue;
    }
    if (stat.size > NEW_FILE_LIMIT_BYTES) {
      limitations.push({ kind: "oversized", detail: `${path} is ${String(stat.size)} bytes` });
      continue;
    }
    files.push({
      path,
      kind: "file",
      // Only the executable bit is meaningful to git.
      mode: (stat.mode & 0o111) === 0 ? "100644" : "100755",
      base64: readFileSync(absolute).toString("base64"),
    });
  }
  return files;
};

const declareUnsupported = (cwd: string, limitations: CheckpointLimitation[]): void => {
  for (const entry of zLines(gitOrThrow(cwd, ["ls-files", "--stage", "-z"]))) {
    if (entry.startsWith("160000 ")) {
      limitations.push({ kind: "submodule", detail: entry.split("\t")[1] ?? entry });
    }
  }
  const attributes = gitOrThrow(cwd, ["ls-files", "--", ".gitattributes"]).trim();
  if (attributes !== "") {
    const text = readFileSync(join(cwd, ".gitattributes"), "utf8");
    if (/filter\s*=\s*lfs/.test(text)) {
      limitations.push({ kind: "lfs", detail: "the tree declares an lfs filter in .gitattributes" });
    }
  }
};

/**
 * Collect the first-solve state: HEAD, its reachable history, the notes refs as
 * they stand, both deltas, and the untracked files.
 *
 * Nothing here writes to the actor's index or worktree.
 */
export const takeCheckpoint = (options: TakeOptions): Checkpoint => {
  const { cwd, stage, outDir } = options;
  const exclude = new Set(options.exclude ?? []);
  const limitations: CheckpointLimitation[] = [];

  const head = gitOrThrow(cwd, ["rev-parse", "HEAD"]).trim();
  const notes = readNotes(cwd);

  const bundlePath = join(outDir, `${stage}-${head.slice(0, 12)}.bundle`);
  gitOrThrow(cwd, ["bundle", "create", bundlePath, "--all"]);

  const stagedPatch = gitOrThrow(cwd, ["diff", "--cached", ...DIFF_FLAGS, head]);
  const unstagedPatch = gitOrThrow(cwd, ["diff", ...DIFF_FLAGS]);

  declareUnsupported(cwd, limitations);
  const newFiles = collectNewFiles(cwd, exclude, limitations);

  // The worktree's identity, built in an index of our own. `add -A` respects
  // .gitignore, so this is the source tree as git sees it, and the actor's
  // index is not consulted or modified.
  const env = isolatedIndex(cwd, `${stage}-tree`);
  gitOrThrow(cwd, ["read-tree", head], { env });
  gitOrThrow(cwd, ["add", "-A"], { env });
  const worktreeTree = gitOrThrow(cwd, ["write-tree"], { env }).trim();
  rmSync(env["GIT_INDEX_FILE"]!, { force: true });

  return {
    stage,
    taken_at: (options.now?.() ?? new Date()).toISOString(),
    head,
    worktree_tree: worktreeTree,
    notes,
    bundle_path: bundlePath,
    staged_patch: stagedPatch,
    unstaged_patch: unstagedPatch,
    new_files: newFiles,
    limitations,
  };
};

/** A checkpoint is complete only when nothing was declared unsupported. */
export const checkpointStatusOf = (checkpoint: Checkpoint): "complete" | "incomplete" =>
  checkpoint.limitations.length === 0 ? "complete" : "incomplete";

export interface RestoreResult {
  readonly head: string;
  readonly worktree_tree: string;
  /** True when the restored tree identity equals the one recorded at collection. */
  readonly identity_matches: boolean;
  readonly notes: readonly NotesRef[];
  readonly limitations: readonly CheckpointLimitation[];
}

const applyPatch = (cwd: string, patch: string, args: readonly string[]): void => {
  // "Empty deltas are no-ops" -- git apply exits non-zero on an empty patch.
  if (patch.trim() === "") return;
  const result = git(cwd, ["apply", ...args], { input: patch });
  if (result.status !== 0) {
    throw new Error(`git apply ${args.join(" ")} exited ${String(result.status)}: ${result.stderr.trim()}`);
  }
};

const writeNewFile = (root: string, file: NewFile): void => {
  const absolute = join(root, file.path);
  mkdirSync(dirname(absolute), { recursive: true });
  if (file.kind === "symlink") {
    if (existsSync(absolute)) rmSync(absolute, { force: true });
    symlinkSync(file.target ?? "", absolute);
    return;
  }
  writeFileSync(absolute, Buffer.from(file.base64 ?? "", "base64"));
  if (file.mode === "100755") chmodSync(absolute, 0o755);
};

/**
 * Restore a checkpoint into an empty directory.
 *
 * Order follows #1034: HEAD and notes first, then the staged half with
 * `--index`, then the unstaged half, then the untracked payload. The build is
 * never attempted — restoring source that does not compile is the point, since
 * that failure can be the reason the repair exists.
 */
export const restoreCheckpoint = (checkpoint: Checkpoint, into: string): RestoreResult => {
  mkdirSync(into, { recursive: true });
  // The initial branch is a name the bundle cannot contain, and it stays
  // unborn. `git init` otherwise leaves HEAD on `main`, and git refuses to fetch
  // into the branch that is checked out -- so restoring a checkpoint whose
  // default branch happened to be `main`, which is every one of them, failed.
  gitOrThrow(into, ["init", "--quiet", "--initial-branch=de-checkpoint-restore-unborn"]);
  // Every ref, so the first solve's own commits and its note objects arrive
  // together. Fetching only the branch would restore the code and lose the
  // memory, which is the failure #1034 names.
  gitOrThrow(into, ["fetch", "--quiet", checkpoint.bundle_path, "+refs/*:refs/*"]);
  gitOrThrow(into, ["checkout", "--force", "--detach", checkpoint.head]);

  applyPatch(into, checkpoint.staged_patch, ["--index", "--whitespace=nowarn"]);
  applyPatch(into, checkpoint.unstaged_patch, ["--whitespace=nowarn"]);
  for (const file of checkpoint.new_files) writeNewFile(into, file);

  const env = isolatedIndex(into, "restored-tree");
  gitOrThrow(into, ["read-tree", checkpoint.head], { env });
  gitOrThrow(into, ["add", "-A"], { env });
  const worktreeTree = gitOrThrow(into, ["write-tree"], { env }).trim();
  rmSync(env["GIT_INDEX_FILE"]!, { force: true });

  return {
    head: gitOrThrow(into, ["rev-parse", "HEAD"]).trim(),
    worktree_tree: worktreeTree,
    identity_matches: worktreeTree === checkpoint.worktree_tree,
    notes: readNotes(into),
    limitations: checkpoint.limitations,
  };
};
