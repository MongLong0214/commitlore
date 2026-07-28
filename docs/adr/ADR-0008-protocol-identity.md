# ADR-0008: protocol identity — establish the name and vocabulary as an independent design

> ⚠️ **§1 (name) was superseded by [ADR-0009](ADR-0009-rename-commitlore.md).** The protocol is named **CommitLore**, not `Annals`, and the package, binary, and repository use `commitlore`.
> The `Annals` references remaining in this document are deliberately preserved as decision history — mechanical replacement would erase what changed and why.
> **§2 (vocabulary re-derivation) and its rationale remain valid.** Not one vocabulary term or enum changed; only `Annals-Version:` → `CommitLore-Version:` followed from the name change.

- Status: Accepted (2026-07-26, owner decision) · §1 Superseded by ADR-0009 (2026-07-26)
- Owner: CTO
- Supersedes: all provisional names and vocabulary used in earlier documents

## Context

The initial design inherited the name and trailer vocabulary of the preceding material unchanged. That made the project read as a derivative, and each vocabulary term remained unable to answer "why does this field exist?" (because it was inherited).

At the same time, we had already established the **"no dead fields"** principle: *every field must have at least 1 consumer route that reads it and changes behavior.* Applying this principle to the inherited vocabulary means re-deriving the vocabulary itself — some inherited fields had no consumer.

Because not one line of code has been written, this is the cheapest point to replace it.

## Decision

### 1. Protocol and tool name: **Annals**

`annals` = chronological records left by contemporary recorders for posterity. The exact definition of this project.
- npm package `annals`, CLI binary `annals`, repository `MongLong0214/annals`
- The unit of knowledge is a **record**. One commit leaves one record.

Rejected candidates and reasons: `menhir` (conflicts with the OCaml parser generator), `rune`·`stele`·`waymark`·`lodestone` (taken on npm), `cairn` (taken on npm), `markstone`·`blazemark` (available but less readable as CLIs).

### 2. Vocabulary: re-derived from consumer routes

Each field exists only if it can answer **"which route reads this, and what does it do?"** If it cannot answer, remove it from the vocabulary.

| Trailer | Meaning | Value grammar | Consumer route (reason to exist) |
|---|---|---|---|
| `Limit:` | External condition that constrained the decision | Free text | Path injection · `annals limits` |
| `Ruled-out:` | Rejected alternative and reason | `alternative \| reason` (pipe required) | **`annals guard`** — block re-proposal in advance |
| `Warn:` | Warning for the next modifier | Free text (folding allowed) | Graded injection (demoted when unverified) |
| `Blast:` | Change impact radius | `local \| module \| system` | Approval-gate routing |
| `Undo:` | Cost of reversal | `easy \| costly \| permanent` | Approval-gate routing |
| `Certainty:` | Confidence in the judgment | `firm \| tentative \| guess` | Stale-sweep priority (review guess first) |
| `Verified:` | What was verified and how | Free text | Coverage query |
| `Unverified:` | Known verification gap | Free text | Coverage query |
| `Follows:` | Preceding record in the decision chain | Record-Id | Context assembly |
| `Record-Id:` | Stable identity of the record | `r-[a-z0-9]{6,}` | Lifecycle fold |
| `Supersedes:` | Retires a previous record | Record-Id | Stale engine |
| `Expires:` | Validity end date or condition | `YYYY-MM-DD` or condition text | Stale engine |
| `Evidence:` | Claim→evidence link | `path#anchor` or URL | Harvest verifier (citation comparison) |
| `Provenance:` | Source grade of the record | `authored \| inherited <sha> \| reconstructed` | Trust-grade decision |
| `Annals-Version:` | Protocol version | semver | Tool compatibility |
| `X-*` | Organization extension | Free text | Preserve, but core does not interpret |

**3 design decisions:**
- `Follows:` points to a **Record-Id**, not a commit hash — hashes change through rebase and squash, but Record-Id is immutable (consistent with ADR-0004's workflow-survival principle).
- `Certainty:` survived because it has a route — the stale sweep moves `guess` records to the front of the review queue. If we could not create a route, we would have removed it.
- Value enums use **words that direct behavior**. An approval gate understands `permanent` immediately, while abstract grade words require interpretation every time.

## Rejected

- **Keep the preceding material's name and vocabulary** | reads as a derivative, and inherited fields cannot answer "why do I exist?" Above all, the vocabulary itself violated our own "no dead fields" principle
- **Change only the name and keep the vocabulary** | half a measure. The vocabulary is the substance of the protocol, so changing only the name leaves the substance unchanged
- **Delete `Certainty:`** | we could design a real route (stale priority), so the principle says to keep it. What is forbidden is retaining a field merely because it "looks useful" without a route
- **Replace after implementation** | after implementing 27 tickets, we would have to touch the spec, fixtures, index, hooks, and every document again. With 0 lines of code, now is the only cheap moment

## Consequences

- Every document (README in 4 languages, ADRs, PRDs, tickets) and 34 GitHub issues is updated with the new name and vocabulary.
- The in-progress spec, parser, and harness work uses the old vocabulary, so discard it and restart (with 0 lines of code, the only loss is time).
- The conformance suite's **rejection fixtures** contain *values outside our enums*, not inherited vocabulary — for example: `Blast: wide`, `Undo: clean`, `Certainty: high`.
- This protocol differs from the preceding material in name, vocabulary, and value system, so describe it as an independent design.
