import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CHARS_PER_TOKEN, buildInjection } from '../../dist/core/inject.js';
import { command, git, timing } from './shared.ts';
import type { NoiseExposureRow, NoiseRoute, RowBase } from './types.ts';

export const NOISE_SIZES = [0, 10, 100, 1_000, 10_000] as const;
export const NOISE_SEED = 142_2026;
export const NOISE_RUNS = 20;
export const TARGET_PATH = 'src/core/decision-context.ts';
const TOP_K = 2;
const TOP_K_QUERY = `${TARGET_PATH} active lifecycle decision context path scope`;

interface NoiseRecord {
  readonly recordId: string;
  readonly path: string;
  readonly message: string;
  readonly relevant: boolean;
}

export interface NoiseCorpus {
  readonly records: readonly NoiseRecord[];
  readonly distractors: number;
}

export interface NoiseFixture {
  readonly dir: string;
  readonly corpus: NoiseCorpus;
  readonly superseded: boolean;
}

const activeRecords = (): readonly NoiseRecord[] => [
  {
    recordId: 'r-expose001',
    path: TARGET_PATH,
    relevant: true,
    message: [
      'Keep lifecycle filtering at the decision-context path boundary.',
      '',
      'Limit: Keep active decision context scoped to the edited path.',
      'Ruled-out: repository-wide decision context | unrelated paths overlap this wording.',
      'Warn: Lifecycle declarations remain global even when delivery is path-scoped.',
      'Blast: module',
      'Undo: easy',
      'Certainty: firm',
      'Record-Id: r-expose001',
    ].join('\n'),
  },
  {
    recordId: 'r-expose002',
    path: TARGET_PATH,
    relevant: true,
    message: [
      'Keep decision context explicit at the consumer boundary.',
      '',
      'Limit: Preserve active path-scoped records for this decision context.',
      'Ruled-out: lexical context ranking alone | similar repository decisions can outrank it.',
      'Warn: Do not treat a matching word as proof that a record applies to this path.',
      'Blast: module',
      'Undo: easy',
      'Certainty: firm',
      'Record-Id: r-expose002',
    ].join('\n'),
  },
];

const paths = [
  'src/core/inject.ts',
  'src/core/query.ts',
  'src/core/index-db.ts',
  'src/core/grade.ts',
  'src/commands/query.ts',
  'src/commands/inject.ts',
  'test/query.test.ts',
  'bench/deterministic/report.ts',
] as const;
const subjects = [
  'Keep decision context scoped while lifecycle state remains global',
  'Project active records at the path boundary before rendering context',
  'Preserve lifecycle declarations while narrowing decision delivery',
  'Rank overlapping decision context without assuming path relevance',
] as const;
const alternatives = [
  'repository-wide decision context',
  'lexical path ranking alone',
  'dropping lifecycle state before projection',
  'a global active-record dump',
] as const;

const next = (state: number): number => (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
const choose = <T>(values: readonly T[], state: number): T => {
  const choice = values[state % values.length];
  if (choice === undefined) throw new Error('cannot choose from an empty list');
  return choice;
};

const distractor = (index: number, seed: number): NoiseRecord => {
  let state = (seed + index) >>> 0;
  state = next(state);
  const path = choose(paths, state);
  state = next(state);
  const subject = choose(subjects, state);
  state = next(state);
  const alternative = choose(alternatives, state);
  const recordId = `r-noise${String(index).padStart(6, '0')}`;
  return {
    recordId,
    path,
    relevant: false,
    message: [
      subject,
      '',
      `Limit: Keep active decision context explicit for ${path}.`,
      `Ruled-out: ${alternative} | similar lifecycle and path wording is insufficient.`,
      'Warn: This decision overlaps the queried terminology but applies to another repository path.',
      'Blast: module',
      'Undo: easy',
      'Certainty: tentative',
      `Record-Id: ${recordId}`,
    ].join('\n'),
  };
};

export const generateNoiseCorpus = (distractors: number, seed = NOISE_SEED): NoiseCorpus => {
  if (!Number.isInteger(distractors) || distractors < 0) {
    throw new Error(`distractors must be a non-negative integer, got ${distractors}`);
  }
  return {
    records: [...activeRecords(), ...Array.from({ length: distractors }, (_, index) => distractor(index, seed))],
    distractors,
  };
};

const fastImport = (records: readonly NoiseRecord[], supersede: boolean): string => {
  const active = records.filter((record) => record.relevant);
  const distractors = records.filter((record) => !record.relevant);
  const commit = (
    mark: number,
    message: string,
    parent: number | undefined,
    changedPaths: readonly string[],
  ): string => [
      'commit refs/heads/main',
      `mark :${mark}`,
      'author CommitLore Bench <bench@commitlore.local> 1760000000 +0000',
      'committer CommitLore Bench <bench@commitlore.local> 1760000000 +0000',
      `data ${Buffer.byteLength(message)}`,
      message,
      ...(parent === undefined ? [] : [`from :${parent}`]),
      ...changedPaths.flatMap((path) => {
        const content = `${path}\n`;
        return [`M 100644 inline ${path}`, `data ${Buffer.byteLength(content)}`, content];
      }),
    ].join('\n');
  const first = active[0];
  const second = active[1];
  if (first === undefined || second === undefined) throw new Error('noise corpus needs two active records');
  const commits = [
    commit(1, first.message, undefined, [first.path]),
    commit(2, second.message, 1, [second.path]),
  ];
  let latestMark = 2;
  if (distractors.length > 0) {
    const blocks = distractors.map((record) => record.message.split('\n\n')[1] ?? record.message);
    commits.push(commit(3, `Batch realistic unrelated decisions.\n\n${blocks.join('\n\n')}`, 2, paths));
    latestMark = 3;
  }
  if (supersede) {
    const message = 'Retire an obsolete decision context.\n\nSupersedes: r-expose001\n';
    commits.push([
      'commit refs/heads/main',
      `mark :${latestMark + 1}`,
      'author CommitLore Bench <bench@commitlore.local> 1760000001 +0000',
      'committer CommitLore Bench <bench@commitlore.local> 1760000001 +0000',
      `data ${Buffer.byteLength(message)}`,
      message,
      `from :${latestMark}`,
      'M 100644 inline .commitlore/lifecycle.txt',
      'data 10',
      'supersede\n',
    ].join('\n'));
  }
  return `${commits.join('\n')}\ndone\n`;
};

export const createNoiseFixture = (
  distractors: number,
  seed = NOISE_SEED,
  supersede = false,
): NoiseFixture => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-noise-'));
  const corpus = generateNoiseCorpus(distractors, seed);
  git(dir, ['init', '--quiet']);
  command('git', ['fast-import', '--quiet'], { cwd: dir, input: fastImport(corpus.records, supersede) });
  git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return { dir, corpus, superseded: supersede };
};

export const destroyNoiseFixture = (fixture: NoiseFixture): void => {
  rmSync(fixture.dir, { recursive: true, force: true });
};

const tokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

const lexicalScore = (query: string, record: NoiseRecord): number => {
  const haystack = `${record.path}\n${record.message}`.toLowerCase();
  return query.toLowerCase().match(/[a-z0-9]+/g)?.reduce(
    (score, token) => score + (haystack.split(token).length - 1),
    0,
  ) ?? 0;
};

const topK = (records: readonly NoiseRecord[]): readonly NoiseRecord[] =>
  records.slice().sort((left, right) =>
    lexicalScore(TOP_K_QUERY, right) - lexicalScore(TOP_K_QUERY, left) ||
    left.recordId.localeCompare(right.recordId),
  ).slice(0, TOP_K);

const delivery = (
  route: NoiseRoute,
  fixture: NoiseFixture,
): { readonly records: number; readonly relevant: number; readonly text: string } => {
  if (route === 'inject-everything') {
    const text = fixture.corpus.records.map((record) => record.message).join('\n\n');
    return { records: fixture.corpus.records.length, relevant: 2, text };
  }
  if (route === 'top-k-lexical') {
    const selected = topK(fixture.corpus.records);
    return {
      records: selected.length,
      relevant: selected.filter((record) => record.relevant).length,
      text: selected.map((record) => record.message).join('\n\n'),
    };
  }
  const injection = buildInjection({ cwd: fixture.dir, path: TARGET_PATH });
  return { records: injection.records, relevant: injection.records, text: injection.text };
};

export const activePathRecords = (fixture: NoiseFixture): number =>
  fixture.corpus.records.filter(
    (record) => record.relevant && record.path === TARGET_PATH &&
      !(fixture.superseded && record.recordId === 'r-expose001'),
  ).length;

export const measureNoiseExposure = (
  base: RowBase,
  distractors: readonly number[] = NOISE_SIZES,
  runs = NOISE_RUNS,
): readonly NoiseExposureRow[] => {
  const rows: NoiseExposureRow[] = [];
  for (const size of distractors) {
    const fixture = createNoiseFixture(size);
    try {
      for (const route of ['inject-everything', 'top-k-lexical', 'commitlore-path-lifecycle'] as const) {
        const visible = delivery(route, fixture);
        rows.push({
          ...base,
          metric: 'noise_exposure',
          distractors: size,
          corpus_records: fixture.corpus.records.length,
          route,
          visible_records: visible.records,
          visible_tokens: tokens(visible.text),
          relevant_records: visible.relevant,
          relevant_total: 2,
          timing: timing(() => { delivery(route, fixture); }, runs),
        });
      }
    } finally {
      destroyNoiseFixture(fixture);
    }
  }
  return rows;
};
