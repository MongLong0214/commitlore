# F8 tickets — Backfill MVP (M4 · stretch)

> PRD: `docs/prd/PRD-F8-backfill-mvp.md` · ADR: 0006 · **does not block release**

---

## T-801 backfill MVP (L) — #26 · depends on T-301, T-404

**Implementation outline**
- `commitlore backfill [--limit N] [--with-prs] [--budget-tokens N]`
  1. Target: latest N commits without trailers (+`--with-prs`: collect linked PR bodies with gh CLI, opt-in)
  2. Reconstruction: draft records from commit/PR text through a user-session delegation prompt → **must pass T-404 verifier** (evidence = source citation) → attach notes, all `Provenance: reconstructed`
  3. No-LLM mode: when no LLM is available, only index past commits that already have trailers (still valuable)
  4. Dual stopping: 2 consecutive batches with 0 new records (convergence) or `--limit`/`--budget-tokens` cap. Skip+log commits that fail reconstruction; **no fabrication**
- No parallel execution (v0.1 simplification — sequential batches).

**Test**: log from 1 run against this repository (≥10 reconstructed, Provenance on every record, verifier pass rate) / forced stop at budget cap / no-LLM mode.
**AC**: PRD-F8 AC 1·2. On failure, the v0.1.0 release proceeds unchanged (stretch).
