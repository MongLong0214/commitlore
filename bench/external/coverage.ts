/**
 * `budgeted_log_coverage` — the part of the `git-log-path-budgeted` arm that
 * needs no records at all, and therefore the only part of the 42.0% figure that
 * can be carried to a repository nobody here wrote.
 *
 * Registered in `bench/EXTERNAL-CORPUS.md` §4, before this file existed.
 *
 * **This is not recall.** It is the share of a path's commits whose message
 * survives the shipped 800-token cut. Recall equals it only if each commit
 * carries at most one record and records are spread evenly over a path's
 * history, and neither holds exactly anywhere — which is what the calibration
 * corpus in §3 exists to measure rather than assume.
 */

import { CHARS_PER_TOKEN, DEFAULT_BUDGET_TOKENS } from '../../dist/core/inject.js';
import { percentile } from '../deterministic/report.ts';
import { command } from '../deterministic/shared.ts';
import { truncateToBudget } from '../deterministic/recovery.ts';
import type { RowBase } from '../deterministic/types.ts';
import type { BudgetedLogCoverageRow, CorpusIdentity, CoveragePopulation } from './types.ts';

const POPULATIONS: readonly CoveragePopulation[] = ['authored', 'all-tracked'];

const tokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

/** Tracked paths at a ref, read from the tree so no working tree is required. */
const treePaths = (repoRoot: string, ref: string): readonly string[] =>
  command('git', ['ls-tree', '-r', '--name-only', '-z', ref], { cwd: repoRoot })
    .stdout.split('\0')
    .filter((path) => path !== '');

/**
 * Paths the repository's own `.gitattributes` declares generated, evaluated
 * against the pinned tree rather than the checkout — `--source` is what keeps
 * the answer a property of the corpus instead of of whatever is checked out.
 */
const generatedPaths = (
  repoRoot: string,
  ref: string,
  paths: readonly string[],
): ReadonlySet<string> => {
  if (paths.length === 0) return new Set();
  const fields = command(
    'git',
    ['check-attr', '-z', '--stdin', `--source=${ref}`, 'linguist-generated'],
    { cwd: repoRoot, input: `${paths.join('\0')}\0` },
  ).stdout.split('\0');
  const generated = new Set<string>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    if (fields[index + 2] === 'true') generated.add(fields[index] ?? '');
  }
  return generated;
};

export interface PathCoverage {
  readonly path: string;
  readonly generated: boolean;
  readonly commitsTotal: number;
  readonly commitsDelivered: number;
  readonly fullTokens: number;
  readonly budgetedTokens: number;
}

/**
 * One path's coverage, with the byte layout established rather than assumed
 * (§4.2).
 *
 * `git log --format=%B` emits each commit's raw body followed by one LF. The
 * offsets that decide which commits survive a prefix cut depend on that being
 * exactly true, so the same log is read a second time with a NUL terminator,
 * the concatenation is rebuilt from the pieces, and the two are compared byte
 * for byte. A disagreement stops the run: the alternative is a coverage figure
 * computed from wrong offsets, which would look like a result.
 */
export const coverageForPath = (
  repoRoot: string,
  ref: string,
  path: string,
  generated: boolean,
  budgetTokens: number,
): PathCoverage | null => {
  const full = command('git', ['log', ref, '--format=%B', '--', path], { cwd: repoRoot }).stdout;
  const raw = command('git', ['log', ref, '--format=%B%x00', '--', path], {
    cwd: repoRoot,
  }).stdout.split('\0');
  raw.pop();
  if (raw.length === 0) return null;
  const messages = raw.map((entry, index) => (index === 0 ? entry : entry.slice(1)));
  const rebuilt = messages.map((message) => `${message}\n`).join('');
  if (rebuilt !== full) {
    throw new Error(
      `git log --format=%B layout disagreed for ${path} at ${ref}: ` +
        `${full.length} bytes against ${rebuilt.length} rebuilt`,
    );
  }

  const budgeted = truncateToBudget(full, budgetTokens);
  let offset = 0;
  let delivered = 0;
  for (const message of messages) {
    offset += message.length + 1;
    if (offset <= budgeted.length) delivered += 1;
  }
  return {
    path,
    generated,
    commitsTotal: messages.length,
    commitsDelivered: delivered,
    fullTokens: tokens(full),
    budgetedTokens: tokens(budgeted),
  };
};

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const scorePopulation = (
  base: RowBase,
  identity: CorpusIdentity,
  observations: readonly PathCoverage[],
  tracked: number,
  generated: number,
  population: CoveragePopulation,
  budgetTokens: number,
): BudgetedLogCoverageRow => {
  const selected = observations.filter(
    (observation) => population === 'all-tracked' || !observation.generated,
  );
  const candidates = population === 'all-tracked' ? tracked : tracked - generated;
  let commitsTotal = 0;
  let commitsDelivered = 0;
  let macroSum = 0;
  let pathsComplete = 0;
  let pathsZero = 0;
  let fullTokens = 0;
  let budgetedTokens = 0;
  const perPathCommits: number[] = [];
  const perPathTokens: number[] = [];

  for (const observation of selected) {
    commitsTotal += observation.commitsTotal;
    commitsDelivered += observation.commitsDelivered;
    macroSum += ratio(observation.commitsDelivered, observation.commitsTotal);
    if (observation.commitsDelivered === observation.commitsTotal) pathsComplete += 1;
    if (observation.commitsDelivered === 0) pathsZero += 1;
    fullTokens += observation.fullTokens;
    budgetedTokens += observation.budgetedTokens;
    perPathCommits.push(observation.commitsTotal);
    perPathTokens.push(observation.fullTokens);
  }

  return {
    ...base,
    metric: 'budgeted_log_coverage',
    corpus: identity,
    population,
    budget_tokens: budgetTokens,
    tracked_paths: tracked,
    generated_paths: generated,
    candidate_paths: candidates,
    evaluation_paths: selected.length,
    commits_total: commitsTotal,
    commits_delivered: commitsDelivered,
    commit_coverage: ratio(commitsDelivered, commitsTotal),
    macro_commit_coverage: ratio(macroSum, selected.length),
    paths_complete: pathsComplete,
    paths_zero: pathsZero,
    full_tokens: fullTokens,
    budgeted_tokens: budgetedTokens,
    median_commits_per_path: percentile(perPathCommits, 0.5),
    median_full_tokens_per_path: percentile(perPathTokens, 0.5),
    p90_full_tokens_per_path: percentile(perPathTokens, 0.9),
  };
};

export const measureBudgetedLogCoverage = (
  base: RowBase,
  repoRoot: string,
  identity: CorpusIdentity,
  log: (line: string) => void = () => {},
): readonly BudgetedLogCoverageRow[] => {
  const ref = identity.ref;
  const tracked = treePaths(repoRoot, ref);
  const generated = generatedPaths(repoRoot, ref, tracked);
  log(
    `coverage: ${identity.name} at ${ref.slice(0, 9)} — ${tracked.length} tracked paths, ` +
      `${generated.size} declared generated`,
  );

  const observations: PathCoverage[] = [];
  for (const path of tracked) {
    const observation = coverageForPath(
      repoRoot,
      ref,
      path,
      generated.has(path),
      DEFAULT_BUDGET_TOKENS,
    );
    if (observation !== null) observations.push(observation);
    if (observations.length % 500 === 0 && observation !== null) {
      log(`coverage: ${identity.name} — ${observations.length} paths measured`);
    }
  }

  return POPULATIONS.map((population) =>
    scorePopulation(
      base,
      identity,
      observations,
      tracked.length,
      generated.size,
      population,
      DEFAULT_BUDGET_TOKENS,
    ),
  );
};
