# F5 tickets — Minimum trust layer (M3)

> PRD: `docs/prd/PRD-F5-trust-minimal.md` · ADR: 0005
> Modules: `src/core/grade.ts`, `src/core/secret-guard.ts`, `src/hooks/secret-rules.ts`

---

## T-501 Grade model + Warn demotion + injection heuristics (M) — #18 · depends on T-205

**Implementation outline**
- `grade.ts`: record → `{provenance, lifecycle, trust: 'directive'|'claim'|'blocked'}`.
  - provenance: trailer `Provenance:` + commit metadata (author and merge path). A non-matching configured author string renders claim; a matching string is selected by the commit author and is not authentication unless opt-in signature mode also verifies it.
  - reconstructed/unknown → always claim.
- Injection heuristics: tool-call inducement, policy-bypass, or privilege-escalation patterns in Warn values (rules based on 5 fixture types) → `blocked` (exclude from injection + warning list).
- Formally include the grade field in the query and injection output schema (final T-204/T-402 interface).

**Test**: directly execute demotion cases (5~8) from `spec/contract-cases/` / 5 injection-fixture types blocked / trusted-authors boundary.
**AC**: PRD-F5 AC 1·2.

---

## T-502 secret guard (S) — #19 · depends on T-202

**Implementation outline**
- Add to the commit-msg hook chain: scan messages (including trailers) for credential, token, private-key, and internal-URL patterns (port a subset of gitleaks rules, regular-expression table in `src/hooks/secret-rules.ts`).
- When blocked, output which rule matched + bypass flag (do not suggest `--no-verify`).

**Test**: block secret fixtures (6 types including AWS key, GitHub token, private URL) / pass normal commit / pass common false-positive case (for example, only the word `token`).
**AC**: PRD-F5 AC 3.
