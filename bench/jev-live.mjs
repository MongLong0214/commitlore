/**
 * A bounded live check of the optional Jev prototype — #1051 §4.
 *
 * Not CI, not a benchmark, not a research platform. It is the smallest thing
 * that can answer "does the real provider, through the real client, produce
 * something the real assembler turns into a real record" — and it is explicitly
 * authorized each time it runs, because it spends money and sends text.
 *
 *   COMMITLORE_JEV_API_KEY=... node bench/jev-live.mjs [--out <dir>]
 *
 * ## Rules this file holds itself to
 *
 * - **A declared, finite request budget.** `MAX_REQUESTS` below. The run stops
 *   at it rather than at a convenient result.
 * - **References defined before any output is seen.** Each case carries the
 *   answer a careful reader would give, written into this file with the input.
 *   Reading the model's answer first and then deciding what the right one was
 *   is how a precision figure becomes a description of the model's opinion.
 * - **Failed and unexecuted rows stay visible.** A case that errored is printed
 *   as an error, never dropped, and the totals count it.
 * - **Unknown usage is unknown.** A response with no usage reports `null`, not
 *   zero, and the cost line says "estimated" because $0.042/1e6 input tokens is
 *   a dated price and not an invoice.
 * - **Synthetic input, labelled as such.** Every case below was written for this
 *   file. None is a real conversation, and nothing here measures how the model
 *   does on real ones.
 *
 * What a green run does NOT establish: accuracy, recall, or that the prototype
 * is worth enabling. It establishes that the wire contract holds against the
 * live endpoint.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveJevActivation } from '../dist/jev/activation.js';
import { askJev, describeOutcome } from '../dist/jev/client.js';
import { assembleDrafts, planDiscovery } from '../dist/jev/discover.js';

/** The ceiling. One request per case; the run refuses to exceed it. */
const MAX_REQUESTS = 4;

/** Built the way the adapter builds one, so offsets and lines are real. */
const sourceOf = (turns) => {
  const blocks = [];
  let text = '';
  let line = 1;
  for (const [index, turn] of turns.entries()) {
    const header = `${turn.role}:\n`;
    const start = text.length + header.length;
    const chunk = `${header}${turn.text}\n\n`;
    const startLine = line + 1;
    text += chunk;
    line += chunk.split('\n').length - 1;
    blocks.push({
      id: `b${index}`,
      role: turn.role,
      start,
      end: start + turn.text.length,
      startLine,
      endLine: startLine + turn.text.split('\n').length - 1,
      complete: true,
    });
  }
  const bytes = Buffer.byteLength(text, 'utf8');
  return {
    host: 'claude-code',
    sessionId: 'bench',
    worktree: '/bench',
    gitdir: '/bench/.git',
    path: '/bench/transcript.jsonl',
    digest: '0'.repeat(64),
    windowFrom: 0,
    windowTo: bytes,
    size: bytes,
    mtimeMs: 0,
    text,
    blocks,
    coverage: {
      recordsInspected: turns.length,
      recordsOmitted: 0,
      unknownForms: 0,
      bytesInspected: bytes,
      bytesTotal: bytes,
      complete: true,
    },
  };
};

/**
 * The cases, with their references.
 *
 * `expectRecord` is what a careful reader would say *before* seeing any model
 * output: whether this conversation, against this change, contains a decision
 * worth recording. It is written here with the input and is not edited after a
 * run — an unfavourable row stays.
 */
const CASES = [
  {
    id: 'vendor-cap',
    label: 'synthetic — an explicit external constraint',
    expectRecord: true,
    reference: 'The vendor cap is a stated constraint on the change; a Limit is the right record.',
    turns: [
      {
        role: 'user',
        text: 'The vendor caps us at three retries per minute on that endpoint, so we cannot raise the ceiling past three however the backoff is tuned.',
      },
    ],
    change: { paths: ['src/core/retry.ts'], diffExcerpt: '-const RETRIES = 10;\n+const RETRIES = 3;\n' },
  },
  {
    id: 'narration',
    label: 'synthetic — routine narration, no decision',
    expectRecord: false,
    reference: 'Nothing is decided or constrained here; a record would be noise.',
    turns: [
      {
        role: 'assistant',
        text: 'I have run the test suite again and it finished in about forty seconds with everything green, so I will move on to the next file now.',
      },
    ],
    change: { paths: ['src/core/retry.ts'], diffExcerpt: '+const RETRIES = 3;\n' },
  },
  {
    id: 'unrelated',
    label: 'synthetic — a real constraint about something else',
    expectRecord: false,
    reference:
      'The constraint is real but is about the deploy window, not about the retry change; relevance should be unrelated.',
    turns: [
      {
        role: 'user',
        text: 'The deploy window on Thursdays is thirty minutes and operations will not extend it, so anything that needs a longer migration has to wait.',
      },
    ],
    change: { paths: ['src/core/retry.ts'], diffExcerpt: '-const RETRIES = 10;\n+const RETRIES = 3;\n' },
  },
  {
    id: 'korean',
    label: 'synthetic — the same shape in Korean',
    expectRecord: true,
    reference: 'A stated external constraint; the language is not supposed to matter.',
    turns: [
      {
        role: 'user',
        text: '벤더가 해당 엔드포인트에서 분당 재시도를 세 번으로 제한하고 있어서, 백오프를 어떻게 조정하든 상한을 세 번 위로 올릴 수 없다.',
      },
    ],
    change: { paths: ['src/core/retry.ts'], diffExcerpt: '-const RETRIES = 10;\n+const RETRIES = 3;\n' },
  },
];

const outDir = (() => {
  const at = process.argv.indexOf('--out');
  return at === -1 ? resolve('bench', 'jev-live-out') : resolve(process.argv[at + 1] ?? '.');
})();

const main = async () => {
  const activation = resolveJevActivation(process.env);
  if (!activation.enabled) {
    process.stderr.write(
      'jev-live: not enabled. Set COMMITLORE_JEV_API_KEY (this run costs money and sends the ' +
        'synthetic text in this file to TypeSafe).\n',
    );
    process.exitCode = 2;
    return;
  }

  mkdirSync(outDir, { recursive: true });
  const rows = [];
  let requests = 0;

  for (const testCase of CASES) {
    if (requests >= MAX_REQUESTS) {
      rows.push({ id: testCase.id, status: 'unexecuted', reason: 'request budget exhausted' });
      continue;
    }
    const source = sourceOf(testCase.turns);
    const plan = planDiscovery(source, testCase.change);
    if (plan.questions.length === 0) {
      rows.push({ id: testCase.id, status: 'unexecuted', reason: 'no candidates enumerated' });
      continue;
    }

    requests += 1;
    const started = Date.now();
    const outcome = await askJev({
      key: activation.key,
      state: plan.state,
      questions: plan.questions,
    });
    const elapsedMs = Date.now() - started;

    const assembled = assembleDrafts({ plan, outcome, recordCap: 1 });
    const produced = assembled.records.length > 0;
    rows.push({
      id: testCase.id,
      label: testCase.label,
      status: outcome.status,
      detail: describeOutcome(outcome),
      elapsedMs,
      candidates: plan.coverage.candidatesAsked,
      questions: plan.questions.length,
      expectRecord: testCase.expectRecord,
      reference: testCase.reference,
      producedRecord: produced,
      agrees: produced === testCase.expectRecord,
      trailers: assembled.records.flatMap((record) => record.trailers),
      skipped: assembled.outcomes.filter((entry) => !entry.kept).map((entry) => entry.reason),
      usage: outcome.usage,
    });
  }

  const executed = rows.filter((row) => row.status === 'answered' || row.status === 'unavailable');
  const answered = rows.filter((row) => row.status === 'answered');
  const agreed = answered.filter((row) => row.agrees).length;
  const knownTokens = rows.reduce(
    (total, row) => (row.usage?.inputTokens == null ? total : total + row.usage.inputTokens),
    0,
  );
  const unknownUsage = rows.filter((row) => row.status === 'answered' && row.usage == null).length;

  const report = {
    ranAt: new Date().toISOString(),
    inputs: 'synthetic — every case is written into bench/jev-live.mjs and is not a real conversation',
    labels: 'references declared in the source before the run; not edited after seeing output',
    budget: { max: MAX_REQUESTS, used: requests },
    totals: {
      cases: CASES.length,
      executed: executed.length,
      answered: answered.length,
      unexecuted: rows.filter((row) => row.status === 'unexecuted').length,
      agreedWithReference: agreed,
      knownInputTokens: knownTokens,
      rowsWithUnknownUsage: unknownUsage,
      estimatedUsd: knownTokens * (0.042 / 1e6),
      estimateNote:
        'estimated from the dated price $0.042 per 1e6 input tokens (docs read 2026-09-18); not an invoice',
    },
    caveat:
      'Four synthetic cases establish that the wire contract holds live. They are not an accuracy ' +
      'measurement, not a recall measurement, and say nothing about real conversations.',
    rows,
  };

  const path = resolve(outDir, `jev-live-${report.ranAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);

  process.stdout.write(`${'-'.repeat(72)}\n`);
  for (const row of rows) {
    if (row.status === 'unexecuted') {
      process.stdout.write(`  ${row.id.padEnd(12)} UNEXECUTED — ${row.reason}\n`);
      continue;
    }
    const verdict = row.status !== 'answered' ? 'ERROR' : row.agrees ? 'agrees' : 'DIFFERS';
    process.stdout.write(
      `  ${row.id.padEnd(12)} ${verdict.padEnd(10)} expected record=${String(row.expectRecord)} ` +
        `got=${String(row.producedRecord)}  ${row.detail}  ${row.elapsedMs}ms\n`,
    );
    for (const trailer of row.trailers ?? []) {
      process.stdout.write(`      ${trailer.key}: ${trailer.value}\n`);
    }
    if ((row.trailers ?? []).length === 0 && row.skipped?.length) {
      process.stdout.write(`      skipped: ${row.skipped.join(', ')}\n`);
    }
  }
  process.stdout.write(`${'-'.repeat(72)}\n`);
  process.stdout.write(
    `  ${report.totals.answered}/${report.totals.cases} answered, ` +
      `${report.totals.agreedWithReference} agreed with the declared reference, ` +
      `${report.totals.unexecuted} unexecuted\n`,
  );
  process.stdout.write(
    `  ${report.totals.knownInputTokens} known input token(s), ` +
      `${report.totals.rowsWithUnknownUsage} row(s) with unknown usage, ` +
      `~$${report.totals.estimatedUsd.toFixed(6)} estimated\n`,
  );
  process.stdout.write(`  saved: ${path}\n`);
  process.stdout.write(`  ${report.caveat}\n`);
};

await main();
