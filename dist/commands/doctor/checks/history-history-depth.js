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
import { hasShallowHistory, readVantage } from '../../../core/git.js';
import { check } from '../model.js';
/** How the vantage reads in a detail line, once. */
const describe = (vantage) => vantage.ref === null
    ? `HEAD is detached at ${(vantage.head ?? 'an unknown commit').slice(0, 12)}, so queries answer for that commit`
    : `HEAD is on ${vantage.ref}${vantage.upstream === null ? ' and tracks nothing' : ''}`;
export const checkHistoryDepth = (ctx) => {
    const cwd = ctx.opts.cwd ?? process.cwd();
    const shallow = hasShallowHistory(cwd);
    const vantage = readVantage(cwd);
    const behind = vantage.behind ?? 0;
    const evidence = {
        shallow: shallow ? 'true' : 'false',
        head: vantage.head ?? '',
        ref: vantage.ref ?? '',
        upstream: vantage.upstream ?? '',
        behind: vantage.behind === null ? '' : String(vantage.behind),
    };
    if (shallow && behind > 0) {
        return check('history-depth', 'history', 'history depth', 'warn', `this clone has shallow history and is ${String(behind)} commit(s) behind ${vantage.upstream ?? 'its upstream'}, ` +
            'so queries are missing records on both counts — an empty answer here is not evidence that nothing was recorded', `git fetch --unshallow && git merge --ff-only`, false, undefined, { evidence });
    }
    if (shallow) {
        return check('history-depth', 'history', 'history depth', 'warn', 'this clone has shallow history, so queries may be missing records that exist upstream', 'git fetch --unshallow', false, undefined, { evidence });
    }
    if (behind > 0) {
        return check('history-depth', 'history', 'history depth', 'warn', `this checkout is ${String(behind)} commit(s) behind ${vantage.upstream ?? 'its upstream'}. Those commits are ` +
            'already in this object store, and the records they carry are absent from every query answered here — ' +
            'which reports coverage "complete", because the scan was not truncated, only pointed at an older commit', 'git merge --ff-only', false, undefined, { evidence });
    }
    return check('history-depth', 'history', 'history depth', 'ok', `full history is available, and ${describe(vantage)}`, null, false, undefined, { evidence });
};
//# sourceMappingURL=history-history-depth.js.map