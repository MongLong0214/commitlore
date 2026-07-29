# Retrieval route comparison

Measured at: 2026-07-29T09:17:25.181Z

This measures exposure and recall at a fixed two-record output budget. It does not measure token cost, billed cost, accuracy, or agent behaviour. Timing was not taken.

Corpus: `generateNoiseCorpus`, seed 1422026, distractor sizes 0, 10, 100, 1000, 10000.
Query: `src/core/decision-context.ts active lifecycle decision context path scope`
Harness source SHA-256: `206b3527cb7cfc7bba09bc437f83a13db28dfc68532abbee487e60330115801a`

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

## Results

Routes matching or beating CommitLore path scope at every reported size: `Embedding top-k`, `Embedding + path filter`. This statement compares only the recall counts in the table.

| distractors | corpus records | BM25 | Embedding top-k | Hybrid RRF | Embedding + path filter | CommitLore path + lifecycle |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| 10 | 12 | 0/2 | 2/2 | 1/2 | 2/2 | 2/2 |
| 100 | 102 | 0/2 | 2/2 | 0/2 | 2/2 | 2/2 |
| 1000 | 1002 | 0/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| 10000 | 10002 | 0/2 | 2/2 | 1/2 | 2/2 | 2/2 |
