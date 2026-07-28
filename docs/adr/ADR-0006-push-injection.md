# ADR-0006: consumption is push — hook and MCP injection, deterministic projection, grade routing

- Status: Accepted (2026-07-26)

## Context

Pull-only consumption (the agent queries on its own) is forgotten in real use (D8). Uncurated, unscoped memory injection also hurt performance in experiments (CTIM-Rover) — injection must be narrow, graded, and budget-capped.

## Decision

1. **injection hook**: when an agent reads or modifies a file (PreToolUse family), automatically inject a summary of active records for that path. No global dump — path scope only.
2. **deterministic projection**: compute and cache the injection summary as a deterministic fold of the record stream (independent of LLMs, 0 token cost, reproducible). LLM compression is opt-in only when the budget is exceeded.
3. **grade routing**: deliver instructions, claims, and holds differently according to the ADR-0005 grade. Do not inject stale records.
4. **`commitlore guard`**: if an agent proposal matches a `Ruled-out:` record for that path, issue a deterministic warning before execution (a gate against re-proposal).
5. **automatic harvest**: generate a trailer draft from the transcript just before commit → a **separate verifier** mechanically checks evidence citations; discard failed records (fail-explicit). Fail explicitly after a bounded repair loop (up to N attempts).

## Ruled-out

- CLAUDE.md-style static global context injection | empirical AGENTS.md studies found conditional harm — dynamic path scope has a structural advantage
- Generate every injection summary with an LLM | violates the 0-cost principle + is not reproducible
- Let the harvesting agent verify itself | maker–checker separation — the author does not grade their own homework

## Consequences

- Specify the injection budget (default token cap) in the spec and calibrate it with the CommitLoreBench noise ablation (F7).
- Use LLMs for harvest and verification only inside the user's existing agent session — no separate billing path.
