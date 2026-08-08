/**
 * `token_ledger` — what a record costs to write against what it saves to read.
 *
 * The method is registered in `bench/TOKEN-LEDGER.md`, which was committed
 * before this file produced a number. Two rules from it are load-bearing here
 * and are enforced rather than documented:
 *
 * 1. **The write side is a floor.** Only the two terms measurable without a
 *    model call are counted — the generated prompt scaffold and the staged
 *    diff. The session transcript and the drafting turn's output are both
 *    non-negative and both omitted, so every break-even derived from this is a
 *    lower bound and is never the cost of a record.
 * 2. **The read side is not remeasured.** It is derived from a committed
 *    `decision_delivery` run whose provenance travels onto this row. Measuring
 *    it here would move the corpus — the record count grows with the commits
 *    that add this file — and leave one ratio citing two corpora.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildHarvestPrompt } from '../../dist/core/harvest.js';
import { CHARS_PER_TOKEN } from '../../dist/core/inject.js';
import { git } from './shared.ts';
import type {
  DecisionDeliveryRow,
  DeliveryPopulation,
  DeliveryRoute,
  LedgerBreakEven,
  LedgerReadRoute,
  LedgerReduction,
  LedgerStats,
  RowBase,
  TokenLedgerRow,
} from './types.ts';

/**
 * The committed delivery run this ledger derives its read side from, named as a
 * constant so a reader can see which corpus the ratio's denominator came from
 * without opening the harness. `docs/evidence.md` cites the same file.
 */
export const READ_SIDE_SOURCE = 'bench/results/decision-delivery-20260801T060225Z.jsonl';
export const READ_SIDE_POPULATION: DeliveryPopulation = 'authored';
export const SHIPPED_ROUTE: DeliveryRoute = 'commitlore';

/**
 * The write terms this measurement does not carry, named on the row so a
 * consumer of the JSONL cannot mistake the floor for a total.
 *
 * The drafting-output entry was narrowed on 2026-08-02. It used to give two
 * reasons W4 was missing — no model call, and no way to attribute an answer to
 * the turn that produced it. The second is no longer true: the driver's
 * `--per-turn-usage` mode records provider-reported usage per turn and
 * reconciles it against the session total. The first still is, so the term is
 * still on this list and the floor is still a floor. Committed rows keep the
 * text they were written with; the change applies to rows written from here on.
 */
export const UNMEASURED_WRITE_TERMS: readonly string[] = [
  'session-transcript: buildHarvestPrompt numbers the transcript into the prompt; the sessions that produced this corpus were never retained, so the term is unrecoverable for these records rather than merely unmeasured',
  'drafting-output: the tokens a model emits answering the harvest prompt. Still needs a model call, and no bench arm runs `capture` against a run of its own, so this ledger prices no drafting turn. The attribution half of the blocker is closed — the driver records provider-reported usage per turn under `--per-turn-usage`, audited against the session total — so an answer would now be attributable to the turn that produced it',
  'billing-rate: whether the prompt is charged as fresh input or as a cache read is a provider property this harness never observes',
];

/**
 * The reduction pairs, fixed here before the run rather than chosen after
 * seeing which one flattered the product. Each names its own denominator, and
 * the two where CommitLore does badly are in the list for that reason.
 */
export const REDUCTION_PAIRS: readonly {
  readonly subject: DeliveryRoute;
  readonly denominator: DeliveryRoute;
  readonly note: string;
}[] = [
  {
    subject: 'commitlore',
    denominator: 'git-log-path-budgeted',
    note: 'Equal budget. The comparison an agent actually faces, and the only one where the shipped route is both cheaper and higher-recall.',
  },
  {
    subject: 'commitlore',
    denominator: 'git-log-path',
    note: 'Against an unbounded `git log`, which recovers more. Cheaper at lower recall is a trade, not a win, and the recall columns say so.',
  },
  {
    subject: 'commitlore',
    denominator: 'every-record-unbudgeted',
    note: 'Against the whole-repository dump. The largest reduction in the table and the least useful, because nobody has that context.',
  },
  {
    subject: 'commitlore-unbudgeted',
    denominator: 'every-record-unbudgeted',
    note: 'The iso-recovery pair: both are the same projection at a budget that cuts nothing, and both recover the same count. This is the reduction attributable to path scoping alone.',
  },
  {
    subject: 'commitlore',
    denominator: 'code-only',
    note: 'Against reading no history at all. The denominator is zero, so no percentage reduction exists — the shipped route is a token cost here, and a market-shaped percentage cannot express that. What it offers against this route is recall.',
  },
];

const LOG_FORMAT = '--format=%H%x1f%P%x1f%B%x00';
const RECORD_ID_LINE = /^Record-Id:/m;

/**
 * Network clients, searched for in the built verify module graph.
 *
 * `bench/types.ts` already asserts that `verify_tokens` is structurally zero
 * for the shipped verifier. An assertion is not a measurement, and this list is
 * what turns it into one: a hit here makes the run report a non-zero count and
 * withdraw the zero rather than keep printing a figure it no longer earns.
 */
const NETWORK_REFERENCES: readonly RegExp[] = [
  // Delimited by the quotes of a module specifier rather than matched as a
  // substring. A plain `includes('node:http')` also fires on `node:https`, so
  // one import counted as two and the scanner overstated its own findings.
  /['"]node:(?:http|https|net|tls|dgram)['"]/,
  /['"]undici['"]/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /(^|[^.\w])fetch\s*\(/,
];

const LOCAL_IMPORT = /from\s+'(\.[^']+)'/g;

export const tokensFor = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

export const statsOf = (samples: readonly number[]): LedgerStats => {
  if (samples.length === 0) {
    return { count: 0, total: 0, mean: 0, p50: 0, p95: 0, min: 0, max: 0 };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (proportion: number): number => sorted[Math.ceil(proportion * sorted.length) - 1] ?? 0;
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    total,
    mean: total / sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
};

interface Commit {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly recordBlocks: number;
}

/**
 * Record blocks are counted by `Record-Id:` lines rather than by Git's trailer
 * parser. One commit may declare several (ADR-0014), and the count is only ever
 * used as the per-record denominator beside the per-capture one — the capture
 * itself is charged once per commit whatever it declared.
 */
const readCommits = (repoRoot: string, ref: string): readonly Commit[] =>
  git(repoRoot, ['log', LOG_FORMAT, ref])
    .stdout.split('\0')
    .filter((entry) => entry.trim() !== '')
    .map((entry) => {
      const [sha = '', parents = '', body = ''] = entry.replace(/^\n/, '').split('\x1f');
      return {
        sha,
        parents: parents.trim().split(/\s+/).filter((value) => value !== ''),
        recordBlocks: RECORD_ID_LINE.test(body) ? (body.match(/^Record-Id:/gm) ?? []).length : 0,
      };
    });

/**
 * Walks the built verify entry points' local import graph and counts network
 * references in it. Returns the module count so a zero is legible as "scanned N
 * files and found none" rather than as "scanned nothing".
 */
export const scanVerifyModules = (
  distRoot: string,
  entries: readonly string[],
): { readonly modules: number; readonly references: number } => {
  const seen = new Set<string>();
  const queue = entries.map((entry) => resolve(distRoot, entry));
  let references = 0;
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // One hit per (file, pattern): the question is whether a network client is
    // reachable at all, not how many times it is named.
    for (const pattern of NETWORK_REFERENCES) {
      if (pattern.test(source)) references += 1;
    }
    for (const match of source.matchAll(LOCAL_IMPORT)) {
      const specifier = match[1];
      if (specifier !== undefined) queue.push(resolve(file, '..', specifier));
    }
  }
  return { modules: seen.size, references };
};

const readDeliveryRows = (repoRoot: string, file: string): readonly DecisionDeliveryRow[] => {
  const rows = readFileSync(join(repoRoot, file), 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as DecisionDeliveryRow)
    .filter((row) => row.metric === 'decision_delivery' && row.population === READ_SIDE_POPULATION);
  if (rows.length === 0) throw new Error(`${file} carries no ${READ_SIDE_POPULATION} decision_delivery row`);
  return rows;
};

const readRouteOf = (row: DecisionDeliveryRow): LedgerReadRoute => ({
  route: row.route,
  budget_tokens: row.budget_tokens,
  evaluation_paths: row.evaluation_paths,
  delivered_tokens: row.delivered_tokens,
  tokens_per_read: row.delivered_tokens / row.evaluation_paths,
  path_recall: row.path_recall,
  recovered: row.recovered,
  path_active_total: row.path_active_total,
});

/**
 * A comparator that delivers no more tokens than the shipped route leaves
 * nothing to amortize a write cost against, and no number of reads produces
 * one. That is returned as a named refusal — the same discipline `computeCpaa`
 * applies to a ratio with no denominator — rather than as a negative read count
 * or an infinity that serializes to `null` and reads downstream as "free".
 */
export const breakEvenAgainst = (
  comparator: LedgerReadRoute,
  shipped: LedgerReadRoute,
  writeFloorWithDiff: number,
  writeFloorScaffoldOnly: number,
): LedgerBreakEven => {
  const saving = comparator.tokens_per_read - shipped.tokens_per_read;
  const reduction =
    comparator.tokens_per_read === 0 ? null : saving / comparator.tokens_per_read;
  const base = {
    comparator: comparator.route,
    comparator_tokens_per_read: comparator.tokens_per_read,
    shipped_tokens_per_read: shipped.tokens_per_read,
    saving_tokens_per_read: saving,
    reduction_against_comparator: reduction,
  };
  if (saving <= 0) {
    return {
      ...base,
      exists: false,
      undefined_because:
        comparator.tokens_per_read === 0
          ? 'the comparator delivers nothing, so the shipped route is a net token cost against it at every read count'
          : 'the comparator delivers no more tokens than the shipped route, so there is no saving to amortize a write cost against',
      reads_with_diff: null,
      reads_scaffold_only: null,
      passes_with_diff: null,
      passes_scaffold_only: null,
    };
  }
  return {
    ...base,
    exists: true,
    undefined_because: null,
    reads_with_diff: writeFloorWithDiff / saving,
    reads_scaffold_only: writeFloorScaffoldOnly / saving,
    passes_with_diff: writeFloorWithDiff / saving / shipped.evaluation_paths,
    passes_scaffold_only: writeFloorScaffoldOnly / saving / shipped.evaluation_paths,
  };
};

export interface CapturePricing {
  readonly scaffold: string;
  readonly commitsExamined: number;
  readonly mergeCommits: number;
  readonly captures: number;
  readonly recordsMeasured: number;
  readonly recordsOnMerges: number;
  readonly recordsOnRoots: number;
  readonly diffTokens: LedgerStats;
  readonly promptTokens: LedgerStats;
}

/**
 * The write side, over any repository's history.
 *
 * Separate from `measureTokenLedger` so it can be exercised on a synthetic
 * history whose merge-borne and root-borne records are known by construction.
 * The production call passes this repository and reads the same numbers.
 */
export const priceCaptures = (
  historyRoot: string,
  ref: string,
  log: (line: string) => void = () => {},
): CapturePricing => {
  const scaffold = buildHarvestPrompt({ transcript: '', diff: '' });
  const commits = readCommits(historyRoot, ref);
  const diffTokens: number[] = [];
  const promptTokens: number[] = [];
  let captures = 0;
  let recordsMeasured = 0;
  let recordsOnMerges = 0;
  let recordsOnRoots = 0;
  let merges = 0;

  for (const commit of commits) {
    if (commit.parents.length > 1) merges += 1;
    if (commit.recordBlocks === 0) continue;
    if (commit.parents.length > 1) {
      recordsOnMerges += commit.recordBlocks;
      continue;
    }
    if (commit.parents.length === 0) {
      recordsOnRoots += commit.recordBlocks;
      continue;
    }
    const diff = git(historyRoot, ['diff', '--no-color', `${commit.sha}^`, commit.sha]).stdout;
    diffTokens.push(tokensFor(diff));
    promptTokens.push(tokensFor(buildHarvestPrompt({ transcript: '', diff })));
    captures += 1;
    recordsMeasured += commit.recordBlocks;
    if (captures % 50 === 0) log(`  token ledger: ${captures} captures priced`);
  }
  if (captures === 0) throw new Error(`no record-bearing single-parent commit in ${ref}`);

  return {
    scaffold,
    commitsExamined: commits.length,
    mergeCommits: merges,
    captures,
    recordsMeasured,
    recordsOnMerges,
    recordsOnRoots,
    diffTokens: statsOf(diffTokens),
    promptTokens: statsOf(promptTokens),
  };
};

export const reductionFor = (
  pair: (typeof REDUCTION_PAIRS)[number],
  reads: readonly LedgerReadRoute[],
): LedgerReduction => {
  const subject = reads.find((route) => route.route === pair.subject);
  const denominator = reads.find((route) => route.route === pair.denominator);
  if (subject === undefined || denominator === undefined) {
    throw new Error(`reduction pair ${pair.subject} / ${pair.denominator} has no row in the delivery run`);
  }
  const defined = denominator.tokens_per_read !== 0;
  return {
    subject: pair.subject,
    denominator: pair.denominator,
    subject_tokens_per_read: subject.tokens_per_read,
    denominator_tokens_per_read: denominator.tokens_per_read,
    reduction: defined ? 1 - subject.tokens_per_read / denominator.tokens_per_read : null,
    ratio: defined ? denominator.tokens_per_read / subject.tokens_per_read : null,
    subject_recall: subject.path_recall,
    denominator_recall: denominator.path_recall,
    subject_recovered: subject.recovered,
    denominator_recovered: denominator.recovered,
    equal_recovered_count: subject.recovered === denominator.recovered,
    note: pair.note,
  };
};

/**
 * The history both halves of the ratio describe.
 *
 * Not `HEAD`. A trial run priced the write side at `HEAD` while the read side
 * came from a delivery run three records earlier, which puts two corpora in one
 * ratio — the exact fault this measurement's own method document warns about
 * one paragraph after committing it. The history is therefore pinned to the
 * commit the delivery run recorded, and a commit that no longer resolves stops
 * the run: ADR-0018's digest fallback establishes that harness *code* is
 * identical, which is not the same as having the *history* back.
 */
export const resolveHistoryRef = (repoRoot: string, commit: string): string => {
  const kind = git(repoRoot, ['cat-file', '-t', commit], { allowed: [0, 128] });
  if (kind.status !== 0 || kind.stdout.trim() !== 'commit') {
    throw new Error(
      `refusing to price a token ledger: the delivery run's harness commit ${commit} does not resolve, ` +
        'so the write side cannot be measured over the same history the read side was',
    );
  }
  const ancestor = git(repoRoot, ['merge-base', '--is-ancestor', commit, 'HEAD'], {
    allowed: [0, 1],
  });
  if (ancestor.status !== 0) {
    throw new Error(
      `refusing to price a token ledger: ${commit} is not an ancestor of HEAD, ` +
        'so this checkout is not a continuation of the history the read side was measured on',
    );
  }
  return commit;
};

export const measureTokenLedger = (
  base: RowBase,
  repoRoot: string,
  log: (line: string) => void = () => {},
): TokenLedgerRow => {
  const deliveryRows = readDeliveryRows(repoRoot, READ_SIDE_SOURCE);
  const first = deliveryRows[0];
  if (first === undefined) throw new Error('unreachable: rows were checked non-empty');
  const reads = deliveryRows.map(readRouteOf);
  const shipped = reads.find((route) => route.route === SHIPPED_ROUTE);
  if (shipped === undefined) throw new Error(`${READ_SIDE_SOURCE} carries no \`${SHIPPED_ROUTE}\` route`);

  const ref = resolveHistoryRef(repoRoot, first.harness_commit);
  const priced = priceCaptures(repoRoot, ref, log);
  const { scaffold, captures, promptTokens: prompt } = priced;
  const scaffoldOnlyTotal = tokensFor(scaffold) * captures;
  const verify = scanVerifyModules(join(repoRoot, 'dist'), [
    'core/capture-verify.js',
    'core/harvest-verify.js',
  ]);

  return {
    ...base,
    metric: 'token_ledger',
    history_ref: ref,
    chars_per_token: CHARS_PER_TOKEN,
    prompt_scaffold_chars: scaffold.length,
    prompt_scaffold_bytes: Buffer.byteLength(scaffold),
    prompt_scaffold_tokens: tokensFor(scaffold),
    commits_examined: priced.commitsExamined,
    merge_commits: priced.mergeCommits,
    captures_measured: captures,
    records_on_measured_captures: priced.recordsMeasured,
    records_on_merge_commits: priced.recordsOnMerges,
    records_on_root_commits: priced.recordsOnRoots,
    diff_tokens: priced.diffTokens,
    prompt_tokens: prompt,
    write_floor_tokens_with_diff: prompt.total,
    write_floor_tokens_scaffold_only: scaffoldOnlyTotal,
    write_floor_tokens_per_capture_with_diff: prompt.total / captures,
    write_floor_tokens_per_record_with_diff: prompt.total / priced.recordsMeasured,
    verify_model_tokens: 0,
    verify_model_calls: 0,
    verify_modules_scanned: verify.modules,
    verify_network_references: verify.references,
    unmeasured_write_terms: UNMEASURED_WRITE_TERMS,
    read_source: {
      file: READ_SIDE_SOURCE,
      harness_commit: first.harness_commit,
      harness_digest: first.harness_digest ?? null,
      dist_digest: first.dist_digest,
      measured_at: first.measured_at,
      population: READ_SIDE_POPULATION,
      shipped_route: SHIPPED_ROUTE,
    },
    reads,
    reductions: REDUCTION_PAIRS.map((pair) => reductionFor(pair, reads)),
    break_even: reads
      .filter((route) => route.route !== SHIPPED_ROUTE)
      .map((route) => breakEvenAgainst(route, shipped, prompt.total, scaffoldOnlyTotal)),
  };
};
