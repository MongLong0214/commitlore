/**
 * The `history-depth` doctor check.
 *
 * It owns the shallow-history observation because history completeness is an
 * independent limitation on every query, not a dependency on another check.
 */
import { hasShallowHistory } from '../../../core/git.js';
import { check } from '../model.js';
export const checkHistoryDepth = (opts) => hasShallowHistory(opts.cwd ?? process.cwd())
    ? check('history-depth', 'history', 'history depth', 'warn', 'this clone has shallow history, so queries may be missing records that exist upstream', 'git fetch --unshallow', false, undefined, { evidence: { shallow: 'true' } })
    : check('history-depth', 'history', 'history depth', 'ok', 'full history is available', null, false, undefined, { evidence: { shallow: 'false' } });
//# sourceMappingURL=history-history-depth.js.map