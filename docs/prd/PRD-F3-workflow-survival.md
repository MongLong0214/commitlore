# PRD F3 — Workflow survival (squash inheritance · notes mirror · --follow)

- Milestone: M2 (08-09) · ADR: 0004

## Goal
Knowledge does not die through squash, rebase, or rename. Resolve D3 and D4, which experimentally disproved the "permanent preservation" claim, with tooling.

## User stories
- As an agent on a squash-merge team, I can query Limits accumulated on a branch from the merge-target branch even after merge.
- Records survive a rebase through the notes mirror.

## Requirements
1. `commitlore squash-preserve <base>..<head>`: collect trailers → rewrite a proper trailer block in the merge commit + attach notes records. Dedupe duplicate records by Record-Id/content hash.
2. notes mirror: module to read/write `refs/notes/commitlore`; merge notes records into the query path.
3. Inherited records require `Provenance: inherited <sha>`.
4. doctor: automatically configure the notes fetch refspec (ADR-0003).

## AC
- [ ] D3 reproduction scenario: after a squash merge, `commitlore limits -- <path>` returns branch records
- [ ] Query succeeds through notes after rebase -i (rewrite)
- [ ] Confirm round-trip notes synchronization between teammates with 1 doctor run immediately after clone
