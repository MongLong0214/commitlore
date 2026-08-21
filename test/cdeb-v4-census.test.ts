/** CDEB-Fresh v4 Stage 0 census: identity is metadata, and nothing is dropped silently. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  PENDING_GATES,
  RECORD_EXCLUSION_KINDS,
  assertRecordExclusionKindsCovered,
  enumerateRepositoryDecisions,
  type SnapshotEntry,
} from "../bench/cdeb/freeze/census-v4.ts";
import { gitOrThrow } from "../bench/git.ts";
import { createTestRepo } from "./git-fixtures.js";

const scratch: string[] = [];

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const repo = (label: string): string => {
  const path = createTestRepo({ path: mkdtempSync(join(tmpdir(), `cdeb-v4-${label}-`)) });
  scratch.push(path);
  return path;
};

const commit = (cwd: string, serial: number, message: string): string => {
  writeFileSync(join(cwd, "decision.ts"), `export const revision = ${String(serial)};\n`);
  gitOrThrow(cwd, ["add", "decision.ts"]);
  gitOrThrow(cwd, ["commit", "--quiet", "-m", message]);
  return gitOrThrow(cwd, ["rev-parse", "HEAD"]).trim();
};

const snapshotFor = (snapshotSha: string): SnapshotEntry => ({
  repository_id: "repo-under-test",
  snapshot_sha: snapshotSha,
  bundle_path: "bundles/repo-under-test.bundle",
  bundle_sha256: "0".repeat(64),
  snapshot_commit: snapshotSha,
  snapshot_tree_oid: "0".repeat(40),
  refs_included: [],
  refs_digest: "0".repeat(64),
  notes_refs_included: false,
  notes_ref_digest: "0".repeat(64),
  source_authorization_id: "auth-test",
});

const enumerate = (cwd: string, exclusions: readonly string[] = []) => {
  const snapshotSha = gitOrThrow(cwd, ["rev-parse", "HEAD"]).trim();
  return enumerateRepositoryDecisions({
    cwd,
    snapshot: snapshotFor(snapshotSha),
    exclusionIndex: new Set(exclusions),
  });
};

describe("CDEB v4 census", () => {
  it("enumerates a decision that carries no Record-Id at all", () => {
    const cwd = repo("id-less");
    commit(cwd, 1, "base");
    commit(
      cwd,
      2,
      ["seed under the target root", "", "Ruled-out: absolute paths from user input | one escaped the root in testing"].join("\n"),
    );

    const { candidates, census } = enumerate(cwd);
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    expect(candidate.record_id).toBeNull();
    expect(candidate.identity_present).toBe(false);
    // The whole point of v4: absent identity does not exclude, and does not admit.
    expect(candidate.qualification_status).toBe("pending");
    expect(candidate.ineligibility_codes).toEqual([]);
    expect(candidate.pending_gates).toEqual([...PENDING_GATES]);
    expect(census.identity_absent).toBe(1);
    expect(census.identity_present).toBe(0);
    expect(candidate.decision_audit_anchor).toMatch(/^[0-9a-f]{64}$/);
  });

  it("counts a record's rulings separately and anchors each one distinctly", () => {
    const cwd = repo("multi");
    commit(cwd, 1, "base");
    commit(
      cwd,
      2,
      [
        "rework the writer",
        "",
        "Ruled-out: a global cache | it leaks state across tenants",
        "Ruled-out: a per-request cache | the hit rate never justified the allocation",
        "Record-Id: r-multiruling",
        "Provenance: authored",
      ].join("\n"),
    );

    const { candidates, census } = enumerate(cwd);
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((candidate) => candidate.decision_audit_anchor)).size).toBe(2);
    expect(candidates.map((candidate) => candidate.decision_ordinal).sort()).toEqual([0, 1]);
    expect(candidates.every((candidate) => candidate.sibling_decision_count === 2)).toBe(true);
    // One record, two decisions: both counts are reported so the unit change is
    // visible instead of looking like the corpus grew.
    expect(census.records_with_explicit_reason).toBe(1);
    expect(census.decisions_enumerated).toBe(2);
  });

  it("enumerates a ruling that a squash merge left outside the record block", () => {
    const cwd = repo("squash");
    commit(cwd, 1, "base");
    commit(
      cwd,
      2,
      [
        "merge two lanes (#41)",
        "",
        "* first lane",
        "",
        "Ruled-out: extending the message TTL | it is replay protection, not an expiry knob",
        "",
        "* second lane",
        "",
        "Limit: field position is still the contract between the stub and its readers",
      ].join("\n"),
    );

    const { candidates, census } = enumerate(cwd);
    // The product's query reads the final trailer block, which holds no ruling.
    // The decision is still in the history, so the census keeps it and lets the
    // delivery gate decide -- it is not dropped at discovery.
    expect(census.decisions_in_record_blocks).toBe(0);
    expect(census.decisions_in_ordinary_source).toBe(1);
    const candidate = candidates[0]!;
    expect(candidate.storage_kind).toBe("ordinary-source");
    expect(candidate.storage_locator).toMatch(/^commit-body:[0-9a-f]{40}$/);
    expect(candidate.identity_present).toBe(false);
    expect(candidate.qualification_status).toBe("pending");
  });

  it("excludes a record the legacy index names, and only when the index names it", () => {
    const cwd = repo("legacy");
    commit(cwd, 1, "base");
    commit(
      cwd,
      2,
      [
        "close the unstageable path",
        "",
        "Ruled-out: staging by wildcard | it has twice committed files nobody wrote",
        "Record-Id: r-legacysource",
        "Provenance: authored",
      ].join("\n"),
    );

    // Arrival first: without the index entry the candidate is present and pending.
    const clean = enumerate(cwd);
    expect(clean.candidates).toHaveLength(1);
    expect(clean.candidates[0]!.qualification_status).toBe("pending");

    const excluded = enumerate(cwd, ["record-id r-legacysource"]);
    expect(excluded.candidates[0]!.qualification_status).toBe("ineligible");
    expect(excluded.candidates[0]!.ineligibility_codes).toEqual(["legacy-exclusion-match"]);
    expect(excluded.census.exclusion_reasons["legacy-exclusion-match"]).toBe(1);

    // Kind and value together: the same string under another kind is not a match.
    const wrongKind = enumerate(cwd, ["task-id r-legacysource"]);
    expect(wrongKind.candidates[0]!.qualification_status).toBe("pending");

    for (const kind of RECORD_EXCLUSION_KINDS) {
      expect(enumerate(cwd, [`${kind} r-legacysource`]).candidates[0]!.qualification_status).toBe("ineligible");
    }
  });

  it("refuses an exclusion index that names records under an unchecked kind", () => {
    expect(() => assertRecordExclusionKindsCovered([{ kind: "record-id", value: "r-known", reason: "x" }])).not.toThrow();
    expect(() => assertRecordExclusionKindsCovered([{ kind: "study-id", value: "cdeb-v1", reason: "x" }])).not.toThrow();
    expect(() =>
      assertRecordExclusionKindsCovered([{ kind: "retired-record", value: "r-invisible", reason: "x" }]),
    ).toThrow(/names records under kinds this census does not check: retired-record r-invisible/);
  });

  it("keeps a superseded decision and reports its lifecycle rather than filtering it", () => {
    const cwd = repo("superseded");
    commit(cwd, 1, "base");
    commit(
      cwd,
      2,
      [
        "first ruling",
        "",
        "Ruled-out: the polling loop | it burned a request per second with no backoff",
        "Record-Id: r-firstruling",
        "Provenance: authored",
      ].join("\n"),
    );
    commit(
      cwd,
      3,
      [
        "supersede the first ruling",
        "",
        "Ruled-out: the webhook fallback | the endpoint was not reachable from the runner",
        "Record-Id: r-secondruling",
        "Provenance: authored",
        "Supersedes: r-firstruling",
      ].join("\n"),
    );

    const { candidates, census } = enumerate(cwd);
    const superseded = candidates.filter((candidate) => candidate.lifecycle === "superseded");
    expect(superseded).toHaveLength(1);
    expect(superseded[0]!.record_id).toBe("r-firstruling");
    expect(census.lifecycle_counts.superseded).toBe(1);
    expect(census.lifecycle_counts.active).toBe(1);
  });

  it("drops nothing for a malformed ruling without saying so", () => {
    const cwd = repo("malformed");
    commit(cwd, 1, "base");
    commit(
      cwd,
      2,
      [
        "a ruling with no separator",
        "",
        "Ruled-out: this has no separator at all",
        "Record-Id: r-noseparator",
        "Provenance: authored",
      ].join("\n"),
    );

    const { candidates, census } = enumerate(cwd);
    // A ruling with no reason is not an explicit-reason decision, so it is not
    // in the universe at all -- and the record count shows it was seen.
    expect(candidates).toHaveLength(0);
    expect(census.records_examined).toBeGreaterThan(0);
    expect(census.records_with_explicit_reason).toBe(0);
  });
});
