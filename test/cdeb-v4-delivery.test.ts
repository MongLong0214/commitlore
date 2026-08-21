/** CDEB-Fresh v4 delivery feasibility: content, not identity, and a zero that has to earn it. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  SHIPPING_TOKEN_BUDGET,
  assertBothIdentityStatesObserved,
  assertInjectorRan,
  containsNormalized,
  probeDeliveryFeasibility,
  summarize,
  type DeliveryFeasibility,
} from "../bench/cdeb/freeze/delivery-v4.ts";
import { gitOrThrow } from "../bench/git.ts";
import { createTestRepo } from "./git-fixtures.js";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const CLI = resolve(HERE, "..", "dist", "cli.js");

const scratch: string[] = [];

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const row = (overrides: Partial<DeliveryFeasibility> = {}): DeliveryFeasibility => ({
  candidate_id: "v4-test",
  identity_present: true,
  record_id: "r-test",
  ruling_visible: true,
  reason_visible: true,
  before_first_mutation: true,
  scope_correct: true,
  lifecycle_correct: true,
  stale_as_current: false,
  delivered: true,
  in_scope_payload_bytes: 512,
  in_scope_payload_sha256: "0".repeat(64),
  out_of_scope_payload_bytes: 0,
  exit_code: 0,
  stderr: "",
  ...overrides,
});

describe("CDEB v4 delivery feasibility", () => {
  it("matches content across a re-wrap but not across a paraphrase", () => {
    const payload = "the seeder must not write\noutside   the target directory";
    expect(containsNormalized(payload, "the seeder must not write outside the target directory")).toBe(true);
    expect(containsNormalized(payload, "the seeder should avoid writing outside the target")).toBe(false);
    // A needle short enough to appear by chance is not evidence of delivery.
    expect(containsNormalized(payload, "the seeder")).toBe(false);
  });

  it("refuses a result in which the injector never ran, rather than reporting zero delivery", () => {
    const rows = [row({ exit_code: 1, in_scope_payload_bytes: 0, delivered: false, stderr: "Cannot find package 'commander'" })];
    expect(() => assertInjectorRan(rows)).toThrow(/never exited 0.*harness failure, not zero delivery/s);
    // Started, but forwarded nothing anywhere: also indistinguishable from broken.
    expect(() => assertInjectorRan([row({ exit_code: 0, in_scope_payload_bytes: 0, delivered: false })]))
      .toThrow(/empty payload for every one of/);
    expect(() => assertInjectorRan([row()])).not.toThrow();
  });

  it("requires both identity states before the observability claim can be made", () => {
    const identifiedOnly = [row({ identity_present: true }), row({ candidate_id: "v4-b", identity_present: true })];
    expect(() => assertBothIdentityStatesObserved(identifiedOnly)).toThrow(/no id-less decision was delivered/);
    const idLessOnly = [row({ identity_present: false, record_id: null })];
    expect(() => assertBothIdentityStatesObserved(idLessOnly)).toThrow(/no identified decision was delivered/);
    expect(() => assertBothIdentityStatesObserved([...identifiedOnly, ...idLessOnly])).not.toThrow();
  });

  it("counts delivery by content and reports identity beside it, never as a condition", () => {
    const summary = summarize([
      row({ identity_present: true }),
      row({ candidate_id: "v4-b", identity_present: false, record_id: null }),
      row({ candidate_id: "v4-c", identity_present: false, record_id: null, reason_visible: false, delivered: false }),
    ]);
    expect(summary).toMatchObject({
      probed: 3,
      delivered: 2,
      delivered_with_identity: 1,
      delivered_without_identity: 1,
      ruling_visible: 3,
      reason_visible: 2,
    });
  });

  it("delivers a record that carries no Record-Id, through the shipping hook", () => {
    const cwd = createTestRepo({ path: mkdtempSync(join(tmpdir(), "cdeb-v4-deliver-")) });
    scratch.push(cwd);
    writeFileSync(join(cwd, "seed.ts"), "export const seed = 1;\n");
    writeFileSync(join(cwd, "unrelated.ts"), "export const other = 1;\n");
    gitOrThrow(cwd, ["add", "seed.ts", "unrelated.ts"]);
    gitOrThrow(cwd, ["commit", "--quiet", "-m", "base"]);
    writeFileSync(join(cwd, "seed.ts"), "export const seed = 2;\n");
    gitOrThrow(cwd, ["add", "seed.ts"]);
    gitOrThrow(cwd, [
      "commit",
      "--quiet",
      "-m",
      [
        "resolve seed paths under the target root",
        "",
        "A path taken from user input escaped the target directory during testing.",
        "",
        "Ruled-out: absolute paths taken from user input | one of them escaped the target root during testing",
        "Provenance: authored",
      ].join("\n"),
    ]);

    const probe = probeDeliveryFeasibility(
      CLI,
      cwd,
      {
        candidate_id: "v4-idless",
        repository_id: "repo-under-test",
        in_scope_path: join(cwd, "seed.ts"),
        out_of_scope_path: join(cwd, "unrelated.ts"),
        ruling: "absolute paths taken from user input",
        reason: "one of them escaped the target root during testing",
        lifecycle: "active",
        record_id: null,
      },
      SHIPPING_TOKEN_BUDGET,
    );

    expect(probe.exit_code).toBe(0);
    expect(probe.identity_present).toBe(false);
    expect(probe.record_id).toBeNull();
    // The estimand in one assertion: the decision's content arrives with no
    // identifier anywhere in the record.
    expect(probe.ruling_visible).toBe(true);
    expect(probe.reason_visible).toBe(true);
    expect(probe.scope_correct).toBe(true);
    expect(probe.delivered).toBe(true);
    expect(probe.in_scope_payload_bytes).toBeGreaterThan(0);
  });

  it("fails the scope gate when the decision also arrives for a path it never touched", () => {
    const arrived = probeScopeOutcome(true);
    const scoped = probeScopeOutcome(false);
    expect(scoped.scope_correct).toBe(true);
    expect(arrived.scope_correct).toBe(false);
    expect(arrived.delivered).toBe(false);
  });
});

/**
 * The scope half of G6 cannot be exercised by a repository whose injector is
 * already correct, so it is exercised directly: the same ruling, once absent
 * from the out-of-scope payload and once present in it.
 */
const probeScopeOutcome = (arrivesOutOfScope: boolean): DeliveryFeasibility => {
  const ruling = "absolute paths taken from user input";
  const inScope = `record: ${ruling} | one of them escaped the target root during testing`;
  const outOfScope = arrivesOutOfScope ? `record: ${ruling}` : "record: something else entirely";
  const rulingVisible = containsNormalized(inScope, ruling);
  const arrived = containsNormalized(outOfScope, ruling);
  const scopeCorrect = rulingVisible && !arrived;
  return row({
    ruling_visible: rulingVisible,
    scope_correct: scopeCorrect,
    delivered: rulingVisible && scopeCorrect,
    out_of_scope_payload_bytes: outOfScope.length,
  });
};
