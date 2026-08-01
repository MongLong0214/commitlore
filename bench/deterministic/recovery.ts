/**
 * `decision_delivery`: how much of this repository's currently-active record
 * set reaches a fresh agent before its first edit, and how much of what reaches
 * it the repository has already retired.
 *
 * The method — corpus rule, answer key, arms, scoring and the denominator
 * choice — is registered in `bench/DECISION-DELIVERY.md`, written before this
 * file produced a number. The answer key is built by `./census.ts`, which
 * imports nothing from the product; this module owns only the routes and the
 * scoring.
 *
 * A delivered record has not been used, only handed over. Every figure here is
 * therefore a ceiling on recovery, never recovery itself: an agent cannot
 * recover what it was never given, and being given something is no evidence it
 * was read.
 */

import {
  CHARS_PER_TOKEN,
  DEFAULT_BUDGET_TOKENS,
  buildInjection,
} from '../../dist/core/inject.js';
import { buildCensus, type Census } from './census.ts';
import { command } from './shared.ts';
import type {
  DecisionDeliveryRow,
  DeliveryCensus,
  DeliveryPopulation,
  DeliveryRoute,
  RowBase,
} from './types.ts';

export const DELIVERY_ROUTES: readonly DeliveryRoute[] = [
  'code-only',
  'git-log-path',
  'every-record-budgeted',
  'every-record-unbudgeted',
  'commitlore',
];

export const DELIVERY_POPULATIONS: readonly DeliveryPopulation[] = ['authored', 'all-tracked'];

/**
 * Large enough that no repository this measurement can run against reaches it,
 * and asserted rather than trusted: the unbudgeted arm refuses to report if the
 * projection truncated.
 */
export const UNBOUNDED_BUDGET_TOKENS = 10_000_000;

/**
 * One rendered injection line: two spaces, the padded trust tag, the record id,
 * the abbreviated sha, then the trailer value. `-` in the id column is a record
 * that declared none.
 */
const ENTRY_LINE = /^ {2}\[(?:directive|claim|blocked)\]\s+(\S+) {2}([0-9a-f]+) {2}/gm;
/** A declared record inside ordinary `git log` output. */
const RECORD_ID_LINE = /^Record-Id:[ \t]*(\S+)[ \t]*$/gm;

const tokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

const matchAll = (pattern: RegExp, text: string): readonly string[] => {
  pattern.lastIndex = 0;
  const found: string[] = [];
  let match = pattern.exec(text);
  while (match !== null) {
    if (match[1] !== undefined) found.push(match[1]);
    match = pattern.exec(text);
  }
  return found;
};

export interface Delivery {
  /** Distinct record ids handed over. */
  readonly ids: ReadonlySet<string>;
  /** Rendered lines whose record declared no id; nothing can be scored against them. */
  readonly unidentified: number;
  /** Records the projection refused to render because grading blocked them. */
  readonly withheld: number;
  readonly tokens: number;
}

const EMPTY_DELIVERY: Delivery = { ids: new Set(), unidentified: 0, withheld: 0, tokens: 0 };

export const deliveredFromInjection = (
  text: string,
  withheld: number,
): Delivery => {
  const ids = new Set<string>();
  let unidentified = 0;
  for (const id of matchAll(ENTRY_LINE, text)) {
    if (id === '-') unidentified += 1;
    else ids.add(id);
  }
  return { ids, unidentified, withheld, tokens: tokens(text) };
};

export const deliveredFromLog = (text: string): Delivery => ({
  ids: new Set(matchAll(RECORD_ID_LINE, text)),
  unidentified: 0,
  withheld: 0,
  tokens: tokens(text),
});

const trackedPaths = (repoRoot: string): readonly string[] =>
  command('git', ['ls-files', '-z'], { cwd: repoRoot })
    .stdout.split('\0')
    .filter((path) => path !== '');

/** Paths the repository's own `.gitattributes` declares generated. */
const generatedPaths = (repoRoot: string, paths: readonly string[]): ReadonlySet<string> => {
  if (paths.length === 0) return new Set();
  const fields = command('git', ['check-attr', '-z', '--stdin', 'linguist-generated'], {
    cwd: repoRoot,
    input: `${paths.join('\0')}\0`,
  }).stdout.split('\0');
  const generated = new Set<string>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    if (fields[index + 2] === 'true') generated.add(fields[index] ?? '');
  }
  return generated;
};

/** Every name a path has carried, via `git log --follow` on that one pathspec. */
const renameChain = (repoRoot: string, path: string): ReadonlySet<string> => {
  const names = command(
    'git',
    ['log', '--follow', '--name-only', '--format=', '-z', '--', path],
    { cwd: repoRoot },
  ).stdout.split('\0').filter((name) => name !== '');
  return new Set([path, ...names]);
};

const invertPaths = (census: Census): ReadonlyMap<string, readonly string[]> => {
  const byPath = new Map<string, string[]>();
  for (const record of census.records.values()) {
    for (const path of record.paths) {
      const existing = byPath.get(path);
      if (existing === undefined) byPath.set(path, [record.recordId]);
      else existing.push(record.recordId);
    }
  }
  return byPath;
};

interface PathGold {
  readonly path: string;
  readonly generated: boolean;
  /** Active records attached to this path, directly or through a rename. */
  readonly active: ReadonlySet<string>;
  /** Attachments of any lifecycle that only a rename made reachable. */
  readonly renameOnly: number;
}

const goldForPath = (
  repoRoot: string,
  census: Census,
  byPath: ReadonlyMap<string, readonly string[]>,
  path: string,
  generated: boolean,
): PathGold => {
  const direct = new Set(byPath.get(path) ?? []);
  const attached = new Set(direct);
  // Every path pays for its rename chain, including one with no direct
  // attachment: that is the case a rename is most likely to explain, so
  // skipping it would drop exactly the records this asks about.
  const chain = renameChain(repoRoot, path);
  for (const name of chain) {
    if (name === path) continue;
    for (const recordId of byPath.get(name) ?? []) attached.add(recordId);
  }
  const active = new Set([...attached].filter((recordId) => census.active.has(recordId)));
  return { path, generated, active, renameOnly: attached.size - direct.size };
};

interface PathObservation {
  readonly gold: PathGold;
  readonly deliveries: ReadonlyMap<DeliveryRoute, Delivery>;
}

const injectionDelivery = (
  repoRoot: string,
  path: string,
  budget?: number,
): Delivery => {
  const projection = buildInjection({
    cwd: repoRoot,
    path,
    ...(budget === undefined ? {} : { budget }),
  });
  return deliveredFromInjection(projection.text, projection.withheld);
};

const everyRecordDelivery = (repoRoot: string, budget: number, mustNotTruncate: boolean): Delivery => {
  const projection = buildInjection({
    cwd: repoRoot,
    path: '.',
    budget,
    ablation: { noScope: true, noLifecycle: true },
  });
  if (mustNotTruncate && projection.truncatedAt !== undefined) {
    throw new Error(
      `the unbudgeted every-record arm truncated at ${projection.truncatedAt}; ` +
        `raise UNBOUNDED_BUDGET_TOKENS above ${budget}`,
    );
  }
  return deliveredFromInjection(projection.text, projection.withheld);
};

const logDelivery = (repoRoot: string, path: string): Delivery =>
  deliveredFromLog(
    command('git', ['log', '--format=%B', '--', path], { cwd: repoRoot }).stdout,
  );

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const censusRow = (
  census: Census,
  tracked: number,
  generated: number,
): DeliveryCensus => ({
  commits_examined: census.commitsExamined,
  merge_commits: census.mergeCommits,
  record_bearing_commits: census.recordBearingCommits,
  records: census.records.size,
  active_records: census.active.size,
  superseded_records: census.superseded.size,
  expired_records: census.expired.size,
  records_without_paths: census.recordsWithoutPaths,
  supersedes_trailers_parsed: census.supersedesTrailersParsed,
  supersedes_lines_scanned: census.supersedesLinesScanned,
  expires_trailers_parsed: census.expiresTrailersParsed,
  expires_lines_scanned: census.expiresLinesScanned,
  tracked_paths: tracked,
  generated_paths: generated,
});

export const scoreRoute = (
  base: RowBase,
  census: Census,
  deliveryCensus: DeliveryCensus,
  observations: readonly PathObservation[],
  candidatePaths: number,
  population: DeliveryPopulation,
  route: DeliveryRoute,
  budget: number | null,
  historyRef: string,
): DecisionDeliveryRow => {
  let delivered = 0;
  let recovered = 0;
  let pathActiveTotal = 0;
  let renameOnly = 0;
  let macroSum = 0;
  let supersededDelivered = 0;
  let expiredDelivered = 0;
  let offPathDelivered = 0;
  let unknownDelivered = 0;
  let unidentifiedDelivered = 0;
  let withheldRecords = 0;
  let deliveredTokens = 0;
  let pathsComplete = 0;
  let pathsZero = 0;

  for (const observation of observations) {
    const delivery = observation.deliveries.get(route) ?? EMPTY_DELIVERY;
    const active = observation.gold.active;
    const hit = [...delivery.ids].filter((recordId) => active.has(recordId)).length;

    delivered += delivery.ids.size;
    recovered += hit;
    pathActiveTotal += active.size;
    renameOnly += observation.gold.renameOnly;
    macroSum += ratio(hit, active.size);
    unidentifiedDelivered += delivery.unidentified;
    withheldRecords += delivery.withheld;
    deliveredTokens += delivery.tokens;
    if (active.size > 0 && hit === active.size) pathsComplete += 1;
    if (hit === 0) pathsZero += 1;

    for (const recordId of delivery.ids) {
      if (census.superseded.has(recordId)) supersededDelivered += 1;
      else if (census.expired.has(recordId)) expiredDelivered += 1;
      else if (!census.records.has(recordId)) unknownDelivered += 1;
      else if (!active.has(recordId)) offPathDelivered += 1;
    }
  }

  const paths = observations.length;
  const staleDelivered = supersededDelivered + expiredDelivered;
  // Against the repository-wide denominator an off-path active record counts as
  // recovered: it is part of the repository's active set, just not part of this
  // path's. That is exactly the difference the two denominators exist to show.
  const repoRecovered = recovered + offPathDelivered;
  return {
    ...base,
    metric: 'decision_delivery',
    history_ref: historyRef,
    evaluated_at: census.evaluatedAt.toISOString(),
    census: deliveryCensus,
    population,
    candidate_paths: candidatePaths,
    paths_without_active_record: candidatePaths - paths,
    evaluation_paths: paths,
    path_active_total: pathActiveTotal,
    rename_only_attachments: renameOnly,
    repo_active_total: census.active.size,
    route,
    budget_tokens: budget,
    delivered_total: delivered,
    recovered,
    path_recall: ratio(recovered, pathActiveTotal),
    macro_path_recall: ratio(macroSum, paths),
    repo_recall: ratio(repoRecovered, paths * census.active.size),
    precision: ratio(recovered, delivered),
    superseded_delivered: supersededDelivered,
    expired_delivered: expiredDelivered,
    stale_delivered: staleDelivered,
    stale_share: ratio(staleDelivered, delivered),
    off_path_delivered: offPathDelivered,
    unknown_delivered: unknownDelivered,
    unidentified_delivered: unidentifiedDelivered,
    withheld_records: withheldRecords,
    delivered_tokens: deliveredTokens,
    paths_complete: pathsComplete,
    paths_zero: pathsZero,
  };
};

export const measureDecisionDelivery = (
  base: RowBase,
  repoRoot: string,
  ref = 'HEAD',
  log: (line: string) => void = () => {},
): readonly DecisionDeliveryRow[] => {
  const census = buildCensus(repoRoot, ref);
  const tracked = trackedPaths(repoRoot);
  const generated = generatedPaths(repoRoot, tracked);
  const byPath = invertPaths(census);
  const deliveryCensus = censusRow(census, tracked.length, generated.size);
  log(
    `decision delivery: ${census.records.size} records (${census.active.size} active, ` +
      `${census.superseded.size} superseded, ${census.expired.size} expired) over ` +
      `${census.commitsExamined} commits; ${tracked.length} tracked paths`,
  );

  // The two every-record arms deliver the same bytes to every path, so they are
  // projected once. Charging the repository-wide dump per path would time the
  // harness rather than the route.
  const budgeted = everyRecordDelivery(repoRoot, DEFAULT_BUDGET_TOKENS, false);
  const unbudgeted = everyRecordDelivery(repoRoot, UNBOUNDED_BUDGET_TOKENS, true);

  const observations: PathObservation[] = [];
  for (const path of tracked) {
    const gold = goldForPath(repoRoot, census, byPath, path, generated.has(path));
    if (gold.active.size === 0) continue;
    observations.push({
      gold,
      deliveries: new Map<DeliveryRoute, Delivery>([
        ['code-only', EMPTY_DELIVERY],
        ['git-log-path', logDelivery(repoRoot, path)],
        ['every-record-budgeted', budgeted],
        ['every-record-unbudgeted', unbudgeted],
        ['commitlore', injectionDelivery(repoRoot, path)],
      ]),
    });
    if (observations.length % 100 === 0) {
      log(`decision delivery: ${observations.length} paths measured`);
    }
  }

  const budgets: { readonly [Route in DeliveryRoute]: number | null } = {
    'code-only': null,
    'git-log-path': null,
    'every-record-budgeted': DEFAULT_BUDGET_TOKENS,
    'every-record-unbudgeted': UNBOUNDED_BUDGET_TOKENS,
    commitlore: DEFAULT_BUDGET_TOKENS,
  };

  const rows: DecisionDeliveryRow[] = [];
  for (const population of DELIVERY_POPULATIONS) {
    const selected = observations.filter(
      (observation) => population === 'all-tracked' || !observation.gold.generated,
    );
    const candidates =
      population === 'all-tracked' ? tracked.length : tracked.length - generated.size;
    for (const route of DELIVERY_ROUTES) {
      rows.push(
        scoreRoute(
          base,
          census,
          deliveryCensus,
          selected,
          candidates,
          population,
          route,
          budgets[route],
          ref,
        ),
      );
    }
  }
  return rows;
};
