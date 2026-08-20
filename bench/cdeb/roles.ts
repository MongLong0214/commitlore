import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { load } from "js-yaml";

const CDEB_ROOT = new URL(".", import.meta.url).pathname;
const ROLE_MANIFEST_SCHEMA = join(CDEB_ROOT, "schemas", "role-manifest.schema.json");
const PRD_PATH = join(CDEB_ROOT, "PRD.md");
const DEFAULT_STUDY_DIR = join(CDEB_ROOT, "studies", "cdeb-fresh-v3");

export interface RoleLock {
  readonly role_id: string;
  readonly prompt_path: string;
  readonly version: number;
  readonly prompt_sha256: string;
  readonly allowed_inputs: readonly string[];
  readonly forbidden_inputs: readonly string[];
  readonly output_schema: string | null;
  readonly stop_conditions: readonly string[];
}

export interface RoleManifest {
  readonly schema_version: 1;
  readonly roles: readonly RoleLock[];
}

export interface PairConstraint {
  readonly roles: readonly [string, string];
  readonly requirement: "different-model-family" | "different-session";
  readonly consequence: "downgrade" | "invalid";
  readonly evidence_label?: "single-family-internally-replicated";
  readonly detail: string;
}

export interface PairingViolation {
  readonly constraint: PairConstraint;
  readonly kind: "same-session" | "same-model-family";
  readonly consequence: "downgrade" | "invalid";
  readonly evidence_label?: "single-family-internally-replicated";
}

/** §3.5 diversity constraints and §3.8 no-self-approval constraints. */
export const PAIR_CONSTRAINTS: readonly PairConstraint[] = [
  {
    roles: ["GOLD-A", "GOLD-B"],
    requirement: "different-model-family",
    consequence: "downgrade",
    evidence_label: "single-family-internally-replicated",
    detail: "§3.5 requires GOLD-A and GOLD-B to use different model families.",
  },
  {
    roles: ["ORACLE", "REDTEAM"],
    requirement: "different-model-family",
    consequence: "downgrade",
    evidence_label: "single-family-internally-replicated",
    detail: "§3.5 requires ORACLE and REDTEAM to use different model families.",
  },
  {
    roles: ["STAT-A", "STAT-B"],
    requirement: "different-model-family",
    consequence: "downgrade",
    evidence_label: "single-family-internally-replicated",
    detail: "§3.5 allows independent language implementations as an alternative; this family-only API records a same-family downgrade.",
  },
  {
    roles: ["PATCH-A", "PATCH-B"],
    requirement: "different-model-family",
    consequence: "downgrade",
    evidence_label: "single-family-internally-replicated",
    detail: "§3.5 requires PATCH-A and PATCH-B to use different model families.",
  },
  {
    roles: ["TASK", "LEAK"],
    requirement: "different-session",
    consequence: "invalid",
    detail: "§3.8 forbids a task author from approving its own leakage audit.",
  },
  {
    roles: ["ORACLE", "REDTEAM"],
    requirement: "different-session",
    consequence: "invalid",
    detail: "§3.8 forbids an oracle engineer from red-teaming its own oracle.",
  },
  {
    roles: ["STAT-A", "STAT-B"],
    requirement: "different-session",
    consequence: "invalid",
    detail: "§3.8 forbids a primary statistician from independently reproducing itself.",
  },
  {
    roles: ["PATCH-A", "PATCH-B"],
    requirement: "different-session",
    consequence: "invalid",
    detail: "§3.8 forbids reviewer A from acting as reviewer B in the same session.",
  },
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sameStringArray = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const schemaValidator = (() => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return ajv.compile(JSON.parse(readFileSync(ROLE_MANIFEST_SCHEMA, "utf8")));
})();

const validationMessage = (): string =>
  schemaValidator.errors?.map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`).join("; ") ?? "invalid";

const roleIdsFromPrd = (): string[] => {
  const prd = readFileSync(PRD_PATH, "utf8");
  const start = prd.indexOf("### 3.4 Mandatory roles");
  const end = prd.indexOf("### 3.5 Model-family requirement", start);
  if (start < 0 || end < 0) throw new Error(`Cannot read mandatory roles from ${PRD_PATH}`);
  const ids = [...prd.slice(start, end).matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]!);
  if (ids.length === 0) throw new Error(`No mandatory roles found in ${PRD_PATH}`);
  return ids;
};

/** The PRD table, not a second hand-maintained role list, is the completeness authority. */
export const mandatoryRoleIds = (): readonly string[] => roleIdsFromPrd();

const parseFrontMatter = (path: string, bytes: Buffer): Record<string, unknown> => {
  const match = bytes.toString("utf8").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (match?.[1] === undefined) throw new Error(`Role prompt ${path} has no YAML front matter`);
  const parsed = load(match[1]);
  if (!isRecord(parsed)) throw new Error(`Role prompt ${path} front matter is not an object`);
  return parsed;
};

const stringArray = (value: unknown, field: string, roleId: string): readonly string[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Role ${roleId} prompt lock has invalid ${field}`);
  }
  return value;
};

const assertPromptLockMatches = (role: RoleLock, path: string, bytes: Buffer): void => {
  const frontMatter = parseFrontMatter(path, bytes);
  const matches =
    frontMatter.role_id === role.role_id &&
    frontMatter.version === role.version &&
    sameStringArray(stringArray(frontMatter.allowed_inputs, "allowed_inputs", role.role_id), role.allowed_inputs) &&
    sameStringArray(stringArray(frontMatter.forbidden_inputs, "forbidden_inputs", role.role_id), role.forbidden_inputs) &&
    frontMatter.output_schema === role.output_schema &&
    sameStringArray(stringArray(frontMatter.stop_conditions, "stop_conditions", role.role_id), role.stop_conditions);
  if (!matches) throw new Error(`Role ${role.role_id} prompt front matter does not match its manifest lock`);
};

const assertComplete = (roles: readonly RoleLock[]): void => {
  const expected = roleIdsFromPrd();
  const actual = roles.map((role) => role.role_id);
  const duplicates = actual.filter((id, index) => actual.indexOf(id) !== index);
  const missing = expected.filter((id) => !actual.includes(id));
  const unexpected = actual.filter((id) => !expected.includes(id));
  if (duplicates.length > 0 || missing.length > 0 || unexpected.length > 0) {
    throw new Error(`Incomplete role manifest: missing [${missing.join(", ")}]; unexpected [${unexpected.join(", ")}]; duplicates [${duplicates.join(", ")}]`);
  }
};

/** Parses, schema-validates, completeness-checks, and byte-verifies every locked prompt. */
export const loadRoleManifest = (studyDir: string): RoleManifest => {
  const manifestPath = join(studyDir, "roles", "manifest.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read role manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!schemaValidator(manifest)) throw new Error(`Invalid role manifest: ${validationMessage()}`);
  const typed = manifest as RoleManifest;
  assertComplete(typed.roles);
  for (const role of typed.roles) {
    const expectedPath = `roles/${role.role_id.toLowerCase()}.md`;
    if (role.prompt_path !== expectedPath) throw new Error(`Role ${role.role_id} prompt_path must be ${expectedPath}`);
    const promptPath = join(studyDir, role.prompt_path);
    let bytes: Buffer;
    try {
      bytes = readFileSync(promptPath);
    } catch (error) {
      throw new Error(`Role ${role.role_id} cannot read prompt ${promptPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const actual = sha256(bytes);
    if (actual !== role.prompt_sha256) {
      throw new Error(`Role ${role.role_id} prompt SHA-256 drift: expected ${role.prompt_sha256}, found ${actual}`);
    }
    assertPromptLockMatches(role, promptPath, bytes);
  }
  return typed;
};

const samePair = (constraint: PairConstraint, roleA: string, roleB: string): boolean =>
  (constraint.roles[0] === roleA && constraint.roles[1] === roleB) ||
  (constraint.roles[0] === roleB && constraint.roles[1] === roleA);

/** A same-session §3.8 violation is invalid; a same-family §3.5 violation is a recorded downgrade. */
export const checkPairing = (
  roleA: string,
  roleB: string,
  identities: { readonly familyA: string; readonly familyB: string; readonly sessionA: string; readonly sessionB: string },
): PairingViolation | null => {
  const applicable = PAIR_CONSTRAINTS.filter((constraint) => samePair(constraint, roleA, roleB));
  const sessionConstraint = applicable.find((constraint) => constraint.requirement === "different-session");
  if (sessionConstraint !== undefined && identities.sessionA === identities.sessionB) {
    return { constraint: sessionConstraint, kind: "same-session", consequence: "invalid" };
  }
  const familyConstraint = applicable.find((constraint) => constraint.requirement === "different-model-family");
  if (familyConstraint !== undefined && identities.familyA === identities.familyB) {
    return {
      constraint: familyConstraint,
      kind: "same-model-family",
      consequence: "downgrade",
      evidence_label: "single-family-internally-replicated",
    };
  }
  return null;
};

const inputKindMatches = (forbidden: string, offered: string): boolean => {
  const left = forbidden.toLowerCase();
  const right = offered.toLowerCase();
  return left === right || (left === "arm" && right === "arm label");
};

/** Reports forbidden manifest input kinds that a caller is about to offer a role. */
export const forbiddenInputViolations = (roleId: string, offeredInputKinds: readonly string[]): readonly string[] => {
  const role = loadRoleManifest(DEFAULT_STUDY_DIR).roles.find((candidate) => candidate.role_id === roleId);
  if (role === undefined) throw new Error(`Unknown CDEB role ${roleId}`);
  return role.forbidden_inputs.filter((forbidden) => offeredInputKinds.some((offered) => inputKindMatches(forbidden, offered)));
};
