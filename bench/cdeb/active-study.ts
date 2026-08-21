import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ACTIVE_STUDY_FILE = "ACTIVE-STUDY.json";

export interface ActiveStudyDeclaration {
  readonly active_study_id: string | null;
  readonly last_terminal_study_id: string;
  readonly status: "no-active-study";
  readonly reason: string;
  readonly successor_requires_new_study_id: true;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The only default study resolver. It deliberately never inspects study
 * directories, timestamps, or names to guess an active study.
 */
export const resolveActiveStudyRoot = (cdebRoot: string): string => {
  const declarationPath = join(cdebRoot, ACTIVE_STUDY_FILE);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(declarationPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read active-study declaration ${declarationPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value) ||
      (value.active_study_id !== null && typeof value.active_study_id !== "string") ||
      typeof value.last_terminal_study_id !== "string" ||
      value.status !== "no-active-study" ||
      typeof value.reason !== "string" ||
      value.successor_requires_new_study_id !== true) {
    throw new Error(`Invalid active-study declaration ${declarationPath}`);
  }
  if (value.active_study_id === null) {
    throw new Error(`No active CDEB study: ${value.reason}`);
  }
  if (value.active_study_id === "" || value.active_study_id.includes("/") || value.active_study_id.includes("\\") || value.active_study_id === "." || value.active_study_id === "..") {
    throw new Error(`Invalid active study id in ${declarationPath}`);
  }
  return resolve(cdebRoot, "studies", value.active_study_id);
};

/**
 * The guard a future measured-run entry point must use after resolving its
 * active study. Selection and seed are both required evidence; neither an
 * empty selection nor an unseeded plan can reach a measured run.
 */
export const assertMeasuredRunAuthorized = (studyRoot: string): void => {
  const failures: string[] = [];
  let status: unknown;
  let selection: unknown;
  try { status = JSON.parse(readFileSync(join(studyRoot, "STATUS.json"), "utf8")); }
  catch { failures.push("STATUS.json is missing or invalid"); }
  try { selection = JSON.parse(readFileSync(join(studyRoot, "corpus", "selection.json"), "utf8")); }
  catch { failures.push("corpus/selection.json is missing or invalid"); }
  if (!isRecord(status) || status.measured_run_allowed !== true) failures.push("measured_run_allowed is not true");
  if (!isRecord(selection) || !Array.isArray(selection.selected) || selection.selected.length === 0) failures.push("selection is empty");
  if (!isRecord(selection) || selection.seed === null || selection.seed === undefined) failures.push("selection seed is null");
  if (failures.length > 0) throw new Error(`Refused CDEB measured run: ${failures.join("; ")}`);
};

export const resolveActiveMeasuredStudyRoot = (cdebRoot: string): string => {
  const studyRoot = resolveActiveStudyRoot(cdebRoot);
  assertMeasuredRunAuthorized(studyRoot);
  return studyRoot;
};
