/**
 * The third real case, built against the rule the first two produced — #1038.
 *
 * Two cases were well-formed and measured nothing, for one reason stated twice:
 *
 *   When the decision is expressed in code the handoff already contains and the
 *   later request is additive, the actor preserves the decision by inertia and
 *   knowledge is irrelevant.
 *
 * `hook-fails-open`'s `return 0` sat outside the `catch` nobody was asked to
 * restructure. `diff-name-quoting`'s `-z` sat inside an argument list nobody was
 * asked to shorten — all three of its controls swapped `--name-only` for
 * `--name-status` and left the flag exactly where it was.
 *
 * So the bar has two halves that pull against each other, and this case is the
 * first attempt at meeting both:
 *
 *   1. the handoff must already satisfy the decision, or every arm starts
 *      failing and nothing is measured;
 *   2. the later request must force a **rewrite of the site where the decision
 *      lives**, not an addition to it.
 *
 * **How (2) is met.** The request replaces the command. `git diff` becomes
 * `git diff-tree -r`, so the argument array is written from scratch and its
 * output format is different enough that the parse has to be rebuilt too.
 * Nothing carries over by inertia: an actor has to decide, afresh, how the
 * paths come out. That is the decision point the first two cases never created.
 *
 * **The decision is the same one**, deliberately. Holding the constraint fixed
 * while changing only the shape of the request is what isolates the rule: if
 * this case's control fails where `diff-name-quoting`'s passed, the difference
 * is the request, because nothing else moved.
 *
 * **The request is real.** This repository made exactly this change, for
 * exactly this reason — two `rev-parse` spawns per changed path became one
 * `diff-tree -r -z`, measured at 132 spawns to 0 and ~1555 ms to ~198 ms.
 *
 * What this case still is not: a repository fixture with a base commit and a
 * notes snapshot, which #1038 §1 asks for. It carries inline staged files, the
 * format the runner accepts today.
 */

import type { ExecutableCase } from "../execute.ts";

/**
 * Prose only, and it never names a flag (#1038 §3).
 *
 * It records what git does to a non-ASCII name and what that cost. A discussion
 * that named `-z` would hand over the implementation rather than the
 * constraint, and an arm could transcribe it without understanding — which
 * would make the study measure copying.
 */
const DISCUSSION = `# Changed-path listing, from the review after the Korean-filename bug

A branch whose only file was named in Korean came back classified as unknown,
and unknown is the safe verdict, so it looked like caution for weeks.

What actually happened: we listed the changed paths, then looked each one up
again in a tree. Git's default configuration prints a path containing anything
outside ASCII in its C-quoted spelling, with the bytes written as backslash
escapes and the whole thing wrapped in double quotes. That spelling is not the
path. No tree resolves it. So the first lookup failed, and every branch
touching such a file answered unknown.

The listing and the lookup have to agree about what a path is. Whatever we use
to read the changed paths must give us the bytes git will accept back, not a
rendering of them meant for a terminal. That property is not a property of one
command -- it has to survive whichever command we end up using, and a
repository full of ASCII filenames will never tell you it is missing.

We also looked at asking the object store directly for each path instead. That
is wrong here for an unrelated reason: a submodule pointer is a gitlink whose
commit is not in the superproject's object store, so every branch that bumped a
submodule would have collapsed to unknown -- trading one silent
misclassification for another.
`;

/** The reference unit, fixed before any record is generated (#1038 §2). */
export const DECISION_UNIT = {
  id: "unit-diff-tree-rewrite",
  source_refs: ["DISCUSSION.md#changed-path-listing"],
  statement:
    "However the changed paths are read, they must come out as the bytes git will accept back in a " +
    "tree lookup rather than in the C-quoted rendering git's default configuration prints for " +
    "non-ASCII names -- and the property has to survive a change of command.",
  required_qualifiers: [
    "applies to whichever command reads the paths, not only to the one it was first observed on",
    "the reason is that the C-quoted spelling resolves in no tree, so the lookup fails and the caller reads that as unknown",
  ],
  handoff_validity: "current" as const,
  eligible_for_new_capture: true,
  already_recorded: false,
  next_requirement_ids: ["req-plumbing-rewrite"],
  next_status: "applicable" as const,
  /** Checked against `src/core/squash.ts` by the suite, not assumed. */
  evidence_location: "history_required" as const,
};

export const diffTreeRewrite = (checker: string): ExecutableCase => ({
  id: "diff-tree-rewrite",
  cluster_id: "commitlore-git",
  source_group: "path-encoding",
  discussion: DISCUSSION,
  /*
   * The handoff satisfies the decision, and says nothing about why.
   *
   * No comment flags the flag. The first case staged "Silent on purpose. The
   * discussion explains why.", which told the solve arm the line was
   * load-bearing and pointed at a document it does not have.
   */
  staged: {
    "changed.js": [
      "const { execFileSync } = require('node:child_process');",
      "",
      "// Paths changed between two refs.",
      "const changedPaths = (repo, from, to) => {",
      "  const out = execFileSync('git', ['diff', '--name-only', '-z', from, to], {",
      "    cwd: repo,",
      "    encoding: 'utf8',",
      "  });",
      "  return out.split('\\0').filter((entry) => entry !== '');",
      "};",
      "",
      "module.exports = { changedPaths };",
      "",
    ].join("\n"),
  },
  /*
   * The request replaces the command rather than adding to it.
   *
   * `git diff` resolves both refs and walks working-tree state it does not need
   * here; `git diff-tree -r` compares two trees directly. The argument array is
   * therefore written from scratch and the output format is different, so the
   * parse is rebuilt too -- which is the whole point of this case.
   */
  next_request:
    "`git diff` is porcelain and does more work than we need between two commits — it resolves " +
    "refs and consults working-tree state. Rewrite changedPaths to use the plumbing command " +
    "`git diff-tree -r` instead, which compares the two trees directly. Keep the export name and " +
    "keep returning the changed paths. Commit your work.",
  checker,
  /*
   * Two checks per purpose. The request check exists because an arm that
   * ignored the rewrite entirely would keep the decision by changing nothing,
   * and "the arm that did nothing passed" measures nothing.
   *
   * They stay separate rather than merged so the decision verdict is
   * behavioural alone: the request check reads the source text, and folding a
   * textual result into the decision would let a grep speak for the property.
   */
  described: [
    {
      id: "uses-the-plumbing-command",
      category: "request",
      purpose: "feedback",
      requirement_ids: ["req-plumbing-rewrite"],
    },
    {
      id: "paths-survive-a-lookup",
      category: "decision",
      purpose: "feedback",
      requirement_ids: ["req-plumbing-rewrite"],
    },
    {
      id: "uses-the-plumbing-command",
      category: "request",
      purpose: "audit",
      requirement_ids: ["req-plumbing-rewrite"],
    },
    {
      id: "paths-survive-a-lookup",
      category: "decision",
      purpose: "audit",
      requirement_ids: ["req-plumbing-rewrite"],
    },
  ],
  secrets: [
    { kind: "next_request", value: "Rewrite changedPaths to use the plumbing command" },
    { kind: "unit_label", value: "unit-diff-tree-rewrite" },
    { kind: "check_id", value: "paths-survive-a-lookup" },
  ],
});
