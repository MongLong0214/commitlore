# ADR-0033: raise the supported Node floor to 22.13.0

- Status: Accepted (2026-08-13)
- Owner: CTO
- Issue: [#586](https://github.com/MongLong0214/commitlore/issues/586)
- Supersedes: [ADR-0010](ADR-0010-node-floor.md)'s floor of `>=22` (later written
  as `>=22.12.0` without a superseding ADR). ADR-0010's other decisions remain
  valid: stay on the v22 line rather than v24, run CI on both the floor and
  Active LTS, and fail the build when a direct dependency does not support the
  declared floor.

## Context

ADR-0010 raised the floor from Node 20 to Node 22 because 20 was EOL and
`commander` already required `>=22.12.0`. It said, explicitly:

> When raising the floor again, write a new ADR that supersedes this one.
> Reject any change that edits only `package.json`.

That instruction was ignored when the floor became `>=22.12.0`. The number
moved in `package.json`, the installers, the README, and the CI matrix, and
no ADR recorded why 22.12 was the floor or what it was supposed to buy.

It did not buy a working index.

The product's storage layer (`src/core/index-db.ts`) imports `node:sqlite`.
That module was added in 22.5.0 and stayed behind `--experimental-sqlite`
until 22.13.0. On 22.12.x it is not there:

    node 22.12.0: require('node:sqlite') -> "No such built-in module: node:sqlite"
    node 22.13.0: require('node:sqlite') -> OK
    node 22.13.0: zlib.zstdCompressSync  -> not a function
    node 22.15.0: zlib.zstdCompressSync  -> OK

CI proved the first line. Pinning the floor job to 22.12.0 failed 134 tests
with 85 "No such built-in module: node:sqlite". Node 24 passed everything.
On 22.12.x, `init` dies at the Index step and `context` / `query` / `inject`
/ `doctor` lose the index.

`scripts/check-engines.mjs` could not have caught this. It reads declared
`engines.node` ranges. A bare `node:` builtin has no range. That is why a
wrong floor shipped.

`zlib.zstdCompressSync` is 22.15.0 and is used only in `bench/cdeb/*`, never
in `src/` or `dist/`. Raising the package floor to 22.15.0 to dodge a
research-harness import would exclude every 22.13 and 22.14 user for a
path they never run.

## Decision

1. **Raise the floor to `>=22.13.0`.** Change `engines.node`, both installers,
   the CI matrix pin, the release-gate check name, and the documentation
   together. This ADR is the document; those files are the change.
2. **Do not raise the floor to 22.15.0.** `zstdCompressSync` is bench-only.
   Those tests skip when zstd is missing, and they name the Node version they
   need. The package promise stays 22.13.0.
3. **`check-engines.mjs` compares imported `node:` builtins against the
   floor.** For each specifier `src/` imports, the minimum Node that provides
   it unflagged is compared to `engines.node`. `node:sqlite` is 22.13.0. The
   check fails when the floor is below what an imported builtin needs. That
   is the gap this ADR closes.
4. **When raising the floor again, write a new ADR that supersedes this one.**
   Reject any change that edits only `package.json`.

## Rejected

- **Keep 22.12.0 and document `--experimental-sqlite`** | the product imports
  the builtin without a flag. Asking every 22.12 user to relaunch Node with a
  flag is a support burden that hides a floor that already does not work.
- **Raise the floor to 22.15.0 because the bench uses zstd** | zstd is not in
  `src/` or `dist/`. The floor is what a user of the product needs, not what
  the research harness needs.
- **Edit only `package.json`** | ADR-0010 already forbade this. The 22.12.0
  bump did it in spirit: the number moved in several files and no ADR said
  why. The next raise writes an ADR first.

## Consequences

- `engines.node` is `>=22.13.0`. Both installers refuse 22.12 and accept 22.13.
- CI's floor job is `check (22.13.0)`. The human updates GitHub branch
  protection; this change does not.
- `scripts/check-engines.mjs` fails a floor that cannot load `node:sqlite`
  without a flag, even when every npm dependency is fine with that floor.
- Bench/cdeb tests that need `zlib.zstdCompressSync` skip on 22.13 and 22.14
  and say they need 22.15.0.
- ADR-0010 remains the record of why the floor left Node 20 and stayed on
  the v22 line. This document is the record of why the minor moved.
