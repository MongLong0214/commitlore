# Retrieval route comparison

Measured at: 2026-07-29T12:05:31.164Z

This measures exposure and recall at a fixed two-record output budget. It does not measure token cost, billed cost, accuracy, or agent behaviour. Timing was not taken.

Corpus: `generateNoiseCorpus` extended with two superseded predecessors and one expired record, seed 1422026, distractor sizes 0, 10, 100, 1000, 10000.
Query: `src/core/decision-context.ts active lifecycle decision context path scope`
Harness source SHA-256: `f8ddea11f0250056606da8338135adf1a1fcb78b7e423e62eab2090b137c0fcd`

## Embedding provenance

Provider: Ollama 0.17.4
Model: `qwen3-embedding:0.6b`
Manifest digest: `ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d`
Model modified at: 2026-07-11T21:20:15.333099299+09:00
Embedding dimension: 1024

A rerun is reproducible only with the same model artifact, query, corpus seed, and harness source. A different model version may not reproduce these rankings.

## Lexical baseline

The deterministic benchmark’s current `top-k lexical` scorer is a case-insensitive, unweighted count of every query-token occurrence in `path + record message`, with `recordId` as the tie-break. BM25 is a fairer baseline from the same lexical-retrieval family, but it is a different scorer: it adds inverse document frequency, term-frequency saturation, and document-length normalization.
This BM25 uses lowercase ASCII-alphanumeric tokens, unique query terms, k1=1.2, and b=0.75. Embedding routes rank cosine similarity over `path + record message`; hybrid applies reciprocal-rank fusion with k=60 to the complete BM25 and embedding rankings before the two-record budget; the path filter keeps exact-path candidates before embedding ranking.

## Adversarial lifecycle case

The superseded record `r-adverse` deliberately repeats the query’s subject and vocabulary more closely than its successor `r-expose002`; both records are on `src/core/decision-context.ts`, so path-filtered similarity retrieval can select the reversed decision.
Construction check: BM25 4.569424 > 1.586191 and pinned-model cosine 0.931950 > 0.815043 for stale record versus successor.
Zero-stale embedding retrieval was still a possible outcome: yes. The harness does not force either record into an embedding result or alter its score; both compete normally for the fixed budget.

## Results

Routes matching or beating CommitLore path scope at every reported size: none. This statement compares only the recall counts in the table.
Routes with strictly higher recall than CommitLore path + lifecycle at any reported size: none.
Routes with fewer stale records than CommitLore path + lifecycle at any reported size: none.

| distractors | corpus records | BM25 recall | BM25 stale | Embedding top-k recall | Embedding top-k stale | Hybrid RRF recall | Hybrid RRF stale | Embedding + path filter recall | Embedding + path filter stale | CommitLore path + lifecycle recall | CommitLore path + lifecycle stale |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 5 | 1/2 | 1 | 1/2 | 1 | 1/2 | 1 | 1/2 | 1 | 2/2 | 0 |
| 10 | 15 | 0/2 | 1 | 1/2 | 1 | 1/2 | 1 | 1/2 | 1 | 2/2 | 0 |
| 100 | 105 | 0/2 | 1 | 1/2 | 1 | 1/2 | 1 | 1/2 | 1 | 2/2 | 0 |
| 1000 | 1005 | 0/2 | 1 | 1/2 | 1 | 1/2 | 1 | 1/2 | 1 | 2/2 | 0 |
| 10000 | 10005 | 0/2 | 1 | 1/2 | 1 | 1/2 | 1 | 1/2 | 1 | 2/2 | 0 |

## Conclusion

BM25, Embedding top-k, Hybrid RRF, Embedding + path filter returned at least one stale record in this corpus; the separate recall columns show the context each route omitted.
