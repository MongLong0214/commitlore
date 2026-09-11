/**
 * The `squash-inheritance` doctor check (#915).
 *
 * A squash merge drops the branch commits' trailers, so the record is lost unless
 * something carries it onto the commit that squashed it. Two paths already do:
 *
 *   - a **local** `git merge --squash` is handled by the installed
 *     `prepare-commit-msg` hook, which reads `SQUASH_MSG` and appends every
 *     squashed record block to the draft (`src/hooks/prepare-commit-msg.ts`);
 *   - a **server-side** squash — the GitHub merge button — runs no local hook at
 *     all, and is handled by the `action/preserve` GitHub Action (ADR-0004).
 *
 * The second is the one nobody has running. It was built, this repository runs it
 * on itself, and it appeared in no README until #915: the reporter made one
 * record in twelve commits, the squash dropped it, and they found out only
 * because they went looking. Nothing was broken — the protection simply was not
 * installed, and no surface said so.
 *
 * `squash-conservation` is the other half of this and reports after the fact, on
 * records that are already gone. This one reports before: a repository with a
 * GitHub remote and no inheritance workflow will lose the next record it makes on
 * a branch, and that is knowable now.
 *
 * Deliberately a `warn` and not a `fail`. A repository may merge with merge
 * commits or rebase, where records survive on their own, and this check cannot
 * read the remote's merge settings — so it reports an exposure, not a defect.
 * Scoped to a GitHub remote because the Action is GitHub's mechanism; a GitLab or
 * Gitea host squashes too and has no answer here yet, which the detail says
 * rather than implying the check covered it.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
export declare const checkSquashInheritance: (ctx: DoctorContext) => DoctorCheck;
