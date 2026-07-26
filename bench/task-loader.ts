import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

import { compileMatcher } from "./detect.ts";
import type {
  Budget,
  DetectSpec,
  MatchSurface,
  Matcher,
  MatcherGroup,
  RepoSpec,
  SeedCommit,
  Task,
} from "./types.ts";

const TASK_KEYS = new Set(["id", "description", "repo", "prompt", "detect", "budget"]);
const REPO_KEYS = new Set(["kind", "path", "seed_commits"]);
const SEED_KEYS = new Set(["files", "message"]);
const DETECT_KEYS = new Set(["reproposed_if", "violation_if"]);
const GROUP_KEYS = new Set(["any_of", "all_of"]);
const MATCHER_KEYS = new Set(["kind", "value", "in", "flags", "label"]);
const SURFACES = new Set(["transcript", "diff", "commits", "code", "artifacts", "any"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const fail = (file: string, message: string): never => {
  throw new Error(`${file}: ${message}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rejectUnknown = (file: string, where: string, value: Record<string, unknown>, allowed: Set<string>): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(file, `unknown key \`${key}\` in ${where} (allowed: ${[...allowed].join(", ")})`);
  }
};

const requireString = (file: string, where: string, value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") fail(file, `${where} must be a non-empty string`);
  return value as string;
};

const requirePositiveInt = (file: string, where: string, value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(file, `${where} must be a positive integer`);
  }
  return value as number;
};

const parseMatcher = (file: string, where: string, raw: unknown): Matcher => {
  if (!isRecord(raw)) fail(file, `${where} must be a mapping`);
  const value = raw as Record<string, unknown>;
  rejectUnknown(file, where, value, MATCHER_KEYS);
  const kind = requireString(file, `${where}.kind`, value.kind);
  if (kind !== "literal" && kind !== "regex") fail(file, `${where}.kind must be "literal" or "regex"`);
  const needle = requireString(file, `${where}.value`, value.value);
  if (value.in !== undefined && (typeof value.in !== "string" || !SURFACES.has(value.in))) {
    fail(file, `${where}.in must be one of ${[...SURFACES].join(", ")}`);
  }
  if (value.flags !== undefined && typeof value.flags !== "string") fail(file, `${where}.flags must be a string`);
  if (value.label !== undefined && typeof value.label !== "string") fail(file, `${where}.label must be a string`);

  const matcher: Matcher = {
    kind: kind as Matcher["kind"],
    value: needle,
    ...(value.in === undefined ? {} : { in: value.in as MatchSurface }),
    ...(value.flags === undefined ? {} : { flags: value.flags as string }),
    ...(value.label === undefined ? {} : { label: value.label as string }),
  };
  try {
    compileMatcher(matcher);
  } catch (error) {
    fail(file, `${where}.value is not a valid regex: ${(error as Error).message}`);
  }
  return matcher;
};

const parseGroup = (file: string, where: string, raw: unknown): MatcherGroup => {
  if (!isRecord(raw)) fail(file, `${where} must be a mapping`);
  const value = raw as Record<string, unknown>;
  rejectUnknown(file, where, value, GROUP_KEYS);
  const group: { any_of?: Matcher[]; all_of?: Matcher[] } = {};
  for (const clause of ["any_of", "all_of"] as const) {
    const list = value[clause];
    if (list === undefined) continue;
    if (!Array.isArray(list)) fail(file, `${where}.${clause} must be a list`);
    group[clause] = (list as unknown[]).map((item, index) =>
      parseMatcher(file, `${where}.${clause}[${index}]`, item),
    );
  }
  return group;
};

const parseDetect = (file: string, raw: unknown): DetectSpec => {
  if (!isRecord(raw)) fail(file, "detect must be a mapping");
  const value = raw as Record<string, unknown>;
  rejectUnknown(file, "detect", value, DETECT_KEYS);
  if (value.reproposed_if === undefined) fail(file, "detect.reproposed_if is required");
  const reproposed = parseGroup(file, "detect.reproposed_if", value.reproposed_if);
  if ((reproposed.any_of ?? []).length === 0 && (reproposed.all_of ?? []).length === 0) {
    fail(file, "detect.reproposed_if needs at least one matcher — a task with no machine decision is not a task");
  }
  return {
    reproposed_if: reproposed,
    ...(value.violation_if === undefined ? {} : { violation_if: parseGroup(file, "detect.violation_if", value.violation_if) }),
  };
};

const parseSeedCommit = (file: string, index: number, raw: unknown): SeedCommit => {
  const where = `repo.seed_commits[${index}]`;
  if (!isRecord(raw)) fail(file, `${where} must be a mapping`);
  const value = raw as Record<string, unknown>;
  rejectUnknown(file, where, value, SEED_KEYS);
  if (!isRecord(value.files)) fail(file, `${where}.files must be a mapping of path to contents`);
  const files: Record<string, string> = {};
  for (const [relative, contents] of Object.entries(value.files as Record<string, unknown>)) {
    if (typeof contents !== "string") fail(file, `${where}.files["${relative}"] must be a string`);
    files[relative] = contents as string;
  }
  if (Object.keys(files).length === 0) fail(file, `${where}.files must not be empty`);
  return { files, message: requireString(file, `${where}.message`, value.message) };
};

const parseRepo = (file: string, raw: unknown): RepoSpec => {
  if (!isRecord(raw)) fail(file, "repo must be a mapping");
  const value = raw as Record<string, unknown>;
  rejectUnknown(file, "repo", value, REPO_KEYS);
  const kind = requireString(file, "repo.kind", value.kind);
  if (kind !== "synthetic" && kind !== "fixture") fail(file, 'repo.kind must be "synthetic" or "fixture"');

  const seeds =
    value.seed_commits === undefined
      ? []
      : Array.isArray(value.seed_commits)
        ? (value.seed_commits as unknown[]).map((item, index) => parseSeedCommit(file, index, item))
        : (fail(file, "repo.seed_commits must be a list") as never);

  if (kind === "synthetic" && seeds.length === 0) {
    fail(file, "repo.seed_commits is required for kind: synthetic");
  }
  if (kind === "fixture" && value.path === undefined) {
    fail(file, "repo.path is required for kind: fixture");
  }
  return {
    kind: kind as RepoSpec["kind"],
    ...(value.path === undefined ? {} : { path: requireString(file, "repo.path", value.path) }),
    seed_commits: seeds,
  };
};

const parseBudget = (file: string, raw: unknown): Budget => {
  if (!isRecord(raw)) fail(file, "budget must be a mapping");
  const value = raw as Record<string, unknown>;
  rejectUnknown(file, "budget", value, new Set(["turns", "tokens"]));
  return {
    turns: requirePositiveInt(file, "budget.turns", value.turns),
    tokens: requirePositiveInt(file, "budget.tokens", value.tokens),
  };
};

export const parseTask = (file: string, source: string): Task => {
  let document: unknown;
  try {
    document = load(source);
  } catch (error) {
    return fail(file, `YAML parse error: ${(error as Error).message}`);
  }
  if (!isRecord(document)) return fail(file, "task file must contain a mapping");
  rejectUnknown(file, "task", document, TASK_KEYS);

  const id = requireString(file, "id", document.id);
  if (!ID_PATTERN.test(id)) fail(file, `id must match ${ID_PATTERN.source}`);

  return {
    id,
    description: requireString(file, "description", document.description),
    repo: parseRepo(file, document.repo),
    prompt: requireString(file, "prompt", document.prompt),
    detect: parseDetect(file, document.detect),
    budget: parseBudget(file, document.budget),
    source_file: file,
  };
};

/** Sorted by id so the run order is stable across filesystems. */
export const loadTasks = (directory: string): readonly Task[] => {
  if (!fs.existsSync(directory)) throw new Error(`task directory not found: ${directory}`);
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort();
  if (files.length === 0) throw new Error(`no .yaml task files in ${directory}`);

  const tasks = files.map((name) => {
    const full = path.join(directory, name);
    return parseTask(full, fs.readFileSync(full, "utf8"));
  });

  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) throw new Error(`duplicate task id \`${task.id}\` (${task.source_file})`);
    seen.add(task.id);
  }
  return [...tasks].sort((a, b) => a.id.localeCompare(b.id));
};
