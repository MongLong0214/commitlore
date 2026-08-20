import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  checkPairing,
  forbiddenInputViolations,
  loadRoleManifest,
  mandatoryRoleIds,
} from "../bench/cdeb/roles.js";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = resolve(HERE, "..");
const CDEB_ROOT = join(ROOT, "bench", "cdeb");
const STUDY_ROOT = join(CDEB_ROOT, "studies", "cdeb-fresh-v3");

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const copiedStudy = (): string => {
  const destination = mkdtempSync(join(tmpdir(), "cdeb-v3-roles-"));
  cpSync(STUDY_ROOT, destination, { recursive: true });
  return destination;
};

describe("CDEB-Fresh v3 role governance", () => {
  it("has a locked, byte-hashed prompt and manifest entry for every role in the PRD table", () => {
    const manifest = loadRoleManifest(STUDY_ROOT);
    const expected = mandatoryRoleIds(); // Parsed from PRD §3.4; no duplicate test-side role list.

    expect(manifest.roles.map((role) => role.role_id)).toEqual(expected);
    for (const role of manifest.roles) {
      expect(readFileSync(join(STUDY_ROOT, role.prompt_path))).toBeDefined();
      expect(role.prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("fails closed, naming the role, when prompt bytes drift from their lock", () => {
    const study = copiedStudy();
    const path = join(study, "roles", "gold-a.md");
    writeFileSync(path, `${readFileSync(path, "utf8")}x`, "utf8");

    expect(() => loadRoleManifest(study)).toThrow(/GOLD-A.*SHA-256 drift/);
  });

  it("keeps the five worked cards' forbidden inputs in their prompts", () => {
    const required: Record<string, readonly string[]> = {
      "GOLD-A": ["CommitLore records", "the other annotator's output", "task prompts", "arm results"],
      TASK: ["CommitLore record text", "rejected-approach answer", "oracle controls", "prior run results"],
      REDTEAM: ["arm labels", "agent trajectories", "treatment outcomes"],
      "STAT-B": ["STAT-A source or narrative", "desired headline", "README copy"],
      "PATCH-A": ["treatment arm", "CommitLore payload", "record IDs", "delivery log", "agent transcript"],
    };
    const manifest = loadRoleManifest(STUDY_ROOT);
    for (const [roleId, forbiddenInputs] of Object.entries(required)) {
      const role = manifest.roles.find((candidate) => candidate.role_id === roleId);
      expect(role, roleId).toBeDefined();
      const prompt = readFileSync(join(STUDY_ROOT, role!.prompt_path), "utf8");
      for (const input of forbiddenInputs) expect(prompt, `${roleId}: ${input}`).toContain(input);
    }
  });

  it("invalidates every same-session no-self-approval pair", () => {
    for (const [left, right] of [["TASK", "LEAK"], ["ORACLE", "REDTEAM"], ["STAT-A", "STAT-B"], ["PATCH-A", "PATCH-B"]] as const) {
      expect(checkPairing(left, right, { familyA: "a", familyB: "b", sessionA: "shared", sessionB: "shared" })).toMatchObject({
        kind: "same-session",
        consequence: "invalid",
      });
    }
  });

  it("records a same-family diversity breach as the required downgrade, not an error", () => {
    expect(checkPairing("GOLD-A", "GOLD-B", { familyA: "one", familyB: "one", sessionA: "a", sessionB: "b" })).toMatchObject({
      kind: "same-model-family",
      consequence: "downgrade",
      evidence_label: "single-family-internally-replicated",
    });
  });

  it("reports real offered-input leaks before a role receives them", () => {
    expect(forbiddenInputViolations("GOLD-A", ["source packet", "record payload"])).toContain("record payload");
    expect(forbiddenInputViolations("PATCH-A", ["blind task+diff+source summary", "arm label"])).toContain("arm");
  });

  it("schema-validates the manifest and rejects a PRD-table role omission", () => {
    const validator = new Ajv2020({ allErrors: true, strict: true }).compile(
      readJson(join(CDEB_ROOT, "schemas", "role-manifest.schema.json")),
    );
    expect(validator(readJson(join(STUDY_ROOT, "roles", "manifest.json")))).toBe(true);

    const study = copiedStudy();
    const manifestPath = join(study, "roles", "manifest.json");
    const manifest = readJson(manifestPath) as { roles: Array<{ role_id: string }> };
    const omitted = mandatoryRoleIds()[0]!;
    manifest.roles = manifest.roles.filter((role) => role.role_id !== omitted);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    expect(() => loadRoleManifest(study)).toThrow(new RegExp(`missing \\[${omitted}`));
  });

  it("rejects a manifest that softens a card's forbidden-input lock", () => {
    const study = copiedStudy();
    const manifestPath = join(study, "roles", "manifest.json");
    const manifest = readJson(manifestPath) as { roles: Array<{ role_id: string; forbidden_inputs: string[] }> };
    const gold = manifest.roles.find((role) => role.role_id === "GOLD-A")!;
    gold.forbidden_inputs = gold.forbidden_inputs.filter((input) => input !== "record payload");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    expect(() => loadRoleManifest(study)).toThrow(/GOLD-A prompt front matter does not match its manifest lock/);
  });
});
