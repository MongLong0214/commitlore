# PRD F1 — Protocol v2 spec + conformance suite

- Milestone: M1 (08-02) · ADR: 0001, 0005, 0006

## Goal
A single canonical spec that produces the same behavior regardless of who implements it. Canonicalize the vocabulary enums to prevent behavioral divergence between implementations (D1) at the source.

## Non-goals
Finalizing symbol-anchoring syntax (Backlog); signature status now comes from Git's `%G?` verifier result when a repository opts into signed directives.

## User stories
- As an implementer, I can build a parser from only the JSON Schema and fixtures and pass the conformance suite.
- As an agent, the vocabulary enums are unique, so format errors such as `Certainty: yes` are mechanically rejected.

## Requirements
1. Trailer vocabulary: v1's 9 types + `CommitLore-Version` `Decision-Id` `Record-Id` `Supersedes` `Expires` `Evidence` `Provenance` + the `X-` extension namespace.
2. Canonical enums: `Certainty: firm|tentative|guess`, `Blast: local|module|system`, `Undo: easy|costly|permanent` (adopt the repo family — reason: compatibility with users of already-distributed skills).
3. Grammar: compatible with git interpret-trailers (including multiline folding) + EBNF.
4. **No dead fields**: for every vocabulary term, specify at least 1 consumer route (query, gate, or injection rule) in the spec.
5. Conformance suite: parser round-trip fixtures + route-contract tests (stale decision, approval-gate routing, Warn demotion).

## AC
- [ ] Commit SPEC.md + JSON Schema, fixtures ≥ 20 (10 valid, 5 boundary, 5 rejected)
- [ ] Define ≥ 8 route-contract test cases (executed in F2)
- [ ] Every row in the vocabulary table has a consumer-route column (0 blanks)
