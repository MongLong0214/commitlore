# ADR-0004: workflow survival — squash inheritance + notes mirror + --follow

- Status: Accepted (2026-07-26)

## Context

Defects confirmed by reproduction: squash-merge destroys the trailer block, making `%(trailers)` queries impossible (D3), and path queries return 0 results after a rename (D4). The "permanently immutable" claim is false unless records survive both paths.

## Decision

1. **squash inheritance**: `commitlore squash-preserve` collects trailers from branch commits before merge, (a) rewrites them as a proper trailer block in the merge commit message, and (b) attaches them to the notes mirror as individual records. GitHub Action (T-602) runs this automatically when a PR merges.
2. **notes mirror**: mirror records to `refs/notes/commitlore` by commit SHA — a 2nd channel where records survive history rewrites by rebase/amend.
3. **path tracking**: all path-scoped queries use `--follow` by default. Inherited and mirrored records retain the original commit SHA in a `Provenance:` trailer.

## Ruled-out

- Server-side preservation (external DB) | violates ADR-0003
- Enforce a no-squash policy | the protocol cannot dictate team workflow — the tool must adapt to the workflow
- Rewrite only the commit message (without notes) | offers no protection against rebase/amend history rewrites

## Consequences

- Automatic refspec configuration by doctor is a prerequisite for sharing notes (ADR-0003).
- Inherited records are distinguished from originals by `Provenance: inherited <sha>` — an input to trust grading (ADR-0005).
