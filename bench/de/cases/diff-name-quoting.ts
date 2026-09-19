/**
 * The second real case, built against the bar the first one failed — #1038.
 *
 * `hook-fails-open` was well-formed and measured nothing. Its unaided control
 * passed three times out of three, for two reasons: `return 0` sat outside the
 * `catch` the later request asked the actor to fill, so honouring the decision
 * took no knowledge at all; and the decision followed from ordinary good
 * practice, so an unaided actor arrived at it anyway.
 *
 * This case is chosen against both.
 *
 * **The decision.** The changed-path listing passes `-z`. Under git's default
 * `core.quotePath`, a path outside ASCII is printed C-quoted --
 * `"\354\204\244\352\263\204.md"` -- and no tree resolves that spelling, so a
 * name read from an unquoted listing cannot be looked up again. This repository
 * learned it from a branch whose only file was named in Korean: the lookup
 * failed, the branch returned `unknown`, and `unknown` is the safe verdict, so
 * it looked like caution rather than a bug.
 *
 * **Why it is arbitrary from outside.** Nothing about good engineering points
 * at `-z`. The idiomatic listing is `--name-only` split on newlines, it is what
 * every tutorial shows, and it is correct for every repository whose filenames
 * are ASCII -- which is every fixture anyone writes by default. An actor
 * reasoning from general practice has no route to this and no reason to suspect
 * it. That is the property `hook-fails-open` lacked.
 *
 * **Why the later request collides with it.** "Report the change status beside
 * each path" is an ordinary request, and the idiomatic implementation is
 * `--name-status` split on newlines and tabs. That drops `-z`, because
 * `--name-status -z` has a fiddly layout -- status NUL path NUL -- that nobody
 * writes unless they know why they must. The request forces the actor to touch
 * the exact flag the decision is about, which is what `hook-fails-open`'s
 * request never did.
 *
 * **The stratum, checked rather than assumed.** The reason is in the commit
 * record and not in `src/core/squash.ts`, which carries the code this decision
 * came from and says nothing about `core.quotePath` or C-quoting. A test keeps
 * checking that, so writing the reason into the source later changes the
 * case's stratum and the suite says so.
 *
 * What this case still is not: a repository fixture with a base commit and a
 * notes snapshot. #1038 §1 asks for `repo/base_commit/prior_notes_snapshot`,
 * and this carries inline staged files like the first one, which is the format
 * the runner accepts today.
 */

import type { ExecutableCase } from "../execute.ts";

/**
 * Prose only. The trailers are the answer, and the capture actor sees only
 * prior discussion and staged change (#1038 §3).
 *
 * It does not say "-z" anywhere. What it records is the *reason* -- what git
 * does to a non-ASCII name and what that cost -- because a discussion that
 * named the flag would be handing over the implementation rather than the
 * constraint, and an arm could then transcribe without understanding.
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
rendering of them meant for a terminal. That is the property to preserve; the
default output format does not have it, and a repository full of ASCII
filenames will never tell you so.

We also looked at asking the object store directly for each path instead. That
is wrong here for an unrelated reason: a submodule pointer is a gitlink whose
commit is not in the superproject's object store, so every branch that bumped a
submodule would have collapsed to unknown -- trading one silent
misclassification for another.
`;

/** The reference unit, fixed before any record is generated (#1038 §2). */
export const DECISION_UNIT = {
  id: "unit-diff-name-quoting",
  source_refs: ["DISCUSSION.md#changed-path-listing"],
  statement:
    "The changed-path listing must emit paths as the bytes git will accept back in a tree lookup, " +
    "not in the C-quoted rendering git's default configuration prints for non-ASCII names.",
  required_qualifiers: [
    "applies to any listing whose paths are looked up again, not only to the first one written",
    "the reason is that the C-quoted spelling resolves in no tree, so the lookup fails and the caller reads that as unknown",
  ],
  handoff_validity: "current" as const,
  eligible_for_new_capture: true,
  already_recorded: false,
  next_requirement_ids: ["req-changed-path-status"],
  next_status: "applicable" as const,
  /** Checked against `src/core/squash.ts` by the suite, not assumed. */
  evidence_location: "history_required" as const,
};

export const diffNameQuoting = (checker: string): ExecutableCase => ({
  id: "diff-name-quoting",
  cluster_id: "commitlore-git",
  source_group: "path-encoding",
  discussion: DISCUSSION,
  /*
   * The handoff already satisfies the decision, and it has to: an arm that
   * started from a violation would fail before touching anything (#1038 §5).
   *
   * It is also deliberately quiet about *why*. The first case staged a comment
   * reading "Silent on purpose. The discussion explains why.", which told the
   * solve arm that the line was load-bearing and pointed at a document it does
   * not have. Nothing here flags `-z` as significant.
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
  next_request:
    "Callers need to know what happened to each path, not just that it changed. Make changedPaths " +
    "return the change status alongside each path — added, modified or deleted — as objects with " +
    "`status` and `path`. Keep the export name. Commit your work.",
  checker,
  described: [
    {
      id: "paths-survive-a-lookup",
      category: "decision",
      purpose: "feedback",
      requirement_ids: ["req-changed-path-status"],
    },
    {
      id: "paths-survive-a-lookup",
      category: "decision",
      purpose: "audit",
      requirement_ids: ["req-changed-path-status"],
    },
  ],
  /**
   * What the capture actor must never see (#1038 §3).
   *
   * The check id is here for the same reason as in the first case: a prompt
   * naming it would tell the actor which property is being graded.
   */
  secrets: [
    { kind: "next_request", value: "return the change status alongside each path" },
    { kind: "unit_label", value: "unit-diff-name-quoting" },
    { kind: "check_id", value: "paths-survive-a-lookup" },
  ],
});
