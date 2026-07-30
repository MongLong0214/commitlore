# PRD F10 — First-run experience (demo, init output, README order)

- Milestone: M5 · ADR: 0022 (positioning), 0013 (claim boundary)

## Goal

A person who has never heard of CommitLore understands the value in under a
minute and knows their repository is ready in seconds.

Three surfaces deliver this:

1. A deterministic demo that shows the product working on a real (temporary)
   repository with no setup, no network, and no model.
2. A result-oriented `init` output that tells the user what is ready and what
   is not — never hiding a warning or failure.
3. A README order that puts a concrete scene before the measurement, without
   deleting evidence.

## Non-goals

- Rewriting the measurement section or the benchmark block.
- Changing `init`'s behaviour (steps, exit codes, idempotency contract).
- Adding new CLI options beyond `--verbose` for `init`.
- Altering the install one-liner or release gate.

## User stories

- As a developer evaluating CommitLore for the first time, I run
  `commitlore demo` in any directory and see — in under 30 seconds — an
  agent encountering a reversed decision and being told it is no longer
  active.
- As a developer who just ran `commitlore init`, I read the output and know
  immediately: hooks installed, index built, agent integration registered,
  and whether anything needs attention — without knowing what `interpret-trailers`
  or `notes refspec` means.
- As a visitor reading the README, I see a concrete scene (what happens when
  an agent asks about a path with a reversed decision) before I see
  measurement tables.

## Requirements

### Demo command (`commitlore demo`)

1. The demo creates a temporary Git repository, populates it with a fixed
   scenario (an active decision, a superseded decision, and a proposal), runs
   `commitlore init` and a path query, then removes the temporary repository.
2. The demo must never modify the user's current repository. It operates
   exclusively in its own temporary directory.
3. The demo must never make a network call or require a model.
4. The demo must remove its temporary repository on exit, including on
   unhandled exceptions, signals (SIGINT, SIGTERM), and early returns.
5. On an unsupported platform (Windows, musl) the demo must print a
   human-readable reason for why it cannot run and exit non-zero, rather
   than attempting a partial execution.
6. The demo scenario fixture (the active/superseded pair and the proposal)
   is defined as static data, not generated at runtime.
### Result-oriented `init` output

7. The default `init` output is a result summary: what is ready and what
   needs attention. It must not require the user to understand internal
   command names (`interpret-trailers`, `notes refspec`, `index --rebuild`)
   to read the result.
8. The default output must never hide a warning or failure. Every step that
   could not complete or that needs attention is named with enough detail
   for the user to act. This preserves the contract from #63 and #67.
9. `init --verbose` produces the current step-by-step detail output (the
   `[1/4]` … `[4/4]` format with indented substep lines).
10. `--json` remains unchanged. It already exists and is not re-added or
    modified.

### README positioning and order

11. The README hero (first heading and subheading across all four language
    files) reflects the decision-authority positioning from ADR-0022. The
    specific wording leads with reversal: an agent must not revive a
    decision the repository already reversed.
12. A concrete scene (the demo scenario or equivalent narrative) appears
    before the retrieval measurement table (`README.md:29-46`), giving
    the visitor a "what does this look like?" before "how well does it
    work?".
13. The retrieval measurement section, the BENCH block, and the exposure
    table are not deleted or hand-edited. Their position may change
    relative to other sections, but their content is preserved byte-for-byte
    (the BENCH block) or semantically (the measurement prose).
14. The section order respects #167's established sequence: product →
    local-first → install promise → install command → evidence. Refinement
    within that frame (e.g., inserting a scene between product and
    local-first) is permitted; overturning the sequence is a
    stop-and-escalate condition.
15. All four language files (`README.md`, `README.ko.md`, `README.ja.md`,
    `README.zh-CN.md`) change together. Each carries the positioning in its
   own language. A partial update is not a valid intermediate state.

16. A deterministic README recording (GIF or equivalent checked-in animation)
    is generated from the exact demo fixture and command output. It contains no
    private path or repository content and is reproducible from a documented
    command; the README must not use a hand-authored scenario that can drift
    from `commitlore demo`.

## AC

- [ ] `commitlore demo` runs to completion in under 30 seconds on a
      supported platform, prints a scenario showing lifecycle filtering,
      and leaves no temporary directory behind.
- [ ] `commitlore demo` on an unsupported platform prints a reason and
      exits non-zero without creating a temporary directory.
- [ ] The checked-in README recording is generated from the same fixture and
      output as `commitlore demo`, contains no private data, and is reproducible.
- [ ] Default `init` output fits in 6 lines or fewer for a clean run and
      names every failure/warning with actionable text.
- [ ] `init --verbose` produces the `[1/4]`…`[4/4]` output identical to
      today's default.
- [ ] README hero in all four files reflects ADR-0022 positioning.
- [ ] A concrete scene appears in README before the measurement section.
- [ ] `scripts/check-readme-numbers.mjs` passes after the README changes.
- [ ] The exposure table is preserved in all four README files.
