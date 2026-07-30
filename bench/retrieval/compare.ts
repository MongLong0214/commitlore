import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildInjection } from '../../dist/core/inject.js';
import { foldLifecycle } from '../../dist/core/stale.js';
import {
  createNoiseFixture,
  destroyNoiseFixture,
  generateNoiseCorpus,
  NOISE_SEED,
  NOISE_SIZES,
  TARGET_PATH,
  TOP_K,
  TOP_K_QUERY,
} from '../deterministic/noise.ts';
import type { NoiseRecord } from '../deterministic/noise.ts';
import { git } from '../deterministic/shared.ts';
import {
  RETRIEVAL_ROUTES,
  type OllamaModel,
  type RetrievalCorpus,
  type RetrievalFixture,
  type RetrievalRecord,
  type RetrievalRoute,
  type RetrievalRow,
  type RouteSelections,
} from './types.ts';

export const PINNED_MODEL = 'qwen3-embedding:0.6b';
const OLLAMA_URL = 'http://localhost:11434';
const RESULT_PATH = new URL('./result.md', import.meta.url);
const BATCH_SIZE = 128;
const RRF_K = 60;
const LIFECYCLE_AT = new Date('2026-01-01T00:00:00Z');
const SAME_PATH_STALE_ID = 'r-stale01';
const EXPIRED_ID = 'r-expire1';
const ADVERSARIAL_STALE_ID = 'r-adverse';

const terms = (text: string): readonly string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const document = (record: NoiseRecord): string => `${record.path}\n${record.message}`;

const staleRecords = (): readonly RetrievalRecord[] => [
  {
    recordId: SAME_PATH_STALE_ID,
    path: TARGET_PATH,
    relevant: false,
    message: [
      'Send every repository decision to the path-scoped context.',
      '',
      'Limit: Keep decision context repository-wide even when a path is known.',
      'Ruled-out: path-only delivery | global context was assumed safer.',
      'Warn: This decision was later replaced on the same path.',
      'Blast: module',
      'Undo: easy',
      'Certainty: firm',
      `Record-Id: ${SAME_PATH_STALE_ID}`,
    ].join('\n'),
  },
  {
    recordId: EXPIRED_ID,
    path: TARGET_PATH,
    relevant: false,
    expiresAt: '2025-06-30',
    message: [
      'Keep a temporary decision-context compatibility branch.',
      '',
      'Limit: Preserve the compatibility branch until the June migration completes.',
      'Warn: Remove this temporary path after its fixed expiry.',
      'Expires: 2025-06-30',
      'Blast: module',
      'Undo: easy',
      'Certainty: firm',
      `Record-Id: ${EXPIRED_ID}`,
    ].join('\n'),
  },
  {
    recordId: ADVERSARIAL_STALE_ID,
    path: TARGET_PATH,
    relevant: false,
    adversarial: true,
    message: [
      `${TARGET_PATH} active lifecycle decision context path scope`,
      '',
      `Limit: ${TARGET_PATH} active lifecycle decision context path scope.`,
      'Ruled-out: semantic successor wording | active lifecycle decision context path scope must repeat the query vocabulary.',
      `Warn: Retrieve ${TARGET_PATH} active lifecycle decision context path scope.`,
      'Blast: module',
      'Undo: easy',
      'Certainty: firm',
      `Record-Id: ${ADVERSARIAL_STALE_ID}`,
    ].join('\n'),
  },
];

const successor = (record: NoiseRecord, supersedes: string): RetrievalRecord => ({
  ...record,
  supersedes: [supersedes],
  message: record.message.replace(
    `Record-Id: ${record.recordId}`,
    `Supersedes: ${supersedes}\nRecord-Id: ${record.recordId}`,
  ),
});

export const retrievalCorpus = (
  distractors: number,
  seed = NOISE_SEED,
): RetrievalCorpus => {
  const base = generateNoiseCorpus(distractors, seed);
  const [first, second, ...distractorRecords] = base.records;
  if (first === undefined || second === undefined) {
    throw new Error('retrieval corpus needs two active records');
  }
  return {
    ...base,
    records: [
      successor(first, SAME_PATH_STALE_ID),
      successor(second, ADVERSARIAL_STALE_ID),
      ...staleRecords(),
      ...distractorRecords,
    ],
  };
};

const commitFixtureRecord = (
  fixture: RetrievalFixture,
  record: RetrievalRecord,
  stamp: number,
): void => {
  const parent = git(fixture.dir, ['rev-parse', 'HEAD']).stdout.trim();
  const content = `${record.path} retrieval fixture ${record.recordId}\n`;
  const stream = [
    'commit refs/heads/main',
    'author CommitLore Bench <bench@commitlore.local> ' + stamp + ' +0000',
    'committer CommitLore Bench <bench@commitlore.local> ' + stamp + ' +0000',
    `data ${Buffer.byteLength(record.message)}`,
    record.message,
    `from ${parent}`,
    `M 100644 inline ${record.path}`,
    `data ${Buffer.byteLength(content)}`,
    content,
    'done',
    '',
  ].join('\n');
  git(fixture.dir, ['fast-import', '--quiet'], { input: stream });
};

export const createRetrievalFixture = (
  distractors: number,
  seed = NOISE_SEED,
): RetrievalFixture => {
  const base = createNoiseFixture(distractors, seed);
  const fixture: RetrievalFixture = { ...base, corpus: retrievalCorpus(distractors, seed) };
  try {
    for (const record of fixture.corpus.records.filter((candidate) =>
      candidate.recordId === SAME_PATH_STALE_ID ||
      candidate.recordId === EXPIRED_ID ||
      candidate.recordId === ADVERSARIAL_STALE_ID
    )) {
      commitFixtureRecord(fixture, record, 1_746_057_600);
    }
    for (const record of fixture.corpus.records.filter((candidate) =>
      candidate.supersedes !== undefined
    )) {
      commitFixtureRecord(fixture, record, 1_760_100_000);
    }
    return fixture;
  } catch (error) {
    destroyNoiseFixture(fixture);
    throw error;
  }
};

export const staleRecordIds = (
  records: readonly RetrievalRecord[],
  at = LIFECYCLE_AT,
): ReadonlySet<string> =>
  new Set(
    foldLifecycle(
      records.map((record) => ({
        sha: record.recordId,
        trailers: [
          { key: 'Record-Id', value: record.recordId },
          ...(record.supersedes ?? []).map((value) => ({ key: 'Supersedes', value })),
          ...(record.expiresAt === undefined
            ? []
            : [{ key: 'Expires', value: record.expiresAt }]),
        ],
      })),
      { at },
    ).filter(({ lifecycle }) => lifecycle !== 'active').map(({ recordId }) => recordId),
  );

export const countStaleRecords = (
  selected: readonly RetrievalRecord[],
  corpus: readonly RetrievalRecord[],
): number => {
  const stale = staleRecordIds(corpus);
  return selected.filter(({ recordId }) => stale.has(recordId)).length;
};

export const bm25Scores = (
  query: string,
  documents: readonly string[],
): readonly number[] => {
  if (documents.length === 0) return [];
  const tokenized = documents.map(terms);
  const averageLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / tokenized.length;
  const queryTerms = [...new Set(terms(query))];
  const documentFrequencies = new Map(
    queryTerms.map((token) => [
      token,
      tokenized.reduce((count, candidate) => count + Number(candidate.includes(token)), 0),
    ]),
  );
  return tokenized.map((tokens) => {
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    return queryTerms.reduce((score, token) => {
      const frequency = frequencies.get(token) ?? 0;
      if (frequency === 0) return score;
      const documentFrequency = documentFrequencies.get(token) ?? 0;
      const inverseDocumentFrequency = Math.log(
        1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5),
      );
      const saturation = frequency * 2.2 /
        (frequency + 1.2 * (0.25 + 0.75 * tokens.length / averageLength));
      return score + inverseDocumentFrequency * saturation;
    }, 0);
  });
};

const rank = (
  records: readonly RetrievalRecord[],
  scores: readonly number[],
  budget: number,
): readonly RetrievalRecord[] => {
  if (scores.length !== records.length) throw new Error('record and score counts differ');
  return records.map((record, index) => ({ record, score: scores[index] ?? Number.NEGATIVE_INFINITY }))
    .sort((left, right) =>
      right.score - left.score || left.record.recordId.localeCompare(right.record.recordId)
    )
    .slice(0, budget)
    .map(({ record }) => record);
};

export const rankBm25 = (
  records: readonly RetrievalRecord[],
  budget: number,
): readonly RetrievalRecord[] =>
  rank(records, bm25Scores(TOP_K_QUERY, records.map(document)), budget);

const cosine = (left: readonly number[], right: readonly number[]): number => {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error(`embedding dimensions differ: ${left.length} and ${right.length}`);
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm);
};

export const rankEmbedding = (
  records: readonly RetrievalRecord[],
  embeddings: readonly (readonly number[])[],
  queryEmbedding: readonly number[],
  budget: number,
  filterPath: string | null = null,
): readonly RetrievalRecord[] => {
  if (embeddings.length !== records.length) throw new Error('record and embedding counts differ');
  const candidates = records.map((record, index) => ({
    record,
    embedding: embeddings[index] ?? [],
  })).filter(({ record }) => filterPath === null || record.path === filterPath);
  return rank(
    candidates.map(({ record }) => record),
    candidates.map(({ embedding }) => cosine(queryEmbedding, embedding)),
    budget,
  );
};

const reciprocalRankFuse = (
  rankings: readonly (readonly RetrievalRecord[])[],
  budget: number,
): readonly RetrievalRecord[] => {
  const records = new Map<string, RetrievalRecord>();
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((record, index) => {
      records.set(record.recordId, record);
      scores.set(record.recordId, (scores.get(record.recordId) ?? 0) + 1 / (RRF_K + index + 1));
    });
  }
  return [...records.values()].sort((left, right) =>
    (scores.get(right.recordId) ?? 0) - (scores.get(left.recordId) ?? 0) ||
    left.recordId.localeCompare(right.recordId)
  ).slice(0, budget);
};

export const retrieveCommitLore = (
  fixture: RetrievalFixture,
  budget = TOP_K,
): readonly RetrievalRecord[] => {
  const text = buildInjection({ cwd: fixture.dir, path: TARGET_PATH }).text;
  return fixture.corpus.records
    .filter((record) => text.includes(record.recordId))
    .slice(0, budget);
};

export const retrieveRoutes = (
  records: readonly RetrievalRecord[],
  embeddings: readonly (readonly number[])[],
  queryEmbedding: readonly number[],
  commitLoreRecords: readonly NoiseRecord[],
  budget = TOP_K,
): RouteSelections => {
  const bm25 = rankBm25(records, records.length);
  const embedding = rankEmbedding(records, embeddings, queryEmbedding, records.length);
  return {
    bm25: bm25.slice(0, budget),
    'embedding-top-k': embedding.slice(0, budget),
    'hybrid-rrf': reciprocalRankFuse([bm25, embedding], budget),
    'embedding-path-filter': rankEmbedding(
      records,
      embeddings,
      queryEmbedding,
      budget,
      TARGET_PATH,
    ),
    'commitlore-path-lifecycle': commitLoreRecords.slice(0, budget),
  };
};

export const assertPinnedModel = (
  models: readonly OllamaModel[],
  pinned = PINNED_MODEL,
): OllamaModel => {
  const model = models.find((candidate) => candidate.name === pinned);
  if (model === undefined) {
    throw new Error(
      `Pinned embedding model ${pinned} is unavailable; install that exact model instead of substituting.`,
    );
  }
  return model;
};

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Ollama returned invalid ${label}`);
  }
  return value as Record<string, unknown>;
};

const textField = (value: Record<string, unknown>, field: string): string => {
  const result = value[field];
  if (typeof result !== 'string' || result.length === 0) {
    throw new Error(`Ollama returned invalid ${field}`);
  }
  return result;
};

const ollamaJson = async (path: string, body?: unknown): Promise<unknown> => {
  const response = await fetch(`${OLLAMA_URL}${path}`, {
    ...(body === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`Ollama ${path} failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
};

const availableModels = async (): Promise<readonly OllamaModel[]> => {
  const payload = object(await ollamaJson('/api/tags'), 'model list');
  if (!Array.isArray(payload.models)) throw new Error('Ollama returned invalid model list');
  return payload.models.map((candidate) => {
    const model = object(candidate, 'model');
    return {
      name: textField(model, 'name'),
      digest: textField(model, 'digest'),
      modifiedAt: textField(model, 'modified_at'),
    };
  });
};

const embeddings = async (input: readonly string[]): Promise<readonly (readonly number[])[]> => {
  const payload = object(
    await ollamaJson('/api/embed', { model: PINNED_MODEL, input, truncate: false, keep_alive: '5m' }),
    'embedding response',
  );
  if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== input.length) {
    throw new Error('Ollama returned the wrong number of embeddings');
  }
  return payload.embeddings.map((candidate) => {
    if (!Array.isArray(candidate) || candidate.length === 0 || candidate.some((value) => typeof value !== 'number')) {
      throw new Error('Ollama returned an invalid embedding');
    }
    return candidate as number[];
  });
};

const embedCorpus = async (records: readonly NoiseRecord[]): Promise<readonly (readonly number[])[]> => {
  const result: (readonly number[])[] = [];
  for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
    result.push(...await embeddings(records.slice(offset, offset + BATCH_SIZE).map(document)));
    process.stderr.write(`embedded ${Math.min(offset + BATCH_SIZE, records.length)}/${records.length}\r`);
  }
  process.stderr.write('\n');
  return result;
};

const sourceDigest = (): string => {
  const hash = createHash('sha256');
  for (const path of [
    new URL('./compare.ts', import.meta.url),
    new URL('./types.ts', import.meta.url),
    new URL('../deterministic/noise.ts', import.meta.url),
  ]) {
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
};

const resultFor = (
  rows: readonly RetrievalRow[],
  distractors: number,
  route: RetrievalRoute,
): RetrievalRow => {
  const row = rows.find((candidate) =>
    candidate.distractors === distractors && candidate.route === route
  );
  if (row === undefined) throw new Error(`missing ${route} result at ${distractors} distractors`);
  return row;
};

const renderReport = (
  rows: readonly RetrievalRow[],
  model: OllamaModel,
  dimension: number,
  ollamaVersion: string,
  adversarialBm25: readonly [number, number],
  adversarialCosine: readonly [number, number],
): string => {
  const routeLabels: Readonly<Record<RetrievalRoute, string>> = {
    bm25: 'BM25',
    'embedding-top-k': 'Embedding top-k',
    'hybrid-rrf': 'Hybrid RRF',
    'embedding-path-filter': 'Embedding + path filter',
    'commitlore-path-lifecycle': 'CommitLore path + lifecycle',
  };
  const comparable = RETRIEVAL_ROUTES.filter((route) =>
    route !== 'commitlore-path-lifecycle' &&
    NOISE_SIZES.every((size) =>
      resultFor(rows, size, route).relevantRecords >=
      resultFor(rows, size, 'commitlore-path-lifecycle').relevantRecords
    )
  );
  const recallWinners = RETRIEVAL_ROUTES.filter((route) =>
    route !== 'commitlore-path-lifecycle' &&
    NOISE_SIZES.some((size) =>
      resultFor(rows, size, route).relevantRecords >
        resultFor(rows, size, 'commitlore-path-lifecycle').relevantRecords
    )
  );
  const staleWinners = RETRIEVAL_ROUTES.filter((route) =>
    route !== 'commitlore-path-lifecycle' &&
    NOISE_SIZES.some((size) =>
      resultFor(rows, size, route).staleRecords <
        resultFor(rows, size, 'commitlore-path-lifecycle').staleRecords
    )
  );
  const staleRoutes = RETRIEVAL_ROUTES.filter((route) =>
    NOISE_SIZES.some((size) => resultFor(rows, size, route).staleRecords > 0)
  );
  return [
    '# Retrieval route comparison',
    '',
    `Measured at: ${new Date().toISOString()}`,
    '',
    'This measures exposure and recall at a fixed two-record output budget. It does not measure token cost, billed cost, accuracy, or agent behaviour. Timing was not taken.',
    '',
    `Corpus: \`generateNoiseCorpus\` extended with two superseded predecessors and one expired record, seed ${NOISE_SEED}, distractor sizes ${NOISE_SIZES.join(', ')}.`,
    `Query: \`${TOP_K_QUERY}\``,
    `Harness source SHA-256: \`${sourceDigest()}\``,
    '',
    '## Embedding provenance',
    '',
    `Provider: Ollama ${ollamaVersion}`,
    `Model: \`${model.name}\``,
    `Manifest digest: \`${model.digest}\``,
    `Model modified at: ${model.modifiedAt}`,
    `Embedding dimension: ${dimension}`,
    '',
    'A rerun is reproducible only with the same model artifact, query, corpus seed, and harness source. A different model version may not reproduce these rankings.',
    '',
    '## Lexical baseline',
    '',
    'The deterministic benchmark’s current `top-k lexical` scorer is a case-insensitive, unweighted count of every query-token occurrence in `path + record message`, with `recordId` as the tie-break. BM25 is a fairer baseline from the same lexical-retrieval family, but it is a different scorer: it adds inverse document frequency, term-frequency saturation, and document-length normalization.',
    'This BM25 uses lowercase ASCII-alphanumeric tokens, unique query terms, k1=1.2, and b=0.75. Embedding routes rank cosine similarity over `path + record message`; hybrid applies reciprocal-rank fusion with k=60 to the complete BM25 and embedding rankings before the two-record budget; the path filter keeps exact-path candidates before embedding ranking.',
    '',
    '## Adversarial lifecycle case',
    '',
    `The superseded record \`${ADVERSARIAL_STALE_ID}\` deliberately repeats the query’s subject and vocabulary more closely than its successor \`r-expose002\`; both records are on \`${TARGET_PATH}\`, so path-filtered similarity retrieval can select the reversed decision.`,
    `Construction check: BM25 ${adversarialBm25[0].toFixed(6)} > ${adversarialBm25[1].toFixed(6)} and pinned-model cosine ${adversarialCosine[0].toFixed(6)} > ${adversarialCosine[1].toFixed(6)} for stale record versus successor.`,
    'Zero-stale embedding retrieval was still a possible outcome: yes. The harness does not force either record into an embedding result or alter its score; both compete normally for the fixed budget.',
    '',
    '## Results',
    '',
    `Routes matching or beating CommitLore path scope at every reported size: ${
      comparable.length === 0 ? 'none' : comparable.map((route) => `\`${routeLabels[route]}\``).join(', ')
    }. This statement compares only the recall counts in the table.`,
    `Routes with strictly higher recall than CommitLore path + lifecycle at any reported size: ${
      recallWinners.length === 0
        ? 'none'
        : recallWinners.map((route) => `\`${routeLabels[route]}\``).join(', ')
    }.`,
    `Routes with fewer stale records than CommitLore path + lifecycle at any reported size: ${
      staleWinners.length === 0
        ? 'none'
        : staleWinners.map((route) => `\`${routeLabels[route]}\``).join(', ')
    }.`,
    '',
    `| distractors | corpus records | ${
      RETRIEVAL_ROUTES.flatMap((route) => [
        `${routeLabels[route]} recall`,
        `${routeLabels[route]} stale`,
      ]).join(' | ')
    } |`,
    `|---:|---:|${RETRIEVAL_ROUTES.flatMap(() => ['---:', '---:']).join('|')}|`,
    ...NOISE_SIZES.map((size) => {
      const first = resultFor(rows, size, 'bm25');
      return `| ${size} | ${first.corpusRecords} | ${
        RETRIEVAL_ROUTES.flatMap((route) => {
          const row = resultFor(rows, size, route);
          return [`${row.relevantRecords}/${row.relevantTotal}`, row.staleRecords];
        }).join(' | ')
      } |`;
    }),
    '',
    '## Conclusion',
    '',
    staleRoutes.length === 0
      ? 'No route returned a stale record in this corpus; the separate recall columns show the context each route omitted.'
      : `${
        staleRoutes.map((route) => routeLabels[route]).join(', ')
      } returned at least one stale record in this corpus; the separate recall columns show the context each route omitted.`,
    '',
  ].join('\n');
};

export const runComparison = async (): Promise<string> => {
  const model = assertPinnedModel(await availableModels());
  const versionPayload = object(await ollamaJson('/api/version'), 'version response');
  const ollamaVersion = textField(versionPayload, 'version');
  const largestCorpus = retrievalCorpus(NOISE_SIZES.at(-1) ?? 0);
  const [queryEmbedding] = await embeddings([TOP_K_QUERY]);
  if (queryEmbedding === undefined) throw new Error('Ollama returned no query embedding');
  const corpusEmbeddings = await embedCorpus(largestCorpus.records);
  const dimension = queryEmbedding.length;
  if (corpusEmbeddings.some((embedding) => embedding.length !== dimension)) {
    throw new Error('Ollama returned inconsistent embedding dimensions');
  }
  const adversarial = largestCorpus.records.find(({ adversarial }) => adversarial === true);
  const adversarialSuccessor = largestCorpus.records.find(({ supersedes }) =>
    supersedes?.includes(ADVERSARIAL_STALE_ID)
  );
  if (adversarial === undefined || adversarialSuccessor === undefined) {
    throw new Error('adversarial stale record and successor are missing');
  }
  const adversarialIndex = largestCorpus.records.indexOf(adversarial);
  const successorIndex = largestCorpus.records.indexOf(adversarialSuccessor);
  const adversarialEmbedding = corpusEmbeddings[adversarialIndex];
  const successorEmbedding = corpusEmbeddings[successorIndex];
  if (adversarialEmbedding === undefined || successorEmbedding === undefined) {
    throw new Error('adversarial embeddings are missing');
  }
  const [adversarialBm25Score, successorBm25Score] = bm25Scores(
    TOP_K_QUERY,
    [document(adversarial), document(adversarialSuccessor)],
  );
  const adversarialCosineScore = cosine(queryEmbedding, adversarialEmbedding);
  const successorCosineScore = cosine(queryEmbedding, successorEmbedding);
  if (
    adversarialBm25Score === undefined ||
    successorBm25Score === undefined ||
    adversarialBm25Score <= successorBm25Score ||
    adversarialCosineScore <= successorCosineScore
  ) {
    throw new Error('adversarial stale record does not outrank its successor');
  }

  const rows: RetrievalRow[] = [];
  for (const distractors of NOISE_SIZES) {
    const fixture = createRetrievalFixture(distractors, NOISE_SEED);
    try {
      const expectedCorpus = retrievalCorpus(distractors, NOISE_SEED);
      if (JSON.stringify(fixture.corpus) !== JSON.stringify(expectedCorpus)) {
        throw new Error('retrieval and deterministic harness corpora differ');
      }
      const routes = retrieveRoutes(
        fixture.corpus.records,
        corpusEmbeddings.slice(0, fixture.corpus.records.length),
        queryEmbedding,
        retrieveCommitLore(fixture),
      );
      for (const route of RETRIEVAL_ROUTES) {
        const selected = routes[route];
        if (selected.length !== TOP_K) {
          throw new Error(`${route} returned ${selected.length} records; expected budget ${TOP_K}`);
        }
        rows.push({
          distractors,
          corpusRecords: fixture.corpus.records.length,
          route,
          visibleRecords: selected.length,
          relevantRecords: selected.filter((record) => record.relevant).length,
          relevantTotal: 2,
          staleRecords: countStaleRecords(selected, fixture.corpus.records),
        });
      }
    } finally {
      destroyNoiseFixture(fixture);
    }
  }
  return renderReport(
    rows,
    model,
    dimension,
    ollamaVersion,
    [adversarialBm25Score, successorBm25Score],
    [adversarialCosineScore, successorCosineScore],
  );
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  runComparison().then((report) => {
    writeFileSync(RESULT_PATH, report);
    process.stdout.write(report);
    process.stderr.write(`wrote ${fileURLToPath(RESULT_PATH)}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
