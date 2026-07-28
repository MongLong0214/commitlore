# ADR-0003: git = SSOT, everything else is derived

- Status: Accepted (2026-07-26, owner confirmation: "use git history as the SSOT")

## Context

Where should the source of truth for knowledge records live? Owner's principles: no DB, no server, 0 user cost.

## Decision

- **Truth set = {commit trailers, git notes (`refs/notes/commitlore`)}** — all git objects. They travel with clones and remain intact even if a server disappears.
- The SQLite index (L1) is a **rebuildable derived cache**: rebuild everything with the single command `commitlore index --rebuild`. Store the index at `.git/commitlore/index.db` and do not commit it.
- The organization view (graph and dashboard) is a static CI artifact — outside v0.1 scope (Backlog).
- Durable state such as pending approval does not get its own store. Use GitHub PRs (labels, checks, and comments) as the state machine, then stamp the result back into merge commit trailers/notes.

## Ruled-out

- Store records in a dedicated DB/server | duplicates the SSOT → repeats synchronization and corruption problems (the failure point of ADRs/wikis and ProjectMem), violates the 0-cost principle
- Commit the index to the repository | causes merge conflicts; derived artifacts should not be committed

## Consequences

- `commitlore doctor` must check and automatically configure the notes fetch refspec (`+refs/notes/commitlore:refs/notes/commitlore`) (git notes are not fetched by default — T-301).
- Index corruption is a reason to rebuild, not an outage. Every query command has a fallback path when the index is absent.
