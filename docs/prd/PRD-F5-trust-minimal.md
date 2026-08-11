# PRD F5 — Minimum trust layer (grades · demotion · secret guard)

- Milestone: M3 (08-16) · ADR: 0005

## Goal
A minimum defense that prevents the repository from becoming an injection vector (D7). Mechanically guarantee that "an instruction outside the repository's configured policy is a claim, not a command"; default author-string mode is not authentication, while signature mode can require Git verification.

## User stories
- As an agent, I receive a `Warn:` whose author string does not match the repository policy only as a "claim," not an instruction.
- As a commit author, if tokens or credentials enter decision prose, pre-commit blocks them.

## Requirements
1. Grade model: provenance(authored|inherited|reconstructed|unknown) × lifecycle(active|superseded|expired) — include a grade field in query and injection output.
2. Demoted rendering: in injection and `--json` output, separate Warn into `warn` (directive) vs `claim` (demoted) fields. An unmatched author string is a claim; a matching string is not proof of identity unless opt-in signature mode also verifies it.
3. Injection heuristics: when an imperative bypass pattern is detected, exclude it from injection + list the warning.
4. secret guard: pre-commit scan with a subset of gitleaks-family patterns (credentials, tokens, internal URLs).

## AC
- [ ] Route-contract test: pass the "unmatched author string Warn → claim" case
- [ ] All injection-payload fixtures (≥5 types) are blocked/demoted in the injection path
- [ ] The hook blocks an attempted secret-fixture commit with a nonzero exit code
