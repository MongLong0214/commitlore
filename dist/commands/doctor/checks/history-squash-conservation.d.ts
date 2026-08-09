/**
 * The `squash-conservation` doctor check.
 *
 * It owns the local branch/history comparison because squash loss can be
 * diagnosed from Git and records alone, without coupling to sibling checks.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
/**
 * Detects records a squash may have collapsed out of reach, and says so
 * (SPEC §2.4, bug-issue-60 finding 1: nothing invokes `squash-preserve`, and
 * for GitHub's server-side squash button nothing local can — the collapse
 * happens on a server this checkout never runs code on). Detection is the
 * honest answer where prevention is impossible.
 *
 * `Ruled-out: a CI step comparing a PR's commits against its post-merge
 * squash commit`. That is the complementary check for the case this one
 * cannot reach — a repository whose feature branch was deleted by the
 * squash before the next local clone or fetch — but it needs the GitHub API
 * to reconstruct a PR's original commits (this tool takes no HTTP dependency
 * anywhere else) and it can only ever run *after* the squash has already
 * happened and been pushed, which is too late to fix locally. `doctor` runs
 * at the moment the mistake is still cheap to fix: right after a local
 * `git merge --squash`, when the feature branch this check looks for is, in
 * the overwhelmingly common case, still sitting right there in
 * `refs/heads`. A CI step remains worth adding separately for the server-side
 * case (documented, not built here — see the module doc comment above).
 *
 * A candidate branch (`squashCandidates`) that declared no `Record-Id` at all
 * cannot be checked this way: without an identity there is nothing to search
 * HEAD's history for by name, and guessing by content would be exactly the
 * kind of heuristic this project has repeatedly found unsafe (SPEC §2.1 B3).
 * That is a real, narrower gap than "detects every lost record" and is
 * reported as such rather than silently passed over.
 */
export declare const checkSquashConservation: (ctx: DoctorContext) => DoctorCheck;
