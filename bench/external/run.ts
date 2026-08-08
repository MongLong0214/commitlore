/**
 * The external-corpus run, registered in `bench/EXTERNAL-CORPUS.md` before this
 * file existed.
 *
 * Three measurements over the corpus of §3, in the order the method document
 * gives them:
 *
 *   1. `budgeted_log_coverage` (§4) — the part of the `git log` baseline that
 *      needs no records, on all five corpora including the calibration row;
 *   2. `revert_backfill` (§5) — the deterministic funnel from revert commits to
 *      notes-borne records, on the four externals;
 *   3. `decision_delivery` (§6) — the registered metric, same code, run on the
 *      backfilled corpus with the two notes-aware Git arms added.
 *
 * Usage:
 *   COMMITLORE_EXTERNAL_CORPUS_DIR=<dir with the clones> \
 *     node --experimental-strip-types bench/external/run.ts
 *
 * The clone directory is an input, never an output: no result row records where
 * the corpus happened to sit on the machine that measured it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { digestDistTree } from '../hooks-settings.ts';
import { DELIVERY_ROUTES, measureDecisionDelivery } from '../deterministic/recovery.ts';
import { assertCleanCheckout, command, git, rowBase } from '../deterministic/shared.ts';
import type { DeliveryRoute } from '../deterministic/types.ts';
import { backfillCorpus } from './backfill.ts';
import { PINNED_CORPORA, resolveCorpus } from './corpus.ts';
import { measureBudgetedLogCoverage } from './coverage.ts';
import { writeExternalReport } from './report.ts';
import type { ExternalDeliveryRow, ExternalRow } from './types.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * The seven registered arms plus the two of §6.2. The registered seven are kept
 * and reported even though the plain Git pair scores 0% on a notes-borne corpus:
 * omitting them would hide the fact that the 0% is about where the records are,
 * and reporting the notes arm alone would let a reader mistake it for the
 * shipped comparator.
 */
const EXTERNAL_ROUTES: readonly DeliveryRoute[] = [
  ...DELIVERY_ROUTES,
  'git-log-path-notes',
  'git-log-path-notes-budgeted',
];

/** The harness that produced these rows, for ADR-0018's `harness_digest`. */
const HARNESS_PATHS = ['bench/deterministic.ts', 'bench/deterministic', 'bench/external'] as const;

/** The built product, whose bytes `dist_digest` pins. */
const CLI = join(REPO_ROOT, 'dist', 'commitlore.mjs');

const stamp = (instant: string): string =>
  instant.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const main = (): void => {
  const corpusDir = process.env['COMMITLORE_EXTERNAL_CORPUS_DIR'];
  if (corpusDir === undefined) {
    throw new Error('COMMITLORE_EXTERNAL_CORPUS_DIR must name the directory holding the clones');
  }
  const outputDir = resolve(
    REPO_ROOT,
    process.env['COMMITLORE_EXTERNAL_OUTPUT_DIR'] ?? join('bench', 'results'),
  );
  assertCleanCheckout(REPO_ROOT);

  const measuredAt = new Date().toISOString();
  const harnessCommit = git(REPO_ROOT, ['rev-parse', 'HEAD']).stdout.trim();
  const distDigest = digestDistTree();
  const base = rowBase(REPO_ROOT, harnessCommit, distDigest, measuredAt, HARNESS_PATHS);

  const corpora = PINNED_CORPORA.map((pinned) => resolveCorpus(corpusDir, REPO_ROOT, pinned));
  for (const corpus of corpora) {
    say(
      `corpus: ${corpus.identity.name} at ${corpus.identity.ref.slice(0, 9)} — ` +
        `${corpus.identity.commits} commits, ${corpus.identity.first_commit_at.slice(0, 10)} to ` +
        `${corpus.identity.last_commit_at.slice(0, 10)}`,
    );
  }

  const rows: ExternalRow[] = [];

  say('external bench: budgeted log coverage, every tracked path, no records required');
  for (const corpus of corpora) {
    rows.push(...measureBudgetedLogCoverage(base, corpus.root, corpus.identity, say));
  }

  say('external bench: revert backfill');
  for (const corpus of corpora) {
    if (corpus.pinned.calibration) continue;
    const { row } = backfillCorpus(base, corpus.root, corpus.identity, say);
    rows.push(row);
  }

  say('external bench: active-record delivery on the backfilled corpus');
  for (const corpus of corpora) {
    if (corpus.pinned.calibration) continue;
    // The projection reads the derived index, and the notes it must project
    // were written after any index this clone already had. Rebuilding rather
    // than trusting freshness: a stale index would understate the shipped route
    // and nothing in the row would say so.
    const head = git(corpus.root, ['rev-parse', 'HEAD']).stdout.trim();
    if (head !== corpus.identity.ref) throw new Error(`${corpus.identity.name}: HEAD moved`);
    const rebuild = command('node', [CLI, 'index', '--rebuild'], { cwd: corpus.root });
    say(`external bench: ${corpus.identity.name} — ${rebuild.stdout.trim()}`);

    const delivery = measureDecisionDelivery(base, corpus.root, corpus.identity.ref, say, {
      includeNotes: true,
      routes: EXTERNAL_ROUTES,
    });
    for (const row of delivery) {
      rows.push({ ...row, corpus: corpus.identity } satisfies ExternalDeliveryRow);
    }
  }

  const currentCommit = git(REPO_ROOT, ['rev-parse', 'HEAD']).stdout.trim();
  const currentDigest = digestDistTree();
  if (currentCommit !== harnessCommit || currentDigest !== distDigest) {
    throw new Error(
      `product changed during measurement: commit ${harnessCommit} -> ${currentCommit}, ` +
        `dist ${distDigest} -> ${currentDigest}`,
    );
  }
  assertCleanCheckout(REPO_ROOT);

  mkdirSync(outputDir, { recursive: true });
  const baseName = `external-corpus-${stamp(measuredAt)}`;
  const jsonlPath = join(outputDir, `${baseName}.jsonl`);
  const reportPath = join(outputDir, `${baseName}.md`);
  writeFileSync(jsonlPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  writeExternalReport(reportPath, rows);
  say(`external bench: wrote ${jsonlPath}`);
  say(`external bench: wrote ${reportPath}`);
};

main();
