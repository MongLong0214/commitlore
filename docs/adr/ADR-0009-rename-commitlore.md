# ADR-0009: establish CommitLore as the protocol name

- Status: Accepted (2026-07-26, owner decision)
- Owner: CTO
- Supersedes: ADR-0008 §1 (name `Annals`). ADR-0008's vocabulary decision (§2) **remains valid**.

## Context

`Annals` creates an unwanted association in English pronunciation and spelling. The owner raised this as a problem, and it disqualifies the name as the face of the project. Functionality does not offset a problem with how a name sounds — a name people hesitate to say directly reduces adoption.

The owner's first directive was `GitLore`. Investigation found that **npm `gitlore` was taken by an active package, not squatting**:

- `gitlore@1.5.0` · first published 2026-03-15 · last updated 2026-04-14 · `nebulord-dev/gitlore`
- Description: "Git archaeology CLI — surface churn, bus factor, hotspots, and cursed files from your repo's git history"

That means **the name overlaps with a live tool in the same domain (a CLI that reads git history).** This is the same type of conflict that led ADR-0008 to reject `menhir`. Even if the npm package name detours to `git-lore`, the CLI binary `gitlore` still conflicts on PATH and remains mixed into search results.

One separate fact must be recorded here: `Lore` was this repository's **previous name**, and ADR-0008 removed it to establish originality (commit `ef48843`). After being told this, the owner decided to retain the sound of the `lore` family. ADR-0008 objected to *the inherited state of the preceding material's name and vocabulary*, and vocabulary re-derivation (§2) had already resolved that problem. Keeping one root is different from inheriting the whole system.

## Decision

### 1. Name: **CommitLore**

| Item | Value | Status |
|---|---|---|
| npm package | `commitlore` | Available (measured 404) |
| CLI binary | `commitlore` | No PATH conflict |
| GitHub repository | `MongLong0214/commitlore` | Available (measured 404) |
| Version trailer | `CommitLore-Version:` | — |
| notes ref | `refs/notes/commitlore` | — |
| Derived index | `.git/commitlore/index.db` | — |

`commit` + `lore` = oral knowledge accumulated in commits. It is the exact definition of the protocol, and the name directly encodes the design fact that knowledge is commit-scoped.

The unit of knowledge remains a **record** (ADR-0008 §1). One commit leaves one record.

### 2. Do not touch the vocabulary

`Limit` `Ruled-out` `Warn` `Blast` `Undo` `Certainty` `Verified` `Unverified` `Follows` `Record-Id` `Supersedes` `Expires` `Evidence` `Provenance` `X-*` — all remain exactly as in ADR-0008. The value enums are also unchanged.

The **only** trailer that changes is `Annals-Version:` → `CommitLore-Version:`, and that follows from the name rather than changing the vocabulary. In the consumer-route table (SPEC §5), only the command prefix changes: `annals limits` → `commitlore limits`, `annals guard` → `commitlore guard`.

### 3. Rename scope: comprehensive

Rename documents (README in 4 languages · 9 ADRs · 8 PRDs · 9 tickets), the spec (`spec/SPEC.md` · schema · fixtures · contract cases), source (`src/`), package metadata, the GitHub repository, and the bodies of 34 issues in one pass.

**Finish replacement with an exhaustive literal grep.** macOS `sed` does not support `\b` (word boundary), and word-boundary regular expressions miss compounds such as `AnnalsBench` and tokens inside inline code — the previous rename (`ef48843` → `9f4b304` → `236748d`) took three passes for exactly that reason. This time, leave a post-replacement `grep -ri` residual count of 0 as evidence.

## Rejected

- **Force `GitLore`** | npm `gitlore` is an active package in the same domain. Detouring to the package name `git-lore` still conflicts in the CLI binary and search results. There is no reason not to apply ADR-0008's criterion for rejecting `menhir` to ourselves
- **Keep `Annals`** | the sound problem does not disappear over time, and now, with almost no code, is the cheapest point to replace it. ADR-0008's rationale for rejecting "replace after implementation" applies unchanged
- **`gitchronicle`** | has no conflict, but overlaps in meaning with `Annals`, merely trading the sound problem for length, and is not in the `lore` family the owner requested
- **Rename code and spec first, then documents just before v0.1.0** | creates a period when documents and code use different names. Every artifact written during that period becomes a source of drift

## Consequences

- Only §1 (name) of ADR-0008 is superseded; the rest remains valid. Read both documents together for the full identity decision.
- When the GitHub repository is renamed, GitHub redirects the old URL, so external links do not break. The local remote still needs updating.
- The MCP tool names `lore_query`/`lore_stale`/`lore_guard` in `docs/tickets/F4-agent-fabric.md` were remnants of the previous name. This rename changes them to `commitlore_query`/`commitlore_stale`/`commitlore_guard`.
- The rationale for the rename is itself the kind of knowledge this protocol exists to record, so the commit that adds this ADR becomes a dogfooding example.
