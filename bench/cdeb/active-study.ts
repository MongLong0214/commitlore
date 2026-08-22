import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ACTIVE_STUDY_FILE = "ACTIVE-STUDY.json";

export const ACTIVE_STUDY_STATUSES = ["no-active-study", "active"] as const;

export type ActiveStudyStatus = (typeof ACTIVE_STUDY_STATUSES)[number];

export interface ActiveStudyDeclaration {
  readonly active_study_id: string | null;
  readonly last_terminal_study_id: string;
  readonly status: ActiveStudyStatus;
  readonly reason: string;
  readonly successor_requires_new_study_id: true;
}

/**
 * The phases a study writes into its own STATUS.json when it ends. A study that
 * declares itself terminal cannot be named active, however the declaration is
 * edited -- the refusal reads the study's own record rather than a list of
 * names kept somewhere else, which would drift the first time a study ended
 * without anyone remembering to update it.
 *
 * `stage0-hold` joins `invalidated` because a study that reached HOLD is just as
 * finished as one that was invalidated: it holds a published verdict and a
 * successor requirement, and running anything against it would attribute the
 * result to a study that already ended.
 */
export const TERMINAL_STUDY_PHASES = ["invalidated", "stage0-hold"] as const;

/** Retained for callers that predate the plural form. */
export const TERMINAL_STUDY_PHASE = "invalidated";

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
      typeof value.status !== "string" ||
      !(ACTIVE_STUDY_STATUSES as readonly string[]).includes(value.status) ||
      typeof value.reason !== "string" ||
      value.successor_requires_new_study_id !== true) {
    throw new Error(`Invalid active-study declaration ${declarationPath}`);
  }
  // The status word and the id have to agree. Either alone can be edited, and a
  // declaration that says "active" with no id -- or names an id while claiming
  // none is active -- must not resolve to whichever half the reader trusts.
  if ((value.status === "no-active-study") !== (value.active_study_id === null)) {
    throw new Error(`Contradictory active-study declaration ${declarationPath}: status ${value.status} with active_study_id ${JSON.stringify(value.active_study_id)}`);
  }
  if (value.active_study_id === null) {
    throw new Error(`No active CDEB study: ${value.reason}`);
  }
  if (value.active_study_id === "" || value.active_study_id.includes("/") || value.active_study_id.includes("\\") || value.active_study_id === "." || value.active_study_id === "..") {
    throw new Error(`Invalid active study id in ${declarationPath}`);
  }
  const studyRoot = resolve(cdebRoot, "studies", value.active_study_id);
  assertStudyNotTerminal(studyRoot, value.active_study_id);
  return studyRoot;
};

/**
 * Refuses a study that has ended. The check reads the study's own STATUS.json,
 * so a terminal study cannot be revived by editing the declaration that names
 * it -- and an unreadable or mismatched status fails closed rather than
 * defaulting to "presumably fine".
 */
export const assertStudyNotTerminal = (studyRoot: string, expectedStudyId: string): void => {
  let status: unknown;
  try {
    status = JSON.parse(readFileSync(join(studyRoot, "STATUS.json"), "utf8"));
  } catch (error) {
    throw new Error(`Cannot read STATUS.json for active study ${expectedStudyId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(status) || typeof status.study_id !== "string" || typeof status.phase !== "string") {
    throw new Error(`Invalid STATUS.json for active study ${expectedStudyId}`);
  }
  if (status.study_id !== expectedStudyId) {
    throw new Error(`Active study ${expectedStudyId} resolves to a directory whose STATUS.json declares ${status.study_id}`);
  }
  if ((TERMINAL_STUDY_PHASES as readonly string[]).includes(status.phase)) {
    throw new Error(`Refused terminal study ${expectedStudyId} as the active study: its phase is ${status.phase}`);
  }
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
