# Injection scanner corpus check

Command: `npx vitest run test/grade.test.ts`.

## 3. Injection detection

These are deterministic corpus checks, not an estimate of the scanner's
real-world detection rate. The positive set written from
`INJECTION_PATTERNS`, the independently written issue #70 set, and the benign
set are kept and reported separately.

| corpus | composition | withheld | delivered |
|---|---:|---:|---:|
| pattern-authored positives | 24 | 24 | 0 |
| issue #70, written without reading the patterns | 7 | 7 | 0 |
| benign records | 20 | 0 | 20 |

False positives on the benign corpus: **0/20 (0.0%)**.

The implementation applies one speculative decoding layer for base64,
hexadecimal and URL encoding, followed by explicit lexical rules for English,
Korean, Japanese and Chinese. These corpus outcomes provide no evidence about
semantic paraphrases, arbitrary nested encodings, languages or phrasings absent
from the table, or attacks split into individually innocent records.
