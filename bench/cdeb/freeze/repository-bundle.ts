/**
 * CDEB-02: frozen repository bundles, and the proof that two materializations
 * of one are the same repository (PRD §6).
 *
 * Every CDEB comparison rests on one invariant: the ON and OFF arms of a
 * task/repeat pair see **byte-identical repository state**, and the only
 * difference between the arms is the frozen agent settings. This module owns
 * that invariant end to end — creating the bundle, materializing it offline,
 * and computing the identity digests both arms are compared by.
 *
 * Deliberately new code. `bench/workspace.ts` builds synthetic workspaces and,
 * with `seedRecords: false`, strips the trailer block out of seeded commits —
 * exactly the control construction §6.3 prohibits ("OFF에서 CommitLore
 * trailers 제거"). Nothing here imports it, and a mutation test in
 * `test/cdeb-materializer.test.ts` proves a trailer-stripped history cannot
 * pass the digest comparison.
 *
 * Digest boundaries, stated because they are load-bearing (PRD v1.2 §6.2):
 * the identity covers commits, trees, refs and the notes mirror. It excludes
 * `.git/` internal product state — the CommitLore index and MCP lifecycle log
 * live under `.git/commitlore/`, are created lazily by the product on first
 * use, and must not make an ON materialization "differ" from an OFF one that
 * has not been queried yet.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { git, gitOrThrow } from "../../git.ts";

export const NOTES_REF = "refs/notes/commitlore";

/** Branch name the snapshot is bundled under; temporary in the source. */
export const BUNDLE_REF_NAME = "cdeb-snapshot";

/** The §6.1 identity of a frozen bundle. */
export interface RepositoryBundleIdentity {
  readonly repository_id: string;
  readonly bundle_sha256: string;
  readonly snapshot_commit: string;
  readonly snapshot_tree_oid: string;
  readonly refs_digest: string;
  readonly notes_ref_digest: string;
  /** `git bundle list-heads` lines, sorted and retained in the freeze manifest. */
  readonly refs_included: readonly string[];
  readonly notes_refs_included: boolean;
}

/** The §6.2 identity of one materialized working copy. */
export interface MaterializedIdentity {
  readonly head: string;
  readonly base_tree_oid: string;
  readonly commit_message_digest: string;
  readonly refs_digest: string;
  readonly notes_ref_digest: string;
  readonly working_tree_source_digest: string;
}

const sha256 = (input: string | Buffer): string =>
  createHash("sha256").update(input).digest("hex");

const sha256File = (path: string): string => sha256(readFileSync(path));

/**
 * Every ref the repository carries, as `sha ref` lines sorted by ref name.
 * `for-each-ref` rather than `show-ref` so an empty result is an answer, and
 * sorted so the digest does not depend on enumeration order.
 *
 * `refs/remotes/` is excluded: a materialization keeps the bundle under an
 * origin remote as an artefact of how it was cloned, and that is a property of
 * the transport rather than of the repository the arms are supposed to share.
 */
const refsListing = (cwd: string): string =>
  gitOrThrow(cwd, [
    "for-each-ref",
    "--format=%(objectname) %(refname)",
    "--sort=refname",
    "refs/heads",
    "refs/tags",
    "refs/notes",
  ]);

/** The refs a bundle actually carries, read back out of the bundle itself. */
const bundledRefLines = (cwd: string, bundlePath: string): string[] =>
  gitOrThrow(cwd, ["bundle", "list-heads", bundlePath])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .sort();

const notesTip = (cwd: string): string => {
  const result = git(cwd, ["rev-parse", "--verify", "--quiet", NOTES_REF]);
  return result.status === 0 ? result.stdout.trim() : "absent";
};

/**
 * Every commit message reachable from the snapshot, in a stable order.
 *
 * This is the digest that catches §6.3's prohibited constructions directly: a
 * history whose trailers were stripped, or whose messages were rewritten,
 * changes every descendant sha — but comparing messages by content names the
 * *kind* of divergence instead of only that one exists, and it holds even if
 * someone constructs colliding-sha trickery at the ref level.
 */
const commitMessageDigest = (cwd: string, snapshot: string): string =>
  sha256(gitOrThrow(cwd, ["log", "--format=%H%x00%B%x01", snapshot]));

/**
 * The working tree's content identity, from the index git itself builds for
 * the checkout. `git ls-files -s` covers tracked content (mode, oid, path);
 * a detached checkout of a frozen snapshot has no untracked files by
 * construction, and §6.2 v1.2 excludes `.git/` internals, which ls-files never
 * sees.
 */
const workingTreeDigest = (cwd: string): string =>
  sha256(gitOrThrow(cwd, ["ls-files", "-s"]));

/**
 * Creates the frozen bundle for a repository at an exact snapshot.
 *
 * **The bundle carries the snapshot and the notes mirror, and nothing else.**
 * `--all` was the obvious spelling and is wrong here: it packs every branch in
 * the source, so a materialization would hand the agent `git show
 * other-branch:path` over work the study is supposed to have sealed. Caught
 * before any run — bundling this repository's own HEAD while the pilot's tasks
 * and oracles sat on that branch would have put the answers inside the tree the
 * agent was being measured in.
 *
 * The notes ref is named explicitly because `git bundle create` includes
 * `refs/notes/*` only when the source's config fetches them, and a bundle that
 * silently dropped the mirror would materialize a repository where every
 * notes-sourced record is simply absent — an OFF arm by accident.
 */
export const createRepositoryBundle = (
  repositoryId: string,
  sourceCwd: string,
  bundlePath: string,
  snapshotRef = "HEAD",
): RepositoryBundleIdentity => {
  const absoluteBundlePath = resolve(bundlePath);
  mkdirSync(join(absoluteBundlePath, ".."), { recursive: true });
  const snapshot = gitOrThrow(sourceCwd, ["rev-parse", `${snapshotRef}^{commit}`]).trim();

  // `git bundle create <out> <snapshot_sha>` cannot advertise a bare SHA as a
  // bundle head: Git refuses that empty ref set.  Do not manufacture the
  // needed ref in a measured repository.  Instead make a disposable bare
  // mirror, add the one advertised snapshot ref there, and delete the mirror
  // afterwards.  The source is read only: no checkout, fetch, worktree, ref,
  // config, or index mutation is performed in it.
  const tempRef = `refs/heads/${BUNDLE_REF_NAME}`;
  const staging = mkdtempSync(join(tmpdir(), "cdeb-bundle-"));
  try {
    // --mirror brings the explicit notes ref into the disposable clone; only
    // `tempRef` and `NOTES_REF` are subsequently written to the bundle.
    gitOrThrow(tmpdir(), ["clone", "--quiet", "--mirror", "--no-local", sourceCwd, staging]);
    gitOrThrow(staging, ["update-ref", tempRef, snapshot]);
    const refs = [tempRef];
    const notesRefIncluded = notesTip(staging) !== "absent";
    if (notesRefIncluded) refs.push(NOTES_REF);
    gitOrThrow(staging, ["bundle", "create", absoluteBundlePath, ...refs]);
    gitOrThrow(staging, ["bundle", "verify", absoluteBundlePath]);
    const refsIncluded = bundledRefLines(staging, absoluteBundlePath);
    return {
      repository_id: repositoryId,
      bundle_sha256: sha256File(absoluteBundlePath),
      snapshot_commit: snapshot,
      snapshot_tree_oid: gitOrThrow(staging, ["rev-parse", `${snapshot}^{tree}`]).trim(),
      refs_digest: sha256(refsIncluded.join("\n")),
      notes_ref_digest: sha256(notesTip(staging)),
      refs_included: refsIncluded,
      notes_refs_included: notesRefIncluded,
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
};

/**
 * Materializes a frozen bundle into a fresh working copy, offline, and
 * verifies every §6.1 identity before handing it over.
 *
 * A mismatch is a throw, not a warning: a materialization whose digests do not
 * match the freeze is not "a repository with a caveat", it is a different
 * repository, and running an arm in it would compare two experiments while
 * calling them one (§6.2).
 */
export const materializeBundle = (
  identity: RepositoryBundleIdentity,
  bundlePath: string,
  targetDir: string,
): MaterializedIdentity => {
  if (!existsSync(bundlePath)) {
    throw new Error(`materialize: bundle ${bundlePath} is missing`);
  }
  const actualBundle = sha256File(bundlePath);
  if (actualBundle !== identity.bundle_sha256) {
    throw new Error(
      `materialize: bundle digest ${actualBundle} does not match the frozen ${identity.bundle_sha256}`,
    );
  }

  const actualRefs = bundledRefLines(dirname(resolve(bundlePath)), resolve(bundlePath));
  const actualRefsDigest = sha256(actualRefs.join("\n"));
  if (actualRefsDigest !== identity.refs_digest || actualRefs.join("\n") !== identity.refs_included.join("\n")) {
    throw new Error("materialize: bundle refs do not match the frozen manifest");
  }
  const actualNotesIncluded = actualRefs.some((ref) => ref.endsWith(` ${NOTES_REF}`));
  if (actualNotesIncluded !== identity.notes_refs_included) {
    throw new Error("materialize: bundle notes-ref policy does not match the frozen manifest");
  }

  mkdirSync(targetDir, { recursive: true });
  gitOrThrow(targetDir, ["clone", "--quiet", "--no-hardlinks", bundlePath, "."]);
  // Detach before restoring local refs: git refuses to fetch into the branch
  // the clone checked out, and the materialization never works on a branch
  // anyway — the contract is a detached checkout of the exact snapshot.
  gitOrThrow(targetDir, ["checkout", "--quiet", "--detach", identity.snapshot_commit]);
  // The clone maps bundle refs under the origin remote; the comparison needs
  // them local, exactly as the source had them.
  gitOrThrow(targetDir, ["fetch", "--quiet", "origin", "+refs/*:refs/*"]);

  const materialized = identityOfMaterialization(targetDir, identity.snapshot_commit);

  if (materialized.head !== identity.snapshot_commit) {
    throw new Error(`materialize: HEAD ${materialized.head} is not the frozen snapshot`);
  }
  if (materialized.base_tree_oid !== identity.snapshot_tree_oid) {
    throw new Error(`materialize: tree ${materialized.base_tree_oid} is not the frozen tree`);
  }
  if (materialized.notes_ref_digest !== identity.notes_ref_digest) {
    throw new Error(
      "materialize: the notes mirror does not match the freeze — a repository without its records is a different repository",
    );
  }

  return materialized;
};

/** The §6.2 identity of an existing materialization, for arm comparison. */
export const identityOfMaterialization = (cwd: string, snapshot: string): MaterializedIdentity => ({
  head: gitOrThrow(cwd, ["rev-parse", "HEAD"]).trim(),
  base_tree_oid: gitOrThrow(cwd, ["rev-parse", "HEAD^{tree}"]).trim(),
  commit_message_digest: commitMessageDigest(cwd, snapshot),
  refs_digest: sha256(refsListing(cwd)),
  notes_ref_digest: sha256(notesTip(cwd)),
  working_tree_source_digest: workingTreeDigest(cwd),
});

/**
 * The same-history gate: every field of the two arms' identities must be
 * equal, and the answer names each field that is not. Returns the mismatched
 * field names — an empty array is the invariant holding.
 */
export const sameHistoryMismatches = (
  on: MaterializedIdentity,
  off: MaterializedIdentity,
): string[] =>
  (Object.keys(on) as (keyof MaterializedIdentity)[]).filter((key) => on[key] !== off[key]);
