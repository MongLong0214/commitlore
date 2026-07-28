# PRD F8 — Backfill MVP (stretch)

- Milestone: M4 (08-23) · Stretch — failure does not block the v0.1.0 release · ADR: 0006

## Goal
Resolve cold start: retrospectively reconstruct decision context from past commits and PR text in an existing repository, creating query value from the first day of adoption.

## User stories
- As a new adopter, when I run `commitlore backfill --limit 200`, past decision history is reconstructed in notes and becomes immediately queryable.

## Requirements
1. Input: latest N commits (+ linked PR bodies, gh CLI opt-in). Output: notes records, all `Provenance: reconstructed`.
2. Must pass the verifier (evidence = citation from original commit/PR text). Skip+mark reconstruction failures; no fabrication.
3. Dual stopping: convergence (0 new records for 2 consecutive batches) or commit-count and token-budget caps.
4. LLM use only through the user's existing agent session/key (opt-in) — no-LLM mode only indexes commits that already contain trailers.

## AC
- [ ] Run 1 time against this repository or any public repository: reconstructed records ≥ 10, Provenance on every record, verifier pass-rate log
- [ ] Test the forced-stop path at the budget cap
