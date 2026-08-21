import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";

import { assertTransition, type StudyState } from "./lifecycle.js";

const TRANSITIONS_FILE = "transitions.jsonl";
const STUDY_FILE = "study.json";
const TRANSITION_SCHEMA = join(new URL(".", import.meta.url).pathname, "schemas", "transition.schema.json");

// Keep this sole format check local: study artifacts are validated by a rule
// this repository can read, and bench tsconfig's verbatim module settings make
// ajv-formats' default export uncallable.
const RFC3339_DATE_TIME = /^(?:\d{4})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:(?:[0-5]\d|60)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export const addRfc3339DateTimeFormat = (ajv: Ajv2020): void => {
  ajv.addFormat("date-time", RFC3339_DATE_TIME);
};

export interface TransitionArtifact {
  readonly from: StudyState;
  readonly to: StudyState;
  readonly timestamp: string;
  readonly actor_role: string;
  readonly input_digest: string;
  readonly output_digest: string;
  readonly checks: readonly string[];
  readonly deviations: readonly unknown[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readStudyId = (studyDir: string): string => {
  const path = join(studyDir, STUDY_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read study manifest ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || typeof parsed.study_id !== "string" || parsed.study_id.length === 0) {
    throw new Error(`Study manifest ${path} has no usable study_id`);
  }
  return parsed.study_id;
};

/** Refuse a foreign study before an otherwise-valid schema can disguise it. */
export const assertStudyIdentity = (studyDir: string, value: unknown): void => {
  if (!isRecord(value) || typeof value.study_id !== "string") return;
  const expected = readStudyId(studyDir);
  if (value.study_id !== expected) {
    throw new Error(`Mixed-study refusal: expected study_id ${expected}, received ${value.study_id}`);
  }
};

const validator = (() => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addRfc3339DateTimeFormat(ajv);
  return ajv.compile(JSON.parse(readFileSync(TRANSITION_SCHEMA, "utf8")));
})();

const validationMessage = (): string => validator.errors?.map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`).join("; ") ?? "invalid";

const transitionPath = (studyDir: string): string => join(studyDir, TRANSITIONS_FILE);

const countArrayArtifact = (path: string, property: string): number => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) && Array.isArray(parsed[property]) ? parsed[property].length : 0;
  } catch {
    return 0;
  }
};

const auditArtifactCounts = (studyDir: string): Readonly<Record<"litA" | "litB" | "adjudication", number>> => {
  const audits = join(studyDir, "literature", "audits");
  let names: readonly string[] = [];
  try {
    names = readdirSync(audits);
  } catch {
    // The gate reports each missing artifact as zero rather than converting a
    // missing directory into an unmeasured success.
  }
  const count = (expression: RegExp): number => names.filter((name) => expression.test(name)).length;
  return {
    litA: count(/(?:^|[-_])(lit|auditor)[-_]?a(?:[-_.]|$)/i),
    litB: count(/(?:^|[-_])(lit|auditor)[-_]?b(?:[-_.]|$)/i),
    adjudication: count(/adjudication/i),
  };
};

const unresolvedClaimCount = (studyDir: string): number => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(studyDir, "literature", "evidence-matrix.json"), "utf8"));
    if (!isRecord(parsed) || !Array.isArray(parsed.claims)) return 0;
    return parsed.claims.filter((claim) => !isRecord(claim) || claim.status !== "resolved").length;
  } catch {
    return 0;
  }
};

const assertLiteratureLockGate = (studyDir: string, transition: TransitionArtifact): void => {
  if (transition.to !== "LITERATURE_LOCKED") return;

  const sources = countArrayArtifact(join(studyDir, "literature", "source-lock.json"), "sources");
  const claims = countArrayArtifact(join(studyDir, "literature", "evidence-matrix.json"), "claims");
  const audits = auditArtifactCounts(studyDir);
  const unresolved = unresolvedClaimCount(studyDir);
  const circularChecks = transition.checks.filter((check) =>
    check.toUpperCase().includes(transition.to),
  );
  const failures: string[] = [];

  if (sources === 0) failures.push("source-lock sources must be > 0 (measured 0)");
  if (claims === 0) failures.push("evidence-matrix claims must be > 0 (measured 0)");
  if (audits.litA === 0) failures.push("literature/audits LIT-A artifact must exist (measured 0)");
  if (audits.litB === 0) failures.push("literature/audits LIT-B artifact must exist (measured 0)");
  if (audits.adjudication === 0) failures.push("literature/audits adjudication artifact must exist (measured 0)");
  if (unresolved !== 0) failures.push(`evidence-matrix unresolved claims must be 0 (measured ${unresolved})`);
  if (transition.actor_role !== "OWNER" && transition.actor_role !== "FREEZE") {
    failures.push(`actor_role must be OWNER or FREEZE (measured 0 authorized roles for ${transition.actor_role})`);
  }
  if (circularChecks.length > 0) {
    failures.push(`circular check names destination state ${transition.to} (measured ${circularChecks.length})`);
  }
  if (failures.length > 0) {
    throw new Error(`Refused LITERATURE_LOCKED transition: ${failures.join("; ")}`);
  }
};

export const readTransitions = (studyDir: string): TransitionArtifact[] => {
  const path = transitionPath(studyDir);
  if (!existsSync(path)) return [];
  const bytes = readFileSync(path, "utf8");
  if (bytes.length === 0) return [];
  const lines = bytes.endsWith("\n") ? bytes.slice(0, -1).split("\n") : bytes.split("\n");

  const transitions: TransitionArtifact[] = [];
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    let artifact: unknown;
    try {
      artifact = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid transition ledger line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      assertStudyIdentity(studyDir, artifact);
    } catch (error) {
      throw new Error(`Invalid transition ledger line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!validator(artifact)) {
      throw new Error(`Invalid transition ledger line ${lineNumber}: ${validationMessage()}`);
    }
    const transition = artifact as TransitionArtifact;
    const previous = transitions.at(-1)?.to ?? "DRAFT";
    if (transition.from !== previous) {
      throw new Error(`Invalid transition ledger line ${lineNumber}: expected from ${previous}, received ${transition.from}`);
    }
    try {
      assertTransition(transition.from, transition.to);
    } catch (error) {
      throw new Error(`Invalid transition ledger line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
    transitions.push(transition);
  }
  return transitions;
};

export const currentState = (studyDir: string): StudyState => {
  const transitions = readTransitions(studyDir);
  return transitions.at(-1)?.to ?? "DRAFT";
};

export const appendTransition = (studyDir: string, artifact: unknown): void => {
  assertStudyIdentity(studyDir, artifact);
  if (!validator(artifact)) {
    throw new Error(`Invalid transition artifact: ${validationMessage()}`);
  }
  const transition = artifact as TransitionArtifact;
  const current = currentState(studyDir);
  if (transition.from !== current) {
    throw new Error(`Refused transition from ${transition.from}: ledger is currently ${current}`);
  }
  assertTransition(transition.from, transition.to);
  // This is intentionally evaluated only for a proposed append. Historical
  // bad rows remain readable so they can be invalidated rather than erased.
  assertLiteratureLockGate(studyDir, transition);
  appendFileSync(transitionPath(studyDir), `${JSON.stringify(transition)}\n`, "utf8");
};
