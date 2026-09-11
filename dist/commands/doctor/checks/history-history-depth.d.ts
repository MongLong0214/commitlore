/**
 * The `history-depth` doctor check.
 *
 * It owns the shallow-history observation because history completeness is an
 * independent limitation on every query, not a dependency on another check.
 *
 * #930 gave it a second instance of the same idea. A shallow clone cannot see
 * records that were never fetched; a checkout behind its upstream cannot see
 * records it *has* already fetched. Both make every query answer less than the
 * truth while nothing in the answer used to say so, and both are one command
 * away from fixed -- which is what keeps this a row rather than a fact. A row
 * that cannot be cleared by fixing the thing it names teaches people to skip
 * the section.
 *
 * Detached HEAD is stated, never warned about. `git worktree add <path> <ref>`
 * is how a review is set up, the narrower scope is the point of being there,
 * and a warning would fire on every one of them.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
export declare const checkHistoryDepth: (ctx: DoctorContext) => DoctorCheck;
