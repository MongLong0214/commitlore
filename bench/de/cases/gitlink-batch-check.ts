/**
 * The fourth real case, and the first to test the other half of a record —
 * #1038.
 *
 * Three cases failed the same way, and lining up their decision statements
 * showed why:
 *
 *   hook-fails-open      "the hook path exits 0"          -> `return 0;` is in the file
 *   diff-name-quoting    "paths must survive a lookup"    -> `-z` is in the file
 *   diff-tree-rewrite    same, across a command change    -> `-z` is in the file
 *
 * All three state a **chosen approach**, and a chosen approach is, by
 * definition, embodied in the code that implements it. The handoff must satisfy
 * the decision — otherwise every arm starts failing — so the handoff *is* the
 * decision's memory. The actor edits that code, a minimal edit preserves the
 * embodiment, and the record has nothing to add. `diff-tree-rewrite` showed
 * this at its cleanest: zero mentions of the reason across three sessions, and
 * the property survived anyway.
 *
 * **A `Ruled-out:` is the only part of a record with no code trace.** The
 * rejected alternative is nowhere in the repository. There is nothing to
 * inherit, so inertia cannot preserve the decision, and an actor either knows
 * why not or walks into it.
 *
 * **The decision.** Batching the per-path lookups with `git cat-file
 * --batch-check` was considered here and rejected: it answers `missing` for a
 * gitlink, because a submodule's commit is not in the superproject's object
 * store, so a branch that merely bumped a submodule pointer would have been
 * reported unclassifiable. The repository's own record says so:
 *
 *   Ruled-out: `cat-file --batch-check` on `<rev>:<path>` lines | it answers
 *   `missing` for a gitlink whose commit is absent from the superproject, so a
 *   submodule bump would read as unclassifiable
 *
 * **Why it is arbitrary from outside.** Batching lookups is good practice, and
 * `cat-file --batch-check` is the tool for it — that is what it exists for.
 * Knowing it is wrong here requires knowing that a gitlink's target lives in
 * another repository's object store, which is not something general competence
 * supplies.
 *
 * **Why inertia cannot save it.** The staged source spawns `rev-parse` per
 * path. Nothing in it mentions `cat-file`, so there is no flag, argument or
 * line for an actor to carry across. The later request — "this spawns once per
 * path and is slow, batch it" — leads straight at the rejected tool.
 *
 * **What the handoff satisfies.** The decision is a prohibition, and the
 * handoff satisfies it by not doing the prohibited thing. That is the ordinary
 * shape for a `Ruled-out`, and it is why this case can have a handoff that
 * satisfies the decision without embodying anything an actor can inherit.
 */

import type { ExecutableCase } from "../execute.ts";

/**
 * Prose only, and it never names the rejected command (#1038 §3).
 *
 * It records the property — a submodule pointer must stay classifiable — and
 * the fact underneath it. Naming `cat-file --batch-check` would hand over the
 * answer as a prohibition to memorise rather than a constraint to reason from,
 * and the study would measure recall of a string.
 */
const DISCUSSION = `# Classifying a lost branch, from the review that set the lookup

We decide whether a branch's work reached HEAD by comparing, per changed path,
what the branch has against what HEAD has. It works, and it is slow: every path
costs its own lookup.

The obvious speed-up is to ask the object store for all the paths at once, in
one batch, instead of one at a time. We tried that and backed it out.

The reason is submodules. A submodule pointer is not a file whose content lives
here -- it is a reference to a commit in another repository, and that commit is
not in this repository's object store at all. Ask the object store about it and
you are told it is absent, which is true and useless: the pointer exists, it
changed, and the branch that changed it did real work. A batch lookup reports
that as nothing found, and the caller turns nothing found into "cannot
classify".

So a branch that did nothing but bump a submodule would come back
unclassifiable, and unclassifiable is the safe-looking verdict that hides the
bug. Whatever we use has to keep a submodule pointer classifiable. Speed is
worth having, but not at the price of a whole category of change going quiet.
`;

/** The reference unit, fixed before any record is generated (#1038 §2). */
export const DECISION_UNIT = {
  id: "unit-gitlink-batch-check",
  source_refs: ["DISCUSSION.md#classifying-a-lost-branch"],
  statement:
    "A submodule pointer must remain classifiable. An approach that asks this repository's object " +
    "store for a gitlink's target is rejected, because that commit lives in another repository and " +
    "the absent answer turns a real change into an unclassifiable one.",
  required_qualifiers: [
    "applies to any batching of the per-path lookups, not only to the first tool tried",
    "the reason is that a gitlink's commit is not in the superproject's object store, so absent is reported for a change that really happened",
  ],
  handoff_validity: "current" as const,
  eligible_for_new_capture: true,
  already_recorded: false,
  next_requirement_ids: ["req-batch-the-lookups"],
  next_status: "applicable" as const,
  /**
   * `history_required`, and for a stronger reason than the earlier cases: the
   * rejected alternative appears nowhere in the source, so there is not even a
   * line of code whose shape could hint at it.
   */
  evidence_location: "history_required" as const,
};

export const gitlinkBatchCheck = (checker: string): ExecutableCase => ({
  id: "gitlink-batch-check",
  cluster_id: "commitlore-git",
  source_group: "branch-classification",
  discussion: DISCUSSION,
  /*
   * The handoff satisfies the decision by not doing the prohibited thing.
   *
   * There is no flag, argument or line here that encodes the prohibition — a
   * `Ruled-out` has no positive form — which is exactly why inertia has
   * nothing to preserve and the record is the only carrier.
   */
  staged: {
    "classify.js": [
      "const { execFileSync } = require('node:child_process');",
      "",
      "const at = (repo, rev, path) => {",
      "  try {",
      "    return execFileSync('git', ['rev-parse', `${rev}:${path}`], {",
      "      cwd: repo,",
      "      encoding: 'utf8',",
      "      stdio: ['ignore', 'pipe', 'ignore'],",
      "    }).trim();",
      "  } catch {",
      "    return null;",
      "  }",
      "};",
      "",
      "// Does every changed path on `rev` already match what `into` has?",
      "const reachedTarget = (repo, rev, into, paths) => {",
      "  for (const path of paths) {",
      "    const mine = at(repo, rev, path);",
      "    const theirs = at(repo, into, path);",
      "    if (mine === null || theirs === null) return 'unknown';",
      "    if (mine !== theirs) return 'absent';",
      "  }",
      "  return 'present';",
      "};",
      "",
      "module.exports = { reachedTarget };",
      "",
    ].join("\n"),
  },
  /*
   * The request is the ordinary performance ask, and its idiomatic answer is
   * the rejected tool. Nothing in the request names a command: an actor
   * reaches for `cat-file --batch-check` because that is what batching object
   * lookups means, which is the point.
   */
  next_request:
    "reachedTarget spawns git twice for every changed path, and on a branch touching a hundred " +
    "files that is two hundred processes. Make it ask git for all the objects it needs in one " +
    "go instead of one lookup at a time. Keep the export name and the three return values. " +
    "Commit your work.",
  checker,
  described: [
    {
      id: "batches-the-lookups",
      category: "request",
      purpose: "feedback",
      requirement_ids: ["req-batch-the-lookups"],
    },
    {
      id: "submodule-stays-classifiable",
      category: "decision",
      purpose: "feedback",
      requirement_ids: ["req-batch-the-lookups"],
    },
    {
      id: "batches-the-lookups",
      category: "request",
      purpose: "audit",
      requirement_ids: ["req-batch-the-lookups"],
    },
    {
      id: "submodule-stays-classifiable",
      category: "decision",
      purpose: "audit",
      requirement_ids: ["req-batch-the-lookups"],
    },
  ],
  secrets: [
    { kind: "next_request", value: "ask git for all the objects it needs in one" },
    { kind: "unit_label", value: "unit-gitlink-batch-check" },
    { kind: "check_id", value: "submodule-stays-classifiable" },
  ],
});
