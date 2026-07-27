# ADR-0001: v0.1.0 scope — compress the 26-week roadmap into 4 weeks

- Status: Accepted (2026-07-26, Isaac's directive: "finish within 1 month")
- Owner: CTO

## Context

The original roadmap in the full analysis report (commitlore-dossier) totaled 26 weeks across Phase 0~3. The owner fixed the entire schedule at 4 weeks (v0.1.0 release on 2026-08-23). This project is also MIT-licensed and free at every layer, following the principle of 0 additional user cost (no paid plan, no SaaS, git is the SSOT).

## Decision

4 weeks = 4 milestones. Each week's deliverable becomes the next week's input.

| Milestone | Deadline | Deliverable | Included features |
|---|---|---|---|
| M1 Spec & Bench | 08-02 | Protocol v2 spec+JSON Schema+conformance suite v0, CommitLoreBench skeleton+first re-proposal-rate measurement | F1, F7 |
| M2 Core CLI | 08-09 | parser/validate/query/index/stale + squash inheritance/notes mirror/--follow | F2, F3 |
| M3 Agent Fabric | 08-16 | commitlore-mcp, injection hook, automatic harvest+verifier, guard, skill rewrite, minimum trust layer | F4, F5 |
| M4 Org + Release | 08-23 | GitHub Action(lint+inheritance), ablation report, backfill MVP(stretch), v0.1.0 | F6, F7, F8 |

### Deliberately cut from v0.1.0 (→ Backlog milestone)

- Real sigstore/gitsign signatures (v0.1 uses rule-based grades — ADR-0005)
- Organization decision graph (cross-repo), static CI dashboard
- Embedding search, `commitlore coverage`, interactive `commitlore commit` builder (`--from-json` is included)
- `Anchor:` symbol-level anchoring (v0.1 stops at paths + `--follow`)
- Automatic Expires notifications, organization policy filters

## Ruled-out

- Keep the original 26-week plan | conflicts with the owner's deadline constraint
- Compress every feature into 4 weeks | quality collapses — even the CommitLoreBench evidence (the project's reason to exist) gets sacrificed
- Defer CommitLoreBench | if the utility hypothesis is wrong, we need to know first (existential risk takes priority)

## Consequences

- F8(backfill) is a stretch goal — failure does not block the v0.1.0 release.
- If M1's first CommitLoreBench measurement shows no significant difference in re-proposal rate, escalate to the owner immediately (pivot decision).
- Leave every cut item as an issue in the Backlog milestone — no silent drops.
