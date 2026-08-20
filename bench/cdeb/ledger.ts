import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { assertTransition, type StudyState } from "./lifecycle.js";

const TRANSITIONS_FILE = "transitions.jsonl";
const STUDY_FILE = "study.json";
const TRANSITION_SCHEMA = join(new URL(".", import.meta.url).pathname, "schemas", "transition.schema.json");

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
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(TRANSITION_SCHEMA, "utf8")));
})();

const validationMessage = (): string => validator.errors?.map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`).join("; ") ?? "invalid";

const transitionPath = (studyDir: string): string => join(studyDir, TRANSITIONS_FILE);

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
  appendFileSync(transitionPath(studyDir), `${JSON.stringify(transition)}\n`, "utf8");
};
