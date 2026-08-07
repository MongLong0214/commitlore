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
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { git, gitOrThrow } from "../../git.ts";

export const NOTES_REF = "refs/notes/commitlore";

/** The §6.1 identity of a frozen bundle. */
export interface RepositoryBundleIdentity {
  readonly repository_id: string;
  readonly bundle_sha256: string;
  readonly snapshot_commit: string;
  readonly snapshot_tree_oid: string;
  readonly refs_digest: string;
  readonly notes_ref_digest: string;
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
 */
const refsListing = (cwd: string): string =>
  gitOrThrow(cwd, ["for-each-ref", "--format=%(objectname) %(refname)", "--sort=refname"]);

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
 * `--all` plus the notes ref explicitly: `git bundle create --all` includes
 * `refs/notes/*` only when the repository's config fetches them, and a bundle
 * that silently dropped the mirror would materialize into a repository where
 * every notes-sourced record simply does not exist — an OFF arm by accident.
 */
export const createRepositoryBundle = (
  repositoryId: string,
  sourceCwd: string,
  bundlePath: string,
): RepositoryBundleIdentity => {
  mkdirSync(join(bundlePath, ".."), { recursive: true });
  const refs = ["--all"];
  if (notesTip(sourceCwd) !== "absent") refs.push(NOTES_REF);
  gitOrThrow(sourceCwd, ["bundle", "create", bundlePath, ...refs]);
  gitOrThrow(sourceCwd, ["bundle", "verify", bundlePath]);

  const snapshot = gitOrThrow(sourceCwd, ["rev-parse", "HEAD"]).trim();
  return {
    repository_id: repositoryId,
    bundle_sha256: sha256File(bundlePath),
    snapshot_commit: snapshot,
    snapshot_tree_oid: gitOrThrow(sourceCwd, ["rev-parse", `${snapshot}^{tree}`]).trim(),
    refs_digest: sha256(refsListing(sourceCwd)),
    notes_ref_digest: sha256(notesTip(sourceCwd)),
  };
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
