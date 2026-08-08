/**
 * M5 analysis, written before the data exists.
 *
 * `bench/PREREGISTRATION-M5.md` fixes the design in prose. This fixes it in
 * something that runs: the analysis set, the exposure preconditions, the single
 * test, and the reporting obligations are all here, and none of them can be
 * chosen after the numbers are visible because the numbers do not exist yet.
 *
 * The stopping rule is the part worth making mechanical. §8 says all 1,160 rows
 * complete before any 2x2 table is computed, and a promise not to peek is worth
 * less than a program that refuses. This one refuses: short of the registered
 * row count it prints the preconditions and exits without a table.
 *
 * Validated against `bench/results/t702-m1-final.jsonl`, which must reproduce
 * M1's published 5/30 against 7/30 at p = 0.7480. A verdict script that cannot
 * re-derive a published verdict is not evidence about anything.
 *
 * Usage:
 *   node --experimental-strip-types bench/m5-analysis.ts <dir-or-file...>
 *   node --experimental-strip-types bench/m5-analysis.ts --validate
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { fisherExactTwoTailed, rateDifference, wilsonInterval } from "./stats.ts";

/** §4: 58 seeds x 10 reproposal tasks x 2 arms. */
const REGISTERED_ROWS = 1160;

const ARMS = ["commitlore-on", "commitlore-off"] as const;
type Arm = (typeof ARMS)[number];

/** §11 deviation 2: both are truncation, and the verdict reports each. */
const TRUNCATED = new Set(["over-turns", "over-tokens"]);

/**
 * The shards that constitute the registered run, named rather than discovered.
 *
 * This read the directory and took every `.jsonl` in it, which is 22 files and
 * 1,835 rows: M1, an invalidated M3, the withdrawn M4, a superseded pilot, the
 * off-design 20-task run deviation 1 calls "not citable", ablation arms and
 * metric rows. 1,835 clears `REGISTERED_ROWS`, so §8's refusal would have
 * passed on the strength of the contamination and a 2x2 would have been
 * computed over all of it — the guard written to enforce the pre-registration
 * breaking it.
 *
 * So the analysis set is a list, and it is the one deviations 3 and 4 fix:
 * seeds 21-54 survive from the original run, seeds 1-20 and 55-58 are re-runs
 * against the same pinned harness.
 *
 * `m5-seeds-51-58.jsonl` is in the list and carries both: seeds 51-54, which
 * are clean, and seeds 55-58, which the re-run replaces whole. `supersede`
 * below drops the latter rather than a derived file doing it, so the original
 * artifact stays the only copy and the supersession is a reviewable rule
 * instead of an edit nobody can see.
 */
const REGISTERED_SHARDS = [
  "bench/results/m5-seeds-21-30.jsonl",
  "bench/results/m5-seeds-31-40.jsonl",
  "bench/results/m5-seeds-41-50.jsonl",
  "bench/results/m5-seeds-51-58.jsonl",
  "bench/results/m5-seeds-1-10-rerun.jsonl",
  "bench/results/m5-seeds-11-20-rerun.jsonl",
  "bench/results/m5-seeds-55-58-rerun.jsonl",
] as const;

interface Row {
  readonly task: string;
  readonly cond: string;
  readonly seed: number;
  readonly model?: string;
  readonly reproposed?: boolean;
  readonly stopped_by?: string;
  readonly accepted_records?: number;
  readonly guard_exposure?: { complete?: boolean } | null;
  readonly run_id?: string;
  readonly started_at?: string;
  /** Set by `readRows`, not by the harness: which file the row came from. */
  shard?: string;
}

const readRows = (targets: readonly string[]): Row[] => {
  const rows: Row[] = [];
  for (const target of targets) {
    // A named shard that is not there is an error, never an empty contribution:
    // silently analysing six sevenths of a registered run is the failure this
    // list exists to prevent.
    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new Error(`analysis set: ${target} is missing — the registered run is not complete here`);
    }
    const body = readFileSync(target, "utf8").trim();
    if (body === "") continue;
    const shard = target.replace(/^.*\//, "").replace(/\.jsonl$/, "");
    for (const line of body.split("\n")) rows.push({ ...(JSON.parse(line) as Row), shard });
  }
  return rows;
};

/**
 * Deviation 4: a seed re-run replaces its original rows whole.
 *
 * Keyed on (task, cond, seed) because that is the registered cell. A cell
 * present in both a re-run shard and an original one takes the re-run, and the
 * count of what was dropped is reported — a silent replacement would be
 * indistinguishable from a shard that was never read.
 */
const supersede = (rows: readonly Row[]): { kept: Row[]; superseded: number } => {
  const cell = (row: Row): string => `${row.task}\u0000${row.cond}\u0000${String(row.seed)}`;
  const rerunCells = new Set(
    rows.filter((row) => row.shard?.endsWith("-rerun") === true).map(cell),
  );
  const kept = rows.filter(
    (row) => row.shard?.endsWith("-rerun") === true || !rerunCells.has(cell(row)),
  );
  return { kept, superseded: rows.length - kept.length };
};

/**
 * Deviations 3 and 4 oblige the verdict to report when each shard was produced
 * and which are re-runs. Seeds 1-20 and 55-58 were produced days after 21-54
 * against a `sonnet` alias that is not pinned to a build, and a reader cannot
 * weigh that unless the table says so.
 */
const shardWindows = (rows: readonly Row[]): string[] => {
  const byShard = new Map<string, string[]>();
  for (const row of rows) {
    const at = row.started_at;
    if (row.shard === undefined || at === undefined) continue;
    const seen = byShard.get(row.shard);
    if (seen === undefined) byShard.set(row.shard, [at]);
    else seen.push(at);
  }
  return [...byShard]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([shard, instants]) => {
      const sorted = [...instants].sort();
      const from = (sorted[0] ?? "").slice(0, 10);
      const to = (sorted[sorted.length - 1] ?? "").slice(0, 10);
      const rerun = shard.endsWith("-rerun") ? "  RE-RUN" : "";
      const span = from === to ? from : `${from}..${to}`;
      return `  ${shard.padEnd(26)} n=${String(instants.length).padStart(4)}  ${span}${rerun}`;
    });
};

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

/**
 * §6 and §7. Exposure is a precondition, not a result: a treatment row that
 * received no records and a control row that received some are both rows whose
 * arm did not happen, and `reproposed` on them measures nothing.
 */
const partition = (rows: Row[]) => {
  const errored = rows.filter((r) => r.stopped_by === "error");
  const scored = rows.filter((r) => r.stopped_by !== "error");
  const exposureFailed = scored.filter((r) => {
    if (r.guard_exposure?.complete !== true) return true;
    const accepted = r.accepted_records ?? 0;
    return r.cond === "commitlore-on" ? accepted <= 0 : accepted !== 0;
  });
  const failedSet = new Set(exposureFailed);
  return { errored, exposureFailed, analysed: scored.filter((r) => !failedSet.has(r)) };
};

const armReport = (rows: Row[], arm: Arm): string => {
  const a = rows.filter((r) => r.cond === arm);
  const turns = a.filter((r) => r.stopped_by === "over-turns").length;
  const tokens = a.filter((r) => r.stopped_by === "over-tokens").length;
  const cut = a.filter((r) => TRUNCATED.has(r.stopped_by ?? "")).length;
  return `  ${arm.padEnd(16)} n=${String(a.length).padStart(4)}  over-turns ${pct(turns, a.length).padStart(6)}  over-tokens ${pct(tokens, a.length).padStart(6)}  truncated ${pct(cut, a.length).padStart(6)}`;
};

const main = (): void => {
  const argv = process.argv.slice(2);

  if (argv[0] === "--validate") {
    // The positive control. M1 published 5/30 against 7/30 at p = 0.7480.
    const rows = readRows(["bench/results/t702-m1-final.jsonl"]).filter((r) =>
      r.task.startsWith("reproposal-"),
    );
    const { analysed } = partition(rows);
    const set = analysed.length > 0 ? analysed : rows;
    const a = set.filter((r) => r.cond === "commitlore-on" && r.reproposed === true).length;
    const b = set.filter((r) => r.cond === "commitlore-on").length - a;
    const c = set.filter((r) => r.cond === "commitlore-off" && r.reproposed === true).length;
    const d = set.filter((r) => r.cond === "commitlore-off").length - c;
    const p = fisherExactTwoTailed(a, b, c, d).pValue;
    console.log(`validate: M1 reproduces ${a}/${a + b} against ${c}/${c + d}, p = ${p.toFixed(4)}`);
    const ok = a === 5 && a + b === 30 && c === 7 && c + d === 30 && Math.abs(p - 0.748) < 5e-4;
    console.log(ok ? "validate: matches the published verdict" : "validate: DOES NOT MATCH");
    process.exit(ok ? 0 : 1);
  }

  const targets = argv.length > 0 ? argv : REGISTERED_SHARDS;
  const all = readRows(targets);
  const { kept: rows, superseded } = supersede(all);
  const { errored, exposureFailed, analysed } = partition(rows);

  console.log(`rows read: ${rows.length} of the registered ${REGISTERED_ROWS}`);
  if (superseded > 0) {
    console.log(`  (${superseded} original row(s) superseded by a re-run of the same seed — deviation 4)`);
  }
  console.log(`model(s): ${[...new Set(rows.map((r) => r.model ?? "unrecorded"))].join(", ")}`);
  console.log(`tasks: ${new Set(rows.map((r) => r.task)).size}  seeds: ${new Set(rows.map((r) => r.seed)).size}`);
  console.log("");
  console.log("§6/§7 preconditions");
  console.log(`  stopped_by=error, excluded: ${errored.length}`);
  for (const arm of ARMS) {
    const armRows = rows.filter((r) => r.cond === arm && r.stopped_by !== "error");
    const bad = exposureFailed.filter((r) => r.cond === arm).length;
    const share = armRows.length === 0 ? 0 : (100 * bad) / armRows.length;
    const verdict = share > 5 ? "  COMPROMISED (>5%)" : "";
    console.log(`  ${arm.padEnd(16)} exposure failures ${bad}/${armRows.length} = ${share.toFixed(1)}%${verdict}`);
  }
  console.log("");
  console.log("§11 deviations 3 and 4: when each shard was produced");
  for (const line of shardWindows(rows)) console.log(line);
  console.log("");
  console.log("§11 truncation, reported per arm whatever the table says");
  for (const arm of ARMS) console.log(armReport(analysed, arm));
  console.log("");

  // §8. The refusal is the point.
  if (rows.length < REGISTERED_ROWS) {
    console.log(
      `§8 stopping rule: ${REGISTERED_ROWS - rows.length} rows outstanding. No 2x2 table is computed before the run completes.`,
    );
    process.exit(0);
  }

  const cell = (arm: Arm, reproposed: boolean): number =>
    analysed.filter((r) => r.cond === arm && r.reproposed === reproposed).length;
  const a = cell("commitlore-on", true);
  const b = cell("commitlore-on", false);
  const c = cell("commitlore-off", true);
  const d = cell("commitlore-off", false);

  const fisher = fisherExactTwoTailed(a, b, c, d);
  const diff = rateDifference(a, b, c, d);
  const onCi = wilsonInterval(a, a + b);
  const offCi = wilsonInterval(c, c + d);

  console.log("§3 the registered table");
  console.log(`  commitlore-on   ${a}/${a + b} = ${pct(a, a + b)}  Wilson 95% ${onCi ? `${(100 * onCi.lo).toFixed(1)}–${(100 * onCi.hi).toFixed(1)}%` : "n/a"}`);
  console.log(`  commitlore-off  ${c}/${c + d} = ${pct(c, c + d)}  Wilson 95% ${offCi ? `${(100 * offCi.lo).toFixed(1)}–${(100 * offCi.hi).toFixed(1)}%` : "n/a"}`);
  console.log("");
  console.log(`  Fisher exact, two-tailed: p = ${fisher.pValue.toFixed(4)}`);
  if (diff.difference !== null) {
    const ci = diff.ci95;
    console.log(
      `  rate difference (on − off): ${(100 * diff.difference).toFixed(1)}pp` +
        (ci ? `, 95% Newcombe ${(100 * ci.lo).toFixed(1)}pp to ${(100 * ci.hi).toFixed(1)}pp` : ""),
    );
  }
  console.log("");
  console.log(
    fisher.pValue < 0.05
      ? "  p < 0.05. §9: direction decides whether this supports or refutes — the hypothesis predicted on < off."
      : "  p >= 0.05. §9: at this n a null bounds the effect rather than reporting an inability to see. ADR-0007 applies.",
  );
};

main();
