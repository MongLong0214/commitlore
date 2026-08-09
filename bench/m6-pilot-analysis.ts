/**
 * M6 base-rate pilot — the only computation its rows license.
 *
 * Written before the pilot finished, against §13's committed reading, so the
 * calculation is not chosen once the rows are visible. It prints the
 * `no-grade` rate, the per-task spread behind it, and which of §13's three
 * readings the rate falls into. It computes no comparison and no verdict:
 * the pilot has one arm and cannot compare anything.
 *
 *   node --experimental-strip-types bench/m6-pilot-analysis.ts <shard.jsonl>
 */

import { readFileSync } from "node:fs";

interface Row {
  readonly task: string;
  readonly cond: string;
  readonly seed: number;
  readonly model: string;
  readonly harness_commit: string;
  readonly dist_digest: string;
  readonly reproposed: boolean;
  readonly tokens: number;
  readonly duration_ms: number;
}

const path = process.argv[2];
if (path === undefined) {
  console.error("usage: m6-pilot-analysis.ts <shard.jsonl>");
  process.exit(2);
}

const rows: Row[] = readFileSync(path, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as Row);

/**
 * A pilot whose rows came from more than one build is not a pilot. M5 lost a
 * shard to exactly this and the check that would have caught it is two lines.
 */
const harnesses = new Set(rows.map((r) => r.harness_commit));
const digests = new Set(rows.map((r) => r.dist_digest));
const models = new Set(rows.map((r) => r.model));
const arms = new Set(rows.map((r) => r.cond));

const fail = (message: string): never => {
  console.error(`m6 pilot: ${message}`);
  process.exit(1);
};

if (arms.size !== 1 || !arms.has("no-grade")) fail(`expected one arm, no-grade; got ${[...arms].join(", ")}`);
if (harnesses.size !== 1) fail(`rows span ${harnesses.size} harness commits: ${[...harnesses].join(", ")}`);
if (digests.size !== 1) fail(`rows span ${digests.size} dist digests`);
if (models.size !== 1) fail(`rows span ${models.size} models: ${[...models].join(", ")}`);

const cell = (r: Row): string => `${r.task}:${r.seed}`;
const seen = new Set<string>();
for (const r of rows) {
  if (seen.has(cell(r))) fail(`duplicate task-seed cell ${cell(r)} — one arm counted twice`);
  seen.add(cell(r));
}

const complied = rows.filter((r) => r.reproposed).length;
const rate = complied / rows.length;

/** §13's three readings, applied rather than chosen. */
const reading =
  rate >= 0.1
    ? "RUNNABLE — n follows from §13's table"
    : rate >= 0.03
      ? "POSSIBLE BUT EXPENSIVE — several times M5's size; the cost is stated and the decision is the owner's"
      : "REFUTATION DIRECTION — no-grade sits at or under M5's commitlore-on rate; §2 says a difference this way is reported as a refutation, not a result";

const tasks = [...new Set(rows.map((r) => r.task))].sort();
const perTask = tasks.map((t) => {
  const rs = rows.filter((r) => r.task === t);
  return { task: t.replace("reproposal-", ""), n: rs.length, hit: rs.filter((r) => r.reproposed).length };
});

console.log(`rows            ${rows.length}`);
console.log(`arm             ${[...arms][0]}`);
console.log(`model           ${[...models][0]}`);
console.log(`harness         ${[...harnesses][0].slice(0, 8)}   dist ${[...digests][0].slice(0, 8)}`);
console.log(`tasks x seeds   ${tasks.length} x ${new Set(rows.map((r) => r.seed)).size}`);
console.log("");
console.log(`no-grade rate   ${complied}/${rows.length} = ${(rate * 100).toFixed(1)}%`);
console.log("");
for (const p of perTask) console.log(`  ${p.task.padEnd(24)} ${p.hit}/${p.n}`);
console.log("");
console.log(`wall-clock      ${(rows.reduce((a, r) => a + r.duration_ms, 0) / 60000).toFixed(1)} min total`);
console.log(`tokens          ${rows.reduce((a, r) => a + r.tokens, 0).toLocaleString()}`);
console.log("");
console.log(`§13 reading     ${reading}`);
