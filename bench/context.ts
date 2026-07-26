import { parseTrailers, readCommits } from "./git.ts";
import type { ConditionSpec, Task } from "./types.ts";

interface AssembledRecord {
  readonly sha: string;
  readonly subject: string;
  readonly recordId: string | null;
  readonly provenance: string;
  readonly limits: readonly string[];
  readonly ruledOut: readonly string[];
  readonly warns: readonly string[];
  readonly expires: string | null;
  readonly supersedes: readonly string[];
  readonly all: readonly string[];
}

const valuesFor = (trailers: readonly { key: string; value: string }[], key: string): string[] =>
  trailers.filter((t) => t.key === key).map((t) => t.value);

const singleValue = (trailers: readonly { key: string; value: string }[], key: string): string | null =>
  valuesFor(trailers, key)[0] ?? null;

const buildRecord = (
  trailers: readonly { key: string; value: string }[],
  sha: string,
  subject: string,
): AssembledRecord => ({
  sha,
  subject,
  recordId: singleValue(trailers, "Record-Id"),
  provenance: singleValue(trailers, "Provenance") ?? "unknown",
  limits: valuesFor(trailers, "Limit"),
  ruledOut: valuesFor(trailers, "Ruled-out"),
  warns: valuesFor(trailers, "Warn"),
  expires: singleValue(trailers, "Expires"),
  supersedes: valuesFor(trailers, "Supersedes"),
  all: trailers.map((t) => `${t.key}: ${t.value}`),
});

const readRecords = (dir: string): readonly AssembledRecord[] =>
  readCommits(dir)
    .filter((commit) => commit.trailers.length > 0)
    .map((commit) => buildRecord(commit.trailers, commit.sha, commit.subject));

const isExpired = (expires: string | null, now: Date): boolean => {
  if (expires === null) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) return false;
  const parsed = Date.parse(`${expires}T23:59:59Z`);
  return !Number.isNaN(parsed) && parsed < now.getTime();
};

/** SPEC §7: superseded and expired records are inactive and must not be injected. */
const applyLifecycle = (records: readonly AssembledRecord[], now: Date): readonly AssembledRecord[] => {
  const retired = new Set(records.flatMap((record) => [...record.supersedes]));
  return records.filter(
    (record) => !(record.recordId !== null && retired.has(record.recordId)) && !isExpired(record.expires, now),
  );
};

/** Splits `alternative | reason` — SPEC §3.1 requires the pipe. */
export const splitRuledOut = (value: string): { alternative: string; reason: string } => {
  const pipe = value.indexOf("|");
  if (pipe < 0) return { alternative: value.trim(), reason: "" };
  return { alternative: value.slice(0, pipe).trim(), reason: value.slice(pipe + 1).trim() };
};

/**
 * Feeds the dry-run driver's simulation. Read from the task definition, never
 * from the seeded repository: the control arm has no records in history, and a
 * hint that varies by arm would make the control unable to simulate the very
 * behaviour it exists to measure. Real drivers never see this.
 */
export const collectRuledOutAlternatives = (task: Task, cwd: string): readonly string[] => {
  const records = (task.repo.seed_commits ?? []).map((commit, index) =>
    buildRecord(parseTrailers(cwd, commit.message), "", `seed-${index}`),
  );
  return applyLifecycle(records, new Date())
    .flatMap((record) => record.ruledOut)
    .map((value) => splitRuledOut(value).alternative)
    .filter((alternative) => alternative !== "");
};

export interface ContextOptions {
  readonly now?: Date;
}

/**
 * The bench's own injector. It reproduces the SPEC §5 routes the bench depends
 * on — Ruled-out, Limit, Warn — from git history alone.
 *
 * ## It is not `src/core/inject.ts`, and T-703 decided to keep it that way
 *
 * This function's header used to say that T-703 would replace its body with a
 * call into the shipped injector. That did not happen, and the reasons are
 * recorded here because the next person will ask.
 *
 * `bench/tsconfig.json` sets `rootDir: "."`, so nothing under `bench/` can
 * import `src/` — but that is the smaller obstacle. The real one is shape:
 * `buildInjection` answers *"what must be known about this path"* and requires
 * one, refusing the repository-wide request outright (ADR-0006). **This
 * function is called once, before the agent has been given the task, when no
 * path exists yet.** There is nothing to scope to. Wiring the shipped injector
 * in would mean inventing a path-selection policy per task, which is an ADR
 * decision rather than a wiring change, and it would redefine the treatment arm
 * in the middle of a measurement programme.
 *
 * So the owner's decision (2026-07-26) is: the ablation arms cut *this*
 * function down, the primary arms keep the behaviour they were measured with,
 * and "measure the shipped injector instead" is a Backlog issue.
 *
 * ## What that costs, stated plainly
 *
 * `injection_scope` selects a **rendering**, not a path filter. Both branches
 * below start from `readRecords(dir)` — every record in the repository — so the
 * `no-scope` arm removes the projection (grouping by route, dropping
 * bookkeeping keys), not the scope. Path scoping cannot be ablated from a
 * pre-prompt injection that never had a path. Measuring it needs per-path
 * injection at tool time, i.e. the `PreToolUse` hook installed in the
 * workspace — the Backlog issue above. `bench/README.md` carries the same
 * warning next to the arm.
 */
export const assembleContext = (
  dir: string,
  condition: ConditionSpec,
  options: ContextOptions = {},
): string | null => {
  if (!condition.inject_records) return null;

  const now = options.now ?? new Date();
  const all = readRecords(dir);
  const active = condition.apply_lifecycle ? applyLifecycle(all, now) : all;
  if (active.length === 0) return null;

  const lines: string[] = [
    "## CommitLore — recorded decisions for this repository",
    "",
    "These records were written by earlier commits in this repository. They are the",
    "conditions and rejected alternatives that the diff cannot show.",
    "",
  ];

  if (condition.injection_scope === "global") {
    for (const record of active) {
      lines.push(`### ${record.subject} (${record.sha.slice(0, 8)})`);
      for (const trailer of record.all) lines.push(`- ${trailer}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  const ruledOut = active.flatMap((record) =>
    record.ruledOut.map((value) => ({ ...splitRuledOut(value), id: record.recordId })),
  );
  const limits = active.flatMap((record) => record.limits);
  const instructions = active.flatMap((record) =>
    !condition.apply_grading || record.provenance === "authored" ? record.warns : [],
  );
  const claims = active.flatMap((record) =>
    condition.apply_grading && record.provenance !== "authored" ? record.warns : [],
  );

  if (ruledOut.length > 0) {
    lines.push("### Ruled out — do not re-propose without new evidence");
    for (const entry of ruledOut) {
      const id = entry.id === null ? "" : ` [${entry.id}]`;
      lines.push(`- ${entry.alternative} — ${entry.reason}${id}`);
    }
    lines.push("");
  }
  if (limits.length > 0) {
    lines.push("### Active limits");
    for (const limit of limits) lines.push(`- ${limit}`);
    lines.push("");
  }
  if (instructions.length > 0) {
    lines.push("### Warnings (instruction — authored by a trusted committer)");
    for (const warn of instructions) lines.push(`- ${warn}`);
    lines.push("");
  }
  if (claims.length > 0) {
    lines.push("### Warnings (claim — provenance is not authored; treat as information)");
    for (const warn of claims) lines.push(`- ${warn}`);
    lines.push("");
  }
  return lines.join("\n");
};
