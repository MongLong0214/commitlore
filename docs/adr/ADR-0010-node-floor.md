# ADR-0010: raise the supported Node floor to 22

> ⚠️ **The runtime floor was superseded by [ADR-0033](ADR-0033-node-floor-22-13.md).**
> The supported floor is **Node ≥ 22.13.0**, not “≥ 22”. `node:sqlite` exists
> behind a flag from 22.5 and is unflagged only from 22.13; a 22.12.0 floor let
> `init` fail at the Index step. The major-22 decision, the refusal to set the
> floor at 24, and `scripts/check-engines.mjs` as the enforcement point remain
> valid. ADR-0033 adds the builtin check this document did not have.

- Status: Accepted (2026-07-26) · Runtime floor superseded by ADR-0033 (2026-08-13)
- Owner: CTO
- Supersedes: ADR-0002's runtime clause (“Node ≥ 20”). The language (TypeScript strict), distribution channel (npm/npx), and single-package decisions remain valid.

## Context

ADR-0002 set the floor at “Node ≥ 20; Node carries the least risk.” That judgment was correct when written and is wrong now.

**Node 20 reached EOL on 2026-04-30** (measured from nodejs/Release `schedule.json`, about 3 months before today, 2026-07-26). Making a runtime with no security patches the floor is the opposite of “least risk.”

At the same time, dependencies had already stopped honoring that floor:

| Dependency | Requirement | Our declaration |
|---|---|---|
| `commander` | `>=22.12.0` | `>=20` |
| `better-sqlite3@13` | `>=22` | `>=20` |

npm reports `EBADENGINE` **only as a warning** and continues installation, so this mismatch passed silently. The discovery path was indirect — 2 index-test workers died in CI for no stated reason, and the failure did not reproduce locally (Node 24). **The person adding a dependency usually runs a newer runtime than the floor they broke.**

Node release status (measured):

| Version | Status | End of support |
|---|---|---|
| v20 | **EOL** | 2026-04-30 |
| v22 | Maintenance | 2027-04-30 |
| v24 | Active LTS | 2028-04-30 |

## Decision

1. **Raise the floor to `>=22`.** Change `engines.node` in `package.json`, the CI matrix, and documentation together.
2. **Choose v22, not v24.** Making v24 the floor would exclude users still on v22 now. v22 is supported through 2027-04, enough to cover v0.1.0's lifetime.
3. **CI runs both the floor and Active LTS** — 22 and 24. Running only the floor misses breakage on the latest version; running only the latest makes the floor a lie.
4. **`scripts/check-engines.mjs` enforces this decision.** Fail the build if any direct dependency does not support the declared floor. This ADR is the document; that script enforces the document.

## Rejected

- **Keep Node 20 and downgrade dependencies** | both `commander` and `better-sqlite3` would need to be moved off their latest lines, and the gain would be support for an EOL runtime. That pays maintenance cost to buy an insecure floor
- **Set the floor to 24** | there is no reason to exclude v22 users now. v22 covers the lifetime of v0.1.0
- **Remove `engines` and say nothing** | without a declared floor, users cannot know whether their runtime works, and failure moves from installation to execution
- **Leave only a warning and continue** | npm already does that, and this ADR is the result

## Consequences

- `engines.node` in `package.json` becomes `>=22`. npm warns on runtimes below it.
- CI runs both 22 and 24. The `git-matrix` job multiplies these across ubuntu and macos.
- **`scripts/check-engines.mjs` becomes a CI step.** The next dependency that breaks the floor will stop before merge — this incident was discovered only after the issue had closed, and preventing its recurrence is why this script exists.
- When raising the floor again, write a new ADR that supersedes this one. Reject any change that edits only `package.json`.
