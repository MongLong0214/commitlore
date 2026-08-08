/**
 * T-704: JSONL results -> the exact markdown that ships in the README.
 *
 * The point of this file is not that it prints numbers. It is that the README's
 * numbers cannot come from anywhere else. `--section` emits a marker-delimited
 * block, `scripts/check-readme-numbers.mjs` regenerates it and compares byte for
 * byte, and CI runs that comparison — so a hand-typed rate is a build failure
 * rather than a claim nobody can check.
 *
 * Three rules are load-bearing:
 *
 *   1. **A simulated row stops the report.** `dry-run` rows exist to exercise
 *      the harness; a fabricated transcript that reaches the README would be the
 *      worst failure this ticket can produce, so the whole report is refused
 *      rather than filtered.
 *   2. **Failed runs stay visible.** The analysis set drops rows that carry no
 *      measurement (metrics.ts decides which), but the unfiltered table and the
 *      exclusion counts are printed next to it. A run that crashed is never
 *      silently absent from a denominator.
 *   3. **Output is a pure function of the logs.** No clock, no `git rev-parse`,
 *      no absolute paths. A block that changed because it was regenerated on a
 *      different machine or a later commit would make the CI comparison
 *      meaningless within a day.
 *
 * Usage:
 *   node bench/report.ts <results.jsonl...> [--format markdown|json]
 *   node bench/report.ts [<results.jsonl...>] --section
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { UNRECORDED_MODEL, parseRows, summarize } from "./metrics.ts";
import type { ConditionSummary, Summary } from "./metrics.ts";
import type { RunRecord } from "./types.ts";

/**
 * Whether a dataset may be cited.
 *
 * `final` is the only citable value, and it has to be said out loud. Anything
 * else — `pilot`, `superseded`, an unrecognized word, or nothing at all — is
 * reported as not for citation. The default fails towards the warning on
 * purpose: a run whose status nobody recorded is exactly the run most likely to
 * be quoted by mistake, and the first dataset this repository produced was
 * invalidated mid-flight by an edit to the code under test.
 */
export type SourceStatus = "final" | "pilot" | "superseded";

const STATUS_VALUES: readonly string[] = ["final", "pilot", "superseded"];

export interface DeclaredSource {
  readonly file: string;
  /**
   * Fallback status, used only when the run manifest does not declare one. The
   * manifest is the authority — it ships next to the rows it describes — and
   * the block always says which of the two it read.
   */
  readonly status?: SourceStatus | undefined;
  readonly status_note?: string | undefined;
}

/**
 * The result files the README block is built from. Editing this list is how a
 * new measurement reaches the README — there is no other route, because
 * `--section` with no file arguments is what CI regenerates and compares.
 *
 * Nothing scans a directory, here or anywhere else in this file: a report covers
 * the files it was handed and no others. Once a superseded pilot and a final
 * run sit side by side in `bench/results/`, a glob is all it would take for the
 * wrong one to be published.
 *
 * A file listed here that does not exist renders as "not measured yet" instead
 * of crashing, so the block is honest before the first run lands. A file passed
 * explicitly on the command line must exist: that is a human asking for a
 * specific file, and answering with "no measurement" would hide the typo.
 */
export const README_SOURCES: readonly DeclaredSource[] = [
  {
    file: "bench/results/m5-seeds-1-10-rerun.jsonl",
    status: "final",
    status_note:
      "The registered M5 measurement (bench/PREREGISTRATION-M5.md), whose primary comparison is `commitlore-on` against `commitlore-off` on the re-proposal task set. Seven shards, 1,160 rows, one harness commit `788a9db3` and one dist digest `f54cda4795cc` across every one. Three shards are re-runs (deviations 3 and 4): 400 rows were lost to a temp reaper and re-produced, and seeds 55-58 were re-run whole after 70 of their surviving rows carried no measurement. 80 original cells are superseded by a rule in bench/m5-analysis.ts -- an original is dropped whenever a re-run shard holds the same task, condition and seed -- rather than by a trimmed file nobody can review. One row carrying `stopped_by: error` is excluded by the registered rule. The arms truncate unequally, 28.5% control against 21.2% treatment, which deviations 1 and 2 require the verdict to report because truncation suppresses re-proposal and so shrinks rather than manufactures the gap. Every record in the run rendered `[claim]`: no arm passed --trusted-author, so this measures the weaker of the two trust tiers and not the `[directive]` path 0.7.1 made reachable (#415). bench/VERDICT-M5.md is the verdict. M1 (bench/VERDICT-M1.md), M1-b, M2 and M4 (docs/VERDICT-M4.md) are not pooled here -- different task sets and, for M4, a third arm, the same reason the ablation log stays out of this list. Each file's own manifest is the authority on its status; this declaration is the fallback.",
  },
  {
    file: "bench/results/m5-seeds-11-20-rerun.jsonl",
    status: "final",
    status_note:
      "Part of the registered M5 set declared above; see the first entry for the full status.",
  },
  {
    file: "bench/results/m5-seeds-21-30.jsonl",
    status: "final",
    status_note:
      "Part of the registered M5 set declared above; see the first entry for the full status.",
  },
  {
    file: "bench/results/m5-seeds-31-40.jsonl",
    status: "final",
    status_note:
      "Part of the registered M5 set declared above; see the first entry for the full status.",
  },
  {
    file: "bench/results/m5-seeds-41-50.jsonl",
    status: "final",
    status_note:
      "Part of the registered M5 set declared above; see the first entry for the full status.",
  },
  {
    file: "bench/results/m5-seeds-51-58.jsonl",
    status: "final",
    status_note:
      "Part of the registered M5 set declared above; see the first entry for the full status.",
  },
  {
    file: "bench/results/m5-seeds-55-58-rerun.jsonl",
    status: "final",
    status_note:
      "Part of the registered M5 set declared above; see the first entry for the full status.",
  },
];


/*
 * The ablation log is deliberately NOT listed above.
 *
 * `bench/results/t703-ablation.jsonl` is a different synthetic repository with
 * its own `commitlore-on` arm. Adding it here pools that arm with the primary
 * matrix's: n goes to 37, the task count to 17, and the headline Fisher test
 * silently becomes 5/37 against 7/30 — p = 0.3487 instead of the registered
 * 5/30 against 7/30, p = 0.7480. That is not a hypothetical: both files were
 * listed here once, the generator pooled them, and the wrong p-value reached
 * the working tree before it was caught and never got committed. The warning
 * sits in the code that would cause it rather than only in the manifest that
 * forbids it, because the manifest is not what a future editor of this list
 * will be reading.
 *
 * `readSources` unions every file it is handed and groups by condition alone —
 * it has no notion of which repository a row came from. Until a report can
 * report per-dataset, the ablation belongs in bench/README.md and the manifest,
 * not in the block CI regenerates.
 */

export const MARKER_BEGIN = "<!-- BENCH:BEGIN -->";
export const MARKER_END = "<!-- BENCH:END -->";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/** Repo-relative POSIX path, so the block does not depend on where it was run. */
export const repoRelative = (file: string): string => {
  const relative = path.relative(REPO_ROOT, path.resolve(file));
  return relative.split(path.sep).join("/");
};

/**
 * The sidecar `bench/results/<name>.manifest.json`. Only the fields the report
 * reads are typed; the file carries more, and the ones below are read
 * defensively because a manifest is hand-written.
 */
export interface Manifest {
  readonly ticket?: string | undefined;
  readonly model?: string | undefined;
  readonly model_note?: string | undefined;
  /** `final` | `pilot` | `superseded`. Anything else is treated as not citable. */
  readonly status?: string | undefined;
  readonly status_note?: string | undefined;
  readonly matrix?:
    | {
        readonly tasks?: number | undefined;
        readonly conditions?: readonly string[] | undefined;
        readonly seeds?: readonly number[] | undefined;
        readonly runs?: number | undefined;
      }
    | undefined;
  readonly environment?: { readonly repo_sha?: string | undefined } | undefined;
}

export interface SourceStatusReport {
  /** null when nothing declared one, or when what was declared is unrecognized. */
  readonly status: SourceStatus | null;
  /** Where the status came from, or null when nothing declared one. */
  readonly from: "manifest" | "declaration" | null;
  /** A declared value that is not one of the three recognized ones. */
  readonly unrecognized: string | null;
  readonly note: string | null;
  /** Only an explicit `final` is citable. */
  readonly citable: boolean;
}

export interface SourceFile {
  /** Repo-relative path of the JSONL. */
  readonly file: string;
  readonly rows: readonly RunRecord[];
  readonly manifestFile: string | null;
  readonly manifest: Manifest | null;
  /** Runs the manifest says this file will contain, or null when it does not say. */
  readonly plannedRuns: number | null;
  readonly simulatedRows: number;
  readonly status: SourceStatusReport;
}

export interface Sources {
  readonly present: readonly SourceFile[];
  /** Declared-but-absent files. Only possible for the default source list. */
  readonly missing: readonly string[];
  readonly rows: readonly RunRecord[];
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const asPositiveInt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;

const manifestPathFor = (jsonl: string): string => `${jsonl.replace(/\.jsonl$/, "")}.manifest.json`;

const readManifest = (file: string): Manifest | null => {
  if (!fs.existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${repoRelative(file)}: not valid JSON — ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${repoRelative(file)}: manifest is not a JSON object`);
  }
  const raw = parsed as Record<string, unknown>;
  const matrixRaw = (typeof raw.matrix === "object" && raw.matrix !== null ? raw.matrix : {}) as Record<string, unknown>;
  const environmentRaw = (
    typeof raw.environment === "object" && raw.environment !== null ? raw.environment : {}
  ) as Record<string, unknown>;
  return {
    ticket: asString(raw.ticket),
    model: asString(raw.model),
    model_note: asString(raw.model_note),
    status: asString(raw.status),
    status_note: asString(raw.status_note),
    matrix: {
      tasks: asPositiveInt(matrixRaw.tasks),
      conditions: Array.isArray(matrixRaw.conditions)
        ? matrixRaw.conditions.filter((c): c is string => typeof c === "string")
        : undefined,
      seeds: Array.isArray(matrixRaw.seeds)
        ? matrixRaw.seeds.filter((s): s is number => typeof s === "number")
        : undefined,
      runs: asPositiveInt(matrixRaw.runs),
    },
    environment: { repo_sha: asString(environmentRaw.repo_sha) },
  };
};

/**
 * How many runs the manifest says the file will hold when it is finished.
 * `matrix.runs` wins; otherwise the product of the matrix dimensions. Without
 * either, completeness is unknown and the report says so rather than guessing
 * that whatever is on disk is the whole thing.
 */
const plannedRunsOf = (manifest: Manifest | null): number | null => {
  if (manifest === null) return null;
  const matrix = manifest.matrix;
  if (matrix === undefined) return null;
  if (matrix.runs !== undefined) return matrix.runs;
  const tasks = matrix.tasks;
  const conditions = matrix.conditions?.length;
  const seeds = matrix.seeds?.length;
  if (tasks === undefined || conditions === undefined || seeds === undefined) return null;
  if (conditions === 0 || seeds === 0) return null;
  return tasks * conditions * seeds;
};

/**
 * Resolves the citation status of one dataset.
 *
 * The manifest wins over the declaration in this file: it ships beside the rows
 * it describes, so it is the thing a person updates when a run's standing
 * changes. The declaration exists so a dataset can be labelled before its
 * manifest carries the field — the pilot above is exactly that case — and the
 * block reports which of the two it read, the same way it does for the model.
 */
export const resolveStatus = (manifest: Manifest | null, declared: DeclaredSource): SourceStatusReport => {
  const fromManifest = manifest?.status;
  if (fromManifest !== undefined) {
    const recognized = STATUS_VALUES.includes(fromManifest) ? (fromManifest as SourceStatus) : null;
    return {
      status: recognized,
      from: "manifest",
      unrecognized: recognized === null ? fromManifest : null,
      note: manifest?.status_note ?? declared.status_note ?? null,
      citable: recognized === "final",
    };
  }
  if (declared.status !== undefined) {
    return {
      status: declared.status,
      from: "declaration",
      unrecognized: null,
      note: declared.status_note ?? null,
      citable: declared.status === "final",
    };
  }
  return { status: null, from: null, unrecognized: null, note: declared.status_note ?? null, citable: false };
};

/**
 * The declaration for a file, whatever route it arrived by.
 *
 * Without this, `report.ts bench/results/pilot.jsonl` and `report.ts --section`
 * would label the same rows differently — the first losing the pilot marking
 * because the path was typed rather than looked up. A dataset's standing is a
 * property of the dataset.
 */
export const declarationFor = (file: string): DeclaredSource | null => {
  const resolved = path.resolve(REPO_ROOT, file);
  return README_SOURCES.find((source) => path.resolve(REPO_ROOT, source.file) === resolved) ?? null;
};

export const readSources = (
  files: readonly (string | DeclaredSource)[],
  options: { readonly allowMissing: boolean },
): Sources => {
  const present: SourceFile[] = [];
  const missing: string[] = [];

  for (const entry of files) {
    const declared: DeclaredSource = typeof entry === "string" ? (declarationFor(entry) ?? { file: entry }) : entry;
    const resolved = path.resolve(REPO_ROOT, declared.file);
    if (!fs.existsSync(resolved)) {
      if (!options.allowMissing) throw new Error(`no such file: ${repoRelative(resolved)}`);
      missing.push(repoRelative(resolved));
      continue;
    }
    const relative = repoRelative(resolved);
    const rows = parseRows(relative, fs.readFileSync(resolved, "utf8"));
    const manifestFile = manifestPathFor(resolved);
    const manifest = readManifest(manifestFile);
    present.push({
      file: relative,
      rows,
      manifestFile: manifest === null ? null : repoRelative(manifestFile),
      manifest,
      plannedRuns: plannedRunsOf(manifest),
      simulatedRows: rows.filter((row) => row.simulated === true).length,
      status: resolveStatus(manifest, declared),
    });
  }

  return { present, missing, rows: present.flatMap((source) => [...source.rows]) };
};

/**
 * Refuse to report on fabricated rows. Filtering them out would be worse than
 * failing: the reader would see a plausible table with no way to tell that part
 * of the matrix never ran.
 */
export const assertNotSimulated = (sources: Sources): void => {
  const offenders = sources.present.filter((source) => source.simulatedRows > 0);
  if (offenders.length === 0) return;
  const detail = offenders
    .map((source) => `${source.file}: ${source.simulatedRows}/${source.rows.length} rows`)
    .join(", ");
  throw new Error(
    `refusing to build a report from simulated rows — ${detail}. ` +
      "Rows with `simulated: true` come from the dry-run driver, which fabricates transcripts. " +
      "They exercise the harness and are never evidence, so no report is produced rather than a filtered one.",
  );
};

export type Completeness = "measured" | "in-progress" | "over-planned" | "unknown-plan" | "no-measurement";

export interface Progress {
  readonly state: Completeness;
  readonly recorded: number;
  /** Total planned runs across the manifests that declare a plan, or null. */
  readonly planned: number | null;
  /**
   * Rows left after a re-run of the same cell supersedes the original.
   *
   * A study that re-runs a shard has more rows on disk than measurements, and
   * a line reporting the file count invites the reader to take the larger
   * number for the study's size. M5 has 1,240 rows across seven shards and
   * 1,160 cells, because 400 rows were re-produced after a temp reaper and one
   * seed range was re-run whole. The supersession rule lives in
   * `bench/m5-analysis.ts`; this counts the same way so the published line and
   * the registered analysis cannot disagree.
   */
  readonly distinct: number;
}

/** One measurement: a task, an arm and a seed. Re-runs repeat it. */
const cellKey = (row: Record<string, unknown>): string =>
  `${String(row['task'])}\u0000${String(row['cond'])}\u0000${String(row['seed'])}`;

export const progressOf = (sources: Sources): Progress => {
  const recorded = sources.rows.length;
  const distinct = new Set(
    sources.rows.map((row) => cellKey(row as unknown as Record<string, unknown>)),
  ).size;
  if (recorded === 0) return { state: "no-measurement", recorded, planned: null, distinct };

  const planned = sources.present.reduce<number | null>((total, source) => {
    if (total === null || source.plannedRuns === null) return null;
    return total + source.plannedRuns;
  }, 0);

  if (planned === null) return { state: "unknown-plan", recorded, planned: null, distinct };
  if (recorded < planned) return { state: "in-progress", recorded, planned, distinct };
  if (recorded > planned) return { state: "over-planned", recorded, planned, distinct };
  return { state: "measured", recorded, planned, distinct };
};

export interface ModelReport {
  /** Every model the rows or manifests name, sorted. */
  readonly models: readonly string[];
  /** True when at least one row carries no `model` field. */
  readonly rowsMissingModel: boolean;
  readonly notes: readonly string[];
}

/**
 * Where the model name comes from, and whether the rows themselves carry it.
 *
 * This matters more than it looks: re-proposal is a behaviour, so every rate
 * here is conditional on the model that produced it. Legacy rows may have only
 * a manifest, and the report says which source it read rather than presenting a
 * manifest value as if the row had emitted it.
 */
export const modelReport = (sources: Sources, summary: Summary): ModelReport => {
  const fromRows = summary.models.filter((model) => model !== UNRECORDED_MODEL);
  const rowsMissingModel = summary.models.includes(UNRECORDED_MODEL);
  const fromManifests = [
    ...new Set(
      sources.present
        .map((source) => source.manifest?.model)
        .filter((model): model is string => typeof model === "string"),
    ),
  ].sort();

  const notes: string[] = [];
  const models = [...new Set([...fromRows, ...fromManifests])].sort();

  if (rowsMissingModel && fromManifests.length > 0) {
    notes.push(
      "The model above is read from the run manifest because these legacy rows carry no model field of their own.",
    );
  }
  if (rowsMissingModel && fromManifests.length === 0) {
    notes.push(
      "No model is recorded — neither on the rows nor in a manifest. A re-proposal rate whose model is unknown " +
        "is not a comparable number, and these figures must not be quoted against another model's.",
    );
  }
  if (models.length > 1) {
    notes.push(
      `These rows mix ${models.length} models (${models.join(", ")}). Re-proposal behaviour is model-dependent, ` +
        "so the pooled rates below average across models rather than measuring one.",
    );
  }

  const manifestNotes = [
    ...new Set(
      sources.present
        .map((source) => source.manifest?.model_note)
        .filter((note): note is string => typeof note === "string"),
    ),
  ].sort();
  notes.push(...manifestNotes);

  return { models, rowsMissingModel, notes };
};

const fmtRate = (rate: number | null): string => (rate === null ? "n/a" : rate.toFixed(3));
const fmtTurns = (value: number | null): string => (value === null ? "n/a" : value.toFixed(1));
const fmtTokens = (value: number | null): string => (value === null ? "n/a" : value.toFixed(0));
const fmtP = (p: number): string => (p < 0.0001 ? p.toExponential(2) : p.toFixed(4));
const fmtPp = (value: number): string => `${(value * 100).toFixed(1)}pp`;

const conditionRow = (condition: ConditionSummary): string =>
  `| \`${condition.cond}\` | ${condition.n} | ${condition.reproposed} | ${fmtRate(condition.reproposal_rate)} | ` +
  `${condition.runs_with_violations} | ${fmtRate(condition.violation_rate)} | ` +
  `${fmtTurns(condition.mean_turns)} | ${fmtTokens(condition.mean_tokens)} |`;

const conditionTable = (conditions: readonly ConditionSummary[]): string[] => [
  "| Condition | n | Re-proposed | Re-proposal rate | Runs with violations | Violation rate | Mean turns | Mean tokens |",
  "|---|---|---|---|---|---|---|---|",
  ...conditions.map(conditionRow),
];

const stopTable = (conditions: readonly ConditionSummary[]): string[] => [
  "| Condition | completed | timeout | over-turns | over-tokens | error |",
  "|---|---|---|---|---|---|",
  ...conditions.map(
    (condition) =>
      `| \`${condition.cond}\` | ${condition.stopped_by.completed} | ${condition.stopped_by.timeout} | ` +
      `${condition.stopped_by["over-turns"]} | ${condition.stopped_by["over-tokens"]} | ${condition.stopped_by.error} |`,
  ),
];

const provenanceTable = (sources: Sources, summary: Summary, models: readonly string[]): string[] => {
  const shas = [
    ...new Set(
      sources.present
        .map((source) => source.manifest?.environment?.repo_sha)
        .filter((sha): sha is string => typeof sha === "string"),
    ),
  ].sort();
  const manifests = sources.present
    .map((source) => source.manifestFile)
    .filter((file): file is string => file !== null);

  const rows: string[] = [
    "| Where it comes from | |",
    "|---|---|",
    `| Results | ${sources.present.map((source) => `\`${source.file}\` (${source.rows.length} rows)`).join(", ")} |`,
  ];
  if (manifests.length > 0) rows.push(`| Manifest | ${manifests.map((file) => `\`${file}\``).join(", ")} |`);
  rows.push(`| Run id | ${summary.run_ids.map((id) => `\`${id}\``).join(", ")} |`);
  if (shas.length > 0) rows.push(`| Measured at commit | ${shas.map((sha) => `\`${sha}\``).join(", ")} |`);
  rows.push(`| Driver | ${summary.drivers.map((driver) => `\`${driver}\``).join(", ")} |`);
  rows.push(`| Model | ${models.length === 0 ? "not recorded" : models.map((m) => `\`${m}\``).join(", ")} |`);
  rows.push(`| Matrix | ${summary.tasks.length} tasks, seeds ${summary.seeds.join(", ")} |`);
  rows.push(
    `| Status | ${sources.present
      .map((source) => `${describeStatus(source.status)}${sources.present.length > 1 ? ` (\`${source.file}\`)` : ""}`)
      .join(", ")} |`,
  );
  return rows;
};

const describeStatus = (status: SourceStatusReport): string => {
  const origin =
    status.from === null ? ""
    : status.from === "manifest" ? " (from the run manifest)"
    : " (declared in `bench/report.ts`, pending a manifest field)";
  if (status.unrecognized !== null) return `unrecognized value \`${status.unrecognized}\`${origin} — not citable`;
  if (status.status === null) return "not declared — not citable";
  return `${status.status}${origin}`;
};

/**
 * The banner that keeps a superseded dataset from being read as a result.
 *
 * It goes above everything, including the progress line: a reader who stops
 * after the first line has to have been told. Returns nothing when every source
 * is an explicit `final`, so a real measurement is not decorated with warnings.
 */
const statusBanner = (sources: Sources): string[] => {
  const suspect = sources.present.filter((source) => !source.status.citable);
  if (suspect.length === 0) return [];

  const many = sources.present.length > 1;
  return suspect.flatMap((source) => {
    const headline =
      source.status.status === "superseded" ? "⚠️ Pilot run — superseded. Not for citation."
      : source.status.status === "pilot" ? "⚠️ Pilot run — not for citation."
      : source.status.unrecognized !== null
        ? `⚠️ Status \`${source.status.unrecognized}\` is not one of \`final\`, \`pilot\`, \`superseded\` — not for citation.`
        : "⚠️ Status not declared — not for citation.";
    const where = many ? ` \`${source.file}\`:` : "";
    const note =
      source.status.note ??
      "No manifest or source declaration says whether this dataset is a pilot or the final measurement. Add " +
        '`"status": "final"` to the run manifest when it is one.';
    return [`> **${headline}**${where} ${note}`, ""];
  });
};

const statusLine = (progress: Progress, sources: Sources): string => {
  if (progress.state === "no-measurement") {
    const expected = [...sources.missing, ...sources.present.map((source) => source.file)];
    return (
      "**Not measured yet.** No run has been recorded" +
      (expected.length === 0 ? "" : ` in ${expected.map((file) => `\`${file}\``).join(", ")}`) +
      ". This section fills in from the JSONL logs the moment a measurement lands; until then there is no number " +
      "to report, and an empty table is not one."
    );
  }
  if (progress.state === "in-progress") {
    return (
      `**Measurement in progress — ${progress.recorded} of ${progress.planned} planned runs recorded.** ` +
      "Everything below is computed from a partial matrix and will change when the run finishes. It is published " +
      "in this state because a benchmark that only appears once it is flattering is not a benchmark."
    );
  }
  if (progress.state === "over-planned") {
    return (
      `**${progress.recorded} runs recorded against a plan of ${progress.planned}.** More rows exist than the ` +
      "manifest declares, so the dataset and its manifest disagree — read the counts below as unverified until " +
      "that is reconciled."
    );
  }
  if (progress.state === "unknown-plan") {
    return (
      (progress.distinct === progress.recorded
        ? `**${progress.recorded} runs recorded.** `
        : `**${progress.distinct} measurements across ${progress.recorded} rows.** ` +
          `${progress.recorded - progress.distinct} row(s) are superseded by a re-run of the same task, ` +
          "arm and seed, and the analysis counts the survivor. ") +
      "No manifest declares how many runs the matrix was meant to produce, " +
      "so completeness cannot be checked from the logs alone."
    );
  }
  return `**Complete — ${progress.recorded} of ${progress.planned} planned runs recorded.**`;
};

/**
 * The markdown body, without the markers. Deterministic by construction: every
 * value traces to the JSONL or the manifest, and nothing reads the clock, the
 * working directory or git.
 */
export const buildReport = (sources: Sources): string => {
  assertNotSimulated(sources);

  const summary = summarize(sources.rows, sources.present.map((source) => source.file));
  const progress = progressOf(sources);
  const model = modelReport(sources, summary);
  const lines: string[] = [];

  lines.push(
    "<!-- Generated by `node bench/report.ts --section` from the result logs named below. Do not edit by hand:",
    "     CI regenerates this block and fails if a single byte differs (scripts/check-readme-numbers.mjs). -->",
    "",
    // Before the progress line and before any number: a reader who stops after
    // the first sentence still has to have been told what the data is worth.
    // Skipped when there are no rows — "not measured yet" is already the
    // strongest statement available, and nothing can be miscited from it.
    ...(progress.state === "no-measurement" ? [] : statusBanner(sources)),
    statusLine(progress, sources),
    "",
  );

  if (progress.state === "no-measurement") {
    lines.push(
      "The harness, the tasks and the significance test are in the repository and runnable today — see",
      "[`bench/README.md`](bench/README.md). What is missing is the run, not the ability to check it.",
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push(...provenanceTable(sources, summary, model.models), "");
  lines.push("**Re-proposal and violation rates, every recorded run:**", "");
  lines.push(...conditionTable(summary.conditions), "");

  if (summary.excluded_rows > 0) {
    const detail = Object.entries(summary.exclusions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, count]) => `${reason} = ${count}`)
      .join(", ");
    lines.push(
      `**Analysis set — ${summary.rows - summary.excluded_rows} of ${summary.rows} rows** ` +
        `(${summary.excluded_rows} excluded: ${detail}). A row that failed carries \`reproposed: false\` because ` +
        "the field is required, not because the agent declined to re-propose; leaving it in the denominator would " +
        "let the arm that crashed more often look like the arm that behaved better. The excluded runs are counted " +
        "here, never dropped silently.",
      "",
    );
    lines.push(...conditionTable(summary.analysis), "");
  } else {
    lines.push(
      `**Analysis set — all ${summary.rows} rows.** Nothing was excluded: no simulated rows, no failed runs, no ` +
        "run that never started.",
      "",
    );
  }

  const comparison = summary.comparison;
  if (comparison === null) {
    const measured = summary.analysis.reduce((total, condition) => total + condition.n, 0);
    lines.push(
      "**Significance:** not computed — " +
        (summary.comparison_unavailable_because ??
          (measured === 0
          ? "the analysis set is empty, so there is nothing to test."
          : "a comparison needs exactly two conditions.")),
      "",
    );
  } else {
    lines.push("**Significance:**", "");
    lines.push("| Quantity | Value |", "|---|---|");
    lines.push(`| Arms | \`${comparison.treatment}\` (treatment) vs \`${comparison.baseline}\` (baseline) |`);
    lines.push(
      `| Re-proposed / did not | \`${comparison.treatment}\` ${comparison.table.a}/${comparison.table.b}, ` +
        `\`${comparison.baseline}\` ${comparison.table.c}/${comparison.table.d} |`,
    );
    lines.push(`| Fisher exact, two-tailed | p = ${fmtP(comparison.p_value)} |`);
    lines.push(
      `| Rate difference, treatment minus baseline | ` +
        (comparison.rate_difference === null ? "n/a" : fmtPp(comparison.rate_difference)) +
        (comparison.rate_difference_ci95 === null
          ? ""
          : `, 95% CI [${fmtPp(comparison.rate_difference_ci95.lo)}, ${fmtPp(comparison.rate_difference_ci95.hi)}]`) +
        " |",
    );
    // The reason string comes from stats.ts and already says "not estimable",
    // so it is printed as the value rather than after a second prefix. Its
    // closing clause points at an internal function name, which means nothing in
    // a README; the substitution degrades to leaving it in place.
    const oddsReason = (comparison.odds_ratio_reason ?? "a cell is 0, so the estimate sits on the boundary").replace(
      / — use rateDifference\(\) for effect size$/,
      ". The rate difference above is the effect size to read instead",
    );
    lines.push(
      `| Odds ratio | ${comparison.odds_ratio === null ? `${oddsReason}.` : comparison.odds_ratio.toFixed(4)} |`,
    );
    lines.push(`| Paired (task, seed) cells | ${comparison.paired_cells} |`);
    lines.push(`| Rows excluded from the analysis set | ${comparison.excluded_rows} |`);
    lines.push("");
  }

  lines.push("**How the runs ended** — failures are reported, not filtered:", "");
  lines.push(...stopTable(summary.conditions), "");

  lines.push("**Read these numbers with their limits:**", "");
  for (const note of model.notes) lines.push(`- ${note}`);
  lines.push(
    "- Every rate here is conditional on the model that produced it. Re-proposal is a behaviour, and behaviours " +
      "differ between models, so these figures are not evidence about any other model.",
  );
  // The arm sizes are read off the analysis set rather than written down: a
  // sentence about statistical power that stops matching the data it describes
  // is the same defect as a hand-typed rate.
  const armSizes =
    comparison === null
      ? `${summary.rows - summary.excluded_rows} runs in the analysis set`
      : `${comparison.table.a + comparison.table.b} and ${comparison.table.c + comparison.table.d} runs per arm`;
  lines.push(
    `- ${armSizes}: this matrix is only powered to detect a large effect, so a non-significant result from it is ` +
      "a statement about the sample size, not about CommitLore. The exact power table is in " +
      "[`bench/README.md`](bench/README.md).",
  );
  if (comparison !== null) {
    lines.push(
      "- Fisher exact treats the runs as independent while the design is paired by (task, seed). It is the " +
        "pre-registered result, but it is not a valid paired-data test. See the correction in " +
        "[`docs/VERDICT-M4.md`](docs/VERDICT-M4.md).",
    );
  }

  return `${lines.join("\n")}\n`;
};

/** The exact block the README carries, markers included. */
export const renderSection = (sources: Sources): string =>
  `${MARKER_BEGIN}\n${buildReport(sources)}${MARKER_END}\n`;

export const buildJson = (sources: Sources): string => {
  assertNotSimulated(sources);
  const summary = summarize(sources.rows, sources.present.map((source) => source.file));
  return `${JSON.stringify(
    {
      sources: sources.present.map((source) => ({
        file: source.file,
        rows: source.rows.length,
        manifest: source.manifestFile,
        planned_runs: source.plannedRuns,
        model: source.manifest?.model ?? null,
        repo_sha: source.manifest?.environment?.repo_sha ?? null,
        status: source.status,
      })),
      missing_sources: sources.missing,
      citable: sources.present.length > 0 && sources.present.every((source) => source.status.citable),
      progress: progressOf(sources),
      model: modelReport(sources, summary),
      summary,
    },
    null,
    2,
  )}\n`;
};

const USAGE = `usage: report.ts <results.jsonl...> [--format markdown|json]
       report.ts [<results.jsonl...>] --section

  --section   print the exact README block (markers included). With no files,
              reads the declared README sources: ${README_SOURCES.join(", ")}
  --format    markdown (default) or json
`;

const main = (): number => {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }

  const section = argv.includes("--section");
  const formatIndex = argv.indexOf("--format");
  const format = formatIndex === -1 ? "markdown" : argv[formatIndex + 1];
  if (format !== "markdown" && format !== "json") {
    process.stderr.write(`report: --format must be markdown or json, got ${format ?? "(nothing)"}\n`);
    return 2;
  }
  if (section && format === "json") {
    process.stderr.write("report: --section emits the README block and cannot be combined with --format json\n");
    return 2;
  }

  const formatValueIndex = formatIndex === -1 ? -1 : formatIndex + 1;
  const files = argv.filter((arg, index) => !arg.startsWith("--") && index !== formatValueIndex);
  if (files.length === 0 && !section) {
    process.stderr.write(USAGE);
    return 2;
  }

  const useDefaults = files.length === 0;
  const sources = readSources(useDefaults ? README_SOURCES : files, { allowMissing: useDefaults });
  const output = section ? renderSection(sources) : format === "json" ? buildJson(sources) : buildReport(sources);
  process.stdout.write(output);
  return 0;
};

if (import.meta.filename === process.argv[1]) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`report: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
