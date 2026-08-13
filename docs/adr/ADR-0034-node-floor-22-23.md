# ADR-0034: guarantee FTS5 on the Node 22 LTS floor

- Status: Accepted (2026-08-13)
- Owner: CTO
- Issue: [#593](https://github.com/MongLong0214/commitlore/issues/593)
- Supersedes: [ADR-0033](ADR-0033-node-floor-22-13.md)'s runtime floor of
  `>=22.13.0`. ADR-0033's decision to stay on Node 22, run CI at the declared
  floor and Active LTS, and check Node-provided capabilities remains valid.

## Context

ADR-0033 raised the floor to 22.13.0 because `node:sqlite` becomes available
without `--experimental-sqlite` there. That establishes that the index can open
a database; it does not establish that the database has every feature the index
uses.

CommitLore's index creates an FTS5 virtual table. The bundled SQLite reports
the following when asked to run `CREATE VIRTUAL TABLE t USING fts5(x)`:

| Node | Result |
|---|---|
| 22.13.0 | fails |
| 22.15.0 | fails |
| 22.16.0 | succeeds |
| 22.17.0 | succeeds |
| 22.23.2 | succeeds |

On the former floor, 22.13–22.15 created the normal index but used its LIKE
fallback for every full-text query. Answers stayed correct, but the advertised
full-text path was not available. The weakened test expressed that accident by
accepting either a boolean value for `handle.fts`.

Node's current `latest-jod` documentation and release page identify 22.23.2
as the current stable Node 22 LTS release. It is above the 22.16.0 FTS5
threshold and is the release line this product has chosen to track.

## Decision

1. **Raise the package floor to `>=22.23.2`.** Update `engines.node`, both
   installers, every installation document, the exact floor CI matrix leg and
   the exact-head release check together. The installers compare major, minor
   and patch so they enforce the same floor the package declares.
2. **Make FTS5 a product guarantee.** The default index test asserts
   `handle.fts === true`; the separate explicitly disabled-index test retains
   coverage of the LIKE fallback.
3. **Record the capability rather than merely the module.**
   `scripts/engine-floor.mjs` treats `node:sqlite` as requiring 22.16.0, the
   first release where the FTS5 feature used by this code works. This is not a
   claim that the module itself was still flagged at 22.16.
4. **Future Node-floor raises require another superseding ADR.** The version
   must continue to be a product capability decision, not a lone package
   metadata edit.

## Rejected

- **Keep 22.13.0 and make FTS5 optional** | correctness survives through the
  LIKE fallback, but product performance and full-text completeness would
  remain a runtime coincidence. The owner chose to prioritize both.
- **Set the floor only to 22.16.0** | that is the smallest FTS5-capable
  release, but the chosen policy is to track the current stable Node 22 LTS.
- **Describe `node:sqlite` as available from 22.13.0 in the engine table** |
  that validates an import, not the FTS5 feature the index requires, and would
  permit this exact defect again.

## Consequences

- Every supported Node runtime has FTS5; default indexed search uses it and
  the assertion is once again a guarantee.
- CI runs `check (22.23.2)` and `check (24)`. The human updates branch
  protection separately; this repository only names the check the workflow
  produces.
- Node 22.13–22.23.1 users must upgrade before installing this release.
- The LIKE path remains tested through an explicit test seam, not as an
  unsupported-runtime fallback.
