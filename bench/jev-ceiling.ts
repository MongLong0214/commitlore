/**
 * The ceiling on verbatim selection, measured without a model — #1051 §4.
 *
 * The prototype can only ever produce a record by copying a passage that is
 * already in the source. So before asking how well a classifier picks that
 * passage, there is a prior question with no model in it:
 *
 *   **Is the passage there at all?**
 *
 * A trailer is written *in addition to* the prose that surrounds it, and often
 * *instead of* it — an author synthesises a `Limit:` from a conversation rather
 * than quoting one sentence of it. Every reference with no verbatim source is a
 * reference this design cannot reach, whatever model is asked. That fraction is
 * the ceiling, and until it is known, "0 of 29" is partly "the answer was not
 * in the input".
 *
 *   node bench/jev-ceiling.mjs [--n 60]
 *
 * No network, no key, no cost.
 *
 * ## How overlap is measured
 *
 * Content-word overlap between the trailer's value and the best-matching
 * sentence of the prose, as a fraction of the trailer's own content words.
 * Deliberately generous: it ignores word order, ignores everything the author
 * added, and takes the best sentence rather than requiring one. A reference
 * that scores low here is one no verbatim selector could have produced; a
 * reference that scores high is *reachable*, which is weaker than saying a
 * model would reach it.
 */

import { execFileSync } from 'node:child_process';

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};

const SAMPLE = Number(arg('--n', '60'));
const SCAN = Number(arg('--scan', '600'));
const CONTENT_KEYS = ['Limit', 'Warn', 'Ruled-out'];

const git = (args: readonly string[]): string =>
  execFileSync('git', [...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

/** Words that carry no identity. Kept short: a longer list flatters the score. */
const STOP = new Set(
  ('the a an and or but if then than that this these those is are was were be been being to of in on ' +
    'for with by from as at it its it\'s not no so do does did done can could would should will may ' +
    'might must have has had we i you they he she them us our your their there here what which who ' +
    'when where why how all any both each few more most other some such only own same too very s t ' +
    'just now also into over under again further once')
    .split(/\s+/),
);

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP.has(word));

/**
 * Three granularities, because the fair comparison is the unit the enumerator
 * actually offers.
 *
 * `enumerateCandidates` offers a whole block when it is short enough and
 * sentences when it is not, so scoring only against sentences would understate
 * what the design can reach. The paragraph and whole-prose rows are the
 * generous end: whole-prose is an upper bound nothing could beat, since it is
 * every word the author wrote.
 */
const unitsOf = (prose: string, granularity: 'sentence' | 'paragraph' | 'whole'): string[] => {
  if (granularity === 'whole') return [prose];
  if (granularity === 'paragraph') {
    return prose
      .split(/\n{2,}/)
      .map((piece) => piece.trim())
      .filter((piece) => piece.length >= 24);
  }
  return prose
    .split(/(?<=[.!?。！？])\s+|\n{2,}/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length >= 24);
};

const sentences = (prose: string): string[] => unitsOf(prose, 'sentence');

interface Reference {
  readonly key: string;
  readonly value: string;
}

interface Row extends Reference {
  readonly sha: string;
  readonly score: number;
  readonly sentence: string;
  readonly paragraph: number;
  readonly whole: number;
}

const split = (message: string): { prose: string; values: Reference[] } => {
  const paragraphs = message.replace(/\r\n/g, '\n').split(/\n{2,}/);
  while (paragraphs.length > 0 && (paragraphs.at(-1) ?? '').trim() === '') paragraphs.pop();
  const block = paragraphs.at(-1) ?? '';
  const values: Reference[] = [];
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z][A-Za-z-]*): (.+)$/.exec(line);
    const key = match?.[1];
    const value = match?.[2];
    if (key === undefined || value === undefined) continue;
    if (CONTENT_KEYS.includes(key)) values.push({ key, value });
  }
  const prose = paragraphs
    .slice(0, -1)
    .join('\n\n')
    .split('\n')
    .filter((line) => !/^(Closes|Fixes|Resolves)\s+#/i.test(line.trim()))
    .join('\n')
    .trim();
  return { prose, values };
};

/**
 * `Ruled-out` is `alternative | reason`, and the design copies two spans from
 * one passage. Scored on the whole value: if neither half is in the prose, the
 * reference is unreachable either way.
 */
const bestOverlap = (
  value: string,
  prose: string,
  granularity: 'sentence' | 'paragraph' | 'whole' = 'sentence',
): { score: number; sentence: string } => {
  const target = new Set(words(value));
  if (target.size === 0) return { score: 0, sentence: '' };
  let best = { score: 0, sentence: '' };
  for (const sentence of unitsOf(prose, granularity)) {
    const have = new Set(words(sentence));
    let hit = 0;
    for (const word of target) if (have.has(word)) hit += 1;
    const score = hit / target.size;
    if (score > best.score) best = { score, sentence };
  }
  return best;
};

const shas = git(['log', '--format=%H', `-${String(SCAN)}`, 'main']).trim().split('\n');
const rows: Row[] = [];
for (const sha of shas) {
  if (rows.length >= SAMPLE) break;
  const { prose, values } = split(git(['show', '--no-patch', '--format=%B', '--end-of-options', sha]));
  if (prose.length < 200 || values.length === 0) continue;
  for (const { key, value } of values) {
    const best = bestOverlap(value, prose);
    rows.push({
      sha: sha.slice(0, 8),
      key,
      value,
      score: best.score,
      sentence: best.sentence,
      paragraph: bestOverlap(value, prose, 'paragraph').score,
      whole: bestOverlap(value, prose, 'whole').score,
    });
  }
}

const scores = rows.map((row) => row.score).sort((a, b) => a - b);
const q = (p: number): number =>
  scores.length === 0 ? 0 : (scores[Math.min(scores.length - 1, Math.floor(p * scores.length))] ?? 0);
const atLeast = (bar: number): number => rows.filter((row) => row.score >= bar).length;

const byKey = new Map<string, { n: number; reachable: number }>();
for (const row of rows) {
  const stat = byKey.get(row.key) ?? { n: 0, reachable: 0 };
  stat.n += 1;
  if (row.score >= 0.6) stat.reachable += 1;
  byKey.set(row.key, stat);
}

process.stdout.write(`${'-'.repeat(78)}\n`);
process.stdout.write(`  ${rows.length} reference trailers from ${new Set(rows.map((r) => r.sha)).size} commits\n\n`);
process.stdout.write(`  best-sentence content-word overlap with the trailer's own value:\n`);
process.stdout.write(
  `    p10 ${q(0.1).toFixed(2)}   median ${q(0.5).toFixed(2)}   p90 ${q(0.9).toFixed(2)}   max ${(scores.at(-1) ?? 0).toFixed(2)}\n\n`,
);
for (const bar of [0.4, 0.6, 0.8, 0.95]) {
  process.stdout.write(
    `    >= ${bar.toFixed(2)} overlap: ${String(atLeast(bar)).padStart(3)} / ${String(rows.length)}  ` +
      `(${((atLeast(bar) / rows.length) * 100).toFixed(0)}%)\n`,
  );
}
process.stdout.write(`\n  the same, at coarser granularity -- the generous end:\n`);
const COARSER: readonly [string, 'paragraph' | 'whole'][] = [
  ['paragraph', 'paragraph'],
  ['whole prose', 'whole'],
];
for (const [label, field] of COARSER) {
  const xs = rows.map((row) => row[field]).sort((a, b) => a - b);
  const med = xs[Math.floor(xs.length / 2)] ?? 0;
  process.stdout.write(
    `    ${label.padEnd(12)} median ${med.toFixed(2)}   ` +
      `>= 0.60: ${String(xs.filter((x) => x >= 0.6).length).padStart(3)} / ${String(xs.length)}  ` +
      `>= 0.80: ${String(xs.filter((x) => x >= 0.8).length).padStart(3)} / ${String(xs.length)}\n`,
  );
}

process.stdout.write(`\n  by key, at the 0.60 bar:\n`);
for (const [key, stat] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  process.stdout.write(
    `    ${key.padEnd(10)} ${String(stat.reachable).padStart(3)} / ${String(stat.n).padEnd(3)}  ` +
      `(${((stat.reachable / stat.n) * 100).toFixed(0)}%)\n`,
  );
}
process.stdout.write(`\n  the three highest, and the three lowest:\n`);
const sorted = [...rows].sort((a, b) => b.score - a.score);
for (const row of [...sorted.slice(0, 3), ...sorted.slice(-3)]) {
  process.stdout.write(`    ${row.score.toFixed(2)}  ${row.key.padEnd(10)} ${row.value.slice(0, 84)}\n`);
}
process.stdout.write(`${'-'.repeat(78)}\n`);
process.stdout.write(
  '  A low number here is a ceiling no classifier can lift: the passage the design would\n' +
    '  have to copy is not in the source. A high number says the reference is reachable,\n' +
    '  which is weaker than saying a model would reach it.\n',
);
