# ADR-0007: CommitLoreBench — re-proposal rate first, ablation lite

- Status: Accepted (2026-07-26)

## Context

This project's only existential risk is "the utility hypothesis may be wrong," and that must be determined first within the 4-week deadline.

## Decision

- **Metric priority**: ① re-proposal rate (frequency of proposing previously Ruled-out approaches again — core utility), ② constraint-violation rate, ③ convergence time (tokens and turns). v0.1 requires ①; only instrument ②③ in the harness.
- **Method**: compare agents with CommitLore on/off on the same repository and task sequence. Construct tasks around scenarios that "revisit a decision point with a rejection history" (this repository + 1 public repository).
- **Ablation lite (M4)**: only 3 conditions — remove injection scope (global dump) / remove grades / remove lifecycle — to verify the direction of the CTIM-Rover noise hypothesis.
- **Operational metric**: also report CPAA (cost per accepted record).
- If the first M1 measurement fails to find a significant difference, escalate to the owner immediately (ADR-0001).

## Ruled-out

- 6-month field comparison with 2 teams (traditional methodology) | impossible on cost and deadline — compressed simulation is an advantage of the agent era
- Reproduce all of SWE-bench | excessive scope. Re-proposal rate is measured more directly with custom scenarios
- Full ablation matrix | 4-week constraint — verify direction only (lite) and leave the full matrix in Backlog

## Consequences

- The benchmark harness must have a skeleton in M1 so M2~M3 features are developed in an instrumentable state (instrumentation-first development).
- Put only measured result numbers in the README and release notes — no unverified claims.
