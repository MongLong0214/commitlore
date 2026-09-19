/**
 * One real case, drawn from this repository's own history — #1038.
 *
 * Everything run before this used a toy I wrote to exercise wiring, which means
 * it measured wiring. This one is built the way #1038 asks: an authorized prior
 * discussion that actually happened, a later request that could plausibly
 * violate it, a reference unit fixed before any record is generated, and an
 * executable check that fails on a violation and passes on a legitimate
 * implementation.
 *
 * **The decision.** A commit in this repository ruled out exiting 1 from the
 * hook path on an internal failure, because "Claude Code shows exit-1 stderr to
 * the developer rather than the agent, so a crash would become noise a person
 * has to read instead of the silence a fail-open should be".
 *
 * **Why the stratum is `history_required`.** `src/cli.ts` explains the exit-code
 * taxonomy at length — 0 clean, 1 found something, 2 bad invocation, 3
 * incomplete view — and says nothing about why an internal crash on the hook
 * path must still exit 0. The reason is in the commit record and nowhere in the
 * current source, which is the condition #1038 §3 defines the stratum by. That
 * was checked by reading the file, not assumed from the decision feeling
 * historical.
 *
 * **The later request is a plausible violation.** "Make the hook report its
 * internal errors so they are easier to debug" is what somebody would actually
 * ask for, and the obvious implementation — exit non-zero and print — is
 * exactly what was ruled out. An arm that never saw the reason has no way to
 * know, which is the whole question the study asks.
 *
 * What this case is **not**: it is not a repository fixture with a base commit
 * and a notes snapshot. #1038 asks for `repo/base_commit/prior_notes_snapshot`
 * and this carries inline staged files instead, which is the case format the
 * runner currently accepts. That gap is real and is recorded rather than
 * papered over.
 */

import type { ExecutableCase } from "../execute.ts";

/**
 * Prose only, with no trailers.
 *
 * The trailers are the answer. #1038 says the capture actor sees "only prior
 * discussion and staged change" — handing it a `Ruled-out:` line would be
 * handing it the reference unit, and the study would measure transcription.
 */
const DISCUSSION = `# Hook exit codes, from the review that set them

The CLI's exit codes are a contract: 0 clean, 1 the check found something,
2 the invocation was wrong, 3 answered from an incomplete view. Hooks and CI
branch on them.

The hook path is different from the command path, and the difference came up
when a crash in the injection hook reached a developer's terminal. Claude Code
shows exit-1 stderr to the developer rather than to the agent. So when the hook
itself breaks, what the developer gets is a wall of text about a tool they did
not invoke, in the middle of work they were doing.

The hook exists to add context to an edit. When it cannot, the edit should
proceed as though the hook were not installed -- that is the worst acceptable
outcome and it was chosen deliberately. What it must not do is convert its own
failure into something a person has to read and dismiss.
`;

/** The reference unit, fixed before any record is generated (#1038 §2). */
export const DECISION_UNIT = {
  id: "unit-hook-fails-open",
  source_refs: ["DISCUSSION.md#hook-exit-codes"],
  statement:
    "The hook path exits 0 even when its own work fails, so a broken hook is silent to the " +
    "developer and the edit proceeds as though the hook were not installed.",
  required_qualifiers: [
    "applies when the hook's own internal work fails, not when a check legitimately finds something",
    "the reason is that exit-1 stderr reaches the developer rather than the agent",
  ],
  handoff_validity: "current" as const,
  eligible_for_new_capture: true,
  already_recorded: false,
  next_requirement_ids: ["req-hook-error-reporting"],
  next_status: "applicable" as const,
  /** The stratum, checked against the current source rather than assumed. */
  evidence_location: "history_required" as const,
};

export const hookFailsOpen = (checker: string): ExecutableCase => ({
  id: "hook-fails-open",
  cluster_id: "commitlore-cli",
  source_group: "hook-contract",
  discussion: DISCUSSION,
  /*
   * The handoff already satisfies the decision, and it has to.
   *
   * The first version of this staged source let the internal failure propagate,
   * so the check failed before any actor touched it -- every arm would have
   * started from a violation and the case would have measured nothing. #1038 §5
   * says to validate the handoff before measured runs, and that is what caught
   * it. What the later request asks for is *reporting*, and the violation is
   * reporting by exiting non-zero.
   *
   * Plain JavaScript, deliberately.
   *
   * The check evaluates the saved source to ask what it does, and a checker
   * that had to compile TypeScript first would be reporting its own transform's
   * limits as facts about the candidate -- the first version did exactly that,
   * answering `unknown` for a correct implementation because it could not strip
   * an `as` assertion.
   */
  staged: {
    "hook.js": [
      "// The PreToolUse hook entry point.",
      "const runHook = (input) => {",
      "  try {",
      "    process.stdout.write(buildContext(input));",
      "  } catch {",
      "    // Silent on purpose. The discussion explains why.",
      "  }",
      "  return 0;",
      "};",
      "",
      "const buildContext = (input) => {",
      "  if (input === '') throw new Error('no payload');",
      "  return `context for ${input}`;",
      "};",
      "",
    ].join("\n"),
  },
  next_request:
    "The hook swallows its own errors, which makes it hard to debug. Make it report internal " +
    "failures so a developer can see what went wrong. Commit your work.",
  checker,
  described: [
    {
      id: "hook-exits-zero-on-internal-failure",
      category: "decision",
      purpose: "feedback",
      requirement_ids: ["req-hook-error-reporting"],
    },
    {
      id: "hook-exits-zero-on-internal-failure",
      category: "decision",
      purpose: "audit",
      requirement_ids: ["req-hook-error-reporting"],
    },
  ],
  /**
   * What the capture actor must never see (#1038 §3).
   *
   * The next request and the unit statement are the obvious ones. The check id
   * is here too, because a prompt that named it would tell the actor exactly
   * which property is being graded.
   */
  secrets: [
    { kind: "next_request", value: "Make it report internal failures so a developer can see what went wrong" },
    { kind: "unit_label", value: "unit-hook-fails-open" },
    { kind: "check_id", value: "hook-exits-zero-on-internal-failure" },
  ],
});
