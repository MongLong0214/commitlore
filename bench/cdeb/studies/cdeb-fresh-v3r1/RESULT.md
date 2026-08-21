# CDEB-Fresh v3r1 result: NO-GO

## Result

This study asked whether, with the same model, harness, task, and repository
snapshot, automatically delivering CommitLore's current shipping decision
context reduces functionally viable revival of a repository-rejected decision
relative to delivery-suppressed control (PRD §0.1).

`cdeb-fresh-v3r1` is **NO-GO** under `bench/cdeb/PRD.md` as written. The
confirmatory study cannot be run. This result is recorded before investment in
gold, oracle, or freeze work.

## Corpus qualification finding

A candidate cannot become a task without a valid `Record-Id`:
`gold.schema.json` requires non-empty `expected_record_ids` matching
`^r-[a-z0-9]{4,}$`, and `freeze/delivery-check.ts` keys the shipping probe on
that identifier. Counting candidates that have both an explicit rejection
reason and a valid identifier gives this fixed-stratum corpus:

| Repository | Candidates |
| --- | ---: |
| `gitseed` | 62 |
| `agent-operator-score` | 24 |
| `agent-control-plane` | 1 |
| `logic-pro-mcp` | 0 |

PRD §10.1 requires three pilot tasks per repository and §6.4 requires at
least ten tasks per repository. `agent-control-plane` and `logic-pro-mcp`
cannot meet either floor at any confirmatory N. The primary estimand is
equal-repository-weighted over the four fixed strata, so an estimand over an
empty stratum is undefined.

## Closed alternatives

- **Use two repositories only.** PRD §6.4 caps any one repository at 40% of
  all tasks, which presumes at least three repositories. With two, the most
  that can be supplied is 80%; a 48-task selection needs 60 tasks and can
  supply at most 48.
- **Backfill identifiers.** `commitlore backfill` marks output
  `Provenance: reconstructed`; `freeze/candidate-registry.ts` disqualifies it
  as `synthetic_or_backfilled_record`. Backfill also skips commits already
  carrying CommitLore keys, so it is not an identifier migration.
  `docs/adr/ADR-0014` rules out tool-minted identity everywhere in the
  codebase.
- **Add repositories.** PRD §6.1 defines the authorization's dense set as
  the entire four-repository set. `AUTHORIZATION.md` already excludes the two
  remaining grants and records why they are excluded.

## Identifier finding

The starved repositories are not short of decisions. `logic-pro-mcp` has 138
`Ruled-out:` trailers under `CommitLore-Version: 0.7.1`, a protocol version
whose records had no `Record-Id` field. Those decisions are natural, explicit,
and predate this study; the identifier is absent because it did not yet exist.

The shipping display path permits this form: `src/core/inject.ts` renders
`record.recordId ?? '-'`, and its accompanying comment says that one record
can have no identity. Identity is therefore part of the display selected by
this study's delivery instrument, not a precondition of record delivery. By
defining delivery success as `Record-Id` visibility, this instrument excludes
191 real decisions across the two affected repositories.

## Scope of this result

No measured data exists. Nothing was tuned after seeing an outcome. This
document makes no product claim, and no statement here is evidence for or
against CommitLore working.
