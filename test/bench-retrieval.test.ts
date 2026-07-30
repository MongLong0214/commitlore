import { describe, expect, it } from 'vitest';

import {
  assertPinnedModel,
  bm25Scores,
  countStaleRecords,
  createRetrievalFixture,
  PINNED_MODEL,
  rankEmbedding,
  retrievalCorpus,
  retrieveCommitLore,
  retrieveRoutes,
  staleRecordIds,
} from '../bench/retrieval/compare.ts';
import { RETRIEVAL_ROUTES } from '../bench/retrieval/types.ts';
import {
  destroyNoiseFixture,
  generateNoiseCorpus,
  TARGET_PATH,
  TOP_K,
} from '../bench/deterministic/noise.ts';

describe('retrieval route comparison', () => {
  it('returns exactly the shared output budget from every route', () => {
    const fixture = createRetrievalFixture(10, 142);
    try {
      const embeddings = fixture.corpus.records.map((_, index) => [index + 1, 1]);
      const routes = retrieveRoutes(
        fixture.corpus.records,
        embeddings,
        [1, 0],
        retrieveCommitLore(fixture),
      );

      expect(Object.keys(routes)).toEqual(RETRIEVAL_ROUTES);
      for (const selected of Object.values(routes)) expect(selected).toHaveLength(TOP_K);
    } finally {
      destroyNoiseFixture(fixture);
    }
  });

  it('fails loudly when the pinned model is absent', () => {
    expect(() =>
      assertPinnedModel([
        { name: 'another-model:latest', digest: 'abc', modifiedAt: '2026-01-01T00:00:00Z' },
      ])
    ).toThrow(`Pinned embedding model ${PINNED_MODEL} is unavailable`);
  });

  it('scores a hand-checked BM25 example', () => {
    const scores = bm25Scores('cat', ['cat cat dog', 'cat mouse']);

    expect(scores[0]).toBeCloseTo(0.237342, 6);
    expect(scores[1]).toBeCloseTo(0.198568, 6);
  });

  it('narrows embedding candidates with the path metadata filter', () => {
    const records = generateNoiseCorpus(1, 142).records;
    const embeddings = [
      [0.8, 0.2],
      [0.7, 0.3],
      [1, 0],
    ];

    expect(rankEmbedding(records, embeddings, [1, 0], TOP_K).map(({ recordId }) => recordId))
      .toContain('r-noise000000');
    expect(
      rankEmbedding(records, embeddings, [1, 0], TOP_K, TARGET_PATH).map(({ recordId }) => recordId),
    ).toEqual(['r-expose001', 'r-expose002']);
  });

  it('uses the identical fixed-seed corpus in both harnesses', () => {
    const generated = generateNoiseCorpus(1, 142);
    const retrieval = retrievalCorpus(1, 142);

    expect(retrieval.records.filter(({ recordId }) => recordId.startsWith('r-noise')))
      .toEqual(generated.records.filter(({ recordId }) => recordId.startsWith('r-noise')));
  });

  it('identifies a superseded record as stale', () => {
    const corpus = retrievalCorpus(0, 142);
    const stale = corpus.records.find(({ recordId }) => recordId === 'r-stale01');

    expect(stale).toBeDefined();
    expect(staleRecordIds(corpus.records)).toContain(stale?.recordId);
  });

  it('identifies an expired record as stale', () => {
    const corpus = retrievalCorpus(0, 142);
    const expired = corpus.records.find(({ expiresAt }) => expiresAt !== undefined);

    expect(expired).toBeDefined();
    expect(staleRecordIds(corpus.records)).toContain(expired?.recordId);
  });

  it('contains a deliberately more similar superseded predecessor', () => {
    const corpus = retrievalCorpus(0, 142);
    const stale = corpus.records.find(({ adversarial }) => adversarial === true);
    const successor = corpus.records.find(({ supersedes }) =>
      stale !== undefined && supersedes?.includes(stale.recordId)
    );

    expect(stale).toMatchObject({ path: TARGET_PATH, relevant: false });
    expect(successor).toBeDefined();
    const scores = bm25Scores(
      `${TARGET_PATH} active lifecycle decision context path scope`,
      [stale, successor].map((record) => `${record?.path}\n${record?.message}`),
    );
    expect(scores[0]).toBeGreaterThan(scores[1] ?? Number.POSITIVE_INFINITY);
  });

  it('computes stale count from corpus lifecycle, not a route label', () => {
    const corpus = retrievalCorpus(0, 142);
    const stale = corpus.records.filter(({ recordId, expiresAt }) =>
      recordId === 'r-stale01' || expiresAt !== undefined
    );

    expect(countStaleRecords(stale, corpus.records)).toBe(2);
  });
});
