/** CDEB-10 candidate enumeration: only mechanical facts may reject a record. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  enumerateCandidateRegistry,
  serializeCandidateRegistry,
} from "../bench/cdeb/freeze/candidate-registry.ts";
import { gitOrThrow } from "../bench/git.ts";
import { createTestRepo } from "./git-fixtures.js";

const scratch: string[] = [];

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const repo = (label: string): string => {
  const path = createTestRepo({ path: mkdtempSync(join(tmpdir(), `cdeb-registry-${label}-`)) });
  scratch.push(path);
  return path;
};

const commit = (cwd: string, serial: number, message: string): string => {
  writeFileSync(join(cwd, "decision.ts"), `export const revision = ${String(serial)};\n`);
  gitOrThrow(cwd, ["add", "decision.ts"]);
  gitOrThrow(cwd, ["commit", "--quiet", "-m", message]);
  return gitOrThrow(cwd, ["rev-parse", "HEAD"]).trim();
};

const ruledOutRecord = (id: string, ruledOut: string): string =>
  [
    "decision: retain the portable path",
    "",
    `Ruled-out: ${ruledOut}`,
    `Record-Id: ${id}`,
    "Provenance: authored",
  ].join("\n");

describe("CDEB-10 candidate registry", () => {
  it("keeps a post-cutoff record and names the cutoff rejection", () => {
    const cwd = repo("post-cutoff");
    commit(cwd, 1, "base");
    const snapshot = gitOrThrow(cwd, ["rev-parse", "HEAD"]).trim();
    commit(cwd, 2, ruledOutRecord("r-postcut1", "global cache | it leaks state across tenants"));

    const registry = enumerateCandidateRegistry({ cwd, repositoryId: "repo-a", snapshotRef: snapshot });
    const candidate = registry.candidates.find((entry) => entry.record_ids.includes("r-postcut1"));

    expect(candidate?.review_status).toBe("rejected");
    expect(candidate?.schema_version).toBe(1);
    expect(candidate?.benchmark).toBe("cdeb-v1");
    expect(candidate?.rejection_reason).toContain("after the frozen snapshot cutoff");
    expect(registry.census.rejection_reasons.after_snapshot_cutoff).toBe(1);
  });

  it("rejects a record without an explicit rejection reason and retains it", () => {
    const cwd = repo("missing-reason");
    const snapshot = commit(cwd, 1, ruledOutRecord("r-noreason1", "global cache"));

    const registry = enumerateCandidateRegistry({ cwd, repositoryId: "repo-a", snapshotRef: snapshot });
    const candidate = registry.candidates.find((entry) => entry.record_ids.includes("r-noreason1"));

    expect(candidate).toMatchObject({
      eligibility: { explicit_rejection_reason: false },
      review_status: "rejected",
    });
    expect(candidate?.rejection_reason).toContain("lacks an explicit Ruled-out alternative and rejection reason");
    expect(registry.census.rejection_reasons.missing_explicit_rejection_reason).toBe(1);
    expect(registry.census.candidates_reported).toBe(1);
  });

  it("produces byte-identical YAML for unchanged history", () => {
    const cwd = repo("deterministic");
    const snapshot = commit(
      cwd,
      1,
      ruledOutRecord("r-stable01", "global cache | it leaks state across tenants"),
    );
    const options = { cwd, repositoryId: "repo-a", snapshotRef: snapshot };

    expect(serializeCandidateRegistry(enumerateCandidateRegistry(options))).toBe(
      serializeCandidateRegistry(enumerateCandidateRegistry(options)),
    );
  });

  it("never counts human-only fields as eligible", () => {
    const cwd = repo("undecided");
    const snapshot = commit(
      cwd,
      1,
      ruledOutRecord("r-undecid", "global cache | it leaks state across tenants"),
    );

    const registry = enumerateCandidateRegistry({ cwd, repositoryId: "repo-a", snapshotRef: snapshot });
    expect(registry.candidates[0]?.eligibility.wrong_path_functionally_viable).toBe("undecided");
    expect(registry.candidates[0]?.review_status).toBe("rejected");
    expect(registry.census.eligible).toBe(0);
    expect(registry.census.blocked_on_human_review).toBe(1);
  });

  it("rejects reconstructed records as synthetic or backfilled", () => {
    const cwd = repo("reconstructed");
    const snapshot = commit(
      cwd,
      1,
      [
        "decision: preserve the original rationale",
        "",
        "Ruled-out: global cache | it leaks state across tenants",
        "Record-Id: r-backfill1",
        "Provenance: reconstructed",
      ].join("\n"),
    );

    const registry = enumerateCandidateRegistry({ cwd, repositoryId: "repo-a", snapshotRef: snapshot });
    const candidate = registry.candidates[0];

    expect(candidate?.natural_record).toBe(false);
    expect(candidate?.rejection_reason).toContain("synthetic or backfilled");
    expect(registry.census.rejection_reasons.synthetic_or_backfilled_record).toBe(1);
  });

  it("refuses a fork source whose decision author is not authorized", () => {
    const cwd = repo("fork-author");
    const snapshot = commit(
      cwd,
      1,
      ruledOutRecord("r-forkauth", "global cache | it leaks state across tenants"),
    );

    const registry = enumerateCandidateRegistry({
      cwd,
      repositoryId: "forked-repo",
      snapshotRef: snapshot,
      requireAuthorizedDecisionAuthor: true,
      authorizedDecisionAuthors: ["Owner <owner@example.invalid>"],
    });

    expect(registry.candidates[0]?.review_status).toBe("rejected");
    expect(registry.candidates[0]?.rejection_reason).toContain("not covered by the supplied source authorization");
    expect(registry.census.rejection_reasons.source_authorization_unverified).toBe(1);
  });

  it("excludes CommitLore repository decisions regardless of record content", () => {
    const cwd = repo("commitlore");
    const snapshot = commit(
      cwd,
      1,
      ruledOutRecord("r-product01", "global cache | it leaks state across tenants"),
    );

    const registry = enumerateCandidateRegistry({
      cwd,
      repositoryId: "commitlore",
      snapshotRef: snapshot,
    });
    const candidate = registry.candidates[0];

    expect(candidate?.review_status).toBe("rejected");
    expect(candidate?.rejection_reason).toContain("CommitLore repository decisions are excluded");
    expect(registry.census.rejection_reasons.commitlore_repository).toBe(1);
  });
});
