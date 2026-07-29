# ADR-0018: benchmark provenance survives branch rewrites with two identifiers

- Status: Accepted (2026-07-29)
- Resolves [#161](https://github.com/MongLong0214/commitlore/issues/161).
  Related: [#163](https://github.com/MongLong0214/commitlore/issues/163).

## Context

Each deterministic result recorded the commit at `HEAD` when it was measured.
The reproducibility test then used that commit's history to re-derive the
result. This is the strongest available provenance while the commit resolves.

Branch commits are temporary in this repository. A rebase, amend, or squash
replaces the commit even when the harness files are byte-identical. The
recorded identifier then becomes unresolvable, so the result fails
reproducibility before its code can merge. This happened twice during one
session in which seven branches were rebased onto `dev`.

The failure must remain loud. Issue #163 showed the other side of the same
boundary: two figures that look comparable may describe different work. A
fallback that quietly substitutes current code would preserve the artifact
while discarding the information a reader needs to judge it.

The existing `dist_digest` does not solve this problem. It hashes the built
product bytes that the harness executed and detects a mid-run rebuild. Harness
identity and product identity are separate provenance claims.

## Decision

New deterministic result rows record both:

- `harness_commit`: the commit at `HEAD` when measurement began;
- `harness_digest`: Git's object digest of a canonical manifest containing
  `bench/deterministic.ts` and every tracked file under `bench/deterministic/`.

The manifest is produced by `git ls-tree` and digested by `git hash-object`.
This reuses Git's content-addressing rather than adding another filesystem hash
implementation beside `digestDistTree`. A history rewrite changes the commit
identifier but leaves the harness digest unchanged when no harness file
changed.

Verification uses the identifiers in this order:

1. If `harness_commit` resolves, re-derive the result from that commit's
   history and report that commit verification was used.
2. If the commit is unresolvable, compare the recorded `harness_digest` with
   the harness at current `HEAD`.
3. On a digest match, re-derive from `HEAD` and print a warning that names the
   digest. The warning states that the match proves identical harness code, not
   that the recorded commit existed.
4. If the commit is unresolvable and the digest is absent or mismatched, fail.
   That result cannot be re-derived from an identified commit or identical
   harness code.

Existing results without `harness_digest` remain verifiable while their
recorded commit resolves. They have no fallback after that commit is lost.

## Ruled out

- Run benchmarks only on `dev` after merge | simpler permanent commit identity,
  but reviewers lose the ability to examine a measurement beside the code that
  produced it.
- Record only the harness digest | preserves code identity across rewrites but
  no longer names which commit and history produced the result.
- Regenerate results after every rewrite | honest but turns each rebase into a
  benchmark run; one affected session had already spent five hours measuring,
  and the machine is not always available.
- Accept current `HEAD` silently when the commit is missing | converts a loud
  provenance failure into a quiet weakening that readers cannot distinguish.

## Consequences

A normal verification retains the prior guarantee: the named commit exists and
its history reproduces the result. Digest fallback is explicitly weaker and
explicitly labeled. It establishes that the deterministic harness code is
identical at `HEAD`; it does not establish that the old commit ever existed on
a published ref.

The product bytes remain independently pinned by `dist_digest`. Changes outside
the deterministic harness manifest are not certified by `harness_digest`; if
they alter the re-derived value, the existing result comparison still fails.
