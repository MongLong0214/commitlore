# ADR-0005: minimum trust layer — rule-based grades and Warn demotion

- Status: Accepted (2026-07-26)

## Context

Commit messages are a channel agents read as instructions. An unsigned `Warn:` turns the repository into a prompt-injection vector (D7). But a real sigstore/gitsign signature system does not fit the 4-week scope.

## Decision

v0.1 establishes a minimum defense with **rule-based grades + demoted rendering**.

- Record grade = provenance axis (`authored | inherited | reconstructed | unknown`) × lifecycle axis (`active | superseded | expired`).
- **Demotion rule**: in injection and query output, label and deliver `Warn:` as an "instruction" only when its grade meets the repository's configured policy; otherwise explicitly label it a "claim." An unmatched configured author string is a claim. The default string match is not proof of authorship, because a commit author selects it.
- When heuristics detect imperative injection patterns (inducing tool calls or policy-bypass language), exclude that record from injection and warn.
- secret guard: scan for credential, token, and internal URL patterns at pre-commit and block them.

## Ruled-out

- Include real sigstore/gitsign signatures in v0.1 | 4-week constraint. The later opt-in uses Git's own verifier trust store instead of introducing a signature service or key distribution
- Handle the trust problem only with a documentation warning | D7 is a measured attack surface — cannot release without a mechanical minimum defense

## Consequences

- The demotion rule is a required route-contract test case (F1): "a record whose author string does not match must render as a claim."
- `commitlore.requireSignedDirective=true` now extends the grading axis without changing consumer routing: only Git status `G` is verified. This confirms a signature trusted by the verifier, not a person's authority or the content's truth.
