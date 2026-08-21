/** CDEB-Fresh v4 provenance audit: the reviewer's evidence, and what it must never contain. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  assertPacketsCarryNoAnchor,
  assertRedactionDidWork,
  auditRepository,
  type ProvenanceAuditEntry,
} from "../bench/cdeb/freeze/provenance-v4.ts";
import { enumerateRepositoryDecisions, type SnapshotEntry } from "../bench/cdeb/freeze/census-v4.ts";
import { gitOrThrow } from "../bench/git.ts";
import { createTestRepo } from "./git-fixtures.js";

const scratch: string[] = [];

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const repo = (label: string): string => {
  const path = createTestRepo({ path: mkdtempSync(join(tmpdir(), `cdeb-v4p-${label}-`)) });
  scratch.push(path);
  return path;
};

const commit = (cwd: string, serial: number, message: string): void => {
  writeFileSync(join(cwd, "decision.ts"), `export const revision = ${String(serial)};\n`);
  gitOrThrow(cwd, ["add", "decision.ts"]);
  gitOrThrow(cwd, ["commit", "--quiet", "-m", message]);
};

const snapshotFor = (cwd: string): SnapshotEntry => ({
  repository_id: "repo-under-test",
  snapshot_sha: gitOrThrow(cwd, ["rev-parse", "HEAD"]).trim(),
  bundle_path: "bundles/repo-under-test.bundle",
  bundle_sha256: "0".repeat(64),
  snapshot_commit: gitOrThrow(cwd, ["rev-parse", "HEAD"]).trim(),
  snapshot_tree_oid: "0".repeat(40),
  refs_included: [],
  refs_digest: "0".repeat(64),
  notes_refs_included: false,
  notes_ref_digest: "0".repeat(64),
  source_authorization_id: "auth-test",
});

const audit = (cwd: string): ProvenanceAuditEntry[] => {
  const snapshot = snapshotFor(cwd);
  const { candidates } = enumerateRepositoryDecisions({ cwd, snapshot, exclusionIndex: new Set() });
  return auditRepository(cwd, snapshot, candidates);
};

describe("CDEB v4 provenance audit", () => {
  it("keeps the prose a record was written from and removes the record itself", () => {
    const cwd = repo("redact");
    commit(cwd, 1, "base");
    commit(
      cwd,
      2,
      [
        "resolve seed paths under the target root",
        "",
        "A path taken from user input escaped the target directory during testing, which",
        "would have let a template write anywhere the process could reach.",
        "",
        "Ruled-out: absolute paths from user input | one escaped the root in testing",
        "Record-Id: r-seedpaths",
        "Provenance: authored",
      ].join("\n"),
    );

    const [entry] = audit(cwd);
    expect(entry).toBeDefined();
    expect(entry!.ordinary_source).toContain("escaped the target directory during testing");
    // The record is gone, including the ruling the reviewer must not be shown.
    expect(entry!.ordinary_source).not.toContain("Record-Id");
    expect(entry!.ordinary_source).not.toContain("Ruled-out");
    expect(entry!.removed_trailer_count).toBeGreaterThan(0);
    expect(entry!.ordinary_body_survives).toBe(true);
    expect(entry!.mechanical_exclusion).toBeNull();
    expect(entry!.g1_natural_provenance).toBe(true);
    expect(entry!.g2_mechanical).toBe(true);
    expect(entry!.provenance_tier).toBe("pending");
    expect(entry!.files_changed).toBe(1);
    expect(entry!.changed_paths).toEqual(["decision.ts"]);
  });

  it("names an empty packet rather than passing a record with no prose behind it", () => {
    const cwd = repo("empty");
    commit(cwd, 1, "base");
    commit(
      cwd,
      2,
      [
        "tighten the writer",
        "",
        "Ruled-out: a global cache | it leaks state across tenants",
        "Record-Id: r-nobody",
        "Provenance: authored",
      ].join("\n"),
    );

    const [entry] = audit(cwd);
    // Subject plus a record and nothing else: there is no independent source to
    // review, so the candidate cannot be qualified on ordinary evidence.
    expect(entry!.ordinary_body_survives).toBe(false);
    expect(entry!.mechanical_exclusion).toBe("source-packet-empty");
    expect(entry!.provenance_tier).toBe("unsupported");
    expect(entry!.g2_mechanical).toBe(false);
  });

  it("excludes a record the product itself calls reconstructed", () => {
    const cwd = repo("reconstructed");
    commit(cwd, 1, "base");
    commit(
      cwd,
      2,
      [
        "restate an old ruling",
        "",
        "The original decision was made before records existed here, and this commit",
        "writes it down after the fact.",
        "",
        "Ruled-out: the polling loop | it burned a request per second with no backoff",
        "Record-Id: r-restated",
        "Provenance: reconstructed",
      ].join("\n"),
    );

    const [entry] = audit(cwd);
    expect(entry!.benchmark_authored).toBe(true);
    expect(entry!.g1_natural_provenance).toBe(false);
    expect(entry!.mechanical_exclusion).toBe("benchmark-authored");
  });

  it("refuses a packet carrying the benchmark's own key", () => {
    const cwd = repo("anchor");
    commit(cwd, 1, "base");
    commit(
      cwd,
      2,
      [
        "a decision with prose",
        "",
        "The reasoning is written out here so the packet is not empty.",
        "",
        "Ruled-out: the shortcut | it silently dropped the error path",
        "Record-Id: r-anchorleak",
        "Provenance: authored",
      ].join("\n"),
    );

    const entries = audit(cwd);
    expect(() => assertPacketsCarryNoAnchor(entries)).not.toThrow();
    const leaked = entries.map((entry) => ({
      ...entry,
      ordinary_source: `${entry.ordinary_source}\n<!-- ${entry.decision_audit_anchor} -->`,
    }));
    expect(() => assertPacketsCarryNoAnchor(leaked)).toThrow(/decision anchor exposure/);
  });

  it("refuses to report a clean redaction that never removed anything", () => {
    const cwd = repo("inert");
    commit(cwd, 1, "base");
    commit(
      cwd,
      2,
      [
        "a decision with prose",
        "",
        "The reasoning is written out here so the packet is not empty.",
        "",
        "Ruled-out: the shortcut | it silently dropped the error path",
        "Record-Id: r-inertcheck",
        "Provenance: authored",
      ].join("\n"),
    );

    const entries = audit(cwd);
    const ids = new Set(entries.map((entry) => entry.candidate_id));
    expect(() => assertRedactionDidWork(entries, ids)).not.toThrow();
    // A redaction that removed nothing makes every "no leak" result below
    // meaningless, so it is a failure rather than a clean pass.
    const inert = entries.map((entry) => ({ ...entry, removed_trailer_count: 0 }));
    expect(() => assertRedactionDidWork(inert, ids)).toThrow(/the redaction is inert/);
    // An ordinary-source candidate has no trailer to remove, and an audit made
    // only of those is not evidence the redaction broke.
    expect(() => assertRedactionDidWork(inert, new Set())).not.toThrow();
  });
});
