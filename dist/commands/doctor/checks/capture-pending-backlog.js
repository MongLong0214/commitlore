/**
 * The `pending-backlog` doctor check.
 *
 * It owns the pending-transaction diagnosis because only that subsystem can
 * distinguish an ordinary waiting capture from one that can no longer apply.
 */
import { runPendingList } from '../../pending.js';
import { check } from '../model.js';
/**
 * #458: captures that were prepared and then never reached a commit.
 *
 * Found in the field, not in a fixture. A repository with 815 commits, hooks
 * installed and an index current with HEAD held **zero** CommitLore records —
 * and `doctor` reported all ten of its checks `ok`. Four captures sat in
 * `.git/commitlore/pending/`, one of them staged with a passing validation and
 * a record ready to attach, all four eight days old.
 *
 * The chain: `capture-stage` stamps `expires_at = staged_at + 5 minutes`; the
 * commit did not happen inside that window; `prepare-commit-msg` skipped the
 * record because it had expired; `pending-gc` protects the staged phase and so
 * never collected the file. Every step behaved as designed, and the net effect
 * was that the product silently stopped producing records.
 *
 * `pending ls` already prints `stale` and `never-collected` on exactly these
 * rows. The information existed; the command people actually run did not carry
 * it. That is #402 and #400's category — the first screen reporting ready while
 * the thing it reports on has stopped working — and it is why this check exists
 * rather than a longer TTL. The expiry is doing its job: a staged record binds
 * to the tree it was prepared for, and attaching it to a different one is worse
 * than dropping it. The defect is the silence.
 */
export const checkPendingBacklog = (opts) => {
    const title = 'pending captures';
    const id = 'pending-backlog';
    const category = 'capture';
    const cwd = opts.cwd ?? process.cwd();
    let listing;
    try {
        listing = runPendingList({ cwd });
    }
    catch {
        return check(id, category, title, 'ok', 'no pending directory — nothing has been captured here yet', null, false, undefined, { evidence: { stranded: '0', staged_expired: '0', oldest: 'none' } });
    }
    if (listing.unreadable.length > 0) {
        return check(id, category, title, 'warn', `${listing.unreadable.length} pending file(s) cannot be read as a transaction`, 'commitlore pending ls', false, undefined, {
            evidence: {
                stranded: '0',
                staged_expired: '0',
                oldest: 'none',
                unreadable: String(listing.unreadable.length),
            },
        });
    }
    // A stale transaction can no longer apply: its base_head is not HEAD, so the
    // commit it was prepared for either never happened or happened without it.
    const stranded = listing.transactions.filter((transaction) => transaction.stale);
    if (stranded.length === 0) {
        const held = listing.transactions.length;
        return check(id, category, title, 'ok', held === 0 ? 'no captures are waiting' : `${String(held)} capture(s) waiting, all still able to apply`, null, false, undefined, {
            evidence: {
                stranded: '0',
                staged_expired: '0',
                oldest: 'none',
                waiting: String(held),
            },
        });
    }
    const lost = stranded.filter((transaction) => transaction.phase === 'staged');
    const oldest = stranded
        .map((transaction) => transaction.created_at)
        .sort()[0];
    // A staged transaction that went stale is a record that was drafted,
    // verified, staged, and then dropped. That is a failed capture, not a
    // pending one, and it is the case worth interrupting someone for.
    const detail = lost.length > 0
        ? `${String(lost.length)} staged capture(s) expired before reaching a commit and were dropped` +
            (stranded.length > lost.length
                ? `, alongside ${String(stranded.length - lost.length)} earlier draft(s) that never staged`
                : '')
        : `${String(stranded.length)} capture(s) can no longer apply — their base commit is no longer HEAD`;
    return check(id, category, title, 'warn', `${detail}; oldest from ${oldest ?? 'an unknown time'}. ` +
        'A staged record binds to the tree it was prepared for and is skipped once that tree moves, ' +
        'so these decisions were never written to the history (#458)', 'commitlore pending ls', false, undefined, {
        evidence: {
            stranded: String(stranded.length),
            staged_expired: String(lost.length),
            oldest: oldest ?? 'unknown',
        },
    });
};
//# sourceMappingURL=capture-pending-backlog.js.map