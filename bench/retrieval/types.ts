import type { NoiseCorpus, NoiseFixture, NoiseRecord } from '../deterministic/noise.ts';

export const RETRIEVAL_ROUTES = [
  'bm25',
  'embedding-top-k',
  'hybrid-rrf',
  'embedding-path-filter',
  'commitlore-path-lifecycle',
] as const;

export type RetrievalRoute = (typeof RETRIEVAL_ROUTES)[number];

export interface RetrievalRecord extends NoiseRecord {
  readonly supersedes?: readonly string[];
  readonly expiresAt?: string;
  readonly adversarial?: true;
}

export interface RetrievalCorpus extends Omit<NoiseCorpus, 'records'> {
  readonly records: readonly RetrievalRecord[];
}

export interface RetrievalFixture extends Omit<NoiseFixture, 'corpus'> {
  readonly corpus: RetrievalCorpus;
}

export type RouteSelections = {
  readonly [Route in RetrievalRoute]: readonly RetrievalRecord[];
};

export interface OllamaModel {
  readonly name: string;
  readonly digest: string;
  readonly modifiedAt: string;
}

export interface RetrievalRow {
  readonly distractors: number;
  readonly corpusRecords: number;
  readonly route: RetrievalRoute;
  readonly visibleRecords: number;
  readonly relevantRecords: number;
  readonly relevantTotal: 2;
  readonly staleRecords: number;
}
